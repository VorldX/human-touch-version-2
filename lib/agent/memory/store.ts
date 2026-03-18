import "server-only";

import { createHash } from "node:crypto";

import { AgentMemoryType, AgentMemoryVisibility, Prisma } from "@prisma/client";

import { toPgVectorLiteral } from "@/lib/ai/embeddings";
import { agentMemoryConfig } from "@/lib/agent/memory/config";
import { defaultMemoryEmbedder } from "@/lib/agent/memory/embeddings";
import {
  calculateExponentialTimeDecay,
  calculateRecencyScore,
  calculateTimeWeightedHybridScore,
  dedupeMemoryResults
} from "@/lib/agent/memory/ranking";
import { rerankMemoryResults } from "@/lib/agent/memory/reranker";
import {
  summarizeMemoryContent,
  toPersistableMemory
} from "@/lib/agent/memory/scoring";
import type {
  AgentMemoryConsolidationResult,
  AgentMemoryRecord,
  AgentMemorySearchFilters,
  AgentMemorySearchResult,
  AgentMemoryStore,
  AgentMemoryTypeValue,
  AgentMemoryUpsertInput,
  MemoryEmbedder
} from "@/lib/agent/memory/types";
import {
  pgVectorMemoryBackend,
  type MemoryVectorBackend
} from "@/lib/agent/memory/vector-backend";
import { prisma } from "@/lib/db/prisma";

const memorySelect = {
  id: true,
  orgId: true,
  userId: true,
  agentId: true,
  sessionId: true,
  projectId: true,
  content: true,
  summary: true,
  memoryType: true,
  visibility: true,
  tags: true,
  source: true,
  timestamp: true,
  importance: true,
  recency: true,
  metadata: true,
  contentHash: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true
} as const;

type MemoryRow = Prisma.AgentMemoryGetPayload<{ select: typeof memorySelect }>;

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function hashMemoryContent(input: {
  orgId: string;
  userId?: string | null;
  agentId?: string | null;
  sessionId?: string | null;
  projectId?: string | null;
  memoryType: AgentMemoryTypeValue;
  source: string;
  content: string;
}) {
  return createHash("sha256")
    .update(
      [
        input.orgId,
        input.userId ?? "",
        input.agentId ?? "",
        input.sessionId ?? "",
        input.projectId ?? "",
        input.memoryType,
        input.source,
        compact(input.content).toLowerCase()
      ].join("|")
    )
    .digest("hex");
}

