import "server-only";

import { HubFileType, MemoryTier } from "@prisma/client";

import {
  createDeterministicEmbedding,
  toPgVectorLiteral
} from "@/lib/ai/embeddings";
import { markAgentMemoriesRetrieved, searchAgentMemory } from "@/lib/agent/memory";
import { featureFlags } from "@/lib/config/feature-flags";
import { prisma } from "@/lib/db/prisma";
import { listPeripheralFallbackLogs } from "@/lib/dna/phase3/fallback";
import { readLocalUploadByUrl, toPreviewText } from "@/lib/hub/storage";
import { memoryService } from "@/lib/memory";

export interface RetrievedMemoryEntry {
  id: string;
  agentMemoryId?: string;
  key: string;
  tier: string;
  value: unknown;
  score: number;
  similarity?: number;
  timeDecayScore?: number;
  hybridScore?: number;
  rerankScore?: number;
}

function tokenize(input: string) {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3);
}

function stringifyValue(value: unknown) {
  try {
    return typeof value === "string" ? value : JSON.stringify(value ?? null);
  } catch {
    return "";
  }
}

function scoreTextByOverlap(prompt: string, candidate: string) {
  const promptTokens = new Set(tokenize(prompt));
  if (promptTokens.size === 0) return 0;
  const candidateTokens = tokenize(candidate);
  if (candidateTokens.length === 0) return 0;
  let hits = 0;
  for (const token of candidateTokens) {
    if (promptTokens.has(token)) hits += 1;
  }
  return Math.min(1, hits / Math.max(6, promptTokens.size));
}

