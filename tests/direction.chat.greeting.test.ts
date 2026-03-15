import assert from "node:assert/strict";
import test from "node:test";

import {
  applyDirectionSendArgsFromActiveDraft,
  handleDirectionDraftIntent,
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

test("infers send intent from explicit recipient email even without mailbox keyword", () => {
  const inferred = inferDirectionChatGmailIntent(
    "send meeting details to jane@yahoo.com tomorrow"
  );
  assert.ok(inferred);
  assert.equal(inferred?.action, "SEND_EMAIL");
  assert.equal(inferred?.arguments.to, "jane@yahoo.com");
});

test("routes draft wording to deterministic draft intent (not send)", () => {
  const inferred = inferDirectionChatGmailIntent(
    "draft a mail for congratulating my brother for his new role"
  );
  assert.ok(inferred);
  assert.equal(inferred?.action, "DRAFT_EMAIL");
});

test("direction draft handler persists an active draft payload", () => {
  const handled = handleDirectionDraftIntent({
    message: "draft an email congratulating my brother for his promotion",
    args: {},
    activeDraft: null,
    turn: 1
  });

  assert.equal(Boolean(handled.reply.includes("Here is a draft for your email:")), true);
  assert.equal(handled.activeDraft.status, "pending_approval");
  assert.equal(Boolean(handled.activeDraft.subject), true);
  assert.equal(Boolean(handled.activeDraft.body), true);
});

test("draft birthday intent generates contextual body and extracts recipient name", () => {
  const handled = handleDirectionDraftIntent({
    message: "draft a birthday wish email to rahul",
    args: {},
    activeDraft: null,
    turn: 1
  });

  assert.equal(handled.activeDraft.recipientName, "Rahul");
  assert.match(handled.activeDraft.subject.toLowerCase(), /birthday/);
  assert.match(handled.activeDraft.body.toLowerCase(), /wishing you a very happy birthday|happy birthday/);
  assert.equal(handled.activeDraft.body.toLowerCase().includes("draft a birthday wish email"), false);
});

test("direction send args reuse stored active draft when message lacks fields", () => {
  const merged = applyDirectionSendArgsFromActiveDraft({
    args: {},
    activeDraft: {
      subject: "Congrats on Your Promotion",
      body: "Hi Sam,\n\nCongratulations!\n\nBest regards,",
      to: "sam@example.com",
      recipientName: "Sam",
      companyName: "VorldX",
      status: "pending_approval",
      producedAtTurn: 1
    }
  });

  assert.equal(merged.to, "sam@example.com");
  assert.equal(merged.subject, "Congrats on Your Promotion");
  assert.equal(merged.body, "Hi Sam,\n\nCongratulations!\n\nBest regards,");
});

test("resend intent routes to send action even without mailbox keywords", () => {
  const inferred = inferDirectionChatGmailIntent("resend that email");
  assert.ok(inferred);
  assert.equal(inferred?.action, "SEND_EMAIL");
  assert.equal(inferred?.arguments.resend, true);
});

test("resend send args prefer last sent snapshot over current broken draft", () => {
  const merged = applyDirectionSendArgsFromActiveDraft({
    args: { resend: true },
    activeDraft: {
      subject: "Broken subject",
      body: "Broken body",
      to: "wrong@example.com",
      recipientName: "Wrong",
      companyName: null,
      senderName: null,
      intentHint: "generic_note",
      lastSentDraft: {
        subject: "Happy Birthday, Rahul!",
        body: "Hi Rahul,\n\nWishing you a very happy birthday!\n\nBest regards,",
        to: "rahul@example.com",
        recipientName: "Rahul",
        companyName: null,
        senderName: null,
        intentHint: "birthday_wish"
      },
      status: "sent",
      producedAtTurn: 2
    }
  });

  assert.equal(merged.to, "rahul@example.com");
  assert.equal(merged.subject, "Happy Birthday, Rahul!");
  assert.equal(merged.body, "Hi Rahul,\n\nWishing you a very happy birthday!\n\nBest regards,");
});
