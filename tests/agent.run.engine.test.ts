import assert from "node:assert/strict";
import test from "node:test";

import { runAgentEngine } from "../lib/agent/run/engine.ts";

test("send flow asks for recipient email when missing", async () => {
  const response = await runAgentEngine(
    {
      prompt: "Send congratulations email for her wedding"
    },
    {
      plan: async () => ({
        intent: "send_email",
        needs: ["recipient_email"],
        args: {},
        requires_confirmation: true,
        assistant_message: "Need recipient email."
      }),
      writeEmail: async () => ({
        subject: "Congrats!",
        body: "Warm wishes."
      }),
      executeGmailAction: async () => ({
        ok: true,
        toolkit: "gmail",
        action: "SEND_EMAIL",
        toolSlug: "GMAIL_SEND_EMAIL",
        data: {},
        logId: null,
        attempts: 1
      })
    }
  );

  assert.equal(response.status, "needs_input");
  assert.equal(response.required_inputs?.[0]?.key, "recipient_email");
});

test("send flow returns confirmation draft before sending", async () => {
  let sendInvoked = false;
  const response = await runAgentEngine(
    {
      prompt: "Send congratulations email",
      input: {
        recipient_email: "test@example.com"
      },
      confirm: false
    },
    {
      plan: async () => ({
        intent: "send_email",
        needs: [],
        args: {
          recipient_email: "test@example.com"
        },
        requires_confirmation: true,
        assistant_message: "Please confirm."
      }),
      writeEmail: async () => ({
        subject: "Congratulations on your wedding",
        body: "Wishing you love and happiness in your new journey."
      }),
      executeGmailAction: async () => {
        sendInvoked = true;
        return {
          ok: true,
          toolkit: "gmail",
          action: "SEND_EMAIL",
          toolSlug: "GMAIL_SEND_EMAIL",
          data: {},
          logId: null,
          attempts: 1
        };
      }
    }
  );

  assert.equal(response.status, "needs_confirmation");
  assert.equal(Boolean(response.draft?.subject), true);
  assert.equal(sendInvoked, false);
});

test("send flow sends only after confirm=true", async () => {
  let sendInvoked = false;
  const response = await runAgentEngine(
    {
      prompt: "Send congratulations email",
      input: {
        recipient_email: "test@example.com",
        subject: "Congrats",
        body: "Best wishes!"
      },
      confirm: true
    },
    {
      plan: async () => ({
        intent: "send_email",
        needs: [],
        args: {
          recipient_email: "test@example.com"
        },
        requires_confirmation: true,
        assistant_message: "Sending now."
      }),
      writeEmail: async () => ({
        subject: "unused",
        body: "unused"
      }),
      executeGmailAction: async () => {
        sendInvoked = true;
        return {
          ok: true,
          toolkit: "gmail",
          action: "SEND_EMAIL",
          toolSlug: "GMAIL_SEND_EMAIL",
          data: { delivered: true },
          logId: "log_1",
          attempts: 1
        };
      }
    }
  );

  assert.equal(sendInvoked, true);
  assert.equal(response.status, "completed");
  assert.match(response.assistant_message, /Email sent/i);
});

test("send flow does not send when confirm=true but draft fields are missing", async () => {
  let sendInvoked = false;
  const response = await runAgentEngine(
    {
      prompt: "Send congratulations email",
      input: {
        recipient_email: "test@example.com"
      },
      confirm: true
    },
    {
      plan: async () => ({
        intent: "send_email",
        needs: [],
        args: {
          recipient_email: "test@example.com"
        },
        requires_confirmation: true,
        assistant_message: "Please confirm."
      }),
      writeEmail: async () => ({
        subject: "Congratulations",
        body: "Wishing you the best."
      }),
      executeGmailAction: async () => {
        sendInvoked = true;
        return {
          ok: true,
          toolkit: "gmail",
          action: "SEND_EMAIL",
          toolSlug: "GMAIL_SEND_EMAIL",
          data: {},
          logId: null,
          attempts: 1
        };
      }
    }
  );

  assert.equal(sendInvoked, false);
  assert.equal(response.status, "needs_confirmation");
  assert.equal(Boolean(response.draft?.subject), true);
});

test("summarize flow returns completed summary", async () => {
  const response = await runAgentEngine(
    {
      prompt: "Summarize my last 5 emails"
    },
    {
      plan: async () => ({
        intent: "summarize_emails",
        needs: [],
        args: { limit: 5 },
        requires_confirmation: false,
        assistant_message: "Summarizing."
      }),
      writeEmail: async () => ({
        subject: "unused",
        body: "unused"
      }),
      executeGmailAction: async () => ({
        ok: true,
        toolkit: "gmail",
        action: "SUMMARIZE_EMAILS",
        toolSlug: "GMAIL_FETCH_EMAILS",
        data: {
          summary: "You received 5 emails. 2 need follow-up."
        },
        logId: "log_2",
        attempts: 1
      })
    }
  );

  assert.equal(response.status, "completed");
  assert.match(response.assistant_message, /5 emails/i);
});

test("integration-not-connected error is normalized for UI", async () => {
  const response = await runAgentEngine(
    {
      prompt: "Summarize my last 5 emails"
    },
    {
      plan: async () => ({
        intent: "summarize_emails",
        needs: [],
        args: { limit: 5 },
        requires_confirmation: false,
        assistant_message: "Summarizing."
      }),
      writeEmail: async () => ({
        subject: "unused",
        body: "unused"
      }),
      executeGmailAction: async () => ({
        ok: false,
        attempts: 1,
        error: {
          code: "INTEGRATION_NOT_CONNECTED",
          message: "Gmail not connected.",
          toolkit: "gmail",
          action: "SUMMARIZE_EMAILS",
          connectUrl: "/app?tab=hub&hubScope=TOOLS&toolkit=gmail"
        }
      })
    }
  );

  assert.equal(response.status, "error");
  assert.equal(response.error?.code, "INTEGRATION_NOT_CONNECTED");
  assert.equal(response.error?.details?.connectUrl, "/app?tab=hub&hubScope=TOOLS&toolkit=gmail");
});

test("planner fallback infers send intent when planner fails", async () => {
  const response = await runAgentEngine(
    {
      prompt: "Send congratulations email for her wedding"
    },
    {
      plan: async () => {
        throw new Error("Planner unavailable");
      },
      writeEmail: async () => ({
        subject: "unused",
        body: "unused"
      }),
      executeGmailAction: async () => ({
        ok: true,
        toolkit: "gmail",
        action: "SEND_EMAIL",
        toolSlug: "GMAIL_SEND_EMAIL",
        data: {},
        logId: null,
        attempts: 1
      })
    }
  );

  assert.equal(response.status, "needs_input");
  assert.equal(response.required_inputs?.[0]?.key, "recipient_email");
});

test("writer fallback creates draft when writer fails", async () => {
  const response = await runAgentEngine(
    {
      prompt: "Send congratulations email to test@example.com for her wedding",
      confirm: false
    },
    {
      plan: async () => {
        throw new Error("Planner unavailable");
      },
      writeEmail: async () => {
        throw new Error("Writer unavailable");
      },
      executeGmailAction: async () => ({
        ok: true,
        toolkit: "gmail",
        action: "SEND_EMAIL",
        toolSlug: "GMAIL_SEND_EMAIL",
        data: {},
        logId: null,
        attempts: 1
      })
    }
  );

  assert.equal(response.status, "needs_confirmation");
  assert.equal(response.draft?.to, "test@example.com");
  assert.match(response.draft?.subject ?? "", /congrat/i);
  assert.equal(Boolean(response.draft?.body), true);
});