export async function retrieveRelevantMemoryEntries(input: {
  orgId: string;
  prompt: string;
  flowId?: string | null;
  taskId?: string | null;
  agentId?: string | null;
  userId?: string | null;
  limit: number;
}): Promise<RetrievedMemoryEntry[]> {
  if (featureFlags.useNewMemoryService && input.userId) {
    const unified = await memoryService
      .retrieveRelevant({
        orgId: input.orgId,
        userId: input.userId,
        query: input.prompt,
        topK: Math.max(1, input.limit),
        includeStructured: true
      })
      .catch(() => []);

    if (unified.length > 0) {
      return unified.slice(0, Math.max(1, input.limit)).map((item) => ({
        id: item.id,
        agentMemoryId: item.source.startsWith("agent_memory:") ? item.id : undefined,
        key: item.source,
        tier: "UNIFIED",
        value: item.content,
        score: item.score
      }));
    }
  }

  const semanticLimit = Math.max(3, input.limit);
  const absoluteTopK = Math.max(1, Math.min(input.limit, 3));
  let centralMemoryFailed = false;

  const safeSearch = async (...args: Parameters<typeof searchAgentMemory>) => {
    try {
      return await searchAgentMemory(...args);
    } catch {
      centralMemoryFailed = true;
      return [];
    }
  };

  const [agentScopedSemantic, flowSharedSemantic, hubSharedSemantic] = await Promise.all([
    safeSearch({
      orgId: input.orgId,
      query: input.prompt,
      topK: semanticLimit,
      filters: {
        sessionId: input.flowId ?? null,
        projectId: input.flowId ?? null,
        userId: input.userId ?? null,
        agentId: input.agentId ?? null,
        includeShared: true,
        includePrivate: false
      }
    }),
    safeSearch({
      orgId: input.orgId,
      query: input.prompt,
      topK: Math.max(2, Math.ceil(semanticLimit / 2)),
      filters: {
        sessionId: input.flowId ?? null,
        projectId: input.flowId ?? null,
        userId: input.userId ?? null,
        includeShared: true,
        includePrivate: false
      }
    }),
    safeSearch({
      orgId: input.orgId,
      query: input.prompt,
      topK: Math.max(2, Math.ceil(semanticLimit / 2)),
      filters: {
        includeShared: true,
        includePrivate: false,
        sources: ["dna_chunk"]
      }
    })
  ]);

  const semantic = [...agentScopedSemantic, ...flowSharedSemantic, ...hubSharedSemantic]
    .sort((left, right) => right.score - left.score)
    .filter((item, index, all) => all.findIndex((candidate) => candidate.memory.id === item.memory.id) === index)
    .slice(0, semanticLimit * 2);

  const semanticRows: RetrievedMemoryEntry[] = semantic.map((item) => ({
    id: item.memory.id,
    agentMemoryId: item.memory.id,
    key: `${item.memory.memoryType.toLowerCase()}.${item.memory.source}`,
    tier: item.memory.memoryType,
    value: {
      summary: item.memory.summary,
      content: item.memory.content,
      tags: item.memory.tags,
      source: item.memory.source,
      timestamp: item.memory.timestamp.toISOString(),
      visibility: item.memory.visibility
    },
    score: item.score,
    similarity: item.similarity,
    timeDecayScore: item.timeDecayScore,
    hybridScore: item.hybridScore,
    rerankScore: item.rerankScore
  }));
  const semanticIds = new Set(semanticRows.map((row) => row.id));

  if (semanticRows.length >= absoluteTopK) {
    const selected = semanticRows.slice(0, absoluteTopK);
    await markAgentMemoriesRetrieved(selected.map((row) => row.id)).catch(() => undefined);
    return selected;
  }

  if (centralMemoryFailed) {
    const fallbackLogs = await listPeripheralFallbackLogs({
      orgId: input.orgId,
      limit: 5
    });

    if (fallbackLogs.length > 0) {
      const fallbackRows: RetrievedMemoryEntry[] = fallbackLogs.map((entry) => ({
        ...entry,
        agentMemoryId: undefined,
        similarity: undefined,
        timeDecayScore: undefined,
        hybridScore: undefined,
        rerankScore: undefined
      }));
      const mergedFallback: RetrievedMemoryEntry[] = [...semanticRows, ...fallbackRows].filter(
        (item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index
      );
      const selected = mergedFallback.slice(0, Math.max(5, absoluteTopK));
      await markAgentMemoriesRetrieved(
        selected.filter((row) => semanticIds.has(row.id)).map((row) => row.id)
      ).catch(() => undefined);
      return selected;
    }
  }

  const rows = await prisma.memoryEntry.findMany({
    where: {
      orgId: input.orgId,
      redactedAt: null,
      OR: [
        { tier: MemoryTier.ORG },
        ...(input.flowId ? [{ flowId: input.flowId }] : []),
        ...(input.taskId ? [{ taskId: input.taskId }] : []),
        ...(input.agentId ? [{ agentId: input.agentId }] : [])
      ]
    },
    orderBy: { updatedAt: "desc" },
    take: Math.max(40, input.limit * 5),
    select: {
      id: true,
      key: true,
      tier: true,
      value: true,
      updatedAt: true
    }
  });

  const ranked = rows
    .map((row) => {
      const keyScore = scoreTextByOverlap(input.prompt, row.key);
      const valueScore = scoreTextByOverlap(input.prompt, stringifyValue(row.value));
      const freshnessScore = Math.max(
        0,
        1 - (Date.now() - new Date(row.updatedAt).getTime()) / (1000 * 60 * 60 * 24 * 7)
      );
      const score = Number((keyScore * 0.45 + valueScore * 0.45 + freshnessScore * 0.1).toFixed(4));
      return { ...row, score };
    })
    .filter((row) => row.score > 0.08)
    .sort((a, b) => b.score - a.score);

  const merged: RetrievedMemoryEntry[] = [...semanticRows];
  for (const candidate of ranked) {
    if (merged.some((existing) => existing.id === candidate.id)) {
      continue;
    }
    merged.push({
      id: candidate.id,
      agentMemoryId: undefined,
      key: candidate.key,
      tier: String(candidate.tier),
      value: candidate.value,
      score: candidate.score
    });
    if (merged.length >= absoluteTopK) {
      break;
    }
  }

  const selected = merged.slice(0, absoluteTopK);
  await markAgentMemoriesRetrieved(
    selected.filter((row) => semanticIds.has(row.id)).map((row) => row.id)
  ).catch(() => undefined);
  return selected;
}

export async function retrieveRelevantDnaFiles(input: {
  orgId: string;
  prompt: string;
  limit: number;
}) {
  const queryEmbedding = createDeterministicEmbedding(input.prompt, 1536);
  const vectorLiteral = toPgVectorLiteral(queryEmbedding);

  type DnaRow = {
    id: string;
    name: string;
    url: string;
    isAmnesiaProtected: boolean;
    distance: number;
  };

  const vectorRows = await prisma.$queryRawUnsafe<DnaRow[]>(
    `
      SELECT
        id,
        name,
        url,
        "isAmnesiaProtected",
        (embedding <=> $1::vector) AS distance
      FROM "File"
      WHERE "orgId" = $2
        AND type = 'DNA'
        AND embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector ASC
      LIMIT $3
    `,
    vectorLiteral,
    input.orgId,
    Math.max(1, input.limit)
  );

  const fallbackRows =
    vectorRows.length > 0
      ? []
      : await prisma.file.findMany({
          where: {
            orgId: input.orgId,
            type: HubFileType.DNA
          },
          orderBy: { updatedAt: "desc" },
          take: Math.max(1, input.limit),
          select: {
            id: true,
            name: true,
            url: true,
            isAmnesiaProtected: true
          }
        });

  const rows = vectorRows.length > 0
    ? vectorRows.map((row) => ({
        id: row.id,
        name: row.name,
        url: row.url,
        isAmnesiaProtected: row.isAmnesiaProtected,
        score: Number((1 - Math.min(1, Math.max(0, row.distance))).toFixed(4))
      }))
    : fallbackRows.map((row) => ({
        id: row.id,
        name: row.name,
        url: row.url,
        isAmnesiaProtected: row.isAmnesiaProtected,
        score: 0.2
      }));

  const previews: Array<{
    id: string;
    name: string;
    preview: string;
    amnesiaProtected: boolean;
    score: number;
  }> = [];

  for (const row of rows) {
    if (row.isAmnesiaProtected) {
      previews.push({
        id: row.id,
        name: row.name,
        preview: `DNA asset ${row.name} is amnesia-protected. Only policy-safe summary metadata is available.`,
        amnesiaProtected: true,
        score: row.score
      });
      continue;
    }

    // Sequential reads keep ordering deterministic for RAG packs.
    // eslint-disable-next-line no-await-in-loop
    const local = await readLocalUploadByUrl(row.url);
    const preview = local
      ? toPreviewText(local, 2400)
      : /^https?:\/\//.test(row.url)
        ? await (async () => {
            try {
              const response = await fetch(row.url, { cache: "no-store" });
              return response.ok ? (await response.text()).slice(0, 2400) : "";
            } catch {
              return "";
            }
          })()
        : "";

    previews.push({
      id: row.id,
      name: row.name,
      preview: preview || `DNA file ${row.name} is available at ${row.url}.`,
      amnesiaProtected: false,
      score: row.score
    });
  }

  return previews;
}
