import assert from "node:assert/strict";
import test from "node:test";

import {
  inferDirectionChatGmailIntent,
  isCapabilityOverviewRequest,
  isSimpleGreeting
} from "../lib/direction/chat-routing.ts";

test("detects simple greeting tokens deterministically", () => {
  assert.equal(isSimpleGreeting("hi"), true);
  assert.equal(isSimpleGreeting("Hello"), true);
  assert.equal(isSimpleGreeting("hey!!"), true);
});

test("does not classify non-greeting message as greeting", () => {
  assert.equal(isSimpleGreeting("hello team, schedule a meeting"), false);
  assert.equal(isSimpleGreeting("can you summarize emails"), false);
});

test("detects capability overview requests deterministically", () => {
  assert.equal(isCapabilityOverviewRequest("what can u do for me"), true);
  assert.equal(isCapabilityOverviewRequest("what do you do"), true);
  assert.equal(isCapabilityOverviewRequest("which tools are connected"), true);
});

test("does not over-trigger capability overview detection", () => {
  assert.equal(isCapabilityOverviewRequest("send an email to jane@example.com"), false);
  assert.equal(isCapabilityOverviewRequest("schedule a meeting for tomorrow"), false);
});

test("infers deterministic gmail list intent from recent email request", () => {
  const inferred = inferDirectionChatGmailIntent("show my last 5 emails");
  assert.ok(inferred);
  assert.equal(inferred?.action, "LIST_RECENT_EMAILS");
  assert.equal(inferred?.arguments.limit, 5);
});

test("infers deterministic gmail summarize intent", () => {
  const inferred = inferDirectionChatGmailIntent("summarize recent emails from ops@example.com");
  assert.ok(inferred);
  assert.equal(inferred?.action, "SUMMARIZE_EMAILS");
  assert.equal(inferred?.arguments.limit, 5);
  assert.equal(inferred?.arguments.query, "from:ops@example.com");
});

test("infers deterministic gmail send intent with required fields", () => {
  const inferred = inferDirectionChatGmailIntent(
    "send email to jane@example.com subject: Launch update body: Please ship the final deck by 5 PM."
  );
  assert.ok(inferred);
  assert.equal(inferred?.action, "SEND_EMAIL");
  assert.equal(inferred?.arguments.to, "jane@example.com");
  assert.equal(inferred?.arguments.subject, "Launch update");
  assert.equal(inferred?.arguments.body, "Please ship the final deck by 5 PM.");
});

test("preserves gmail send intent even when details are incomplete", () => {
  const inferred = inferDirectionChatGmailIntent("send an email to jane@example.com");
  assert.ok(inferred);
  assert.equal(inferred?.action, "SEND_EMAIL");
  assert.equal(inferred?.arguments.to, "jane@example.com");
  assert.equal(inferred?.arguments.subject, undefined);
  assert.equal(inferred?.arguments.body, undefined);
});
