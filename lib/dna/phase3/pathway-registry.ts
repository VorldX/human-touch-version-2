import "server-only";

import { createHash } from "node:crypto";

import { createDeterministicEmbedding, toPgVectorLiteral } from "@/lib/ai/embeddings";
import { prisma } from "@/lib/db/prisma";
import { DNA_PHASE3_SCHEMA_VERSION, dnaPhase3Config } from "@/lib/dna/phase3/config";

interface PathwayRow {
  id: number;
  pathwayId: string;
  pathwayName: string;
  status: "ACTIVE" | "DEPRECATED";
  schemaVersion: string;
  version: number;
  pathwayJsonb: unknown;
  overridesPathwayId: string | null;
  metadataJsonb: unknown;
  updatedAt: Date;
}

interface PathwayInsertRow {
  id: number;
  pathwayId: string;
  version: number;
}

interface ExistingRuleRow {
  id: number;
  version: number;
  metadataJsonb: unknown;
}

interface StepDefinition {
  stepKey: string;
  title: string;
  metadata: Record<string, unknown>;
}

function asJson(value: unknown) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function normalizeText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function hashJson(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function tokenEstimate(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

function normalizePathwayPayload(input: {
  pathwayName?: string;
  pathway: unknown;
}) {
  const root = asRecord(input.pathway);

  const explicitPathway = normalizeText(root.pathway);
  const pathwayName = normalizeText(input.pathwayName) || explicitPathway || "Pathway";

  const rawSteps = Array.isArray(root.steps) ? root.steps : [];
  const maxSteps = Math.max(1, dnaPhase3Config.pathwayRegistry.maxSteps);

  const steps: StepDefinition[] = rawSteps
    .slice(0, maxSteps)
    .map((item, index) => {
      if (typeof item === "string") {
        const title = item.trim();
        return {
          stepKey: `step_${index + 1}`,
          title: title || `Step ${index + 1}`,
          metadata: {}
        };
      }

      if (item && typeof item === "object" && !Array.isArray(item)) {
        const record = item as Record<string, unknown>;
        const explicitKey = normalizeText(record.step_key) || normalizeText(record.key);
        const explicitTitle =
          normalizeText(record.title) || normalizeText(record.step) || normalizeText(record.description);

        const looseKeys = Object.keys(record).filter((key) => /^step[_-]?\d+$/i.test(key));
        if (!explicitTitle && looseKeys.length > 0) {
          const matchedKey = looseKeys[0] ?? "";
          const matchedTitle = normalizeText(record[matchedKey]);
          return {
            stepKey: explicitKey || matchedKey.toLowerCase(),
            title: matchedTitle || `Step ${index + 1}`,
            metadata: record
          };
        }

        return {
          stepKey: explicitKey || `step_${index + 1}`,
          title: explicitTitle || `Step ${index + 1}`,
          metadata: record
        };
      }

      return {
        stepKey: `step_${index + 1}`,
        title: `Step ${index + 1}`,
        metadata: {}
      };
    })
    .filter((step) => step.title.length > 0);

  if (steps.length === 0) {
    throw new Error("Pathway requires at least one step.");
  }

  const normalizedPathway = {
    pathway: pathwayName,
    steps: steps.map((step) => ({
      step_key: step.stepKey,
      title: step.title,
      ...step.metadata
    }))
  };

  return {
    pathwayName,
    steps,
    normalizedPathway
  };
}

export async function ensurePhase3Partitions(input: {
  tenantId: string;
  userId: string;
}) {
  await prisma.$queryRawUnsafe(
    "SELECT * FROM dna_memory.ensure_phase3_partition_for_subject($1, $2)",
    input.tenantId,
    input.userId
  );
}

export async function listPathwayRegistry(input: {
  tenantId: string;
  userId: string;
  includeDeprecated?: boolean;
  limit?: number;
}) {
  await ensurePhase3Partitions({ tenantId: input.tenantId, userId: input.userId });

  const rows = await prisma.$queryRawUnsafe<PathwayRow[]>(
    `
      SELECT
        id,
        pathway_id::text AS "pathwayId",
        pathway_name AS "pathwayName",
        status::text AS status,
        schema_version AS "schemaVersion",
        version,
        pathway_jsonb AS "pathwayJsonb",
        overrides_pathway_id::text AS "overridesPathwayId",
        metadata_jsonb AS "metadataJsonb",
        updated_at AS "updatedAt"
      FROM dna_memory.pathway_registry
      WHERE tenant_id = $1
        AND user_id = $2
        AND ($3::boolean OR status <> 'DEPRECATED'::dna_memory.pathway_status)
      ORDER BY updated_at DESC
      LIMIT $4
    `,
    input.tenantId,
    input.userId,
    Boolean(input.includeDeprecated),
    Math.max(1, Math.min(200, Math.floor(input.limit ?? 60)))
  );

  return rows;
}

export async function upsertPathwayRegistry(input: {
  tenantId: string;
  userId: string;
  pathwayName?: string;
  pathway: unknown;
  overridesPathwayId?: string | null;
  actor?: string;
}) {
  await ensurePhase3Partitions({ tenantId: input.tenantId, userId: input.userId });
  await prisma.$queryRawUnsafe(
    "SELECT * FROM dna_memory.ensure_partition_for_subject($1, $2)",
    input.tenantId,
    input.userId
  );

  const normalized = normalizePathwayPayload({
    pathwayName: input.pathwayName,
    pathway: input.pathway
  });

  const pathwayHash = hashJson(normalized.normalizedPathway);

  let deprecatedPathwayId: string | null = null;
  const overrideId = normalizeText(input.overridesPathwayId);
  if (overrideId) {
    const deprecatedRows = await prisma.$queryRawUnsafe<Array<{ id: number; version: number }>>(
      `
        SELECT id, version
        FROM dna_memory.pathway_registry
        WHERE tenant_id = $1
          AND user_id = $2
          AND pathway_id = $3::uuid
          AND status = 'ACTIVE'::dna_memory.pathway_status
        ORDER BY updated_at DESC
        LIMIT 1
      `,
      input.tenantId,
      input.userId,
      overrideId
    );

    const deprecated = deprecatedRows[0];
    if (deprecated) {
      await prisma.$queryRawUnsafe(
        `
          SELECT *
          FROM dna_memory.update_pathway_registry_occ(
            $1,
            $2,
            $3,
            $4,
            NULL,
            'DEPRECATED'::dna_memory.pathway_status,
            $5::jsonb,
            NULL
          )
        `,
        input.tenantId,
        input.userId,
        deprecated.id,
        deprecated.version,
        asJson({
          deprecated_at: new Date().toISOString(),
          deprecated_by: input.actor ?? "phase3.pathway-registry"
        })
      );
      deprecatedPathwayId = overrideId;
    }
  }

  const inserted = await prisma.$queryRawUnsafe<PathwayInsertRow[]>(
    `
      INSERT INTO dna_memory.pathway_registry (
        tenant_id,
        user_id,
        pathway_name,
        pathway_jsonb,
        pathway_hash,
        status,
        overrides_pathway_id,
        schema_version,
        metadata_jsonb
      )
      VALUES (
        $1,
        $2,
        $3,
        $4::jsonb,
        $5,
        'ACTIVE'::dna_memory.pathway_status,
        $6::uuid,
        $7,
        $8::jsonb
      )
      RETURNING id, pathway_id::text AS "pathwayId", version
    `,
    input.tenantId,
    input.userId,
    normalized.pathwayName,
    asJson(normalized.normalizedPathway),
    pathwayHash,
    deprecatedPathwayId,
    DNA_PHASE3_SCHEMA_VERSION,
    asJson({
      source: "phase3.pathway-registry",
      actor: input.actor ?? null,
      created_at: new Date().toISOString()
    })
  );

  const row = inserted[0];
  if (!row?.pathwayId) {
    throw new Error("Unable to create pathway registry record.");
  }

  const pathwayDocumentId = `sop.pathway.${row.pathwayId}`;
  const content = JSON.stringify(normalized.normalizedPathway);
  const embedding = createDeterministicEmbedding(
    `${normalized.pathwayName}\n${normalized.steps.map((step) => step.title).join("\n")}`,
    512
  );
  const vectorLiteral = toPgVectorLiteral(embedding);

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO dna_memory.central_memory (
        tenant_id,
        user_id,
        tier,
        memory_domain,
        memory_kind,
        document_id,
        chunk_index,
        token_count,
        content,
        embedding,
        metadata_jsonb,
        schema_version,
        version
      )
      VALUES (
        $1,
        $2,
        'LONG_TERM'::dna_memory.memory_tier,
        'WORKING'::dna_memory.memory_domain,
        'SOP_PATHWAY'::dna_memory.memory_kind,
        $3,
        0,
        $4,
        $5,
        $6::vector,
        $7::jsonb,
        $8,
        1
      )
      ON CONFLICT (tenant_id, user_id, tier, document_id, chunk_index)
      DO UPDATE
      SET
        content = EXCLUDED.content,
        embedding = EXCLUDED.embedding,
        token_count = EXCLUDED.token_count,
        metadata_jsonb = EXCLUDED.metadata_jsonb,
        schema_version = EXCLUDED.schema_version,
        version = dna_memory.central_memory.version + 1,
        updated_at = NOW()
    `,
    input.tenantId,
    input.userId,
    pathwayDocumentId,
    tokenEstimate(content),
    content,
    vectorLiteral,
    asJson({
      pathway_id: row.pathwayId,
      pathway_name: normalized.pathwayName,
      step_count: normalized.steps.length,
      schema_version: DNA_PHASE3_SCHEMA_VERSION,
      source: "phase3.pathway-registry",
      overrides_pathway_id: deprecatedPathwayId
    }),
    DNA_PHASE3_SCHEMA_VERSION
  );

  return {
    id: row.id,
    pathwayId: row.pathwayId,
    pathwayName: normalized.pathwayName,
    stepCount: normalized.steps.length,
    deprecatedPathwayId
  };
}

export async function upsertWorkingRuleWithCollision(input: {
  tenantId: string;
  userId: string;
  ruleId: string;
  content: string;
  overridesRuleId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await prisma.$queryRawUnsafe(
    "SELECT * FROM dna_memory.ensure_partition_for_subject($1, $2)",
    input.tenantId,
    input.userId
  );

  const ruleId = normalizeText(input.ruleId);
  const content = normalizeText(input.content);
  if (!ruleId || !content) {
    throw new Error("ruleId and content are required.");
  }

  const overridesRuleId = normalizeText(input.overridesRuleId);
  let deprecatedRuleMemoryId: number | null = null;

  if (overridesRuleId) {
    const existingRuleRows = await prisma.$queryRawUnsafe<ExistingRuleRow[]>(
      `
        SELECT id, version, metadata_jsonb AS "metadataJsonb"
        FROM dna_memory.central_memory
        WHERE tenant_id = $1
          AND user_id = $2
          AND tier = 'LONG_TERM'::dna_memory.memory_tier
          AND memory_domain = 'WORKING'::dna_memory.memory_domain
          AND memory_kind = 'RULE'::dna_memory.memory_kind
          AND document_id = $3
          AND chunk_index = 0
        ORDER BY updated_at DESC
        LIMIT 1
      `,
      input.tenantId,
      input.userId,
      overridesRuleId
    );

    const existingRule = existingRuleRows[0];
    if (existingRule) {
      const oldMetadata = asRecord(existingRule.metadataJsonb);
      const deprecatedMetadata = {
        ...oldMetadata,
        deprecated: true,
        deprecated_at: new Date().toISOString(),
        superseded_by_rule_id: ruleId,
        superseded_reason: "overrides_rule_id"
      };

      await prisma.$queryRawUnsafe(
        `
          SELECT *
          FROM dna_memory.update_central_memory_occ(
            $1,
            $2,
            $3,
            $4,
            NULL,
            $5::jsonb,
            NULL,
            NOW()
          )
        `,
        input.tenantId,
        input.userId,
        existingRule.id,
        existingRule.version,
        asJson(deprecatedMetadata)
      );

      deprecatedRuleMemoryId = existingRule.id;
    }
  }

  const embedding = createDeterministicEmbedding(content, 512);
  const vectorLiteral = toPgVectorLiteral(embedding);
  const metadata = {
    ...(input.metadata ?? {}),
    schema_version: DNA_PHASE3_SCHEMA_VERSION,
    source: "phase3.rule-collision",
    overrides_rule_id: overridesRuleId || null,
    deprecated: false
  };

  const existingRows = await prisma.$queryRawUnsafe<ExistingRuleRow[]>(
    `
      SELECT id, version, metadata_jsonb AS "metadataJsonb"
      FROM dna_memory.central_memory
      WHERE tenant_id = $1
        AND user_id = $2
        AND tier = 'LONG_TERM'::dna_memory.memory_tier
        AND memory_domain = 'WORKING'::dna_memory.memory_domain
        AND memory_kind = 'RULE'::dna_memory.memory_kind
        AND document_id = $3
        AND chunk_index = 0
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    input.tenantId,
    input.userId,
    ruleId
  );

  const existing = existingRows[0];
  if (existing) {
    const updated = await prisma.$queryRawUnsafe<Array<{ applied: boolean }>>(
      `
        SELECT applied
        FROM dna_memory.update_central_memory_occ(
          $1,
          $2,
          $3,
          $4,
          $5,
          $6::jsonb,
          $7,
          NOW()
        )
      `,
      input.tenantId,
      input.userId,
      existing.id,
      existing.version,
      content,
      asJson(metadata),
      tokenEstimate(content)
    );

    if (!updated[0]?.applied) {
      throw new Error("Rule update OCC conflict. Retry with latest version.");
    }

    await prisma.$executeRawUnsafe(
      `
        UPDATE dna_memory.central_memory
        SET embedding = $1::vector
        WHERE tenant_id = $2
          AND user_id = $3
          AND id = $4
      `,
      vectorLiteral,
      input.tenantId,
      input.userId,
      existing.id
    );

    return {
      memoryId: existing.id,
      ruleId,
      deprecatedRuleMemoryId,
      created: false
    };
  }

  const insertedRows = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
    `
      INSERT INTO dna_memory.central_memory (
        tenant_id,
        user_id,
        tier,
        memory_domain,
        memory_kind,
        document_id,
        chunk_index,
        token_count,
        content,
        embedding,
        metadata_jsonb,
        schema_version,
        version
      )
      VALUES (
        $1,
        $2,
        'LONG_TERM'::dna_memory.memory_tier,
        'WORKING'::dna_memory.memory_domain,
        'RULE'::dna_memory.memory_kind,
        $3,
        0,
        $4,
        $5,
        $6::vector,
        $7::jsonb,
        $8,
        1
      )
      RETURNING id
    `,
    input.tenantId,
    input.userId,
    ruleId,
    tokenEstimate(content),
    content,
    vectorLiteral,
    asJson(metadata),
    DNA_PHASE3_SCHEMA_VERSION
  );

  const inserted = insertedRows[0];
  if (!inserted?.id) {
    throw new Error("Unable to persist working rule.");
  }

  return {
    memoryId: inserted.id,
    ruleId,
    deprecatedRuleMemoryId,
    created: true
  };
}
