import "server-only";

import { prisma } from "@/lib/db/prisma";
import { dnaPhase4Config } from "@/lib/dna/phase4/config";

interface ExplorerRow {
  id: number;
  tier: "LONG_TERM" | "ARCHIVE" | "STAGING";
  memoryDomain: "CONTEXTUAL" | "WORKING";
  memoryKind: string;
  documentId: string;
  chunkIndex: number;
  tokenCount: number;
  content: string;
  metadataJsonb: unknown;
  schemaVersion: string;
  version: number;
  updatedAt: Date;
}

interface ExplorerSummaryRow {
  tier: "LONG_TERM" | "ARCHIVE" | "STAGING";
  memoryDomain: "CONTEXTUAL" | "WORKING";
  count: number;
}

function parseLimit(value: number | undefined, fallback: number, max: number) {
  if (!Number.isFinite(value) || !value || value <= 0) return fallback;
  return Math.max(1, Math.min(max, Math.floor(value)));
}

function parseEnum<T extends string>(value: string | undefined, allowed: readonly T[]): T | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase() as T;
  return allowed.includes(normalized) ? normalized : null;
}

export async function listDnaExplorerEntries(input: {
  tenantId: string;
  userId: string;
  limit?: number;
  offset?: number;
  tier?: string;
  memoryDomain?: string;
}) {
  const limit = parseLimit(
    input.limit,
    dnaPhase4Config.explorer.defaultLimit,
    dnaPhase4Config.explorer.maxLimit
  );
  const offset = Math.max(0, Math.floor(input.offset ?? 0));

  const tier = parseEnum(input.tier, ["LONG_TERM", "ARCHIVE", "STAGING"] as const);
  const memoryDomain = parseEnum(input.memoryDomain, ["CONTEXTUAL", "WORKING"] as const);

  const [rows, summary] = await Promise.all([
    prisma.$queryRawUnsafe<ExplorerRow[]>(
      `
        SELECT
          id,
          tier::text AS tier,
          memory_domain::text AS "memoryDomain",
          memory_kind::text AS "memoryKind",
          document_id AS "documentId",
          chunk_index AS "chunkIndex",
          token_count AS "tokenCount",
          content,
          metadata_jsonb AS "metadataJsonb",
          schema_version AS "schemaVersion",
          version,
          updated_at AS "updatedAt"
        FROM dna_memory.central_memory
        WHERE tenant_id = $1
          AND user_id = $2
          AND ($3::text = '' OR tier = $3::dna_memory.memory_tier)
          AND ($4::text = '' OR memory_domain = $4::dna_memory.memory_domain)
        ORDER BY updated_at DESC
        LIMIT $5
        OFFSET $6
      `,
      input.tenantId,
      input.userId,
      tier ?? "",
      memoryDomain ?? "",
      limit,
      offset
    ),
    prisma.$queryRawUnsafe<ExplorerSummaryRow[]>(
      `
        SELECT
          tier::text AS tier,
          memory_domain::text AS "memoryDomain",
          COUNT(*)::int AS count
        FROM dna_memory.central_memory
        WHERE tenant_id = $1
          AND user_id = $2
        GROUP BY tier, memory_domain
      `,
      input.tenantId,
      input.userId
    )
  ]);

  return {
    entries: rows,
    summary,
    limit,
    offset
  };
}
