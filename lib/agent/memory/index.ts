import "server-only";

import { AgentMemoryType, AgentMemoryVisibility } from "@prisma/client";

import { agentMemoryConfig } from "@/lib/agent/memory/config";
import { buildMemoryContextBlock } from "@/lib/agent/memory/ranking";
import {
  extractSemanticFacts,
  scoreMemoryCandidate,
  summarizeMemoryContent
} from "@/lib/agent/memory/scoring";
import { agentMemoryStore } from "@/lib/agent/memory/store";
import type {
  AgentMemoryRecord,
  AgentMemorySearchFilters,
  AgentMemorySearchResult,
  AgentMemoryTypeValue,
  AgentMemoryUpsertInput
} from "@/lib/agent/memory/types";

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function normalizeSource(source: string) {
  const normalized = source.trim().toLowerCase();
  return normalized || "runtime";
}

export async function searchAgentMemory(input: {
  orgId: string;
  query: string;
  topK?: number;
  filters?: Omit<AgentMemorySearchFilters, "orgId">;
}) {
  const mergedFilters: AgentMemorySearchFilters = {
    orgId: input.orgId,
    includeShared: true,
    includePrivate: false,
    ...(input.filters ?? {})
  };

  return agentMemoryStore.searchMemory(input.query, mergedFilters, input.topK);
}

export async function upsertAgentMemory(memoryItem: AgentMemoryUpsertInput) {
  return agentMemoryStore.upsertMemory(memoryItem);
}

export async function getRecentAgentMemory(input: {
  orgId: string;
  sessionId: string;
  limit?: number;
  agentId?: string | null;
  userId?: string | null;
  includePrivate?: boolean;
}) {
  return agentMemoryStore.getRecentMemory(input.sessionId, input.limit ?? 10, {
    orgId: input.orgId,
    agentId: input.agentId ?? null,
    userId: input.userId ?? null,
    includePrivate: input.includePrivate ?? false,
    includeShared: true
  });
}

export async function summarizeAndArchiveAgentMemory(input: {
  orgId: string;
  sessionId: string;
  projectId?: string | null;
  agentId?: string | null;
  userId?: string | null;
}) {
  return agentMemoryStore.summarizeAndArchive(input.sessionId, {
    orgId: input.orgId,
    projectId: input.projectId ?? null,
    agentId: input.agentId ?? null,
    userId: input.userId ?? null
  });
}

export async function consolidateAgentMemory(input: {
  orgId: string;
  sessionIds?: string[];
}) {
  if (!agentMemoryStore.consolidateMemory) {
    return {
      scannedSessions: 0,
      summarizedSessions: 0,
      archivedEntries: 0,
      summaryMemoryIds: []
    };
  }
  return agentMemoryStore.consolidateMemory({
    orgId: input.orgId,
    sessionIds: input.sessionIds
  });
}

export async function deleteAgentMemory(memoryId: string) {
  return agentMemoryStore.deleteMemory(memoryId);
}

export async function persistMemoryCandidate(input: {
  orgId: string;
  userId?: string | null;
  agentId?: string | null;
  sessionId?: string | null;
  projectId?: string | null;
  content: string;
  summary?: string;
  memoryType?: AgentMemoryTypeValue;
  visibility?: "PRIVATE" | "SHARED";
  source: string;
  tags?: string[];
  metadata?: AgentMemoryUpsertInput["metadata"];
  importanceHint?: number;
}) {
  if (!agentMemoryConfig.enabled) {
    return {
      saved: false,
      score: 0,
      reason: "feature_disabled" as const,
      memory: null as AgentMemoryRecord | null
    };
  }

  const memoryType = input.memoryType ?? AgentMemoryType.EPISODIC;
  const summary = input.summary?.trim() || summarizeMemoryContent(input.content, 260);
  const score = scoreMemoryCandidate({
    content: input.content,
    summary,
    memoryType,
    source: input.source,
    tags: input.tags,
    importanceHint: input.importanceHint
  });

  if (!score.persist) {
    return {
      saved: false,
      score: score.score,
      reason: "below_threshold" as const,
      details: score.reasons,
      memory: null as AgentMemoryRecord | null
    };
  }

  const memory = await upsertAgentMemory({
    orgId: input.orgId,
    userId: input.userId ?? null,
    agentId: input.agentId ?? null,
    sessionId: input.sessionId ?? null,
    projectId: input.projectId ?? null,
    content: input.content,
    summary,
    memoryType,
    visibility:
      input.visibility === "SHARED"
        ? AgentMemoryVisibility.SHARED
        : AgentMemoryVisibility.PRIVATE,
    source: normalizeSource(input.source),
    tags: input.tags,
    metadata: input.metadata,
    importance: clamp(input.importanceHint ?? score.score),
    recency: 1
  });

  return {
    saved: Boolean(memory),
    score: score.score,
    reason: "persisted" as const,
    details: score.reasons,
    memory
  };
}

export async function persistSemanticFactsFromText(input: {
  orgId: string;
  userId?: string | null;
  agentId?: string | null;
  sessionId?: string | null;
  projectId?: string | null;
  source: string;
  text: string;
}) {
  const facts = extractSemanticFacts(input.text);
  const persisted: AgentMemoryRecord[] = [];

  for (const fact of facts) {
    const result = await persistMemoryCandidate({
      orgId: input.orgId,
      userId: input.userId ?? null,
      agentId: input.agentId ?? null,
      sessionId: input.sessionId ?? null,
      projectId: input.projectId ?? null,
      source: `${input.source}_semantic_fact`,
      memoryType: AgentMemoryType.SEMANTIC,
      visibility: "SHARED",
      content: fact,
      summary: fact,
      tags: ["semantic", "user_fact", "preference"],
      importanceHint: 0.84
    });

    if (result.memory) {
      persisted.push(result.memory);
    }
  }

  return persisted;
}

export function buildMemoryContextSnippet(results: AgentMemorySearchResult[]) {
  return buildMemoryContextBlock({
    results,
    maxItems: agentMemoryConfig.context.maxItems,
    maxChars: agentMemoryConfig.context.maxChars
  });
}
