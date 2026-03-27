import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateExponentialTimeDecay,
  blendRankingScores,
  calculateRecencyScore,
  calculateTimeWeightedHybridScore,
  dedupeMemoryResults
} from "../lib/agent/memory/ranking.ts";
import type { AgentMemorySearchResult } from "../lib/agent/memory/types.ts";

function buildResult(
  overrides: Partial<Omit<AgentMemorySearchResult, "memory">> & {
    memory?: Partial<AgentMemorySearchResult["memory"]>;
  }
): AgentMemorySearchResult {
  const base: AgentMemorySearchResult = {
    memory: {
      id: "mem-1",
      orgId: "org-1",
      userId: null,
      agentId: "agent-1",
      fileId: null,
      sessionId: "session-1",
      projectId: "project-1",
      content: "Tool execution created a meeting invite with key details.",
      summary: "Meeting invite created.",
      embedding: null,
      memoryType: "EPISODIC",
      visibility: "SHARED",
      lifecycleState: "SHORT_TERM",
      lifecycleUpdatedAt: new Date(),
      pinned: false,
      retrievalCount: 0,
      lastRetrievedAt: null,
      lastUsedAt: null,
      quarantineReason: null,
      quarantineSource: null,
      tags: ["tool_result"],
      source: "tool_result_primary",
      timestamp: new Date(),
      importance: 0.7,
      recency: 1,
      metadata: null,
      contentHash: "hash-1",
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    },
    similarity: 0.8,
    recencyScore: 0.7,
    importanceScore: 0.7,
    timeDecayScore: 0.7,
    hybridScore: 0.77,
    score: 0.76
  };

  return {
    ...base,
    ...overrides,
    memory: {
      ...base.memory,
      ...(overrides.memory ?? {})
    }
  };
}

test("calculateRecencyScore decays with age", () => {
  const now = Date.now();
  const fresh = calculateRecencyScore({
    timestamp: new Date(now - 60 * 60 * 1000),
    recency: 1,
    halfLifeHours: 24,
    nowMs: now
  });
  const stale = calculateRecencyScore({
    timestamp: new Date(now - 24 * 60 * 60 * 1000 * 7),
    recency: 1,
    halfLifeHours: 24,
    nowMs: now
  });

  assert.ok(fresh > stale);
});

test("calculateExponentialTimeDecay follows e^(-lambda*delta_t)", () => {
  const now = Date.now();
  const fresh = calculateExponentialTimeDecay({
    timestamp: new Date(now - 60 * 60 * 1000),
    lambdaPerHour: 0.08,
    nowMs: now
  });
  const stale = calculateExponentialTimeDecay({
    timestamp: new Date(now - 24 * 60 * 60 * 1000),
    lambdaPerHour: 0.08,
    nowMs: now
  });

  assert.ok(fresh > stale);
  assert.ok(fresh <= 1 && fresh >= 0);
  assert.ok(stale <= 1 && stale >= 0);
});

test("calculateTimeWeightedHybridScore blends semantic and time decay", () => {
  const strong = calculateTimeWeightedHybridScore({
    semanticSimilarity: 0.9,
    timeDecayScore: 0.8,
    alpha: 0.7,
    beta: 0.3
  });
  const weak = calculateTimeWeightedHybridScore({
    semanticSimilarity: 0.3,
    timeDecayScore: 0.2,
    alpha: 0.7,
    beta: 0.3
  });

  assert.ok(strong > weak);
});

test("blendRankingScores respects weighted blend", () => {
  const highSimilarity = blendRankingScores({
    similarity: 0.95,
    recency: 0.3,
    importance: 0.3,
    weights: {
      similarity: 0.6,
      recency: 0.25,
      importance: 0.15
    }
  });

  const lowSimilarity = blendRankingScores({
    similarity: 0.2,
    recency: 0.9,
    importance: 0.9,
    weights: {
      similarity: 0.6,
      recency: 0.25,
      importance: 0.15
    }
  });

  assert.ok(highSimilarity > lowSimilarity);
});

test("dedupeMemoryResults removes near-identical records", () => {
  const first = buildResult({
    memory: {
      id: "mem-1",
      contentHash: "same-hash",
      content: "User prefers concise updates in morning standups.",
      summary: "Prefers concise updates."
    },
    score: 0.9
  });

  const second = buildResult({
    memory: {
      id: "mem-2",
      contentHash: "same-hash",
      content: "User prefers concise updates in morning standups.",
      summary: "Prefers concise updates."
    },
    score: 0.88
  });

  const third = buildResult({
    memory: {
      id: "mem-3",
      contentHash: "different-hash",
      content: "Budget cap for this mission is $250.",
      summary: "Budget cap set."
    },
    score: 0.7
  });

  const deduped = dedupeMemoryResults([first, second, third], 0.9);

  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].memory.id, "mem-1");
  assert.equal(deduped[1].memory.id, "mem-3");
});
