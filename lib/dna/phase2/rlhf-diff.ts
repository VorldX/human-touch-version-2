import "server-only";

import { createDeterministicEmbedding, toPgVectorLiteral } from "@/lib/ai/embeddings";
import { prisma } from "@/lib/db/prisma";
import {
  DNA_PHASE2_SCHEMA_VERSION,
  dnaPhase2Config
} from "@/lib/dna/phase2/config";
import { ensurePhase2Partitions } from "@/lib/dna/phase2/claim-check";

function normalize(text: string) {
  return text.replace(/\r\n?/g, "\n").trim();
}

function tokenEstimate(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

function buildLineDiff(original: string, edited: string) {
  const before = normalize(original).split("\n");
  const after = normalize(edited).split("\n");

  const max = Math.max(before.length, after.length);
  const lines: string[] = [];

  for (let index = 0; index < max; index += 1) {
    const left = before[index] ?? "";
    const right = after[index] ?? "";
    if (left === right) {
      if (left) {
        lines.push(` ${left}`);
      }
      continue;
    }
    if (left) {
      lines.push(`-${left}`);
    }
    if (right) {
      lines.push(`+${right}`);
    }
  }

  return lines.join("\n");
}

function asJson(value: unknown) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

export async function processRlhfDiff(input: {
  tenantId: string;
  userId: string;
  sessionId?: string | null;
  originalOutput: string;
  editedOutput: string;
  ruleScope: "PERSONAL" | "GLOBAL";
}) {
  await ensurePhase2Partitions({ tenantId: input.tenantId, userId: input.userId });
  await prisma.$queryRawUnsafe(
    "SELECT * FROM dna_memory.ensure_partition_for_subject($1, $2)",
    input.tenantId,
    input.userId
  );

  const originalOutput = normalize(input.originalOutput);
  const editedOutput = normalize(input.editedOutput);
  if (!originalOutput || !editedOutput) {
    throw new Error("Both originalOutput and editedOutput are required.");
  }

  const diffPatch = buildLineDiff(originalOutput, editedOutput);
  const resolvedAs = input.ruleScope === "PERSONAL" ? "AUTO_APPROVED" : "STAGED";

  const eventRows = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
    `
      INSERT INTO dna_memory.rlhf_diff_events (
        tenant_id,
        user_id,
        session_id,
        rule_scope,
        original_output,
        edited_output,
        diff_patch,
        resolved_as,
        schema_version,
        metadata_jsonb
      )
      VALUES (
        $1,
        $2,
        $3,
        $4::dna_memory.rlhf_rule_scope,
        $5,
        $6,
        $7,
        $8::dna_memory.rlhf_resolution,
        $9,
        $10::jsonb
      )
      RETURNING id
    `,
    input.tenantId,
    input.userId,
    input.sessionId ?? null,
    input.ruleScope,
    originalOutput,
    editedOutput,
    diffPatch,
    resolvedAs,
    DNA_PHASE2_SCHEMA_VERSION,
    asJson({
      processor: "phase2.rlhf.diff-engine",
      slm_model: dnaPhase2Config.slm.model,
      generated_at: new Date().toISOString()
    })
  );

  const diffEventId = eventRows[0]?.id;
  if (!diffEventId) {
    throw new Error("Unable to persist RLHF diff event.");
  }

  const documentId =
    resolvedAs === "AUTO_APPROVED"
      ? `rlhf.personal.rule.${input.userId}`
      : `rlhf.global.staging.${diffEventId}`;

  const embedding = createDeterministicEmbedding(editedOutput, 512);
  const vectorLiteral = toPgVectorLiteral(embedding);
  const metadata = {
    diff_event_id: diffEventId,
    rule_scope: input.ruleScope,
    resolution: resolvedAs,
    source: "phase2.rlhf.diff-engine",
    schema_version: DNA_PHASE2_SCHEMA_VERSION,
    session_id: input.sessionId ?? null
  };

  if (resolvedAs === "AUTO_APPROVED") {
    const existingRows = await prisma.$queryRawUnsafe<Array<{ id: number; version: number }>>(
      `
        SELECT id, version
        FROM dna_memory.central_memory
        WHERE tenant_id = $1
          AND user_id = $2
          AND document_id = $3
          AND chunk_index = 0
          AND tier = 'LONG_TERM'::dna_memory.memory_tier
        ORDER BY updated_at DESC
        LIMIT 1
      `,
      input.tenantId,
      input.userId,
      documentId
    );

    const existing = existingRows[0];

    if (existing) {
      await prisma.$queryRawUnsafe(
        `
          SELECT *
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
        editedOutput,
        asJson(metadata),
        tokenEstimate(editedOutput)
      );

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
    } else {
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
        `,
        input.tenantId,
        input.userId,
        documentId,
        tokenEstimate(editedOutput),
        editedOutput,
        vectorLiteral,
        asJson(metadata),
        DNA_PHASE2_SCHEMA_VERSION
      );
    }
  } else {
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
          'STAGING'::dna_memory.memory_tier,
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
      `,
      input.tenantId,
      input.userId,
      documentId,
      tokenEstimate(editedOutput),
      editedOutput,
      vectorLiteral,
      asJson(metadata),
      DNA_PHASE2_SCHEMA_VERSION
    );
  }

  return {
    diffEventId,
    resolvedAs,
    diffPatch
  };
}
