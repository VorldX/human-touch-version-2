import assert from "node:assert/strict";
import test from "node:test";

import { executeThroughExistingToolPath } from "../lib/langgraph/adapters/tool-execution-bridge.ts";

test("tool execution bridge delegates to existing execute path", async () => {
  let called = false;
  const result = await executeThroughExistingToolPath(
    {
      orgId: "org-1",
      userId: "user-1",
      toolkit: "gmail",
      action: "LIST_RECENT_EMAILS",
      arguments: { limit: 3 }
    },
    {
      executeFn: async (input) => {
        called = true;
        assert.equal(input.toolkit, "gmail");
        assert.equal(input.action, "LIST_RECENT_EMAILS");
        return {
          ok: true,
          toolkit: "gmail",
          action: "LIST_RECENT_EMAILS",
          toolSlug: "GMAIL_FETCH_EMAILS",
          data: { count: 3 },
          logId: "log-1",
          attempts: 1
        };
      }
    }
  );

  assert.equal(called, true);
  assert.equal(result.ok, true);
});

test("tool execution bridge preserves error response shape", async () => {
  const result = await executeThroughExistingToolPath(
    {
      orgId: "org-1",
      userId: "user-1",
      toolkit: "gmail",
      action: "SEND_EMAIL",
      arguments: {}
    },
    {
      executeFn: async () => ({
        ok: false,
        attempts: 1,
        error: {
          code: "INTEGRATION_NOT_CONNECTED",
          message: "Gmail is not connected.",
          toolkit: "gmail",
          action: "SEND_EMAIL",
          connectUrl: "/app?toolkit=gmail"
        }
      })
    }
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "INTEGRATION_NOT_CONNECTED");
    assert.equal(result.error.toolkit, "gmail");
  }
});
