import "server-only";

import { agentMemoryConfig } from "@/lib/agent/memory/config";
import type { AgentMemorySearchResult } from "@/lib/agent/memory/types";

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

function overlapScore(query: string, candidate: string) {
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) return 0;

  const candidateTokens = tokenize(candidate);
  if (candidateTokens.length === 0) return 0;

  let hits = 0;
  for (const token of candidateTokens) {
    if (queryTokens.has(token)) {
      hits += 1;
    }
  }

  return clamp(hits / Math.max(6, queryTokens.size));
}

function parseRerankerScores(payload: unknown, expected: number) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.scores) && record.scores.length >= expected) {
    return record.scores
      .slice(0, expected)
      .map((score) => (typeof score === "number" && Number.isFinite(score) ? score : 0));
  }

  if (Array.isArray(record.results)) {
    const scores = Array.from({ length: expected }, () => 0);
    let any = false;

    for (const item of record.results) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const index =
        typeof row.index === "number" && Number.isFinite(row.index)
          ? Math.floor(row.index)
          : null;
      const score =
        typeof row.score === "number" && Number.isFinite(row.score) ? row.score : null;
      if (index === null || score === null) continue;
      if (index >= 0 && index < scores.length) {
        scores[index] = score;
        any = true;
      }
    }

    return any ? scores : null;
  }

  return null;
}

async function runCrossEncoderRerank(input: {
  query: string;
  candidates: AgentMemorySearchResult[];
}) {
  const endpoint = agentMemoryConfig.retrieval.crossEncoderEndpoint;
  if (!endpoint) return null;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(500, agentMemoryConfig.retrieval.crossEncoderTimeoutMs)
  );

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(agentMemoryConfig.retrieval.crossEncoderApiKey
          ? {
              Authorization: `Bearer ${agentMemoryConfig.retrieval.crossEncoderApiKey}`
            }
          : {})
      },
      body: JSON.stringify({
        model: agentMemoryConfig.retrieval.crossEncoderModel,
        query: input.query,
        documents: input.candidates.map((item) => `${item.memory.summary}\n${item.memory.content}`)
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json().catch(() => null)) as unknown;
    return parseRerankerScores(payload, input.candidates.length);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function rerankMemoryResults(input: {
  query: string;
  candidates: AgentMemorySearchResult[];
  topK: number;
}) {
  const topK = Math.max(1, input.topK);
  if (input.candidates.length === 0) {
    return [] as AgentMemorySearchResult[];
  }

  const externalScores = await runCrossEncoderRerank({
    query: input.query,
    candidates: input.candidates
  });

  const reranked = input.candidates
    .map((item, index) => {
      const crossEncoderScore = clamp(
        externalScores?.[index] ??
          overlapScore(input.query, `${item.memory.summary} ${item.memory.content}`),
        0,
        1
      );

      const finalScore = Number(
        clamp(item.hybridScore * 0.35 + crossEncoderScore * 0.65, 0, 1).toFixed(6)
      );

      return {
        ...item,
        rerankScore: crossEncoderScore,
        score: finalScore
      } satisfies AgentMemorySearchResult;
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if ((right.rerankScore ?? 0) !== (left.rerankScore ?? 0)) {
        return (right.rerankScore ?? 0) - (left.rerankScore ?? 0);
      }
      return right.hybridScore - left.hybridScore;
    });

  return reranked.slice(0, topK);
}
