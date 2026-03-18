import "server-only";

import { prisma } from "@/lib/db/prisma";
import { DNA_PHASE4_SCHEMA_VERSION, dnaPhase4Config } from "@/lib/dna/phase4/config";
import { publishDnaUpdateEvent } from "@/lib/dna/phase3";

interface QuarantineRow {
  memoryId: number;
  documentId: string;
  chunkIndex: number;
  tokenCount: number;
  content: string;
  metadataJsonb: unknown;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  diffEventId: number | null;
  originalOutput: string | null;
  editedOutput: string | null;
  diffPatch: string | null;
  ruleScope: string | null;
  resolvedAs: string | null;
}

interface QuarantineReviewInput {
  tenantId: string;
  userId: string;
  reviewerUserId: string;
  memoryId: number;
  expectedVersion: number;
  action: "APPROVE" | "REJECT";
  note?: string;
}

interface PendingCountRow {
  pendingItems: number;
}

function asJson(value: unknown) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

function parseLimit(value: number | undefined, fallback: number, max: number) {
  if (!Number.isFinite(value) || !value || value <= 0) return fallback;
  return Math.max(1, Math.min(max, Math.floor(value)));
}

export async function ensurePhase4Partitions(input: {
  tenantId: string;
  userId: string;
}) {
  await prisma.$queryRawUnsafe(
    "SELECT * FROM dna_memory.ensure_phase4_partition_for_subject($1, $2)",
    input.tenantId,
    input.userId
  );
}

export async function listQuarantineItems(input: {
  tenantId: string;
  userId: string;
  limit?: number;
  offset?: number;
}) {
  await ensurePhase4Partitions({ tenantId: input.tenantId, userId: input.userId });

  const limit = parseLimit(
    input.limit,
    dnaPhase4Config.quarantine.defaultLimit,
    dnaPhase4Config.quarantine.maxLimit
  );
  const offset = Math.max(0, Math.floor(input.offset ?? 0));

  const [rows, countRows] = await Promise.all([
    prisma.$queryRawUnsafe<QuarantineRow[]>(
      `
        SELECT
          cm.id AS "memoryId",
          cm.document_id AS "documentId",
          cm.chunk_index AS "chunkIndex",
          cm.token_count AS "tokenCount",
          cm.content,
          cm.metadata_jsonb AS "metadataJsonb",
          cm.version,
          cm.created_at AS "createdAt",
          cm.updated_at AS "updatedAt",
          de.id AS "diffEventId",
          de.original_output AS "originalOutput",
          de.edited_output AS "editedOutput",
          de.diff_patch AS "diffPatch",
          de.rule_scope::text AS "ruleScope",
          de.resolved_as::text AS "resolvedAs"
        FROM dna_memory.central_memory cm
        LEFT JOIN dna_memory.rlhf_diff_events de
          ON de.tenant_id = cm.tenant_id
          AND de.user_id = cm.user_id
          AND de.id = NULLIF(cm.metadata_jsonb ->> 'diff_event_id', '')::bigint
        LEFT JOIN dna_memory.quarantine_reviews qr
          ON qr.tenant_id = cm.tenant_id
          AND qr.user_id = cm.user_id
          AND qr.memory_id = cm.id
        WHERE cm.tenant_id = $1
          AND cm.user_id = $2
          AND cm.tier = 'STAGING'::dna_memory.memory_tier
          AND qr.id IS NULL
        ORDER BY cm.updated_at DESC
        LIMIT $3
        OFFSET $4
      `,
      input.tenantId,
      input.userId,
      limit,
      offset
    ),
    prisma.$queryRawUnsafe<PendingCountRow[]>(
      `
        SELECT pending_items::int AS "pendingItems"
        FROM dna_memory.phase4_quarantine_overview
        WHERE tenant_id = $1
          AND user_id = $2
      `,
      input.tenantId,
      input.userId
    )
  ]);

  return {
    items: rows,
    total: countRows[0]?.pendingItems ?? 0,
    limit,
    offset
  };
}

export async function reviewQuarantineItem(input: QuarantineReviewInput) {
  await ensurePhase4Partitions({ tenantId: input.tenantId, userId: input.userId });

  const note = input.note?.trim() ?? "";
  const action = input.action;

  const updatedRows = await prisma.$queryRawUnsafe<Array<{ id: number; version: number; diffEventId: number | null }>>(
    `
      UPDATE dna_memory.central_memory
      SET
        tier = CASE
          WHEN $6::text = 'APPROVE' THEN 'LONG_TERM'::dna_memory.memory_tier
          ELSE 'ARCHIVE'::dna_memory.memory_tier
        END,
        document_id = CASE
          WHEN $6::text = 'APPROVE' THEN document_id || '.approved.' || id::text
          ELSE document_id || '.rejected.' || id::text
        END,
        metadata_jsonb = metadata_jsonb || $7::jsonb,
        version = version + 1,
        updated_at = NOW()
      WHERE tenant_id = $1
        AND user_id = $2
        AND id = $3
        AND version = $4
        AND tier = 'STAGING'::dna_memory.memory_tier
      RETURNING
        id,
        version,
        NULLIF(metadata_jsonb ->> 'diff_event_id', '')::bigint AS "diffEventId"
    `,
    input.tenantId,
    input.userId,
    input.memoryId,
    input.expectedVersion,
    input.reviewerUserId,
    action,
    asJson({
      review_status: action,
      reviewed_by: input.reviewerUserId,
      reviewed_at: new Date().toISOString(),
      review_note: note || null,
      schema_version: DNA_PHASE4_SCHEMA_VERSION
    })
  );

  const updated = updatedRows[0];
  if (!updated?.id) {
    return {
      applied: false,
      reason: "occ_conflict_or_missing" as const
    };
  }

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO dna_memory.quarantine_reviews (
        tenant_id,
        user_id,
        memory_id,
        diff_event_id,
        action,
        review_note,
        reviewer_user_id,
        schema_version,
        metadata_jsonb
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5::dna_memory.phase4_quarantine_action,
        $6,
        $7,
        $8,
        $9::jsonb
      )
    `,
    input.tenantId,
    input.userId,
    updated.id,
    updated.diffEventId,
    action,
    note || null,
    input.reviewerUserId,
    DNA_PHASE4_SCHEMA_VERSION,
    asJson({
      source: "phase4.quarantine",
      action,
      reviewed_at: new Date().toISOString()
    })
  );

  await publishDnaUpdateEvent({
    tenantId: input.tenantId,
    userId: input.userId,
    payload: {
      source: "phase4.quarantine.review",
      action,
      memory_id: input.memoryId,
      reviewer_user_id: input.reviewerUserId
    }
  });

  return {
    applied: true,
    action,
    memoryId: updated.id,
    newVersion: updated.version
  };
}