function toMemoryRecord(row: MemoryRow): AgentMemoryRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    userId: row.userId,
    agentId: row.agentId,
    sessionId: row.sessionId,
    projectId: row.projectId,
    content: row.content,
    summary: row.summary ?? "",
    embedding: null,
    memoryType: row.memoryType,
    visibility: row.visibility,
    tags: row.tags,
    source: row.source,
    timestamp: row.timestamp,
    importance: row.importance,
    recency: row.recency,
    metadata: row.metadata,
    contentHash: row.contentHash,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function normalizeTags(tags: string[] | undefined) {
  return [...new Set((tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(
    0,
    24
  );
}

function normalizeType(memoryType: AgentMemoryTypeValue) {
  if (memoryType === AgentMemoryType.WORKING) return AgentMemoryType.WORKING;
  if (memoryType === AgentMemoryType.SEMANTIC) return AgentMemoryType.SEMANTIC;
  if (memoryType === AgentMemoryType.TASK) return AgentMemoryType.TASK;
  return AgentMemoryType.EPISODIC;
}

function normalizeVisibility(value: AgentMemoryUpsertInput["visibility"]) {
  if (value === AgentMemoryVisibility.SHARED) return AgentMemoryVisibility.SHARED;
  return AgentMemoryVisibility.PRIVATE;
}

function cleanSummary(value: string | undefined, fallback: string) {
  const text = compact(value ?? "");
  return text || summarizeMemoryContent(fallback, 260);
}

function lexicalSimilarity(query: string, candidate: string) {
  const toTokens = (value: string) =>
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3);
  const queryTokens = new Set(toTokens(query));
  if (queryTokens.size === 0) return 0;
  const candidateTokens = toTokens(candidate);
  if (candidateTokens.length === 0) return 0;
  let hits = 0;
  for (const token of candidateTokens) {
    if (queryTokens.has(token)) hits += 1;
  }
  return clamp(hits / Math.max(6, queryTokens.size));
}

function buildSessionSummary(entries: AgentMemoryRecord[], maxChars: number) {
  const lines: string[] = [];
  const sorted = [...entries]
    .sort((left, right) => {
      if (right.importance !== left.importance) {
        return right.importance - left.importance;
      }
      return right.timestamp.getTime() - left.timestamp.getTime();
    })
    .slice(0, 24);

  for (const entry of sorted) {
    const point = compact(entry.summary || entry.content);
    if (!point) continue;
    lines.push(`- [${entry.memoryType}] ${entry.source}: ${summarizeMemoryContent(point, 220)}`);
  }

  const uniqueLines = [...new Set(lines)].slice(0, 16);
  const joined = uniqueLines.join("\n");
  if (joined.length <= maxChars) {
    return joined;
  }
  return `${joined.slice(0, Math.max(0, maxChars - 3))}...`;
}

let agentMemoryTablePresence: "unknown" | "present" | "missing" = "unknown";
let warnedMissingAgentMemoryTable = false;

function isAgentMemoryTableMissingError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const code =
    typeof (error as { code?: unknown })?.code === "string"
      ? (error as { code: string }).code
      : "";
  return (
    /relation\s+"?AgentMemory"?\s+does not exist/i.test(message) ||
    /table.*AgentMemory.*does not exist/i.test(message) ||
    code === "42P01" ||
    code === "P2021"
  );
}

function markAgentMemoryTableMissing() {
  agentMemoryTablePresence = "missing";
  if (!warnedMissingAgentMemoryTable) {
    warnedMissingAgentMemoryTable = true;
    console.warn(
      "[agent-memory] AgentMemory table missing; memory persistence/retrieval disabled until migrations are applied."
    );
  }
}

async function ensureAgentMemoryTableAvailable() {
  if (agentMemoryTablePresence === "present") return true;
  if (agentMemoryTablePresence === "missing") return false;
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
      'SELECT to_regclass(\'public."AgentMemory"\') IS NOT NULL AS "exists"'
    );
    const exists = rows[0]?.exists === true;
    agentMemoryTablePresence = exists ? "present" : "missing";
    if (!exists) {
      markAgentMemoryTableMissing();
    }
    return exists;
  } catch (error) {
    if (isAgentMemoryTableMissingError(error)) {
      markAgentMemoryTableMissing();
      return false;
    }
    throw error;
  }
}

class PrismaAgentMemoryStore implements AgentMemoryStore {
  constructor(
    private readonly embedder: MemoryEmbedder,
    private readonly vectorBackend: MemoryVectorBackend
  ) {}

