import "server-only";

import { AgentMemoryType, AgentMemoryVisibility, MemoryTier, Prisma } from "@prisma/client";

import {
  markAgentMemoriesRetrieved,
  markAgentMemoriesUsed,
  persistMemoryCandidate,
  searchAgentMemory
} from "@/lib/agent/memory";
import { prisma } from "@/lib/db/prisma";
import type { MemoryContextQuery, MemoryRelevantItem, MemoryService } from "@/lib/memory/memory-service";

function truncate(value: string, max = 1200) {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 3))}...`;
}

function stringify(value: unknown) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return "";
  }
}

function buildCursor(items: MemoryRelevantItem[]) {
  return items
    .slice(0, 12)
    .map((item) => item.id)
    .join(",");
}

function parseCursor(raw: string | undefined) {
  return raw && raw.length > 0 ? raw : undefined;
}

function selectByTokenBudget(input: {
  entries: MemoryRelevantItem[];
  maxTokens: number;
  reserveTokens: number;
}) {
  const selected: MemoryRelevantItem[] = [];
  const budgetChars = Math.max(600, (input.maxTokens - input.reserveTokens) * 4);
  let consumed = 0;
  for (const item of input.entries) {
    const nextLen = item.content.length;
    if (selected.length >= 8) break;
    if (consumed + nextLen > budgetChars) break;
    selected.push(item);
    consumed += nextLen;
  }
  return selected;
}

class LegacyMemoryService implements MemoryService {
  async retrieveRelevant(input: {
    orgId: string;
    userId: string;
    query: string;
    topK: number;
    includeStructured?: boolean;
  }): Promise<MemoryRelevantItem[]> {
    const semantic = await searchAgentMemory({
      orgId: input.orgId,
      query: input.query,
      topK: Math.max(6, input.topK * 2),
      filters: {
        userId: input.userId,
        includeShared: true,
        includePrivate: true
      }
    }).catch(() => []);

    const semanticRows: MemoryRelevantItem[] = semantic.map((item) => ({
      id: item.memory.id,
      content: truncate(item.memory.summary || item.memory.content),
      score: Number(item.score.toFixed(4)),
      source: `agent_memory:${item.memory.source}`
    }));
    const semanticIds = semanticRows.map((item) => item.id);

    const structured = input.includeStructured
      ? await prisma.memoryEntry.findMany({
          where: {
            orgId: input.orgId,
            redactedAt: null,
            OR: [{ userId: input.userId }, { tier: MemoryTier.ORG }]
          },
          orderBy: { updatedAt: "desc" },
          take: Math.max(4, input.topK),
          select: {
            id: true,
            key: true,
            value: true
          }
        })
      : [];

    const structuredRows: MemoryRelevantItem[] = structured.map((row) => ({
      id: row.id,
      content: truncate(stringify(row.value), 1000),
      score: 0.42,
      source: `memory_entry:${row.key}`
    }));

    const merged = [...semanticRows, ...structuredRows];
    const deduped = merged.filter(
      (item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index
    );
    const selected = deduped.slice(0, Math.max(1, input.topK));
    await markAgentMemoriesRetrieved(
      selected.filter((item) => semanticIds.includes(item.id)).map((item) => item.id)
    ).catch(() => undefined);
    return selected;
  }

  async getContext(input: MemoryContextQuery) {
    const top = await this.retrieveRelevant({
      orgId: input.orgId,
      userId: input.userId,
      query: input.query,
      topK: 12,
      includeStructured: true
    });

    const selected = selectByTokenBudget({
      entries: top,
      maxTokens: input.maxTokens,
      reserveTokens: 300
    });
    await markAgentMemoriesUsed(
      selected
        .filter((item) => item.source.startsWith("agent_memory:"))
        .map((item) => item.id)
    ).catch(() => undefined);

    return {
      snippets: selected.map((item) => ({
        source: item.source,
        content: item.content,
        score: item.score
      })),
      cursor: parseCursor(buildCursor(selected))
    };
  }

  async storeEvent(input: {
    orgId: string;
    userId: string;
    runId: string;
    taskId?: string;
    type: "TASK_EVENT" | "TOOL_EVENT" | "AGENT_EVENT";
    payload: Record<string, unknown>;
    ttlSeconds?: number;
  }): Promise<void> {
    const key = `${input.type}:${input.runId}:${input.taskId ?? "none"}:${Date.now()}`;
    const value = input.payload as Prisma.InputJsonValue;

    await prisma.memoryEntry.create({
      data: {
        orgId: input.orgId,
        flowId: input.runId,
        taskId: input.taskId ?? null,
        userId: input.userId,
        key,
        tier: MemoryTier.WORKING,
        value
      }
    });

    await persistMemoryCandidate({
      orgId: input.orgId,
      userId: input.userId,
      sessionId: input.runId,
      projectId: input.runId,
      content: stringify(input.payload),
      source: "memory_service.event",
      memoryType: AgentMemoryType.EPISODIC,
      visibility: AgentMemoryVisibility.PRIVATE,
      importanceHint: 0.52
    }).catch(() => null);
  }

  async storeSummary(input: {
    orgId: string;
    userId: string;
    runId: string;
    taskId?: string;
    summary: string;
    tags: string[];
    importance: number;
  }): Promise<void> {
    const safeSummary = truncate(input.summary.trim(), 2000);
    if (!safeSummary) {
      return;
    }

    await persistMemoryCandidate({
      orgId: input.orgId,
      userId: input.userId,
      sessionId: input.runId,
      projectId: input.runId,
      content: safeSummary,
      summary: safeSummary,
      source: "memory_service.summary",
      tags: input.tags,
      memoryType: AgentMemoryType.SEMANTIC,
      visibility: AgentMemoryVisibility.SHARED,
      importanceHint: Math.min(1, Math.max(0, input.importance))
    }).catch(() => null);
  }
}

export const legacyMemoryService: MemoryService = new LegacyMemoryService();
