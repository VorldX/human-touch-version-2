import { randomUUID } from "node:crypto";

export interface OAuthStatePayload {
  nonce: string;
  userId: string;
  orgId: string;
  toolkit: string;
  returnTo: string;
  issuedAt: number;
  expiresAt: number;
}

export interface ToolBinding {
  toolkit: string;
  slug: string;
  name: string;
  description: string;
}

export interface ToolExecutionResponse {
  successful: boolean;
  error: string | null;
  data: Record<string, unknown>;
  logId: string | null;
}

export interface ToolkitSummary {
  slug: string;
  name: string;
  description: string;
  logoUrl: string | null;
  appUrl: string | null;
  status: string;
  connected: boolean;
  connectionId: string | null;
}

export interface ConnectionSummary {
  id: string;
  userId: string;
  orgId: string | null;
  provider: string;
  toolkit: string;
  connectionId: string;
  status: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationNotConnectedErrorShape {
  code: "INTEGRATION_NOT_CONNECTED";
  toolkit: string;
  action: string;
  connectUrl?: string;
}

export type CustomAuthScheme =
  | "OAUTH2"
  | "OAUTH1"
  | "API_KEY"
  | "BASIC"
  | "BEARER_TOKEN"
  | "BILLCOM_AUTH"
  | "GOOGLE_SERVICE_ACCOUNT"
  | "NO_AUTH"
  | "BASIC_WITH_JWT"
  | "CALCOM_AUTH"
  | "SERVICE_ACCOUNT"
  | "SAML"
  | "DCR_OAUTH";

export interface CustomToolkitAuthConfig {
  name?: string;
  authScheme: CustomAuthScheme;
  credentials: Record<string, string | number | boolean>;
}

export interface ComposioClientLike {
  toolkits: {
    get: (query?: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
  };
  authConfigs: {
    list: (query?: Record<string, unknown>) => Promise<{
      items?: Array<Record<string, unknown>>;
    }>;
    create: (
      toolkit: string,
      options?: Record<string, unknown>
    ) => Promise<{ id: string } & Record<string, unknown>>;
  };
  connectedAccounts: {
    list: (query?: Record<string, unknown>) => Promise<{
      items?: Array<Record<string, unknown>>;
    }>;
    link: (
      userId: string,
      authConfigId: string,
      options?: {
        callbackUrl?: string;
      }
    ) => Promise<{
      id: string;
      status?: string;
      redirectUrl?: string | null;
    }>;
    delete: (connectionId: string) => Promise<unknown>;
  };
  tools: {
    getRawComposioTools: (query: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
    execute: (
      slug: string,
      body: {
        userId: string;
        connectedAccountId: string;
        arguments?: Record<string, unknown>;
        dangerouslySkipVersionCheck?: boolean;
      }
    ) => Promise<{
      successful?: boolean;
      error?: string | null;
      data?: Record<string, unknown>;
      log_id?: string;
      logId?: string;
    }>;
  };
}

export interface UserIntegrationStore {
  listByUser(input: {
    userId: string;
    provider: string;
    orgId?: string;
  }): Promise<ConnectionSummary[]>;
  listByOrg?(input: {
    orgId: string;
    provider: string;
    toolkits?: string[];
  }): Promise<ConnectionSummary[]>;
  findByConnection(input: {
    userId: string;
    provider: string;
    connectionId: string;
    orgId?: string;
  }): Promise<ConnectionSummary | null>;
  findByNonce(input: {
    userId: string;
    provider: string;
    toolkit: string;
    nonce: string;
    orgId?: string;
  }): Promise<ConnectionSummary | null>;
  upsertByConnection(input: {
    userId: string;
    orgId?: string;
    provider: string;
    toolkit: string;
    connectionId: string;
    status: string;
    metadata?: Record<string, unknown>;
  }): Promise<ConnectionSummary>;
}

interface CreateConnectionInput {
  userId: string;
  orgId: string;
  toolkit: string;
  returnTo: string;
}

interface GetToolsForAgentInput {
  userId: string;
  orgId: string;
  requestedToolkits: string[];
  action: string;
}

interface ComposioServiceCoreConfig {
  enabled: boolean;
  provider: string;
  allowlistedToolkits: string[];
  callbackUrl: string;
  createClient: () => unknown;
  store: UserIntegrationStore;
  createStateToken: (payload: OAuthStatePayload) => string;
  verifyStateToken: (token: string) => OAuthStatePayload | null;
  connectUrlForToolkit: (toolkit: string) => string;
  customAuthConfigs?: Record<string, CustomToolkitAuthConfig>;
  now?: () => number;
  connectionCacheTtlMs?: number;
  toolCatalogCacheTtlMs?: number;
  allowOrgToolkitFallback?: boolean;
}

export class ComposioServiceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, options?: { code?: string; status?: number }) {
    super(message);
    this.name = "ComposioServiceError";
    this.code = options?.code ?? "COMPOSIO_ERROR";
    this.status = options?.status ?? 500;
  }
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function normalizeToolkit(value: string) {
  return value.trim().toLowerCase();
}

function canonicalToolkitForCompare(toolkit: string) {
  const normalized = normalizeToolkit(toolkit);
  const compact = normalized.replace(/[\s_-]+/g, "");
  if (compact === "googlemeet" || compact === "gmeet") {
    return "gmeet";
  }
  if (compact === "googleslides" || compact === "gslides") {
    return "googleslides";
  }
  return normalized;
}

function normalizeStatus(value: unknown) {
  const status = asString(value).toUpperCase();
  if (!status) return "UNKNOWN";
  return status;
}

const ACTIVE_CONNECTION_STATUSES = new Set([
  "ACTIVE",
  "SUCCESS",
  "CONNECTED",
  "COMPLETED",
  "AUTHORIZED",
  "AUTHENTICATED",
  "ENABLED",
  "OK"
]);

const DISCONNECTED_CONNECTION_STATUSES = new Set([
  "DISCONNECTED",
  "REVOKED",
  "DELETED",
  "REMOVED"
]);

export function normalizeConnectionStatus(value: unknown) {
  const status = normalizeStatus(value);
  if (ACTIVE_CONNECTION_STATUSES.has(status)) {
    return "ACTIVE";
  }
  if (DISCONNECTED_CONNECTION_STATUSES.has(status)) {
    return "DISCONNECTED";
  }
  return status;
}

export function isConnectedIntegrationStatus(value: unknown) {
  return normalizeConnectionStatus(value) === "ACTIVE";
}

function humanizeToolkit(slug: string) {
  return slug
    .split(/[-_]/g)
    .map((part) => (part.length > 0 ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function safeMetadata(value: unknown): Record<string, unknown> {
  const data = asRecord(value);
  const result: Record<string, unknown> = {};
  for (const [key, current] of Object.entries(data)) {
    if (/token|secret|password|api[_-]?key/i.test(key)) {
      continue;
    }
    result[key] = current;
  }
  return result;
}

function mergeMetadata(
  current: Record<string, unknown> | undefined,
  incoming: Record<string, unknown> | undefined
) {
  return {
    ...(current ?? {}),
    ...(incoming ?? {})
  };
}

function candidateConnectionId(params: URLSearchParams) {
  const keys = [
    "connectedAccountId",
    "connected_account_id",
    "connectionId",
    "connection_id",
    "id"
  ];
  for (const key of keys) {
    const value = params.get(key);
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

function callbackMetadata(params: URLSearchParams) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of params.entries()) {
    if (key === "state") continue;
    if (/token|secret|password|api[_-]?key/i.test(key)) continue;
    out[key] = value;
  }
  return out;
}

function disconnectNotFoundError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const record = error as Record<string, unknown>;
  const statusCandidates = [
    record.status,
    record.statusCode,
    asRecord(record.error).status,
    asRecord(record.response).status
  ];
  if (statusCandidates.some((value) => Number(value) === 404)) {
    return true;
  }

  const message = [
    asString(record.message),
    asString(asRecord(record.error).message),
    asString(asRecord(record.error).slug),
    asString(asRecord(record.response).message),
    asString(asRecord(asRecord(record.response).error).message),
    asString(asRecord(asRecord(record.response).error).slug)
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return message.includes("not found") || message.includes("resourcenotfound");
}

function executeConnectionMissingError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const record = error as Record<string, unknown>;
  const statusCandidates = [
    record.status,
    record.statusCode,
    asRecord(record.error).status,
    asRecord(record.response).status
  ];
  if (statusCandidates.some((value) => Number(value) === 404)) {
    return true;
  }

  const message = [
    asString(record.message),
    asString(asRecord(record.error).message),
    asString(asRecord(record.response).message),
    asString(asRecord(asRecord(record.response).error).message)
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!message) {
    return false;
  }

  return (
    message.includes("connected account") &&
    (message.includes("not found") || message.includes("missing"))
  );
}

const DEFAULT_CONNECTION_CACHE_TTL_MS = 30_000;
const DEFAULT_TOOL_CATALOG_CACHE_TTL_MS = 5 * 60_000;

export class ComposioServiceCore {
  private readonly enabled: boolean;
  private readonly provider: string;
  private readonly allowlistedToolkitList: string[];
  private readonly allowlistedToolkits: Set<string>;
  private readonly allowlistedCanonicalToolkits: Set<string>;
  private readonly callbackUrl: string;
  private readonly createClient: () => unknown;
  private readonly store: UserIntegrationStore;
  private readonly createStateToken: (payload: OAuthStatePayload) => string;
  private readonly verifyStateToken: (token: string) => OAuthStatePayload | null;
  private readonly connectUrlForToolkit: (toolkit: string) => string;
  private readonly customAuthConfigs: Map<string, CustomToolkitAuthConfig>;
  private readonly now: () => number;
  private readonly connectionCacheTtlMs: number;
  private readonly toolCatalogCacheTtlMs: number;
  private readonly allowOrgToolkitFallback: boolean;
  private readonly connectionCache = new Map<
    string,
    { expiresAt: number; connections: ConnectionSummary[] }
  >();
  private readonly toolCatalogCache = new Map<
    string,
    { expiresAt: number; bindings: ToolBinding[] }
  >();

  constructor(config: ComposioServiceCoreConfig) {
    this.enabled = config.enabled;
    this.provider = config.provider;
    this.allowlistedToolkitList = [...new Set(config.allowlistedToolkits.map(normalizeToolkit))];
    this.allowlistedToolkits = new Set(this.allowlistedToolkitList);
    this.allowlistedCanonicalToolkits = new Set(
      this.allowlistedToolkitList.map(canonicalToolkitForCompare)
    );
    this.callbackUrl = config.callbackUrl;
    this.createClient = config.createClient;
    this.store = config.store;
    this.createStateToken = config.createStateToken;
    this.verifyStateToken = config.verifyStateToken;
    this.connectUrlForToolkit = config.connectUrlForToolkit;
    this.customAuthConfigs = new Map(
      Object.entries(config.customAuthConfigs ?? {}).map(([toolkit, authConfig]) => [
        normalizeToolkit(toolkit),
        authConfig
      ])
    );
    this.now = config.now ?? (() => Date.now());
    this.connectionCacheTtlMs =
      typeof config.connectionCacheTtlMs === "number" && config.connectionCacheTtlMs > 0
        ? config.connectionCacheTtlMs
        : DEFAULT_CONNECTION_CACHE_TTL_MS;
    this.toolCatalogCacheTtlMs =
      typeof config.toolCatalogCacheTtlMs === "number" && config.toolCatalogCacheTtlMs > 0
        ? config.toolCatalogCacheTtlMs
        : DEFAULT_TOOL_CATALOG_CACHE_TTL_MS;
    this.allowOrgToolkitFallback = config.allowOrgToolkitFallback === true;
  }

  isEnabled() {
    return this.enabled;
  }

  private composioUserId(userId: string) {
    return `ht-user-${userId}`;
  }

  private assertToolkitAllowed(toolkit: string) {
    const resolved = this.resolveAllowlistedToolkit(toolkit);
    if (!resolved) {
      throw new ComposioServiceError(
        `Toolkit "${toolkit}" is not supported by this workspace.`,
        { code: "INVALID_TOOLKIT", status: 400 }
      );
    }
    return resolved;
  }

  private resolveAllowlistedToolkit(toolkit: string) {
    const normalized = normalizeToolkit(toolkit);
    if (this.allowlistedToolkits.has(normalized)) {
      return normalized;
    }

    const canonical = canonicalToolkitForCompare(normalized);
    if (!this.allowlistedCanonicalToolkits.has(canonical)) {
      return "";
    }

    const matched = this.allowlistedToolkitList.find(
      (item) => canonicalToolkitForCompare(item) === canonical
    );
    return matched ?? "";
  }

  private async ensureAuthConfigId(client: ComposioClientLike, toolkit: string) {
    const existing = await client.authConfigs.list({
      toolkit,
      limit: 50
    });
    const items = Array.isArray(existing?.items) ? existing.items : [];

    const customAuth = this.customAuthConfigs.get(toolkit);
    if (customAuth) {
      const activeCustom = items.find(
        (item) => normalizeStatus(item.status) === "ENABLED" && item.isComposioManaged === false
      );
      const anyCustom = activeCustom ?? items.find((item) => item.isComposioManaged === false);
      const existingCustomId = asString(anyCustom?.id);
      if (existingCustomId) {
        return existingCustomId;
      }

      const createdCustom = await client.authConfigs.create(toolkit, {
        type: "use_custom_auth",
        name: customAuth.name || `${humanizeToolkit(toolkit)} Custom Auth`,
        authScheme: customAuth.authScheme,
        credentials: customAuth.credentials
      });
      const createdCustomId = asString(createdCustom?.id);
      if (!createdCustomId) {
        throw new ComposioServiceError("Unable to create custom Composio auth config.", {
          code: "COMPOSIO_CUSTOM_AUTH_CONFIG_CREATE_FAILED",
          status: 502
        });
      }
      return createdCustomId;
    }

    const active = items.find((item) => normalizeStatus(item.status) === "ENABLED");
    const chosen = active ?? items[0];
    const chosenId = asString(chosen?.id);
    if (chosenId) {
      return chosenId;
    }

    const created = await client.authConfigs.create(toolkit, {
      type: "use_composio_managed_auth",
      name: `${humanizeToolkit(toolkit)} Managed Auth`
    });
    const createdId = asString(created?.id);
    if (!createdId) {
      throw new ComposioServiceError("Unable to create Composio auth config.", {
        code: "COMPOSIO_AUTH_CONFIG_CREATE_FAILED",
        status: 502
      });
    }
    return createdId;
  }

  private toolkitFromAccount(item: Record<string, unknown>) {
    const toolkit = asRecord(item.toolkit);
    return normalizeToolkit(asString(toolkit.slug));
  }

  private connectionCacheKey(input: { userId: string; orgId: string }) {
    return `${input.userId}::${input.orgId}`;
  }

  private toolCatalogCacheKey(input: {
    userId: string;
    orgId: string;
    requestedToolkits: string[];
  }) {
    const requested = [...new Set(input.requestedToolkits.map(canonicalToolkitForCompare))].sort();
    return `${input.userId}::${input.orgId}::${requested.join(",")}`;
  }

  private cloneConnections(connections: ConnectionSummary[]) {
    return connections.map((item) => ({
      ...item,
      metadata: { ...item.metadata }
    }));
  }

  private cloneBindings(bindings: ToolBinding[]) {
    return bindings.map((binding) => ({ ...binding }));
  }

  private getCachedConnections(cacheKey: string) {
    const cached = this.connectionCache.get(cacheKey);
    if (!cached) {
      return null;
    }
    if (cached.expiresAt <= this.now()) {
      this.connectionCache.delete(cacheKey);
      return null;
    }
    return this.cloneConnections(cached.connections);
  }

  private setCachedConnections(cacheKey: string, connections: ConnectionSummary[]) {
    this.connectionCache.set(cacheKey, {
      expiresAt: this.now() + this.connectionCacheTtlMs,
      connections: this.cloneConnections(connections)
    });
  }

  private getCachedToolBindings(cacheKey: string, allowStale = false) {
    const cached = this.toolCatalogCache.get(cacheKey);
    if (!cached) {
      return null;
    }
    if (!allowStale && cached.expiresAt <= this.now()) {
      return null;
    }
    return this.cloneBindings(cached.bindings);
  }

  private setCachedToolBindings(cacheKey: string, bindings: ToolBinding[]) {
    this.toolCatalogCache.set(cacheKey, {
      expiresAt: this.now() + this.toolCatalogCacheTtlMs,
      bindings: this.cloneBindings(bindings)
    });
  }

  private invalidateCachesForActor(input: { userId: string; orgId: string }) {
    this.connectionCache.delete(this.connectionCacheKey(input));
    const prefix = `${input.userId}::${input.orgId}::`;
    for (const key of this.toolCatalogCache.keys()) {
      if (key.startsWith(prefix)) {
        this.toolCatalogCache.delete(key);
      }
    }
  }

  private async listOrgConnections(input: {
    orgId: string;
    toolkits?: string[];
  }): Promise<ConnectionSummary[]> {
    if (!this.store.listByOrg) {
      return [];
    }

    const rows = await this.store.listByOrg({
      orgId: input.orgId,
      provider: this.provider,
      ...(input.toolkits && input.toolkits.length > 0
        ? { toolkits: [...new Set(input.toolkits.map(normalizeToolkit))] }
        : {})
    });

    if (!input.toolkits || input.toolkits.length === 0) {
      return rows;
    }

    const requestedCanonical = new Set(input.toolkits.map(canonicalToolkitForCompare));
    return rows.filter((row) =>
      requestedCanonical.has(canonicalToolkitForCompare(row.toolkit))
    );
  }

  private async listActiveOrgConnections(input: {
    orgId: string;
    toolkits: string[];
    excludeUserId?: string;
  }) {
    if (!this.allowOrgToolkitFallback) {
      return [] as ConnectionSummary[];
    }

    const rows = await this.listOrgConnections({
      orgId: input.orgId,
      toolkits: input.toolkits
    });

    return rows
      .filter((row) => isConnectedIntegrationStatus(row.status))
      .filter((row) => !input.excludeUserId || row.userId !== input.excludeUserId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  private async resolveExecutionConnections(input: {
    userId: string;
    orgId: string;
    toolkit: string;
  }) {
    const canonicalToolkit = canonicalToolkitForCompare(input.toolkit);
    const userConnections = await this.getConnections({
      userId: input.userId,
      orgId: input.orgId
    });
    const direct = userConnections.find(
      (item) =>
        canonicalToolkitForCompare(item.toolkit) === canonicalToolkit &&
        isConnectedIntegrationStatus(item.status)
    );

    if (direct) {
      return [direct] as ConnectionSummary[];
    }

    const orgFallback = await this.listActiveOrgConnections({
      orgId: input.orgId,
      toolkits: [input.toolkit],
      excludeUserId: input.userId
    });

    return orgFallback.filter(
      (item) => canonicalToolkitForCompare(item.toolkit) === canonicalToolkit
    );
  }

  async listAvailableToolkits(userId: string): Promise<ToolkitSummary[]> {
    const allowed = [...this.allowlistedToolkitList];
    if (!this.enabled) {
      return allowed.map((slug) => ({
        slug,
        name: humanizeToolkit(slug),
        description: "",
        logoUrl: null,
        appUrl: null,
        status: "DISABLED",
        connected: false,
        connectionId: null
      }));
    }

    const client = this.createClient() as ComposioClientLike;
    const [toolkitItems, accounts] = await Promise.all([
      client.toolkits.get({
        limit: 200
      }),
      client.connectedAccounts.list({
        userIds: [this.composioUserId(userId)],
        limit: 200
      })
    ]);

    const accountsByToolkit = new Map<
      string,
      {
        status: string;
        connectionId: string | null;
      }
    >();

    const accountItems = Array.isArray(accounts?.items) ? accounts.items : [];
    for (const account of accountItems) {
      const toolkit = this.resolveAllowlistedToolkit(this.toolkitFromAccount(account));
      if (!toolkit) continue;
      const connectionId = asString(account.id) || null;
      const status = normalizeConnectionStatus(account.status);
      const canonicalToolkit = canonicalToolkitForCompare(toolkit);
      const previous = accountsByToolkit.get(canonicalToolkit);
      if (!previous || !isConnectedIntegrationStatus(previous.status)) {
        accountsByToolkit.set(canonicalToolkit, { status, connectionId });
      }
    }

    const list = Array.isArray(toolkitItems) ? toolkitItems : [];
    const supportedBySlug = new Map<string, ToolkitSummary>();
    for (const item of list) {
      const rawSlug = normalizeToolkit(asString(item.slug));
      const slug = this.resolveAllowlistedToolkit(rawSlug);
      if (!slug) {
        continue;
      }

      const meta = asRecord(item.meta);
      const account = accountsByToolkit.get(canonicalToolkitForCompare(slug));
      const summary: ToolkitSummary = {
        slug,
        name: asString(item.name) || humanizeToolkit(slug),
        description: asString(meta.description),
        logoUrl: asString(meta.logo) || null,
        appUrl: asString(meta.appUrl) || null,
        status: account?.status ?? "NOT_CONNECTED",
        connected: isConnectedIntegrationStatus(account?.status),
        connectionId: account?.connectionId ?? null
      };

      const existing = supportedBySlug.get(slug);
      if (!existing || !isConnectedIntegrationStatus(existing.status)) {
        supportedBySlug.set(slug, summary);
      }
    }
    const supported = [...supportedBySlug.values()];

    if (supported.length > 0) {
      return supported.sort((a, b) => a.name.localeCompare(b.name));
    }

    return allowed.map((slug) => ({
      slug,
      name: humanizeToolkit(slug),
      description: "",
      logoUrl: null,
      appUrl: null,
      status: "UNKNOWN",
      connected: false,
      connectionId: null
    }));
  }

  async getConnections(input: { userId: string; orgId: string }): Promise<ConnectionSummary[]> {
    const cacheKey = this.connectionCacheKey(input);
    const cached = this.getCachedConnections(cacheKey);
    if (cached) {
      return cached;
    }

    const rows = await this.store.listByUser({
      userId: input.userId,
      provider: this.provider,
      orgId: input.orgId
    });

    if (!this.enabled) {
      this.setCachedConnections(cacheKey, rows);
      return rows;
    }

    try {
      const client = this.createClient() as ComposioClientLike;
      const remote = await client.connectedAccounts.list({
        userIds: [this.composioUserId(input.userId)],
        limit: 200
      });

      const items = Array.isArray(remote?.items) ? remote.items : [];
      const remoteConnectionIds = new Set<string>();
      for (const item of items) {
        const connectionId = asString(item.id);
        const toolkit = this.resolveAllowlistedToolkit(this.toolkitFromAccount(item));
        if (!connectionId || !toolkit) {
          continue;
        }
        remoteConnectionIds.add(connectionId);
        const status = normalizeConnectionStatus(item.status);
        await this.store.upsertByConnection({
          userId: input.userId,
          orgId: input.orgId,
          provider: this.provider,
          toolkit,
          connectionId,
          status,
          metadata: {
            remote: safeMetadata(item)
          }
        });
      }

      // Reconcile stale local ACTIVE rows that no longer exist remotely.
      for (const row of rows) {
        if (
          isConnectedIntegrationStatus(row.status) &&
          row.connectionId &&
          !remoteConnectionIds.has(row.connectionId)
        ) {
          await this.store.upsertByConnection({
            userId: row.userId,
            orgId: row.orgId ?? input.orgId,
            provider: row.provider,
            toolkit: row.toolkit,
            connectionId: row.connectionId,
            status: "DISCONNECTED",
            metadata: mergeMetadata(row.metadata, {
              remoteMissingAt: new Date(this.now()).toISOString()
            })
          });
        }
      }

      const refreshed = await this.store.listByUser({
        userId: input.userId,
        provider: this.provider,
        orgId: input.orgId
      });
      this.setCachedConnections(cacheKey, refreshed);
      return refreshed;
    } catch {
      // Fall back to persisted state when Composio remote listing is unavailable.
      this.setCachedConnections(cacheKey, rows);
      return rows;
    }
  }

  async createConnection(input: CreateConnectionInput) {
    const toolkit = this.assertToolkitAllowed(input.toolkit);
    if (!this.enabled) {
      throw new ComposioServiceError(
        "App integrations are disabled. Enable FEATURE_COMPOSIO_INTEGRATIONS and set COMPOSIO_API_KEY.",
        { code: "COMPOSIO_DISABLED", status: 503 }
      );
    }

    const client = this.createClient() as ComposioClientLike;
    const authConfigId = await this.ensureAuthConfigId(client, toolkit);

    const now = this.now();
    const nonce = randomUUID();
    const state = this.createStateToken({
      nonce,
      userId: input.userId,
      orgId: input.orgId,
      toolkit,
      returnTo: input.returnTo,
      issuedAt: now,
      expiresAt: now + 15 * 60_000
    });

    const callback = new URL(this.callbackUrl);
    callback.searchParams.set("state", state);

    const linked = await client.connectedAccounts.link(
      this.composioUserId(input.userId),
      authConfigId,
      {
        callbackUrl: callback.toString()
      }
    );

    const connectionId = asString(linked.id);
    const redirectUrl = asString(linked.redirectUrl ?? "");
    if (!connectionId || !redirectUrl) {
      throw new ComposioServiceError("Unable to create Composio connection link.", {
        code: "COMPOSIO_LINK_CREATE_FAILED",
        status: 502
      });
    }

    const linkedStatus = normalizeConnectionStatus(linked.status);
    const status = linkedStatus === "UNKNOWN" ? "INITIATED" : linkedStatus;
    const stored = await this.store.upsertByConnection({
      userId: input.userId,
      orgId: input.orgId,
      provider: this.provider,
      toolkit,
      connectionId,
      status,
      metadata: {
        oauthStateNonce: nonce,
        callbackUrl: callback.toString(),
        returnTo: input.returnTo
      }
    });
    this.invalidateCachesForActor({ userId: input.userId, orgId: input.orgId });

    return {
      connectUrl: redirectUrl,
      connection: stored
    };
  }

  async disconnectConnection(input: { userId: string; orgId: string; connectionId: string }) {
    const current = await this.store.findByConnection({
      userId: input.userId,
      provider: this.provider,
      connectionId: input.connectionId,
      orgId: input.orgId
    });
    if (!current) {
      return null;
    }

    if (this.enabled) {
      const client = this.createClient() as ComposioClientLike;
      try {
        await client.connectedAccounts.delete(input.connectionId);
      } catch (error) {
        if (!disconnectNotFoundError(error)) {
          throw new ComposioServiceError("Unable to disconnect app integration.", {
            code: "COMPOSIO_DISCONNECT_FAILED",
            status: 502
          });
        }
      }
    }

    const result = await this.store.upsertByConnection({
      userId: current.userId,
      orgId: current.orgId ?? undefined,
      provider: current.provider,
      toolkit: current.toolkit,
      connectionId: current.connectionId,
      status: "DISCONNECTED",
      metadata: mergeMetadata(current.metadata, {
        disconnectedAt: new Date(this.now()).toISOString()
      })
    });
    this.invalidateCachesForActor({ userId: input.userId, orgId: input.orgId });
    return result;
  }

  async handleOAuthCallback(input: {
    params: URLSearchParams;
  }): Promise<
    | {
        ok: true;
        userId: string;
        orgId: string;
        toolkit: string;
        connectionId: string;
        returnTo: string;
      }
    | {
        ok: false;
        reason: "missing_state" | "invalid_state";
        returnTo: string;
      }
  > {
    const rawState = asString(input.params.get("state"));
    if (!rawState) {
      return { ok: false, reason: "missing_state", returnTo: "/app?tab=hub&hubScope=TOOLS" };
    }

    const state = this.verifyStateToken(rawState);
    if (!state) {
      return { ok: false, reason: "invalid_state", returnTo: "/app?tab=hub&hubScope=TOOLS" };
    }

    const toolkit = normalizeToolkit(state.toolkit);
    const pending = await this.store.findByNonce({
      userId: state.userId,
      provider: this.provider,
      toolkit,
      nonce: state.nonce,
      orgId: state.orgId
    });

    const parsedConnectionId = candidateConnectionId(input.params);
    const connectionId = parsedConnectionId || pending?.connectionId || `pending-${state.nonce}`;
    const callbackStatus = normalizeConnectionStatus(input.params.get("status"));
    const status = callbackStatus === "UNKNOWN" ? "ACTIVE" : callbackStatus;

    await this.store.upsertByConnection({
      userId: state.userId,
      orgId: state.orgId,
      provider: this.provider,
      toolkit,
      connectionId,
      status,
      metadata: mergeMetadata(pending?.metadata, {
        oauthStateNonce: state.nonce,
        callback: callbackMetadata(input.params),
        completedAt: new Date(this.now()).toISOString()
      })
    });
    this.invalidateCachesForActor({ userId: state.userId, orgId: state.orgId });

    return {
      ok: true,
      userId: state.userId,
      orgId: state.orgId,
      toolkit,
      connectionId,
      returnTo: state.returnTo
    };
  }

  async getToolsForAgent(input: GetToolsForAgentInput): Promise<{
    ok: boolean;
    requestedToolkits: string[];
    bindings: ToolBinding[];
    error?: IntegrationNotConnectedErrorShape;
  }> {
    const requested = [
      ...new Set(
        input.requestedToolkits
          .map((item) => this.resolveAllowlistedToolkit(item))
          .filter(Boolean)
      )
    ];

    if (requested.length === 0) {
      return { ok: true, requestedToolkits: [], bindings: [] };
    }

    const connections = await this.getConnections({
      userId: input.userId,
      orgId: input.orgId
    });
    const activeToolkits = new Set(
      connections
        .filter((item) => isConnectedIntegrationStatus(item.status))
        .map((item) => canonicalToolkitForCompare(item.toolkit))
    );
    let missing = requested.filter((toolkit) => !activeToolkits.has(canonicalToolkitForCompare(toolkit)));

    if (missing.length > 0 && this.allowOrgToolkitFallback) {
      const fallbackConnections = await this.listActiveOrgConnections({
        orgId: input.orgId,
        toolkits: missing,
        excludeUserId: input.userId
      });
      for (const connection of fallbackConnections) {
        activeToolkits.add(canonicalToolkitForCompare(connection.toolkit));
      }
      missing = requested.filter((toolkit) => !activeToolkits.has(canonicalToolkitForCompare(toolkit)));
    }

    if (missing.length > 0) {
      return {
        ok: false,
        requestedToolkits: requested,
        bindings: [],
        error: {
          code: "INTEGRATION_NOT_CONNECTED",
          toolkit: missing[0],
          action: input.action,
          connectUrl: this.connectUrlForToolkit(missing[0])
        }
      };
    }

    if (!this.enabled) {
      return {
        ok: true,
        requestedToolkits: requested,
        bindings: []
      };
    }

    const toolCacheKey = this.toolCatalogCacheKey({
      userId: input.userId,
      orgId: input.orgId,
      requestedToolkits: requested
    });
    const cachedBindings = this.getCachedToolBindings(toolCacheKey);
    if (cachedBindings) {
      return {
        ok: true,
        requestedToolkits: requested,
        bindings: cachedBindings
      };
    }

    try {
      const client = this.createClient() as ComposioClientLike;
      const rawTools = await client.tools.getRawComposioTools({
        toolkits: requested,
        limit: 100
      });

      const bindings = (Array.isArray(rawTools) ? rawTools : [])
        .map((tool) => {
          const toolkitRecord = asRecord(tool.toolkit);
          const toolkit = normalizeToolkit(asString(toolkitRecord.slug));
          const slug = asString(tool.slug);
          if (!toolkit || !slug) {
            return null;
          }
          return {
            toolkit,
            slug,
            name: asString(tool.name) || slug,
            description: asString(tool.description)
          };
        })
        .filter((value): value is ToolBinding => Boolean(value));

      this.setCachedToolBindings(toolCacheKey, bindings);
      return {
        ok: true,
        requestedToolkits: requested,
        bindings
      };
    } catch (error) {
      const staleBindings = this.getCachedToolBindings(toolCacheKey, true);
      if (staleBindings) {
        return {
          ok: true,
          requestedToolkits: requested,
          bindings: staleBindings
        };
      }
      throw error;
    }
  }

  async executeToolAction(input: {
    userId: string;
    orgId: string;
    toolkit: string;
    toolSlug: string;
    action: string;
    arguments?: Record<string, unknown>;
  }): Promise<ToolExecutionResponse> {
    const toolkit = this.assertToolkitAllowed(input.toolkit);
    const normalizedSlug = asString(input.toolSlug).toUpperCase();
    const allowedPrefixes = new Set([toolkit.toUpperCase()]);
    if (canonicalToolkitForCompare(toolkit) === "gmeet") {
      allowedPrefixes.add("GMEET");
      allowedPrefixes.add("GOOGLEMEET");
    }
    if (canonicalToolkitForCompare(toolkit) === "googleslides") {
      allowedPrefixes.add("GOOGLESLIDES");
      allowedPrefixes.add("GSLIDES");
    }
    const hasValidPrefix = [...allowedPrefixes].some((prefix) =>
      normalizedSlug.startsWith(`${prefix}_`)
    );
    if (!normalizedSlug || !hasValidPrefix) {
      throw new ComposioServiceError(
        `Tool "${input.toolSlug}" is not valid for toolkit "${toolkit}".`,
        { code: "INVALID_TOOL_ACTION", status: 400 }
      );
    }

    const executionConnections = await this.resolveExecutionConnections({
      userId: input.userId,
      orgId: input.orgId,
      toolkit
    });

    if (executionConnections.length === 0) {
      throw new ComposioServiceError(
        `Toolkit "${toolkit}" is not connected for this user.`,
        { code: "INTEGRATION_NOT_CONNECTED", status: 409 }
      );
    }

    if (!this.enabled) {
      throw new ComposioServiceError("Composio integrations are disabled.", {
        code: "COMPOSIO_DISABLED",
        status: 503
      });
    }

    const client = this.createClient() as ComposioClientLike;
    let accountMissing = false;

    for (const connection of executionConnections) {
      try {
        const response = await client.tools.execute(normalizedSlug, {
          userId: this.composioUserId(connection.userId),
          connectedAccountId: connection.connectionId,
          arguments: input.arguments ?? {},
          dangerouslySkipVersionCheck: true
        });

        return {
          successful: Boolean(response?.successful),
          error: asString(response?.error) || null,
          data:
            response?.data && typeof response.data === "object" && !Array.isArray(response.data)
              ? (response.data as Record<string, unknown>)
              : {},
          logId: asString(response?.logId) || asString(response?.log_id) || null
        };
      } catch (error) {
        if (!executeConnectionMissingError(error)) {
          throw error;
        }

        accountMissing = true;
        await this.store.upsertByConnection({
          userId: connection.userId,
          orgId: connection.orgId ?? input.orgId,
          provider: connection.provider,
          toolkit: connection.toolkit,
          connectionId: connection.connectionId,
          status: "DISCONNECTED",
          metadata: mergeMetadata(connection.metadata, {
            remoteMissingAt: new Date(this.now()).toISOString()
          })
        });
        this.invalidateCachesForActor({
          userId: connection.userId,
          orgId: input.orgId
        });
      }
    }

    if (accountMissing) {
      throw new ComposioServiceError(
        `Toolkit "${toolkit}" requires reconnection.`,
        { code: "INTEGRATION_NOT_CONNECTED", status: 409 }
      );
    }

    throw new ComposioServiceError(
      `Toolkit "${toolkit}" execution failed.`,
      { code: "TOOL_EXECUTION_FAILED", status: 502 }
    );
  }
}

export function inferRequestedToolkits(prompt: string, allowlistedToolkits: string[]) {
  const normalizedPrompt = prompt.toLowerCase();
  const compactPrompt = normalizedPrompt.replace(/[^a-z0-9]/g, "");
  const allowlist = allowlistedToolkits.map(normalizeToolkit);
  const requested = new Set<string>();
  const preferredGoogleMeetToolkit = allowlist.includes("googlemeet")
    ? "googlemeet"
    : allowlist.includes("gmeet")
      ? "gmeet"
      : null;

  for (const toolkit of allowlist) {
    const compactToolkit = toolkit.replace(/[^a-z0-9]/g, "");
    if (normalizedPrompt.includes(toolkit) || (compactToolkit && compactPrompt.includes(compactToolkit))) {
      requested.add(toolkit);
    }
  }

  // High-signal intent mapping so natural language ("send email") can still trigger toolkit routing.
  const hasMeetingCreateIntent =
    /\b(set up|setup|schedule|book|arrange|create|plan)\b[\s\S]{0,80}\b(meeting|call|invite|invitation|session)\b/i.test(
      normalizedPrompt
    ) ||
    /\b(meeting|call|invite|invitation|session)\b[\s\S]{0,80}\b(set up|setup|schedule|book|arrange|create|plan)\b/i.test(
      normalizedPrompt
    );
  const hasMeetingShareIntent =
    /\b(send|share|mail|email)\b/i.test(normalizedPrompt) &&
    /\b(details?|invite|invitation|link|meeting)\b/i.test(normalizedPrompt);
  const hasRecipientEmail = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(normalizedPrompt);

  if (
    allowlist.includes("gmail") &&
    (
      /\b(gmail|email|inbox|recipient|subject|send mail|compose mail)\b/i.test(
        normalizedPrompt
      ) ||
      (hasMeetingShareIntent && hasRecipientEmail)
    )
  ) {
    requested.add("gmail");
  }

  if (
    allowlist.includes("whatsapp") &&
    (() => {
      const explicitWhatsappChannel =
        /\bwhatsapp\b/i.test(normalizedPrompt) ||
        /\btext message\b/i.test(normalizedPrompt) ||
        /\bchat message\b/i.test(normalizedPrompt) ||
        /\bsms\b/i.test(normalizedPrompt);
      const hasPhoneTarget =
        /(?:\+?\d[\d\s().-]{7,}\d)/.test(normalizedPrompt) ||
        /\b(phone|mobile|number|recipient_phone|phone_number)\b/i.test(normalizedPrompt);
      const notificationIntent = /\b(send|share|notify|message|text|ping|alert)\b/i.test(
        normalizedPrompt
      );
      const notificationLanguage = /\b(notification|update|status|reminder|follow[-\s]?up|text|message)\b/i.test(
        normalizedPrompt
      );

      return explicitWhatsappChannel || (hasPhoneTarget && notificationIntent && notificationLanguage);
    })()
  ) {
    requested.add("whatsapp");
  }

  if (
    allowlist.includes("zoom") &&
    /\b(zoom|video call|video meeting|webinar|meeting link)\b/i.test(normalizedPrompt)
  ) {
    requested.add("zoom");
  }

  if (
    allowlist.includes("googleslides") &&
    /\b(google slides|googleslides|slides|presentation|ppt|powerpoint|pitch deck|investor deck)\b/i.test(
      normalizedPrompt
    )
  ) {
    requested.add("googleslides");
  }

  if (
    preferredGoogleMeetToolkit &&
    (
      /\b(gmeet|google meet|googlemeet|meet\.google\.com)\b/i.test(normalizedPrompt) ||
      hasMeetingCreateIntent
    )
  ) {
    requested.add(preferredGoogleMeetToolkit);
  }

  if (
    allowlist.includes("googlecalendar") &&
    (
      /\b(calendar|schedule|availability|meeting invite)\b/i.test(normalizedPrompt) ||
      hasMeetingCreateIntent
    )
  ) {
    requested.add("googlecalendar");
  }

  if (
    allowlist.includes("hubspot") &&
    /\b(crm|hubspot|lead|pipeline)\b/i.test(normalizedPrompt)
  ) {
    requested.add("hubspot");
  }

  if (
    allowlist.includes("salesforce") &&
    /\b(crm|salesforce|lead|opportunity)\b/i.test(normalizedPrompt)
  ) {
    requested.add("salesforce");
  }

  const markerMatch = normalizedPrompt.match(/\btoolkits?\s*[:=]\s*([a-z0-9,_\-\s]+)/i);
  if (markerMatch?.[1]) {
    const parsed = markerMatch[1]
      .split(/[,\s]+/g)
      .map((item) => normalizeToolkit(item))
      .filter((item) => allowlist.includes(item));
    for (const item of parsed) {
      requested.add(item);
    }
  }

  if (requested.has("googlemeet") && requested.has("gmeet")) {
    if (preferredGoogleMeetToolkit === "googlemeet") {
      requested.delete("gmeet");
    } else {
      requested.delete("googlemeet");
    }
  }

  return [...requested];
}
