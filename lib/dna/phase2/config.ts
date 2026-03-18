import "server-only";

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

function parseNumberInRange(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export const DNA_PHASE2_SCHEMA_VERSION = "dna.phase2.v1";

export const dnaPhase2Config = {
  enabled: parseBoolean(process.env.FEATURE_DNA_MEMORY_PHASE2, true),
  idleWindowMinutes: parsePositiveInt(process.env.DNA_MEMORY_IDLE_MINUTES, 10),
  sessionSweepLimit: parsePositiveInt(process.env.DNA_MEMORY_IDLE_SWEEP_LIMIT, 40),
  queue: {
    streamKey: process.env.DNA_MEMORY_REDIS_STREAM?.trim() || "dna_memory:slm_tasks",
    workerGroup:
      process.env.DNA_MEMORY_REDIS_GROUP?.trim() || "dna_memory_phase2_workers",
    consumerNamePrefix:
      process.env.DNA_MEMORY_REDIS_CONSUMER_PREFIX?.trim() || "phase2-node"
  },
  hybrid: {
    alpha: parseNumberInRange(process.env.AGENT_MEMORY_TIME_ALPHA, 0.72, 0, 1),
    beta: parseNumberInRange(process.env.AGENT_MEMORY_TIME_BETA, 0.28, 0, 1),
    lambdaPerHour: parseNumberInRange(
      process.env.AGENT_MEMORY_TIME_LAMBDA_PER_HOUR,
      0.08,
      0.0001,
      5
    ),
    gcThreshold: parseNumberInRange(
      process.env.AGENT_MEMORY_TIME_GC_THRESHOLD,
      0.2,
      0,
      1
    )
  },
  reranker: {
    topK: parsePositiveInt(process.env.AGENT_MEMORY_CROSS_ENCODER_TOP_K, 3)
  },
  slm: {
    model: process.env.DNA_MEMORY_SLM_MODEL?.trim() || "Llama-3-8B-Instruct",
    provider: process.env.DNA_MEMORY_SLM_PROVIDER?.trim() || "vllm",
    taskType: "SESSION_IDLE_BATCH" as const
  }
} as const;
