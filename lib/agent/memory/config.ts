function parseBoolean(value: string | undefined, fallback: boolean) {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function parseFloatInRange(
  value: string | undefined,
  fallback: number,
  min = 0,
  max = 1
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseEmbeddingProvider(raw: string | undefined) {
  const normalized = raw?.trim().toLowerCase() ?? "auto";
  if (normalized === "openai") return "openai" as const;
  if (normalized === "deterministic") return "deterministic" as const;
  return "auto" as const;
}

function parseVectorBackend(raw: string | undefined) {
  const normalized = raw?.trim().toLowerCase() ?? "pgvector";
  if (normalized === "pgvector") return "pgvector" as const;
  return "pgvector" as const;
}

export const agentMemoryConfig = {
  enabled: parseBoolean(process.env.FEATURE_AGENT_LONG_TERM_MEMORY, true),
  vectorBackend: parseVectorBackend(process.env.AGENT_MEMORY_VECTOR_BACKEND),
  embedding: {
    provider: parseEmbeddingProvider(process.env.AGENT_MEMORY_EMBEDDING_PROVIDER),
    model: process.env.AGENT_MEMORY_EMBEDDING_MODEL?.trim() || "text-embedding-3-small",
    dimensions: parsePositiveInt(process.env.AGENT_MEMORY_EMBEDDING_DIMENSIONS, 1536),
    timeoutMs: parsePositiveInt(process.env.AGENT_MEMORY_EMBEDDING_TIMEOUT_MS, 12000)
  },
  retrieval: {
    defaultTopK: parsePositiveInt(process.env.AGENT_MEMORY_TOP_K, 6),
    candidateMultiplier: parsePositiveInt(
      process.env.AGENT_MEMORY_SEARCH_CANDIDATE_MULTIPLIER,
      4
    ),
    minSimilarity: parseFloatInRange(process.env.AGENT_MEMORY_MIN_SIMILARITY, 0.08, 0, 1),
    dedupeThreshold: parseFloatInRange(
      process.env.AGENT_MEMORY_DEDUPE_THRESHOLD,
      0.9,
      0.6,
      0.99
    ),
    rankingWeights: {
      similarity: parseFloatInRange(
        process.env.AGENT_MEMORY_WEIGHT_SIMILARITY,
        0.6,
        0,
        1
      ),
      recency: parseFloatInRange(process.env.AGENT_MEMORY_WEIGHT_RECENCY, 0.25, 0, 1),
      importance: parseFloatInRange(
        process.env.AGENT_MEMORY_WEIGHT_IMPORTANCE,
        0.15,
        0,
        1
      )
    },
    recencyHalfLifeHours: parsePositiveInt(
      process.env.AGENT_MEMORY_RECENCY_HALF_LIFE_HOURS,
      96
    )
  },
  ingestion: {
    persistThreshold: parseFloatInRange(
      process.env.AGENT_MEMORY_PERSIST_THRESHOLD,
      0.52,
      0,
      1
    ),
    maxContentChars: parsePositiveInt(process.env.AGENT_MEMORY_MAX_CONTENT_CHARS, 5000)
  },
  context: {
    maxItems: parsePositiveInt(process.env.AGENT_MEMORY_CONTEXT_MAX_ITEMS, 6),
    maxChars: parsePositiveInt(process.env.AGENT_MEMORY_CONTEXT_MAX_CHARS, 2400)
  },
  summarization: {
    triggerCount: parsePositiveInt(process.env.AGENT_MEMORY_SUMMARIZE_TRIGGER_COUNT, 28),
    archiveCount: parsePositiveInt(process.env.AGENT_MEMORY_SUMMARIZE_ARCHIVE_COUNT, 20),
    maxSummaryChars: parsePositiveInt(process.env.AGENT_MEMORY_SUMMARY_MAX_CHARS, 1200),
    maxSourceEntries: parsePositiveInt(process.env.AGENT_MEMORY_SUMMARY_MAX_SOURCE_ENTRIES, 36)
  }
} as const;
