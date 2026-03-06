import assert from "node:assert/strict";
import test from "node:test";

import { inferUnverifiedExternalActionClaim } from "../lib/agent/hallucination-guard.ts";

test("flags unverified external success claims when tool evidence is missing", () => {
  const reason = inferUnverifiedExternalActionClaim({
    outputText: "I have successfully sent the email to the client.",
    requestedToolkits: ["gmail"],
    inferredToolAction: {
      toolkit: "gmail",
      action: "GMAIL_SEND_EMAIL"
    },
    toolActionExecution: null
  });

  assert.ok(reason);
  assert.match(reason ?? "", /no successful tool evidence/i);
});

test("does not flag when successful tool execution evidence exists", () => {
  const reason = inferUnverifiedExternalActionClaim({
    outputText: "I have successfully sent the email to the client.",
    requestedToolkits: ["gmail"],
    inferredToolAction: {
      toolkit: "gmail",
      action: "GMAIL_SEND_EMAIL"
    },
    toolActionExecution: {
      ok: true
    }
  });

  assert.equal(reason, null);
});

test("does not flag draft/non-executed language", () => {
  const reason = inferUnverifiedExternalActionClaim({
    outputText: "Draft prepared. Email not sent yet and awaiting approval.",
    requestedToolkits: ["gmail"],
    inferredToolAction: {
      toolkit: "gmail",
      action: "GMAIL_SEND_EMAIL"
    },
    toolActionExecution: null
  });

  assert.equal(reason, null);
});

test("flags success claim when tool execution failed", () => {
  const reason = inferUnverifiedExternalActionClaim({
    outputText: "Meeting created successfully in Zoom.",
    requestedToolkits: ["zoom"],
    inferredToolAction: {
      toolkit: "zoom",
      action: "ZOOM_CREATE_MEETING"
    },
    toolActionExecution: {
      ok: false,
      error: {
        toolkit: "zoom",
        action: "ZOOM_CREATE_MEETING",
        message: "401 unauthorized"
      }
    }
  });

  assert.ok(reason);
  assert.match(reason ?? "", /failed/i);
});

