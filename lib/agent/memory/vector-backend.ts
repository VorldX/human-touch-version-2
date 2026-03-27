import "server-only";

import { toPgVectorLiteral } from "@/lib/ai/embeddings";
import { agentMemoryConfig } from "@/lib/agent/memory/config";
import {
  includesArchivedAgentMemoryLifecycle,
  resolveAgentMemorySearchLifecycleStates
} from "@/lib/agent/memory/types";
import type {
  AgentMemoryRecord,
  AgentMemoryLifecycleStateValue,
  AgentMemorySearchFilters,
  AgentMemoryTypeValue,
  AgentMemoryVisibilityValue
} from "@/lib/agent/memory/types";
import { prisma } from "@/lib/db/prisma";

export interface MemoryVectorCandidate {
  memory: AgentMemoryRecord;
  distance: number;
}

export interface MemoryVectorBackend {
  searchByVector(input: {
    queryEmbedding: number[];
    filters: AgentMemorySearchFilters;
    topK: number;
  }): Promise<MemoryVectorCandidate[]>;
  delete(memoryId: string): Promise<void>;
}

function asMemoryType(value: unknown): AgentMemoryTypeValue {
  if (value === "WORKING") return "WORKING";
  if (value === "SEMANTIC") return "SEMANTIC";
  if (value === "TASK") return "TASK";
  return "EPISODIC";
}

function asVisibility(value: unknown): AgentMemoryVisibilityValue {
  if (value === "SHARED") return "SHARED";
  return "PRIVATE";
}

function asLifecycleState(value: unknown): AgentMemoryLifecycleStateValue {
  if (value === "LONG_TERM") return "LONG_TERM";
  if (value === "QUARANTINE") return "QUARANTINE";
  if (value === "ARCHIVE") return "ARCHIVE";
  return "SHORT_TERM";
}

function asDate(value: unknown) {
  if (value instanceof Date) return value;
  const parsed = new Date(String(value ?? ""));
  return Number.isFinite(parsed.getTime()) ? parsed : new Date(0);
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value.filter((item): item is string => typeof item === "string");
}

