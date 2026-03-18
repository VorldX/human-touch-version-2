import "server-only";

function normalizeEnv(value: string | undefined) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export interface InngestRuntimeConfig {
  appId: string;
  appName: string;
  eventKey: string;
  signingKey: string;
  baseUrl: string;
}

export function getInngestRuntimeConfig(): InngestRuntimeConfig {
  const appId = normalizeEnv(process.env.INNGEST_APP_ID) || "human-touch-orchestrator";
  const appName = normalizeEnv(process.env.INNGEST_APP_NAME) || "Human Touch Orchestrator";
  const eventKey = normalizeEnv(process.env.INNGEST_EVENT_KEY);
  const signingKey = normalizeEnv(process.env.INNGEST_SIGNING_KEY);
  const baseUrl = normalizeEnv(process.env.INNGEST_BASE_URL);

  return {
    appId,
    appName,
    eventKey,
    signingKey,
    baseUrl
  };
}

export function assertInngestEmitterConfig() {
  const config = getInngestRuntimeConfig();
  if (!config.eventKey) {
    throw new Error(
      "INNGEST_EVENT_KEY is required to emit events. Set it in .env before using /api/orchestrator/run."
    );
  }
  return config;
}

