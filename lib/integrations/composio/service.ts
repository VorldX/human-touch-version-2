import "server-only";

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Composio } from "@composio/core";
import type { Prisma } from "@prisma/client";

import { featureFlags } from "@/lib/config/feature-flags";
import { prisma } from "@/lib/db/prisma";
import {
  ComposioServiceCore,
  ComposioServiceError,
  inferRequestedToolkits as inferRequestedToolkitsCore,
  isConnectedIntegrationStatus as isConnectedIntegrationStatusCore,
  normalizeConnectionStatus as normalizeConnectionStatusCore,
  type ConnectionSummary,
  type CustomToolkitAuthConfig,
  type UserIntegrationStore
} from "@/lib/integrations/composio/service-core";
import { createComposioOAuthState, verifyComposioOAuthState } from "@/lib/integrations/composio/oauth-state";

const DEFAULT_ALLOWLIST = [
  "gmail",
  "slack",
  "notion",
  "github",
  "googlemeet",
  "gmeet",
  "googlecalendar",
  "googleslides",
  "googledrive",
  "googledocs",
  "googlesheets",
  "googleads",
  "outlook",
  "onedrive",
  "microsoftteams",
  "airtable",
  "clickup",
  "discord",
  "telegram",
  "jira",
  "trello",
  "asana",
  "monday",
  "linear",
  "dropbox",
  "box",
  "shopify",
  "stripe",
  "salesforce",
  "hubspot",
  "pipedrive",
  "calendly",
  "mailchimp",
  "quickbooks",
  "zendesk",
  "wordpress",
  "webflow",
  "surveymonkey",
  "facebook",
  "instagram",
  "whatsapp",
  "twitter",
  "linkedin",
  "youtube",
  "zoom",
  "intercom",
  "typeform"
] as const;
type UserIntegrationRow = NonNullable<
  Awaited<ReturnType<typeof prisma.userIntegration.findFirst>>
>;

let cachedLocalEnvMap: Map<string, string> | null = null;

function parseEnvFileContent(raw: string) {
  const parsed = new Map<string, string>();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) {
      continue;
    }
    const [, key, value] = match;
    parsed.set(key, value);
  }
  return parsed;
}

function getLocalEnvMap() {
  if (cachedLocalEnvMap) {
    return cachedLocalEnvMap;
  }

  const map = new Map<string, string>();
  const nodeEnv = process.env.NODE_ENV?.trim() || "development";
  const envFilesInLoadOrder = [
    ".env",
    `.env.${nodeEnv}`,
    ".env.local",
    `.env.${nodeEnv}.local`
  ];

  for (const relativeFile of envFilesInLoadOrder) {
    const absoluteFile = resolve(process.cwd(), relativeFile);
    if (!existsSync(absoluteFile)) {
      continue;
    }
    const content = readFileSync(absoluteFile, "utf8");
    const parsed = parseEnvFileContent(content);
    for (const [key, value] of parsed.entries()) {
      map.set(key, value);
    }
  }

  cachedLocalEnvMap = map;
  return map;
}

function resolveRuntimeEnv(name: string) {
  const fromProcess = normalizeEnvValue(process.env[name]);
  if (fromProcess) {
    return fromProcess;
  }

  const fromLocalEnv = normalizeEnvValue(getLocalEnvMap().get(name));
  if (fromLocalEnv) {
    return fromLocalEnv;
  }
  return undefined;
}

function resolveRuntimeEnvDiagnostics(name: string) {
  const processRaw = process.env[name];
  const processNormalized = normalizeEnvValue(processRaw);
  const localRaw = getLocalEnvMap().get(name);
  const localNormalized = normalizeEnvValue(localRaw);
  return {
    processRawPresent: typeof processRaw === "string",
    processNormalizedPresent: Boolean(processNormalized),
    localRawPresent: typeof localRaw === "string",
    localNormalizedPresent: Boolean(localNormalized)
  };
}

