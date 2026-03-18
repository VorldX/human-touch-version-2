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

export const DNA_PHASE4_SCHEMA_VERSION = "dna.phase4.v1";

export const dnaPhase4Config = {
  enabled: parseBoolean(process.env.FEATURE_DNA_MEMORY_PHASE4, true),
  quarantine: {
    defaultLimit: parsePositiveInt(process.env.DNA_MEMORY_PHASE4_QUARANTINE_LIMIT, 40),
    maxLimit: parsePositiveInt(process.env.DNA_MEMORY_PHASE4_QUARANTINE_MAX_LIMIT, 200)
  },
  trace: {
    defaultLimit: parsePositiveInt(process.env.DNA_MEMORY_PHASE4_TRACE_LIMIT, 30),
    maxLimit: parsePositiveInt(process.env.DNA_MEMORY_PHASE4_TRACE_MAX_LIMIT, 120)
  },
  explorer: {
    defaultLimit: parsePositiveInt(process.env.DNA_MEMORY_PHASE4_EXPLORER_LIMIT, 120),
    maxLimit: parsePositiveInt(process.env.DNA_MEMORY_PHASE4_EXPLORER_MAX_LIMIT, 500)
  },
  graph: {
    defaultNodeLimit: parsePositiveInt(process.env.DNA_MEMORY_PHASE4_GRAPH_NODE_LIMIT, 180),
    defaultEdgeLimit: parsePositiveInt(process.env.DNA_MEMORY_PHASE4_GRAPH_EDGE_LIMIT, 260)
  },
  admin: {
    defaultBackupLimit: parsePositiveInt(process.env.DNA_MEMORY_PHASE4_BACKUP_LIMIT, 12),
    maxBackupRows: parsePositiveInt(process.env.DNA_MEMORY_PHASE4_BACKUP_ROW_MAX, 20000)
  }
} as const;
