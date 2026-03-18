import assert from "node:assert/strict";
import test from "node:test";

import { ComposioServiceCore, inferRequestedToolkits } from "../lib/integrations/composio/service-core.ts";

interface InMemoryConnection {
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

function nowIso() {
  return new Date().toISOString();
}

function createStore() {
  const records = new Map<string, InMemoryConnection>();

  const key = (provider: string, connectionId: string) => `${provider}:${connectionId}`;

  return {
    records,
    adapter: {
      async listByUser(input: { userId: string; provider: string; orgId?: string }) {
        return [...records.values()]
          .filter(
            (record) =>
              record.userId === input.userId &&
              record.provider === input.provider &&
              (!input.orgId || record.orgId === input.orgId)
          )
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      },
      async listByOrg(input: { orgId: string; provider: string; toolkits?: string[] }) {
        const requestedToolkits = (input.toolkits ?? []).map((toolkit) => toolkit.toLowerCase());
        return [...records.values()]
          .filter((record) => {
            if (record.provider !== input.provider) return false;
            if (record.orgId !== input.orgId) return false;
            if (requestedToolkits.length === 0) return true;
            return requestedToolkits.includes(record.toolkit.toLowerCase());
          })
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      },
      async findByConnection(input: {
        userId: string;
        provider: string;
        connectionId: string;
        orgId?: string;
      }) {
        const record = records.get(key(input.provider, input.connectionId));
        if (!record) return null;
        if (record.userId !== input.userId) return null;
        if (input.orgId && record.orgId !== input.orgId) return null;
        return record;
      },
      async findByNonce(input: {
        userId: string;
        provider: string;
        toolkit: string;
        nonce: string;
        orgId?: string;
      }) {
        const match = [...records.values()].find((record) => {
          if (record.userId !== input.userId) return false;
          if (record.provider !== input.provider) return false;
          if (record.toolkit !== input.toolkit) return false;
          if (input.orgId && record.orgId !== input.orgId) return false;
          return record.metadata.oauthStateNonce === input.nonce;
        });
        return match ?? null;
      },
      async upsertByConnection(input: {
        userId: string;
        orgId?: string;
        provider: string;
        toolkit: string;
        connectionId: string;
        status: string;
        metadata?: Record<string, unknown>;
      }) {
        const existing = records.get(key(input.provider, input.connectionId));
        const next: InMemoryConnection = {
          id: existing?.id ?? `ui_${Math.random().toString(36).slice(2, 9)}`,
          userId: input.userId,
          orgId: input.orgId ?? null,
          provider: input.provider,
          toolkit: input.toolkit,
          connectionId: input.connectionId,
          status: input.status,
          metadata: input.metadata ?? existing?.metadata ?? {},
          createdAt: existing?.createdAt ?? nowIso(),
          updatedAt: nowIso()
        };
        records.set(key(input.provider, input.connectionId), next);
        return next;
      }
    }
  };
}

function createMockClient() {
  const client: any = {
    toolkits: {
      get: async () => [
        {
          slug: "gmail",
          name: "Gmail",
          meta: {
            description: "Gmail toolkit",
            logo: "https://example.com/gmail.png",
            appUrl: "https://mail.google.com"
          }
        },
        {
          slug: "slack",
          name: "Slack",
          meta: { description: "Slack toolkit", logo: "https://example.com/slack.png" }
        }
      ]
    },
    authConfigs: {
      list: async () => ({
        items: [{ id: "ac_123", status: "ENABLED", isComposioManaged: true }]
      }),
      create: async () => ({ id: "ac_created" })
    },
    connectedAccounts: {
      list: async () => ({
        items: []
      }),
      link: async () => ({
        id: "conn_123",
        status: "INITIATED",
        redirectUrl: "https://connect.example.com/authorize"
      }),
      delete: async () => ({ ok: true })
    },
    tools: {
      getRawComposioTools: async () => [
        {
          slug: "GMAIL_SEND_EMAIL",
          name: "Send Gmail",
          description: "Send an email",
          toolkit: { slug: "gmail" }
        }
      ],
      execute: async () => ({
        successful: true,
        data: { ok: true },
        logId: "log_mock_1"
      })
    }
  };
  return client;
}

test("createConnection stores pending connection and returns connect URL", async () => {
  const store = createStore();
  const core = new ComposioServiceCore({
    enabled: true,
    provider: "composio",
    allowlistedToolkits: ["gmail", "slack"],
    callbackUrl: "http://localhost:3001/api/integrations/composio/oauth/callback",
    createClient: () => createMockClient(),
    store: store.adapter,
    createStateToken: () => "signed-state",
    verifyStateToken: () => null,
    connectUrlForToolkit: (toolkit: string) => `/app?toolkit=${toolkit}`,
    now: () => 1700000000000
  });

  const result = await core.createConnection({
    userId: "user-1",
    orgId: "org-1",
    toolkit: "gmail",
    returnTo: "/app?tab=hub&hubScope=TOOLS"
  });

  assert.equal(result.connectUrl, "https://connect.example.com/authorize");
  assert.equal(result.connection.connectionId, "conn_123");
  assert.equal(result.connection.toolkit, "gmail");
  assert.equal(result.connection.status, "INITIATED");
});

test("getToolsForAgent returns INTEGRATION_NOT_CONNECTED when toolkit missing", async () => {
  const store = createStore();
  const core = new ComposioServiceCore({
    enabled: true,
    provider: "composio",
    allowlistedToolkits: ["gmail", "slack"],
    callbackUrl: "http://localhost:3001/api/integrations/composio/oauth/callback",
    createClient: () => createMockClient(),
    store: store.adapter,
    createStateToken: () => "signed-state",
    verifyStateToken: () => null,
    connectUrlForToolkit: (toolkit: string) => `/app?toolkit=${toolkit}`
  });

  const result = await core.getToolsForAgent({
    userId: "user-1",
    orgId: "org-1",
    requestedToolkits: ["gmail"],
    action: "TASK_EXECUTION"
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "INTEGRATION_NOT_CONNECTED");
  assert.equal(result.error?.toolkit, "gmail");
});

test("getToolsForAgent uses org fallback connection when actor user has no direct integration", async () => {
  const store = createStore();
  await store.adapter.upsertByConnection({
    userId: "user-2",
    orgId: "org-1",
    provider: "composio",
    toolkit: "gmail",
    connectionId: "conn_shared_gmail",
    status: "ACTIVE",
    metadata: {}
  });

  const core = new ComposioServiceCore({
    enabled: false,
    provider: "composio",
    allowlistedToolkits: ["gmail", "slack"],
    callbackUrl: "http://localhost:3001/api/integrations/composio/oauth/callback",
    createClient: () => createMockClient(),
    store: store.adapter,
    createStateToken: () => "signed-state",
    verifyStateToken: () => null,
    connectUrlForToolkit: (toolkit: string) => `/app?toolkit=${toolkit}`,
    allowOrgToolkitFallback: true
  });

  const result = await core.getToolsForAgent({
    userId: "user-1",
    orgId: "org-1",
    requestedToolkits: ["gmail"],
    action: "TASK_EXECUTION"
  });

  assert.equal(result.ok, true);
});

test("getToolsForAgent returns tool bindings when connection is active", async () => {
  const store = createStore();
  await store.adapter.upsertByConnection({
    userId: "user-1",
    orgId: "org-1",
    provider: "composio",
    toolkit: "gmail",
    connectionId: "conn_123",
    status: "ACTIVE",
    metadata: {}
  });

  const mockClient = createMockClient();
  mockClient.connectedAccounts.list = async () => ({
    items: [
      {
        id: "conn_123",
        status: "ACTIVE",
        toolkit: { slug: "gmail" }
      }
    ]
  });

  const core = new ComposioServiceCore({
    enabled: true,
    provider: "composio",
    allowlistedToolkits: ["gmail", "slack"],
    callbackUrl: "http://localhost:3001/api/integrations/composio/oauth/callback",
    createClient: () => mockClient,
    store: store.adapter,
    createStateToken: () => "signed-state",
    verifyStateToken: () => null,
    connectUrlForToolkit: (toolkit: string) => `/app?toolkit=${toolkit}`
  });

  const result = await core.getToolsForAgent({
    userId: "user-1",
    orgId: "org-1",
    requestedToolkits: ["gmail"],
    action: "TASK_EXECUTION"
  });

  assert.equal(result.ok, true);
  assert.equal(result.bindings.length, 1);
  assert.equal(result.bindings[0]?.slug, "GMAIL_SEND_EMAIL");
});

test("getToolsForAgent treats SUCCESS status as connected", async () => {
  const store = createStore();
  await store.adapter.upsertByConnection({
    userId: "user-1",
    orgId: "org-1",
    provider: "composio",
    toolkit: "gmail",
    connectionId: "conn_success",
    status: "SUCCESS",
    metadata: {}
  });

  const core = new ComposioServiceCore({
    enabled: false,
    provider: "composio",
    allowlistedToolkits: ["gmail", "slack"],
    callbackUrl: "http://localhost:3001/api/integrations/composio/oauth/callback",
    createClient: () => createMockClient(),
    store: store.adapter,
    createStateToken: () => "signed-state",
    verifyStateToken: () => null,
    connectUrlForToolkit: (toolkit: string) => `/app?toolkit=${toolkit}`
  });

  const result = await core.getToolsForAgent({
    userId: "user-1",
    orgId: "org-1",
    requestedToolkits: ["gmail"],
    action: "TASK_EXECUTION"
  });

  assert.equal(result.ok, true);
});

test("getToolsForAgent resolves gmeet/googlemeet aliases", async () => {
  const store = createStore();
  await store.adapter.upsertByConnection({
    userId: "user-1",
    orgId: "org-1",
    provider: "composio",
    toolkit: "gmeet",
    connectionId: "conn_gmeet",
    status: "ACTIVE",
    metadata: {}
  });

  const core = new ComposioServiceCore({
    enabled: false,
    provider: "composio",
    allowlistedToolkits: ["gmeet", "gmail"],
    callbackUrl: "http://localhost:3001/api/integrations/composio/oauth/callback",
    createClient: () => createMockClient(),
    store: store.adapter,
    createStateToken: () => "signed-state",
    verifyStateToken: () => null,
    connectUrlForToolkit: (toolkit: string) => `/app?toolkit=${toolkit}`
  });

  const result = await core.getToolsForAgent({
    userId: "user-1",
    orgId: "org-1",
    requestedToolkits: ["googlemeet"],
    action: "TASK_EXECUTION"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.requestedToolkits, ["gmeet"]);
});

test("getConnections falls back to stored records when remote listing is unavailable", async () => {
  const store = createStore();
  await store.adapter.upsertByConnection({
    userId: "user-1",
    orgId: "org-1",
    provider: "composio",
    toolkit: "gmail",
    connectionId: "conn_123",
    status: "ACTIVE",
    metadata: {}
  });

  let remoteListCalls = 0;
  const mockClient = createMockClient();
  mockClient.connectedAccounts.list = async () => {
    remoteListCalls += 1;
    throw new Error("remote unavailable");
  };

  const core = new ComposioServiceCore({
    enabled: true,
    provider: "composio",
    allowlistedToolkits: ["gmail", "slack"],
    callbackUrl: "http://localhost:3001/api/integrations/composio/oauth/callback",
    createClient: () => mockClient,
    store: store.adapter,
    createStateToken: () => "signed-state",
    verifyStateToken: () => null,
    connectUrlForToolkit: (toolkit: string) => `/app?toolkit=${toolkit}`,
    connectionCacheTtlMs: 60_000
  });

  const first = await core.getConnections({
    userId: "user-1",
    orgId: "org-1"
  });
  const second = await core.getConnections({
    userId: "user-1",
    orgId: "org-1"
  });

  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(first[0]?.connectionId, "conn_123");
  assert.equal(remoteListCalls, 1);
});

test("getConnections reconciles stale local ACTIVE rows when remote account is missing", async () => {
  const store = createStore();
  await store.adapter.upsertByConnection({
    userId: "user-1",
    orgId: "org-1",
    provider: "composio",
    toolkit: "gmail",
    connectionId: "conn_stale",
    status: "ACTIVE",
    metadata: {}
  });

  const mockClient = createMockClient();
  mockClient.connectedAccounts.list = async () => ({
    items: []
  });

  const core = new ComposioServiceCore({
    enabled: true,
    provider: "composio",
    allowlistedToolkits: ["gmail", "slack"],
    callbackUrl: "http://localhost:3001/api/integrations/composio/oauth/callback",
    createClient: () => mockClient,
    store: store.adapter,
    createStateToken: () => "signed-state",
    verifyStateToken: () => null,
    connectUrlForToolkit: (toolkit: string) => `/app?toolkit=${toolkit}`
  });

  const reconciled = await core.getConnections({
    userId: "user-1",
    orgId: "org-1"
  });

  assert.equal(reconciled.length, 1);
  assert.equal(reconciled[0]?.connectionId, "conn_stale");
  assert.equal(reconciled[0]?.status, "DISCONNECTED");
});

test("getToolsForAgent reuses cached catalog within ttl", async () => {
  const store = createStore();
  await store.adapter.upsertByConnection({
    userId: "user-1",
    orgId: "org-1",
    provider: "composio",
    toolkit: "gmail",
    connectionId: "conn_123",
    status: "ACTIVE",
    metadata: {}
  });

  let toolCatalogCalls = 0;
  const mockClient = createMockClient();
  mockClient.connectedAccounts.list = async () => ({
    items: [{ id: "conn_123", status: "ACTIVE", toolkit: { slug: "gmail" } }]
  });
  mockClient.tools.getRawComposioTools = async () => {
    toolCatalogCalls += 1;
    return [
      {
        slug: "GMAIL_SEND_EMAIL",
        name: "Send Gmail",
        description: "Send an email",
        toolkit: { slug: "gmail" }
      }
    ];
  };

  const core = new ComposioServiceCore({
    enabled: true,
    provider: "composio",
    allowlistedToolkits: ["gmail", "slack"],
    callbackUrl: "http://localhost:3001/api/integrations/composio/oauth/callback",
    createClient: () => mockClient,
    store: store.adapter,
    createStateToken: () => "signed-state",
    verifyStateToken: () => null,
    connectUrlForToolkit: (toolkit: string) => `/app?toolkit=${toolkit}`,
    toolCatalogCacheTtlMs: 60_000
  });

  const first = await core.getToolsForAgent({
    userId: "user-1",
    orgId: "org-1",
    requestedToolkits: ["gmail"],
    action: "TASK_EXECUTION"
  });
  const second = await core.getToolsForAgent({
    userId: "user-1",
    orgId: "org-1",
    requestedToolkits: ["gmail"],
    action: "TASK_EXECUTION"
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.bindings.length, 1);
  assert.equal(toolCatalogCalls, 1);
});

test("getToolsForAgent falls back to stale catalog when refresh fails", async () => {
  const store = createStore();
  await store.adapter.upsertByConnection({
    userId: "user-1",
    orgId: "org-1",
    provider: "composio",
    toolkit: "gmail",
    connectionId: "conn_123",
    status: "ACTIVE",
    metadata: {}
  });

  let nowMs = 1_000;
  let toolCatalogCalls = 0;
  const mockClient = createMockClient();
  mockClient.connectedAccounts.list = async () => ({
    items: [{ id: "conn_123", status: "ACTIVE", toolkit: { slug: "gmail" } }]
  });
  mockClient.tools.getRawComposioTools = async () => {
    toolCatalogCalls += 1;
    if (toolCatalogCalls === 1) {
      return [
        {
          slug: "GMAIL_SEND_EMAIL",
          name: "Send Gmail",
          description: "Send an email",
          toolkit: { slug: "gmail" }
        }
      ];
    }
    throw new Error("catalog temporarily unavailable");
  };

  const core = new ComposioServiceCore({
    enabled: true,
    provider: "composio",
    allowlistedToolkits: ["gmail", "slack"],
    callbackUrl: "http://localhost:3001/api/integrations/composio/oauth/callback",
    createClient: () => mockClient,
    store: store.adapter,
    createStateToken: () => "signed-state",
    verifyStateToken: () => null,
    connectUrlForToolkit: (toolkit: string) => `/app?toolkit=${toolkit}`,
    now: () => nowMs,
    toolCatalogCacheTtlMs: 1
  });

  const first = await core.getToolsForAgent({
    userId: "user-1",
    orgId: "org-1",
    requestedToolkits: ["gmail"],
    action: "TASK_EXECUTION"
  });
  assert.equal(first.ok, true);
  assert.equal(first.bindings.length, 1);

  nowMs = 5_000;
  const second = await core.getToolsForAgent({
    userId: "user-1",
    orgId: "org-1",
    requestedToolkits: ["gmail"],
    action: "TASK_EXECUTION"
  });

  assert.equal(second.ok, true);
  assert.equal(second.bindings.length, 1);
  assert.equal(toolCatalogCalls, 2);
});

test("disconnectConnection succeeds when remote account is already missing", async () => {
  const store = createStore();
  await store.adapter.upsertByConnection({
    userId: "user-1",
    orgId: "org-1",
    provider: "composio",
    toolkit: "gmail",
    connectionId: "conn_123",
    status: "ACTIVE",
    metadata: {}
  });

  const mockClient = createMockClient();
  mockClient.connectedAccounts.delete = async () => {
    const error: Error & { status?: number } = new Error("Connected account not found");
    error.status = 404;
    throw error;
  };

  const core = new ComposioServiceCore({
    enabled: true,
    provider: "composio",
    allowlistedToolkits: ["gmail", "slack"],
    callbackUrl: "http://localhost:3001/api/integrations/composio/oauth/callback",
    createClient: () => mockClient,
    store: store.adapter,
    createStateToken: () => "signed-state",
    verifyStateToken: () => null,
    connectUrlForToolkit: (toolkit: string) => `/app?toolkit=${toolkit}`
  });

  const disconnected = await core.disconnectConnection({
    userId: "user-1",
    orgId: "org-1",
    connectionId: "conn_123"
  });

  assert.ok(disconnected);
  assert.equal(disconnected?.status, "DISCONNECTED");
  assert.equal(disconnected?.connectionId, "conn_123");
});

test("executeToolAction accepts connected-account SUCCESS status from remote sync", async () => {
  const store = createStore();
  const mockClient = createMockClient();
  mockClient.connectedAccounts.list = async () => ({
    items: [
      {
        id: "conn_success_exec",
        status: "SUCCESS",
        toolkit: { slug: "gmail" }
      }
    ]
  });
  mockClient.tools.execute = async (_slug: string) => ({
    successful: true,
    data: { sent: true },
    logId: "log_exec_success"
  });

  const core = new ComposioServiceCore({
    enabled: true,
    provider: "composio",
    allowlistedToolkits: ["gmail", "slack"],
    callbackUrl: "http://localhost:3001/api/integrations/composio/oauth/callback",
    createClient: () => mockClient,
    store: store.adapter,
    createStateToken: () => "signed-state",
    verifyStateToken: () => null,
    connectUrlForToolkit: (toolkit: string) => `/app?toolkit=${toolkit}`
  });

  const result = await core.executeToolAction({
    userId: "user-1",
    orgId: "org-1",
    toolkit: "gmail",
    toolSlug: "GMAIL_SEND_EMAIL",
    action: "SEND_EMAIL",
    arguments: { to: "a@example.com" }
  });

  assert.equal(result.successful, true);
  assert.equal(result.logId, "log_exec_success");
});

test("executeToolAction uses org fallback owner when actor user has no direct connection", async () => {
  const store = createStore();
  await store.adapter.upsertByConnection({
    userId: "owner-user",
    orgId: "org-1",
    provider: "composio",
    toolkit: "gmail",
    connectionId: "conn_shared_fallback",
    status: "ACTIVE",
    metadata: {}
  });

  let executedUserId = "";
  let executedConnectionId = "";
  const mockClient = createMockClient();
  mockClient.connectedAccounts.list = async () => ({
    items: []
  });
  mockClient.tools.execute = async (
    _slug: string,
    body: { userId: string; connectedAccountId: string }
  ) => {
    executedUserId = body.userId;
    executedConnectionId = body.connectedAccountId;
    return {
      successful: true,
      data: { ok: true },
      logId: "log_exec_fallback"
    };
  };

  const core = new ComposioServiceCore({
    enabled: true,
    provider: "composio",
    allowlistedToolkits: ["gmail", "slack"],
    callbackUrl: "http://localhost:3001/api/integrations/composio/oauth/callback",
    createClient: () => mockClient,
    store: store.adapter,
    createStateToken: () => "signed-state",
    verifyStateToken: () => null,
    connectUrlForToolkit: (toolkit: string) => `/app?toolkit=${toolkit}`,
    allowOrgToolkitFallback: true
  });

  const result = await core.executeToolAction({
    userId: "session-user",
    orgId: "org-1",
    toolkit: "gmail",
    toolSlug: "GMAIL_SEND_EMAIL",
    action: "SEND_EMAIL",
    arguments: { to: "a@example.com", subject: "Hi", body: "Hello" }
  });

  assert.equal(result.successful, true);
  assert.equal(executedUserId, "ht-user-owner-user");
  assert.equal(executedConnectionId, "conn_shared_fallback");
});

test("executeToolAction strips sender_email-like fields for Gmail send actions", async () => {
  const store = createStore();
  const mockClient = createMockClient();
  mockClient.connectedAccounts.list = async () => ({
    items: [
      {
        id: "conn_gmail_send",
        status: "ACTIVE",
        toolkit: { slug: "gmail" }
      }
    ]
  });

  let executedArguments: Record<string, unknown> | null = null;
  mockClient.tools.execute = async (
    _slug: string,
    body: { arguments?: Record<string, unknown> }
  ) => {
    executedArguments =
      body.arguments && typeof body.arguments === "object" ? body.arguments : null;
    return {
      successful: true,
      data: { sent: true },
      logId: "log_strip_sender_fields"
    };
  };

  const core = new ComposioServiceCore({
    enabled: true,
    provider: "composio",
    allowlistedToolkits: ["gmail", "slack"],
    callbackUrl: "http://localhost:3001/api/integrations/composio/oauth/callback",
    createClient: () => mockClient,
    store: store.adapter,
    createStateToken: () => "signed-state",
    verifyStateToken: () => null,
    connectUrlForToolkit: (toolkit: string) => `/app?toolkit=${toolkit}`
  });

  const result = await core.executeToolAction({
    userId: "user-1",
    orgId: "org-1",
    toolkit: "gmail",
    toolSlug: "GMAIL_SEND_EMAIL",
    action: "SEND_EMAIL",
    arguments: {
      to: "a@example.com",
      subject: "Hi",
      body: "Hello",
      sender_email: "wrong-sender@example.com",
      from_email: "wrong-from@example.com",
      from: "wrong-from-plain@example.com",
      sender: "wrong-sender-plain@example.com",
      cc: "cc@example.com"
    }
  });

  assert.equal(result.successful, true);
  assert.ok(executedArguments);
  const sentArgs = executedArguments as Record<string, unknown>;
  assert.equal(sentArgs["to"], "a@example.com");
  assert.equal(sentArgs["cc"], "cc@example.com");
  assert.equal("sender_email" in (executedArguments ?? {}), false);
  assert.equal("from_email" in (executedArguments ?? {}), false);
  assert.equal("from" in (executedArguments ?? {}), false);
  assert.equal("sender" in (executedArguments ?? {}), false);
});

test("listAvailableToolkits includes app launch URL for popup embedding", async () => {
  const store = createStore();
  const core = new ComposioServiceCore({
    enabled: true,
    provider: "composio",
    allowlistedToolkits: ["gmail", "slack"],
    callbackUrl: "http://localhost:3001/api/integrations/composio/oauth/callback",
    createClient: () => createMockClient(),
    store: store.adapter,
    createStateToken: () => "signed-state",
    verifyStateToken: () => null,
    connectUrlForToolkit: (toolkit: string) => `/app?toolkit=${toolkit}`
  });

  const toolkits = await core.listAvailableToolkits("user-1");
  const gmail = toolkits.find((item: { slug: string; appUrl: string | null }) => item.slug === "gmail");

  assert.equal(gmail?.appUrl, "https://mail.google.com");
});

test("createConnection uses custom auth config when toolkit OAuth credentials are provided", async () => {
  const store = createStore();
  const createdAuthConfigs: Array<{ toolkit: string; options: Record<string, unknown> | undefined }> = [];
  const linkedWithAuthConfigIds: string[] = [];

  const mockClient = createMockClient();
  mockClient.authConfigs.list = async () => ({
    items: [{ id: "ac_managed", status: "ENABLED", isComposioManaged: true }]
  });
  mockClient.authConfigs.create = async (
    toolkit: string,
    options?: Record<string, unknown>
  ) => {
    createdAuthConfigs.push({ toolkit, options });
    return { id: "ac_custom_001" };
  };
  mockClient.connectedAccounts.link = async (
    _userId: string,
    authConfigId: string
  ) => {
    linkedWithAuthConfigIds.push(authConfigId);
    return {
      id: "conn_custom_001",
      status: "INITIATED",
      redirectUrl: "https://connect.example.com/authorize"
    };
  };

  const core = new ComposioServiceCore({
    enabled: true,
    provider: "composio",
    allowlistedToolkits: ["gmail", "slack"],
    callbackUrl: "http://localhost:3001/api/integrations/composio/oauth/callback",
    createClient: () => mockClient,
    store: store.adapter,
    createStateToken: () => "signed-state",
    verifyStateToken: () => null,
    connectUrlForToolkit: (toolkit: string) => `/app?toolkit=${toolkit}`,
    customAuthConfigs: {
      gmail: {
        name: "VorldX Human Touch Gmail OAuth",
        authScheme: "OAUTH2",
        credentials: {
          client_id: "google-client-id",
          client_secret: "google-client-secret"
        }
      }
    }
  });

  await core.createConnection({
    userId: "user-1",
    orgId: "org-1",
    toolkit: "gmail",
    returnTo: "/app?tab=hub&hubScope=TOOLS"
  });

  assert.equal(createdAuthConfigs.length, 1);
  assert.equal(createdAuthConfigs[0]?.toolkit, "gmail");
  assert.equal(createdAuthConfigs[0]?.options?.type, "use_custom_auth");
  assert.equal(linkedWithAuthConfigIds[0], "ac_custom_001");
});

test("inferRequestedToolkits detects compact/spaced toolkit names and intent aliases", () => {
  const inferred = inferRequestedToolkits(
    "Schedule a Google Calendar invite, start a Zoom video call, and sync CRM notes in Quick Books.",
    ["googlecalendar", "zoom", "hubspot", "salesforce", "quickbooks"]
  );

  assert.deepEqual(
    [...inferred].sort(),
    ["googlecalendar", "hubspot", "quickbooks", "salesforce", "zoom"].sort()
  );
});

test("inferRequestedToolkits maps Google Meet signals without duplicate meet toolkits", () => {
  const inferred = inferRequestedToolkits(
    "Set up a Google Meet link and send the meeting details.",
    ["gmeet", "googlemeet", "gmail"]
  );

  assert.deepEqual([...inferred].sort(), ["googlemeet"].sort());
});

test("inferRequestedToolkits maps presentation intents to Google Slides", () => {
  const inferred = inferRequestedToolkits(
    "Make a PPT investor pitch deck for seed funding and prepare slides for demo day.",
    ["googleslides", "googledocs", "gmail"]
  );

  assert.deepEqual([...inferred].sort(), ["googleslides"].sort());
});

test("inferRequestedToolkits detects setup-meeting plus details-email workflows", () => {
  const inferred = inferRequestedToolkits(
    "Setup meeting and send meeting details to singhtrun7985@gmail.com",
    ["gmail", "googlemeet", "googlecalendar", "gmeet"]
  );

  assert.deepEqual(
    [...inferred].sort(),
    ["gmail", "googlecalendar", "googlemeet"].sort()
  );
});

test("inferRequestedToolkits does not force whatsapp for plain meeting scheduling", () => {
  const inferred = inferRequestedToolkits(
    "Can you schedule meeting on Google Meet and share me details",
    ["gmail", "whatsapp", "googlemeet", "googlecalendar", "gmeet"]
  );

  assert.deepEqual(
    [...inferred].sort(),
    ["googlecalendar", "googlemeet"].sort()
  );
});

test("inferRequestedToolkits includes whatsapp for explicit phone notification intent", () => {
  const inferred = inferRequestedToolkits(
    "Create a meeting and send WhatsApp update to +91 98765 43210",
    ["whatsapp", "googlemeet", "googlecalendar", "gmeet"]
  );

  assert.deepEqual(
    [...inferred].sort(),
    ["googlecalendar", "googlemeet", "whatsapp"].sort()
  );
});