function normalizeSources(sources?: string[]) {
  return (sources ?? [])
    .map((source) => source.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function normalizeTags(tags?: string[]) {
  return (tags ?? [])
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 20);
}

class PgVectorMemoryBackend implements MemoryVectorBackend {
  async searchByVector(input: {
    queryEmbedding: number[];
    filters: AgentMemorySearchFilters;
    topK: number;
  }): Promise<MemoryVectorCandidate[]> {
    const vectorLiteral = toPgVectorLiteral(input.queryEmbedding);
    const lifecycleStates = resolveAgentMemorySearchLifecycleStates(input.filters);
    const where: string[] = [
      '"orgId" = $2',
      'embedding IS NOT NULL'
    ];
    const params: unknown[] = [vectorLiteral, input.filters.orgId];
    let index = 3;

    const addEquals = (field: string, value: string | null | undefined) => {
      if (!value) return;
      where.push(`"${field}" = $${index}`);
      params.push(value);
      index += 1;
    };

    addEquals("sessionId", input.filters.sessionId);
    addEquals("projectId", input.filters.projectId);
    addEquals("userId", input.filters.userId);
    addEquals("agentId", input.filters.agentId);

    if (lifecycleStates.length > 0) {
      const placeholders = lifecycleStates.map(() => `$${index++}`);
      params.push(...lifecycleStates);
      where.push(`"lifecycleState" IN (${placeholders.join(", ")})`);
    }

    if (!includesArchivedAgentMemoryLifecycle(lifecycleStates)) {
      where.push('"archivedAt" IS NULL');
    }

    if (input.filters.memoryTypes && input.filters.memoryTypes.length > 0) {
      const placeholders = input.filters.memoryTypes
        .slice(0, 10)
        .map((_) => `$${index++}`);
      params.push(...input.filters.memoryTypes.slice(0, 10));
      where.push(`"memoryType" IN (${placeholders.join(", ")})`);
    }

    const sources = normalizeSources(input.filters.sources);
    if (sources.length > 0) {
      const placeholders = sources.map(() => `$${index++}`);
      params.push(...sources);
      where.push(`"source" IN (${placeholders.join(", ")})`);
    }

    const tags = normalizeTags(input.filters.tags);
    if (tags.length > 0) {
      const placeholders = tags.map(() => `$${index++}`);
      params.push(...tags);
      where.push(`"tags" && ARRAY[${placeholders.join(", ")}]::text[]`);
    }

    const includePrivate = input.filters.includePrivate ?? false;
    const includeShared = input.filters.includeShared ?? true;

    if (!includePrivate) {
      const accessConditions: string[] = [];
      if (includeShared) {
        accessConditions.push('"visibility" = \'SHARED\'');
      }
      if (input.filters.agentId) {
        accessConditions.push(`"agentId" = $${index}`);
        params.push(input.filters.agentId);
        index += 1;
      }
      if (input.filters.userId) {
        accessConditions.push(`"userId" = $${index}`);
        params.push(input.filters.userId);
        index += 1;
      }

      if (accessConditions.length === 0) {
        accessConditions.push('"visibility" = \'SHARED\'');
      }
      where.push(`(${accessConditions.join(" OR ")})`);
    }

    const candidateLimit = Math.max(
      input.topK,
      input.topK * Math.max(1, agentMemoryConfig.retrieval.candidateMultiplier)
    );

    params.push(candidateLimit);
    const limitPlaceholder = `$${index}`;

    type RawRow = {
      id: string;
      orgId: string;
      userId: string | null;
      agentId: string | null;
      fileId: string | null;
      sessionId: string | null;
      projectId: string | null;
      content: string;
      summary: string | null;
      memoryType: string;
      visibility: string;
      lifecycleState: string;
      lifecycleUpdatedAt: Date;
      pinned: boolean;
      retrievalCount: number;
      lastRetrievedAt: Date | null;
      lastUsedAt: Date | null;
      quarantineReason: string | null;
      quarantineSource: string | null;
      tags: string[];
      source: string;
      timestamp: Date;
      importance: number;
      recency: number;
      metadata: unknown;
      contentHash: string;
      archivedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      distance: number;
    };

    const sql = `
      SELECT
        id,
        "orgId",
        "userId",
        "agentId",
        "fileId",
        "sessionId",
        "projectId",
        content,
        summary,
        "memoryType",
        visibility,
        "lifecycleState",
        "lifecycleUpdatedAt",
        pinned,
        "retrievalCount",
        "lastRetrievedAt",
        "lastUsedAt",
        "quarantineReason",
        "quarantineSource",
        tags,
        source,
        timestamp,
        importance,
        recency,
        metadata,
        "contentHash",
        "archivedAt",
        "createdAt",
        "updatedAt",
        (embedding <=> $1::vector) AS distance
      FROM "AgentMemory"
      WHERE ${where.join(" AND ")}
      ORDER BY embedding <=> $1::vector ASC, timestamp DESC
      LIMIT ${limitPlaceholder}
    `;

    const rows = await prisma.$queryRawUnsafe<RawRow[]>(sql, ...params);

    return rows.map((row) => ({
      memory: {
        id: row.id,
        orgId: row.orgId,
        userId: row.userId,
        agentId: row.agentId,
        fileId: row.fileId,
        sessionId: row.sessionId,
        projectId: row.projectId,
        content: row.content,
        summary: row.summary ?? "",
        embedding: null,
        memoryType: asMemoryType(row.memoryType),
        visibility: asVisibility(row.visibility),
        lifecycleState: asLifecycleState(row.lifecycleState),
        lifecycleUpdatedAt: asDate(row.lifecycleUpdatedAt),
        pinned: Boolean(row.pinned),
        retrievalCount:
          typeof row.retrievalCount === "number" && Number.isFinite(row.retrievalCount)
            ? row.retrievalCount
            : 0,
        lastRetrievedAt: row.lastRetrievedAt ? asDate(row.lastRetrievedAt) : null,
        lastUsedAt: row.lastUsedAt ? asDate(row.lastUsedAt) : null,
        quarantineReason:
          typeof row.quarantineReason === "string" ? row.quarantineReason : null,
        quarantineSource:
          typeof row.quarantineSource === "string" ? row.quarantineSource : null,
        tags: asStringArray(row.tags),
        source: row.source,
        timestamp: asDate(row.timestamp),
        importance:
          typeof row.importance === "number" && Number.isFinite(row.importance)
            ? row.importance
            : 0.5,
        recency:
          typeof row.recency === "number" && Number.isFinite(row.recency)
            ? row.recency
            : 1,
        metadata: (row.metadata ?? null) as AgentMemoryRecord["metadata"],
        contentHash: row.contentHash,
        archivedAt: row.archivedAt ? asDate(row.archivedAt) : null,
        createdAt: asDate(row.createdAt),
        updatedAt: asDate(row.updatedAt)
      },
      distance:
        typeof row.distance === "number" && Number.isFinite(row.distance)
          ? row.distance
          : 1
    }));
  }

  async delete(memoryId: string) {
    await prisma.$executeRawUnsafe(
      'UPDATE "AgentMemory" SET embedding = NULL WHERE id = $1',
      memoryId
    );
  }
}

export const pgVectorMemoryBackend: MemoryVectorBackend = new PgVectorMemoryBackend();