function normalizeEnvValue(value: string | undefined) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const wrappedInDoubleQuotes = trimmed.startsWith('"') && trimmed.endsWith('"');
  const wrappedInSingleQuotes = trimmed.startsWith("'") && trimmed.endsWith("'");
  if (wrappedInDoubleQuotes || wrappedInSingleQuotes) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function parseBooleanRuntime(value: string | undefined, fallback = false) {
  const normalized = normalizeEnvValue(value).toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function asJson(value: Record<string, unknown> | undefined): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function toConnectionSummary(row: UserIntegrationRow): ConnectionSummary {
  return {
    id: row.id,
    userId: row.userId,
    orgId: row.orgId ?? null,
    provider: row.provider,
    toolkit: row.toolkit,
    connectionId: row.connectionId,
    status: row.status,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {},
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function parseAllowlistedToolkits() {
  const raw = process.env.COMPOSIO_ALLOWED_TOOLKITS?.trim();
  if (!raw) {
    return [...DEFAULT_ALLOWLIST];
  }

  const strictMode =
    (process.env.COMPOSIO_ALLOWED_TOOLKITS_STRICT?.trim().toLowerCase() ?? "") === "true";
  const parsed = raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (parsed.length === 0) {
    return [...DEFAULT_ALLOWLIST];
  }
  if (strictMode) {
    return [...new Set(parsed)];
  }
  return [...new Set([...DEFAULT_ALLOWLIST, ...parsed])];
}

function envPrefixForToolkit(toolkit: string) {
  return `COMPOSIO_${toolkit.replace(/[^a-z0-9]/gi, "_").toUpperCase()}_`;
}

function parseCustomToolkitAuthConfigs(allowlistedToolkits: string[]) {
  const configs: Record<string, CustomToolkitAuthConfig> = {};

  for (const toolkit of allowlistedToolkits) {
    const envPrefix = envPrefixForToolkit(toolkit);
    const clientId = process.env[`${envPrefix}OAUTH_CLIENT_ID`]?.trim();
    const clientSecret = process.env[`${envPrefix}OAUTH_CLIENT_SECRET`]?.trim();
    if (!clientId || !clientSecret) {
      continue;
    }

    const name = process.env[`${envPrefix}AUTH_CONFIG_NAME`]?.trim();
    configs[toolkit] = {
      authScheme: "OAUTH2",
      credentials: {
        client_id: clientId,
        client_secret: clientSecret
      },
      ...(name ? { name } : {})
    };
  }

  return configs;
}

function parseBooleanEnv(name: string, fallback: boolean) {
  return parseBooleanRuntime(resolveRuntimeEnv(name), fallback);
}

function resolveComposioApiKeyState() {
  const apiKey = normalizeEnvValue(resolveRuntimeEnv("COMPOSIO_API_KEY"));
  if (!apiKey) {
    return {
      apiKey: "",
      reason: "missing" as const
    };
  }

  // Treat template placeholders as unset so local/dev environments don't keep
  // retrying Composio endpoints with invalid credentials.
  if (/^replace_with_/i.test(apiKey)) {
    return {
      apiKey: "",
      reason: "placeholder" as const
    };
  }

  return {
    apiKey,
    reason: "configured" as const
  };
}

function resolveComposioApiKey() {
  return resolveComposioApiKeyState().apiKey;
}

function composioFeatureEnabledRuntime() {
  return parseBooleanRuntime(
    resolveRuntimeEnv("FEATURE_COMPOSIO_INTEGRATIONS"),
    featureFlags.composioIntegrations
  );
}

function enabled() {
  return composioFeatureEnabledRuntime() && Boolean(resolveComposioApiKey());
}

export function composioIntegrationEnabled() {
  return enabled();
}

export function composioIntegrationStatus() {
  const featureEnabled = composioFeatureEnabledRuntime();
  const apiKeyState = resolveComposioApiKeyState();
  const apiKeyConfigured = Boolean(apiKeyState.apiKey);
  return {
    enabled: featureEnabled && apiKeyConfigured,
    featureEnabled,
    apiKeyConfigured,
    apiKeyReason: apiKeyState.reason,
    diagnostics:
      process.env.NODE_ENV === "production"
        ? undefined
        : {
            cwd: process.cwd(),
            featureEnv: resolveRuntimeEnvDiagnostics("FEATURE_COMPOSIO_INTEGRATIONS"),
            apiKeyEnv: resolveRuntimeEnvDiagnostics("COMPOSIO_API_KEY")
          }
  };
}

export const isConnectedIntegrationStatus = isConnectedIntegrationStatusCore;
export const normalizeConnectionStatus = normalizeConnectionStatusCore;

export function composioAllowlistedToolkits() {
  return parseAllowlistedToolkits();
}

export function defaultIntegrationsReturnPath() {
  return "/app?tab=hub&hubScope=TOOLS";
}

export function buildIntegrationConnectPath(toolkit?: string) {
  const url = new URL("http://localhost");
  url.pathname = "/app";
  url.searchParams.set("tab", "hub");
  url.searchParams.set("hubScope", "TOOLS");
  if (toolkit) {
    url.searchParams.set("toolkit", toolkit);
  }
  return `${url.pathname}${url.search}`;
}

function callbackUrl(callbackUrlOverride?: string) {
  const explicit = callbackUrlOverride?.trim() || process.env.COMPOSIO_OAUTH_CALLBACK_URL?.trim();
  if (explicit) {
    return explicit;
  }

  return "http://localhost:3000/api/integrations/composio/oauth/callback";
}

const store: UserIntegrationStore = {
  async listByUser(input) {
    const where =
      input.orgId
        ? {
            userId: input.userId,
            provider: input.provider,
            OR: [{ orgId: input.orgId }, { orgId: null }]
          }
        : {
            userId: input.userId,
            provider: input.provider
          };

    const rows = await prisma.userIntegration.findMany({
      where,
      orderBy: {
        updatedAt: "desc"
      }
    });

    return rows.map((row) => toConnectionSummary(row));
  },

  async listByOrg(input) {
    const rows = await prisma.userIntegration.findMany({
      where: {
        provider: input.provider,
        orgId: input.orgId
      },
      orderBy: {
        updatedAt: "desc"
      }
    });

    const normalizedToolkits = Array.isArray(input.toolkits)
      ? input.toolkits.map((item) => item.trim().toLowerCase()).filter(Boolean)
      : [];
    const includeAll = normalizedToolkits.length === 0;
    const filtered = includeAll
      ? rows
      : rows.filter((row) => normalizedToolkits.includes(row.toolkit.toLowerCase()));

    return filtered.map((row) => toConnectionSummary(row));
  },

  async findByConnection(input) {
    const where =
      input.orgId
        ? {
            userId: input.userId,
            provider: input.provider,
            connectionId: input.connectionId,
            OR: [{ orgId: input.orgId }, { orgId: null }]
          }
        : {
            userId: input.userId,
            provider: input.provider,
            connectionId: input.connectionId
          };

    const row = await prisma.userIntegration.findFirst({ where });
    return row ? toConnectionSummary(row) : null;
  },

  async findByNonce(input) {
    const where =
      input.orgId
        ? {
            userId: input.userId,
            provider: input.provider,
            toolkit: input.toolkit,
            OR: [{ orgId: input.orgId }, { orgId: null }],
            metadata: {
              path: ["oauthStateNonce"],
              equals: input.nonce
            }
          }
        : {
            userId: input.userId,
            provider: input.provider,
            toolkit: input.toolkit,
            metadata: {
              path: ["oauthStateNonce"],
              equals: input.nonce
            }
          };

    const row = await prisma.userIntegration.findFirst({
      where,
      orderBy: {
        updatedAt: "desc"
      }
    });
    return row ? toConnectionSummary(row) : null;
  },

  async upsertByConnection(input) {
    const row = await prisma.userIntegration.upsert({
      where: {
        provider_connectionId: {
          provider: input.provider,
          connectionId: input.connectionId
        }
      },
      update: {
        userId: input.userId,
        orgId: input.orgId ?? null,
        toolkit: input.toolkit,
        status: input.status,
        metadata: asJson(input.metadata)
      },
      create: {
        userId: input.userId,
        orgId: input.orgId ?? null,
        provider: input.provider,
        toolkit: input.toolkit,
        connectionId: input.connectionId,
        status: input.status,
        metadata: asJson(input.metadata)
      }
    });

    return toConnectionSummary(row);
  }
};

export function initComposioClient() {
  if (!enabled()) {
    return null;
  }
  const apiKey = resolveComposioApiKey();
  if (!apiKey) {
    return null;
  }
  const baseURL = process.env.COMPOSIO_BASE_URL?.trim();

  return new Composio({
    apiKey,
    ...(baseURL ? { baseURL } : {})
  });
}

function createCore(options?: { callbackUrlOverride?: string }) {
  const allowlistedToolkits = parseAllowlistedToolkits();
  return new ComposioServiceCore({
    enabled: enabled(),
    provider: "composio",
    allowlistedToolkits,
    callbackUrl: callbackUrl(options?.callbackUrlOverride),
    createClient: () => {
      const client = initComposioClient();
      if (!client) {
        throw new ComposioServiceError(
          "Composio is disabled or COMPOSIO_API_KEY is missing.",
          { code: "COMPOSIO_DISABLED", status: 503 }
        );
      }
      return client;
    },
    store,
    createStateToken: createComposioOAuthState,
    verifyStateToken: verifyComposioOAuthState,
    connectUrlForToolkit: buildIntegrationConnectPath,
    customAuthConfigs: parseCustomToolkitAuthConfigs(allowlistedToolkits),
    allowOrgToolkitFallback: parseBooleanEnv("COMPOSIO_ALLOW_ORG_TOOL_FALLBACK", true)
  });
}

export async function listAvailableToolkits(input: { userId: string }) {
  const core = createCore();
  return core.listAvailableToolkits(input.userId);
}

export async function createConnection(input: {
  userId: string;
  orgId: string;
  toolkit: string;
  returnTo?: string;
  callbackUrlOverride?: string;
}) {
  const core = createCore({
    callbackUrlOverride: input.callbackUrlOverride
  });
  return core.createConnection({
    userId: input.userId,
    orgId: input.orgId,
    toolkit: input.toolkit,
    returnTo: input.returnTo ?? defaultIntegrationsReturnPath()
  });
}

export async function getConnections(input: { userId: string; orgId: string }) {
  const core = createCore();
  return core.getConnections(input);
}

export async function disconnectConnection(input: {
  userId: string;
  orgId: string;
  connectionId: string;
}) {
  const core = createCore();
  return core.disconnectConnection(input);
}

export async function handleOAuthCallback(request: Request) {
  const core = createCore();
  const url = new URL(request.url);
  const params = new URLSearchParams(url.searchParams);

  if (request.method.toUpperCase() === "POST") {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (body) {
        for (const [key, value] of Object.entries(body)) {
          if (typeof value === "string" && value.trim().length > 0) {
            params.set(key, value.trim());
          }
        }
      }
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      const form = await request.formData().catch(() => null);
      if (form) {
        for (const [key, value] of form.entries()) {
          if (typeof value === "string" && value.trim().length > 0) {
            params.set(key, value.trim());
          }
        }
      }
    }
  }

  return core.handleOAuthCallback({ params });
}

export async function getToolsForAgent(input: {
  userId: string;
  orgId: string;
  requestedToolkits: string[];
  action: string;
}) {
  const core = createCore();
  return core.getToolsForAgent(input);
}

export async function executeToolAction(input: {
  userId: string;
  orgId: string;
  toolkit: string;
  toolSlug: string;
  action: string;
  arguments?: Record<string, unknown>;
}) {
  const core = createCore();
  return core.executeToolAction(input);
}

export function inferRequestedToolkits(prompt: string) {
  return inferRequestedToolkitsCore(prompt, parseAllowlistedToolkits());
}

export { ComposioServiceError };
