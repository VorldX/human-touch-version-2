import assert from "node:assert/strict";
import test from "node:test";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3001";
const ORG_ID = "org-smoke";

async function jsonRequest(path, init) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.headers ?? {})
    }
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { response, payload };
}

test("GET /api/integrations/composio/toolkits requires auth headers", async () => {
  const { response, payload } = await jsonRequest(
    `/api/integrations/composio/toolkits?orgId=${encodeURIComponent(ORG_ID)}`
  );
  assert.equal(response.status, 401);
  assert.equal(Boolean(payload?.ok), false);
});

test("GET /api/integrations/composio/connections requires auth headers", async () => {
  const { response, payload } = await jsonRequest(
    `/api/integrations/composio/connections?orgId=${encodeURIComponent(ORG_ID)}`
  );
  assert.equal(response.status, 401);
  assert.equal(Boolean(payload?.ok), false);
});

test("POST /api/integrations/composio/connections requires auth headers", async () => {
  const { response, payload } = await jsonRequest("/api/integrations/composio/connections", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      orgId: ORG_ID,
      toolkit: "gmail"
    })
  });
  assert.equal(response.status, 401);
  assert.equal(Boolean(payload?.ok), false);
});

test("POST /api/integrations/composio/connect requires auth headers", async () => {
  const { response, payload } = await jsonRequest("/api/integrations/composio/connect", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      orgId: ORG_ID,
      toolkit: "gmail"
    })
  });
  assert.equal(response.status, 401);
  assert.equal(Boolean(payload?.ok), false);
});

test("POST /api/agent/tools/execute requires auth headers or internal key", async () => {
  const { response, payload } = await jsonRequest("/api/agent/tools/execute", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      orgId: ORG_ID,
      toolkit: "gmail",
      action: "LIST_RECENT_EMAILS",
      arguments: { limit: 5 }
    })
  });
  assert.equal(response.status, 401);
  assert.equal(Boolean(payload?.ok), false);
});

test("POST /api/agent/run requires auth headers", async () => {
  const { response, payload } = await jsonRequest("/api/agent/run", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      prompt: "Summarize my last 5 emails"
    })
  });
  assert.equal(response.status, 401);
  assert.equal(payload?.status, "error");
});
