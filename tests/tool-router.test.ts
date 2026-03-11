import assert from "node:assert/strict";
import test from "node:test";

import {
  filterToolCatalogForPrompt,
  inferDeterministicHumanInputReason,
  shouldBypassLlmToolRouter
} from "../lib/agent/orchestration/tool-router.ts";

test("tool router bypasses llm for deterministic gmail/meeting intents", () => {
  const decision = shouldBypassLlmToolRouter({
    prompt: "Send meeting invite email to client",
    requestedToolkits: ["gmail", "googlemeet"],
    candidateBindings: [
      {
        toolkit: "gmail",
        slug: "GMAIL_SEND_EMAIL",
        name: "Send email",
        description: "Send an email"
      }
    ]
  });

  assert.equal(decision.bypass, true);
});

test("deterministic router asks for missing email fields", () => {
  const reason = inferDeterministicHumanInputReason({
    prompt: "Send an email to alex@example.com",
    requestedToolkits: ["gmail"]
  });

  assert.match(reason ?? "", /requires recipient, subject, and body/i);
});

test("deterministic router does not pause composite meeting-then-email workflows", () => {
  const reason = inferDeterministicHumanInputReason({
    prompt: "Set up a meeting and send meeting details to alex@example.com",
    requestedToolkits: ["gmail", "googlemeet", "googlecalendar"]
  });

  assert.equal(reason, null);
});

test("catalog filter ranks prompt-relevant actions first", () => {
  const filtered = filterToolCatalogForPrompt({
    prompt: "search inbox for invoices",
    maxItems: 2,
    bindings: [
      {
        toolkit: "gmail",
        slug: "GMAIL_SEND_EMAIL",
        name: "Send email",
        description: "Send a new email"
      },
      {
        toolkit: "gmail",
        slug: "GMAIL_SEARCH_EMAILS",
        name: "Search emails",
        description: "Search inbox messages by query"
      },
      {
        toolkit: "googlemeet",
        slug: "GOOGLEMEET_CREATE_SPACE",
        name: "Create meet",
        description: "Create a Google Meet space"
      }
    ]
  });

  assert.equal(filtered.length, 2);
  assert.equal(filtered[0]?.slug, "GMAIL_SEARCH_EMAILS");
});
