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

export const DNA_PHASE3_SCHEMA_VERSION = "dna.phase3.v1";

export const dnaPhase3Config = {
  enabled: parseBoolean(process.env.FEATURE_DNA_MEMORY_PHASE3, true),
  pathwayRegistry: {
    maxSteps: parsePositiveInt(process.env.DNA_MEMORY_PHASE3_MAX_STEPS, 20),
    defaultStepLimit: parsePositiveInt(process.env.DNA_MEMORY_PHASE3_LIST_STEP_LIMIT, 120)
  },
  blackboard: {
    mutexTtlMs: parsePositiveInt(process.env.DNA_MEMORY_PHASE3_MUTEX_TTL_MS, 120000),
    claimScanLimit: parsePositiveInt(process.env.DNA_MEMORY_PHASE3_CLAIM_SCAN_LIMIT, 40),
    boardFetchLimit: parsePositiveInt(process.env.DNA_MEMORY_PHASE3_BOARD_FETCH_LIMIT, 30)
  },
  syncBus: {
    channel: process.env.DNA_MEMORY_PHASE3_SYNC_CHANNEL?.trim() || "dna_memory:update_bus",
    eventType: "UPDATE_DNA" as const,
    recentLimit: parsePositiveInt(process.env.DNA_MEMORY_PHASE3_SYNC_RECENT_LIMIT, 50)
  },
  gracefulFallback: {
    peripheralLogLimit: parsePositiveInt(process.env.DNA_MEMORY_PHASE3_PERIPHERAL_LOG_LIMIT, 5)
  }
} as const;
