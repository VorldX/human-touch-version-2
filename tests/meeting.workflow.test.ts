import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMeetingDetailsEmailTemplate,
  buildMeetingNotificationTemplate,
  extractFirstPhoneNumber,
  parseMeetingIntent,
  shouldSendMeetingNotification,
  shouldSendMeetingDetailsEmail
} from "../lib/agent/orchestration/meeting-workflow.ts";

test("meeting intent parser extracts creation + share signals", () => {
  const parsed = parseMeetingIntent(
    "Schedule a meeting and send details to jane@example.com. Topic: Q2 roadmap. Duration: 45 minutes."
  );

  assert.equal(parsed.isMeetingRelated, true);
  assert.equal(parsed.wantsCreate, true);
  assert.equal(parsed.wantsShareDetails, true);
  assert.equal(parsed.recipientEmail, "jane@example.com");
  assert.equal(parsed.durationMinutes, 45);
});

test("meeting details email template is deterministic and complete", () => {
  const email = buildMeetingDetailsEmailTemplate({
    recipient: "jane@example.com",
    meetingUri: "https://meet.google.com/abc-defg-hij",
    meetingCode: "abc-defg-hij",
    meetingTopic: "Q2 roadmap",
    durationMinutes: 45,
    prompt: "Send meeting details to Jane for the roadmap review."
  });

  assert.equal(email.to, "jane@example.com");
  assert.match(email.subject, /Meeting details/i);
  assert.match(email.body, /Meeting link: https:\/\/meet\.google\.com\/abc-defg-hij/i);
  assert.match(email.body, /Duration: 45 minutes/i);
  assert.equal(shouldSendMeetingDetailsEmail("Share meeting invite link by email"), true);
});

test("meeting notification parser and template are deterministic", () => {
  const parsed = parseMeetingIntent(
    "Create a meeting and send WhatsApp notification to +91 98765 43210 with details."
  );
  assert.equal(parsed.wantsNotification, true);
  assert.equal(parsed.recipientPhone, "+919876543210");
  assert.equal(shouldSendMeetingNotification("Notify on WhatsApp after meeting setup"), true);
  assert.equal(extractFirstPhoneNumber("Phone: +1 (415) 555-1212"), "+14155551212");

  const message = buildMeetingNotificationTemplate({
    recipientPhone: "+14155551212",
    meetingUri: "https://meet.google.com/abc-defg-hij",
    meetingCode: "abc-defg-hij",
    meetingTopic: "Q2 roadmap",
    durationMinutes: 45,
    prompt: "Send WhatsApp confirmation with meeting details."
  });

  assert.equal(message.to, "+14155551212");
  assert.match(message.message, /Meeting confirmed/i);
  assert.match(message.message, /meet\.google\.com\/abc-defg-hij/i);
});