  async upsertMemory(memoryItem: AgentMemoryUpsertInput) {
    if (!agentMemoryConfig.enabled) {
      return null;
    }
    if (!(await ensureAgentMemoryTableAvailable())) {
      return null;
    }

    const prepared = toPersistableMemory(memoryItem);
    if (!prepared) {
      return null;
    }

    const memoryType = normalizeType(prepared.memoryType);
    const content = compact(prepared.content);
    const summary = cleanSummary(prepared.summary, content);
    const source = compact(prepared.source).slice(0, 80) || "runtime";
    const contentHash = hashMemoryContent({
      orgId: prepared.orgId,
      userId: prepared.userId,
      agentId: prepared.agentId,
      sessionId: prepared.sessionId,
      projectId: prepared.projectId,
      memoryType,
      source,
      content
    });

    const embedded =
      prepared.embedding && prepared.embedding.length > 0
        ? {
            embedding: prepared.embedding,
            telemetry: {
              provider: "deterministic" as const,
              model: "external",
              dimensions: prepared.embedding.length,
              promptTokens: 0,
              totalTokens: 0,
              latencyMs: 0
            }
          }
        : await this.embedder.embed(`${summary}\n${content}`.slice(0, 6000));

    const importance = clamp(prepared.importance ?? 0.5, 0, 1);
    const recency = clamp(prepared.recency ?? 1, 0, 2);

    try {
      const existing = prepared.id
        ? await prisma.agentMemory.findUnique({
            where: { id: prepared.id },
            select: memorySelect
          })
        : await prisma.agentMemory.findFirst({
            where: {
              orgId: prepared.orgId,
              contentHash,
              memoryType,
              source,
              sessionId: prepared.sessionId ?? null,
              userId: prepared.userId ?? null,
              agentId: prepared.agentId ?? null,
              archivedAt: null
            },
            orderBy: { updatedAt: "desc" },
            select: memorySelect
          });

      const nextMetadata: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput =
        prepared.metadata === undefined || prepared.metadata === null
          ? Prisma.JsonNull
          : (prepared.metadata as Prisma.InputJsonValue);

      const row = existing
        ? await prisma.agentMemory.update({
            where: { id: existing.id },
            data: {
              userId: prepared.userId ?? null,
              agentId: prepared.agentId ?? null,
              sessionId: prepared.sessionId ?? null,
              projectId: prepared.projectId ?? null,
              content,
              summary,
              memoryType,
              visibility: normalizeVisibility(prepared.visibility),
              tags: normalizeTags(prepared.tags),
              source,
              timestamp: prepared.timestamp ?? new Date(),
              importance: Math.max(existing.importance, importance),
              recency,
              metadata: nextMetadata,
              contentHash,
              archivedAt: null
            },
            select: memorySelect
          })
        : await prisma.agentMemory.create({
            data: {
              orgId: prepared.orgId,
              userId: prepared.userId ?? null,
              agentId: prepared.agentId ?? null,
              sessionId: prepared.sessionId ?? null,
              projectId: prepared.projectId ?? null,
              content,
              summary,
              memoryType,
              visibility: normalizeVisibility(prepared.visibility),
              tags: normalizeTags(prepared.tags),
              source,
              timestamp: prepared.timestamp ?? new Date(),
              importance,
              recency,
              metadata: nextMetadata,
              contentHash
            },
            select: memorySelect
          });

      const vectorLiteral = toPgVectorLiteral(embedded.embedding);
      await prisma.$executeRawUnsafe(
        'UPDATE "AgentMemory" SET embedding = $1::vector WHERE id = $2',
        vectorLiteral,
        row.id
      );

      return toMemoryRecord(row);
    } catch (error) {
      if (isAgentMemoryTableMissingError(error)) {
        markAgentMemoryTableMissing();
        return null;
      }
      throw error;
    }
  }

