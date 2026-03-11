import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyEmailDraftReply,
  parseStructuredSendFields
} from "../lib/agent/run/email-request-parser.ts";

test("explicit cancel reply is classified as cancel", () => {
  assert.equal(classifyEmailDraftReply("cancel this draft"), "cancel");
  assert.equal(classifyEmailDraftReply("don't send it"), "cancel");
});

test("follow-up edit text is parsed into clean replacement body", () => {
  const parsed = parseStructuredSendFields(
    [
      "send email to x@example.com saying meeting moved to tomorrow",
      "",
      "Additional edits from user: mention that it starts at 3 PM and be polite"
    ].join("\n")
  );

  assert.equal(parsed.recipientEmail, "x@example.com");
  assert.equal(parsed.subject, "Quick note");
  assert.equal(
    parsed.body,
    ["Hi,", "", "Mention that it starts at 3 PM and be polite.", "", "Best regards,"].join("\n")
  );
});

