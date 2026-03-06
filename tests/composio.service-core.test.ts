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
      ]
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