  async searchMemory(query: string, filters: AgentMemorySearchFilters, topK?: number) {
    if (!agentMemoryConfig.enabled) {
      return [];
    }
    if (!(await ensureAgentMemoryTableAvailable())) {
      return [];
    }

    const normalizedQuery = compact(query);
    if (!normalizedQuery) {
      return [];
    }

    const limit = Math.max(1, topK ?? agentMemoryConfig.retrieval.defaultTopK);
    const requestedTopK = Math.max(
      limit,
      agentMemoryConfig.retrieval.crossEncoderCandidatePool
    );
    const rerankTopK = Math.max(
      1,
      Math.min(limit, agentMemoryConfig.retrieval.crossEncoderTopK)
    );
    const queryEmbedding = await this.embedder.embed(normalizedQuery);

    let vectorCandidates = [] as Awaited<ReturnType<MemoryVectorBackend["searchByVector"]>>;
    try {
      vectorCandidates = await this.vectorBackend.searchByVector({
        queryEmbedding: queryEmbedding.embedding,
        filters,
        topK: requestedTopK
      });
    } catch (error) {
      if (isAgentMemoryTableMissingError(error)) {
        markAgentMemoryTableMissing();
        return [];
      }
      throw error;
    }

    if (vectorCandidates.length === 0) {
      try {
        const lexicalRows = await prisma.agentMemory.findMany({
          where: {
            orgId: filters.orgId,
            archivedAt: filters.includeArchived ? undefined : null,
            ...(filters.sessionId ? { sessionId: filters.sessionId } : {}),
            ...(filters.projectId ? { projectId: filters.projectId } : {}),
            ...(filters.userId ? { userId: filters.userId } : {}),
            ...(filters.agentId ? { agentId: filters.agentId } : {}),
            ...(filters.memoryTypes && filters.memoryTypes.length > 0
              ? { memoryType: { in: filters.memoryTypes } }
              : {})
          },
          orderBy: [{ timestamp: "desc" }, { updatedAt: "desc" }],
          take: Math.max(requestedTopK * 3, 8),
          select: memorySelect
        });

        vectorCandidates = lexicalRows.map((row) => ({
          memory: toMemoryRecord(row),
          distance: 1 - lexicalSimilarity(normalizedQuery, `${row.summary ?? ""} ${row.content}`)
        }));
      } catch (error) {
        if (isAgentMemoryTableMissingError(error)) {
          markAgentMemoryTableMissing();
          return [];
        }
        throw error;
      }
    }

    const ranked = vectorCandidates
      .map((candidate) => {
        const similarity = clamp(1 - clamp(candidate.distance, 0, 1), 0, 1);
        const timeDecayScore = calculateExponentialTimeDecay({
          timestamp: candidate.memory.timestamp,
          lambdaPerHour: agentMemoryConfig.retrieval.timeWeighted.lambdaPerHour
        });
        const hybridScore = calculateTimeWeightedHybridScore({
          semanticSimilarity: similarity,
          timeDecayScore,
          alpha: agentMemoryConfig.retrieval.timeWeighted.alpha,
          beta: agentMemoryConfig.retrieval.timeWeighted.beta
        });
        const recencyScore = calculateRecencyScore({
          timestamp: candidate.memory.timestamp,
          recency: candidate.memory.recency,
          halfLifeHours: agentMemoryConfig.retrieval.recencyHalfLifeHours
        });
        const importanceScore = clamp(candidate.memory.importance, 0, 1);
        const score = Number(
          clamp(hybridScore * 0.85 + importanceScore * 0.1 + recencyScore * 0.05).toFixed(6)
        );

        return {
          memory: candidate.memory,
          similarity,
          recencyScore,
          importanceScore,
          timeDecayScore,
          hybridScore,
          score
        } satisfies AgentMemorySearchResult;
      })
      .filter((item) => item.similarity >= agentMemoryConfig.retrieval.minSimilarity)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        if (right.hybridScore !== left.hybridScore) {
          return right.hybridScore - left.hybridScore;
        }
        return right.importanceScore - left.importanceScore;
      });

    const deduped = dedupeMemoryResults(ranked, agentMemoryConfig.retrieval.dedupeThreshold);
    const candidatePool = deduped.slice(0, requestedTopK);
    const reranked = await rerankMemoryResults({
      query: normalizedQuery,
      candidates: candidatePool,
      topK: rerankTopK
    });

    if (reranked.length === 0) {
      return candidatePool.slice(0, rerankTopK);
    }

    return reranked;
  }

  async getRecentMemory(
    sessionId: string,
    limit: number,
    filters: Pick<
      AgentMemorySearchFilters,
      "orgId" | "agentId" | "userId" | "includePrivate" | "includeShared"
    >
  ) {
    if (!agentMemoryConfig.enabled) {
      return [];
    }
    if (!(await ensureAgentMemoryTableAvailable())) {
      return [];
    }

    const includePrivate = filters.includePrivate ?? false;
    const includeShared = filters.includeShared ?? true;

    try {
      const rows = await prisma.agentMemory.findMany({
        where: {
          orgId: filters.orgId,
          sessionId,
          archivedAt: null,
          OR: includePrivate
            ? undefined
            : [
                ...(includeShared ? [{ visibility: AgentMemoryVisibility.SHARED }] : []),
                ...(filters.agentId ? [{ agentId: filters.agentId }] : []),
                ...(filters.userId ? [{ userId: filters.userId }] : [])
              ]
        },
        orderBy: [{ timestamp: "desc" }, { updatedAt: "desc" }],
        take: Math.max(1, limit),
        select: memorySelect
      });

      return rows.map(toMemoryRecord);
    } catch (error) {
      if (isAgentMemoryTableMissingError(error)) {
        markAgentMemoryTableMissing();
        return [];
      }
      throw error;
    }
  }

  async summarizeAndArchive(
    sessionId: string,
    scope: Pick<AgentMemorySearchFilters, "orgId" | "agentId" | "userId"> & {
      projectId?: string | null;
    }
  ) {
    if (!agentMemoryConfig.enabled) {
      return null;
    }
    if (!(await ensureAgentMemoryTableAvailable())) {
      return null;
    }

    let rows: MemoryRow[] = [];
    try {
      rows = await prisma.agentMemory.findMany({
        where: {
          orgId: scope.orgId,
          sessionId,
          archivedAt: null
        },
        orderBy: [{ timestamp: "desc" }, { updatedAt: "desc" }],
        take: agentMemoryConfig.summarization.maxSourceEntries,
        select: memorySelect
      });
    } catch (error) {
      if (isAgentMemoryTableMissingError(error)) {
        markAgentMemoryTableMissing();
        return null;
      }
      throw error;
    }

    const gcThreshold = agentMemoryConfig.retrieval.timeWeighted.gcThreshold;
    const lowScoreMemoryIds = rows
      .map((row) => {
        const similarityProxy = clamp(row.importance, 0, 1);
        const timeDecayScore = calculateExponentialTimeDecay({
          timestamp: row.timestamp,
          lambdaPerHour: agentMemoryConfig.retrieval.timeWeighted.lambdaPerHour
        });
        const hybrid = calculateTimeWeightedHybridScore({
          semanticSimilarity: similarityProxy,
          timeDecayScore,
          alpha: agentMemoryConfig.retrieval.timeWeighted.alpha,
          beta: agentMemoryConfig.retrieval.timeWeighted.beta
        });
        return {
          id: row.id,
          hybrid
        };
      })
      .filter((item) => item.hybrid < gcThreshold)
      .map((item) => item.id);

    if (lowScoreMemoryIds.length > 0) {
      try {
        await prisma.agentMemory.updateMany({
          where: {
            id: { in: lowScoreMemoryIds },
            orgId: scope.orgId,
            archivedAt: null
          },
          data: {
            archivedAt: new Date()
          }
        });

        rows = rows.filter((row) => !lowScoreMemoryIds.includes(row.id));
      } catch (error) {
        if (isAgentMemoryTableMissingError(error)) {
          markAgentMemoryTableMissing();
          return null;
        }
        throw error;
      }
    }

    if (rows.length < Math.max(2, agentMemoryConfig.summarization.triggerCount)) {
      return null;
    }

    const records = rows.map(toMemoryRecord);
    const summaryText = buildSessionSummary(
      records,
      agentMemoryConfig.summarization.maxSummaryChars
    );
    if (!summaryText) {
      return null;
    }

    const summary = await this.upsertMemory({
      orgId: scope.orgId,
      sessionId,
      projectId: scope.projectId ?? null,
      userId: scope.userId ?? null,
      agentId: scope.agentId ?? null,
      content: summaryText,
      summary: summarizeMemoryContent(summaryText, 220),
      memoryType: AgentMemoryType.SEMANTIC,
      visibility: AgentMemoryVisibility.SHARED,
      source: "session_summary",
      tags: ["summary", "session", "consolidated"],
      importance: 0.72,
      recency: 0.9,
      metadata: {
        sourceSessionId: sessionId,
        sourceMemoryCount: rows.length,
        generatedAt: new Date().toISOString()
      }
    });

    if (!summary) {
      return null;
    }

    const keep = Math.max(1, agentMemoryConfig.summarization.archiveCount);
    const toArchive = rows.slice(keep).map((row) => row.id).filter((id) => id !== summary.id);

    if (toArchive.length > 0) {
      try {
        await prisma.agentMemory.updateMany({
          where: {
            id: { in: toArchive },
            orgId: scope.orgId,
            archivedAt: null
          },
          data: {
            archivedAt: new Date()
          }
        });
      } catch (error) {
        if (isAgentMemoryTableMissingError(error)) {
          markAgentMemoryTableMissing();
          return summary;
        }
        throw error;
      }
    }

    return summary;
  }

  async deleteMemory(memoryId: string) {
    if (!agentMemoryConfig.enabled) {
      return false;
    }
    if (!(await ensureAgentMemoryTableAvailable())) {
      return false;
    }

    let deleted: { count: number };
    try {
      deleted = await prisma.agentMemory.deleteMany({
        where: { id: memoryId }
      });
    } catch (error) {
      if (isAgentMemoryTableMissingError(error)) {
        markAgentMemoryTableMissing();
        return false;
      }
      throw error;
    }

    if (deleted.count > 0) {
      await this.vectorBackend.delete(memoryId).catch(() => undefined);
    }

    return deleted.count > 0;
  }

  async consolidateMemory(scope: Pick<AgentMemorySearchFilters, "orgId"> & { sessionIds?: string[] }) {
    if (!agentMemoryConfig.enabled) {
      return {
        scannedSessions: 0,
        summarizedSessions: 0,
        archivedEntries: 0,
        summaryMemoryIds: []
      } satisfies AgentMemoryConsolidationResult;
    }
    if (!(await ensureAgentMemoryTableAvailable())) {
      return {
        scannedSessions: 0,
        summarizedSessions: 0,
        archivedEntries: 0,
        summaryMemoryIds: []
      } satisfies AgentMemoryConsolidationResult;
    }

    type SessionRow = {
      sessionId: string;
      memoryCount: number;
    };

    let sessions: SessionRow[] = [];
    try {
      sessions =
        scope.sessionIds && scope.sessionIds.length > 0
          ? scope.sessionIds.map((sessionId) => ({ sessionId, memoryCount: 0 }))
          : await prisma.$queryRawUnsafe<SessionRow[]>(
              `
                SELECT
                  "sessionId",
                  COUNT(*)::int AS "memoryCount"
                FROM "AgentMemory"
                WHERE "orgId" = $1
                  AND "archivedAt" IS NULL
                  AND "sessionId" IS NOT NULL
                GROUP BY "sessionId"
                HAVING COUNT(*) >= $2
                ORDER BY MAX(timestamp) ASC
                LIMIT 24
              `,
              scope.orgId,
              Math.max(2, agentMemoryConfig.summarization.triggerCount)
            );
    } catch (error) {
      if (isAgentMemoryTableMissingError(error)) {
        markAgentMemoryTableMissing();
        return {
          scannedSessions: 0,
          summarizedSessions: 0,
          archivedEntries: 0,
          summaryMemoryIds: []
        } satisfies AgentMemoryConsolidationResult;
      }
      throw error;
    }

    let summarizedSessions = 0;
    let archivedEntries = 0;
    const summaryMemoryIds: string[] = [];

    for (const row of sessions) {
      const before = await prisma.agentMemory.count({
        where: {
          orgId: scope.orgId,
          sessionId: row.sessionId,
          archivedAt: null
        }
      });

      const summary = await this.summarizeAndArchive(row.sessionId, {
        orgId: scope.orgId,
        agentId: null,
        userId: null
      });

      if (!summary) continue;

      const after = await prisma.agentMemory.count({
        where: {
          orgId: scope.orgId,
          sessionId: row.sessionId,
          archivedAt: null
        }
      });

      summarizedSessions += 1;
      archivedEntries += Math.max(0, before - after);
      summaryMemoryIds.push(summary.id);
    }

    return {
      scannedSessions: sessions.length,
      summarizedSessions,
      archivedEntries,
      summaryMemoryIds
    } satisfies AgentMemoryConsolidationResult;
  }
}

export const agentMemoryStore: AgentMemoryStore = new PrismaAgentMemoryStore(
  defaultMemoryEmbedder,
  pgVectorMemoryBackend
);
