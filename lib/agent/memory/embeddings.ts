import "server-only";

import { createDeterministicEmbedding } from "@/lib/ai/embeddings";
import { agentMemoryConfig } from "@/lib/agent/memory/config";
import type { MemoryEmbedder, MemoryEmbeddingResult } from "@/lib/agent/memory/types";

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

function normalizeApiKey(value: string | undefined) {
  const key = value?.trim() ?? "";
  if (!key) return null;
  if (/^replace_with_/i.test(key)) return null;
  return key;
}

function clampVectorDimensions(vector: number[], dimensions: number) {
  if (vector.length === dimensions) return vector;
  if (vector.length > dimensions) return vector.slice(0, dimensions);
  const padded = [...vector];
  while (padded.length < dimensions) {
    padded.push(0);
  }
  return padded;
}

function logEmbeddingTelemetry(result: MemoryEmbeddingResult) {
  const t = result.telemetry;
  console.info(
    `[agent-memory][embedding] provider=${t.provider}; model=${t.model}; prompt_tokens=${t.promptTokens}; total_tokens=${t.totalTokens}; latency_ms=${t.latencyMs}; dimensions=${t.dimensions}`
  );
}

async function embedWithOpenAI(text: string): Promise<MemoryEmbeddingResult> {
  const apiKey =
    normalizeApiKey(process.env.PLATFORM_OPENAI_API_KEY) ??
    normalizeApiKey(process.env.OPENAI_API_KEY);

  if (!apiKey) {
    throw new Error("OpenAI API key not configured for memory embeddings.");
  }

  const model = agentMemoryConfig.embedding.model;
  const dimensions = agentMemoryConfig.embedding.dimensions;
  const payload: Record<string, unknown> = {
    model,
    input: text
  };

  if (/text-embedding-3/i.test(model)) {
    payload.dimensions = dimensions;
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Math.max(2000, agentMemoryConfig.embedding.timeoutMs)
  );

  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
      cache: "no-store"
    });

    const json = (await response.json().catch(() => null)) as
      | {
          data?: Array<{ embedding?: number[] }>;
          usage?: {
            prompt_tokens?: number;
            total_tokens?: number;
          };
          error?: {
            message?: string;
          };
        }
      | null;

    if (!response.ok) {
      const detail = json?.error?.message ?? `HTTP ${response.status}`;
      throw new Error(`OpenAI embeddings request failed: ${detail}`);
    }

    const embedding = Array.isArray(json?.data?.[0]?.embedding)
      ? (json?.data?.[0]?.embedding as number[])
      : null;

    if (!embedding || embedding.length === 0) {
      throw new Error("OpenAI embeddings returned no vector.");
    }

    const telemetry: MemoryEmbeddingResult["telemetry"] = {
      provider: "openai",
      model,
      dimensions,
      promptTokens:
        typeof json?.usage?.prompt_tokens === "number"
          ? Math.max(1, Math.floor(json.usage.prompt_tokens))
          : estimateTokens(text),
      totalTokens:
        typeof json?.usage?.total_tokens === "number"
          ? Math.max(1, Math.floor(json.usage.total_tokens))
          : estimateTokens(text),
      latencyMs: Math.max(1, Date.now() - startedAt)
    };

    const result: MemoryEmbeddingResult = {
      embedding: clampVectorDimensions(embedding, dimensions),
      telemetry
    };

    logEmbeddingTelemetry(result);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

function embedDeterministically(text: string): MemoryEmbeddingResult {
  const startedAt = Date.now();
  const dimensions = agentMemoryConfig.embedding.dimensions;
  const embedding = createDeterministicEmbedding(text, dimensions);
  const result: MemoryEmbeddingResult = {
    embedding,
    telemetry: {
      provider: "deterministic",
      model: "sha256-deterministic",
      dimensions,
      promptTokens: estimateTokens(text),
      totalTokens: estimateTokens(text),
      latencyMs: Math.max(1, Date.now() - startedAt)
    }
  };

  logEmbeddingTelemetry(result);
  return result;
}

class DefaultMemoryEmbedder implements MemoryEmbedder {
  async embed(text: string) {
    const cleaned = text.trim() || "empty";
    const provider = agentMemoryConfig.embedding.provider;

    if (provider === "deterministic") {
      return embedDeterministically(cleaned);
    }

    if (provider === "openai") {
      return embedWithOpenAI(cleaned);
    }

    try {
      return await embedWithOpenAI(cleaned);
    } catch {
      return embedDeterministically(cleaned);
    }
  }
}

export const defaultMemoryEmbedder: MemoryEmbedder = new DefaultMemoryEmbedder();
