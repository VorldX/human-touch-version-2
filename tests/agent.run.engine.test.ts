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
  assert.equal(Boolean(response.draft?.subject), true);
  assert.equal(Boolean(response.draft?.body), true);
});

test("structured send prompt extracts clean subject and body into approval draft", async () => {
  let sentArgs: Record<string, unknown> | null = null;
  const response = await runAgentEngine(
    {
      prompt:
        "Send an email to x@example.com. Subject: Hello Body: Test message",
      confirm: false
    },
    {
      plan: async () => {
        throw new Error("Planner unavailable");
      },
      writeEmail: async () => ({
        subject: "unused",
        body: "unused"
      }),
      executeGmailAction: async ({ arguments: args }) => {
        sentArgs = args;
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
  assert.equal(response.draft?.to, "x@example.com");
  assert.equal(response.draft?.subject, "Hello");
  assert.equal(response.draft?.body, "Test message");
  assert.equal(sentArgs, null);
});

test("informal send prompt is parsed into clean recipient/subject/body draft", async () => {
  const response = await runAgentEngine(
    {
      prompt: "cn u send mail to ssinghtarun7985@gmail.com that he is a good boy",
      confirm: false
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

  assert.equal(response.status, "needs_confirmation");
  assert.equal(response.draft?.to, "ssinghtarun7985@gmail.com");
  assert.equal(response.draft?.subject, "Quick note");
  assert.equal(
    response.draft?.body,
    ["Hi,", "", "Just wanted to let you know that you are a good boy.", "", "Best regards,"].join(
      "\n"
    )
  );
});

test("missing subject defaults to quick note for informal body phrasing", async () => {
  const response = await runAgentEngine(
    {
      prompt: "send email to x@example.com saying meeting moved to tomorrow",
      confirm: false
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

  assert.equal(response.status, "needs_confirmation");
  assert.equal(response.draft?.to, "x@example.com");
  assert.equal(response.draft?.subject, "Quick note");
  assert.equal(response.draft?.body, ["Hi,", "", "Meeting moved to tomorrow.", "", "Best regards,"].join("\n"));
});

test("structured send prompt reports missing body", async () => {
  const response = await runAgentEngine(
    {
      prompt: "Send an email to x@example.com. Subject: Hello",
      confirm: false
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
  assert.equal(response.required_inputs?.some((item) => item.key === "body"), true);
});

test("inline structured fields without delimiters are parsed correctly", async () => {
  const response = await runAgentEngine(
    {
      prompt: "email x@example.com subject hello body test",
      confirm: false
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

  assert.equal(response.status, "needs_confirmation");
  assert.equal(response.draft?.to, "x@example.com");
  assert.equal(response.draft?.subject, "hello");
  assert.equal(response.draft?.body, "test");
});

test("explicit draft mode keeps approval flow active", async () => {
  let sendInvoked = false;
  const response = await runAgentEngine(
    {
      prompt: "draft email to x@example.com saying meeting moved to tomorrow",
      confirm: false
    },
    {
      plan: async () => {
        throw new Error("Planner unavailable");
      },
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
          data: {},
          logId: null,
          attempts: 1
        };
      }
    }
  );

  assert.equal(response.status, "needs_confirmation");
  assert.equal(sendInvoked, false);
});

test("approval mode keeps boilerplate out of sent payload", async () => {
  let capturedSendArgs: Record<string, unknown> | null = null;
  const response = await runAgentEngine(
    {
      prompt: "Send an email to x@example.com. Subject: Hello Body: Test message",
      confirm: true,
      input: {
        recipient_email: "x@example.com",
        subject: "Draft Email (Approval Required)\nSubject: Hello",
        body: [
          "Draft Email (Approval Required)",
          "To: x@example.com",
          "Subject: Hello",
          "",
          "Test message",
          "",
          "Reply \"approve\" to send this email, or reply with edits."
        ].join("\n")
      }
    },
    {
      plan: async () => {
        throw new Error("Planner unavailable");
      },
      writeEmail: async () => ({
        subject: "unused",
        body: "unused"
      }),
      executeGmailAction: async ({ arguments: args }) => {
        capturedSendArgs = args;
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

  assert.equal(response.status, "completed");
  assert.equal((capturedSendArgs?.["subject"] as string | undefined) ?? "", "Hello");
  assert.equal((capturedSendArgs?.["body"] as string | undefined) ?? "", "Test message");
});

test("direct send mode bypasses approval and sends structured payload", async () => {
  let capturedSendArgs: Record<string, unknown> | null = null;
  const response = await runAgentEngine(
    {
      prompt:
        "Send now an email to x@example.com. Subject: Hello Body: Test message",
      confirm: false
    },
    {
      plan: async () => {
        throw new Error("Planner unavailable");
      },
      writeEmail: async () => ({
        subject: "unused",
        body: "unused"
      }),
      executeGmailAction: async ({ arguments: args }) => {
        capturedSendArgs = args;
        return {
          ok: true,
          toolkit: "gmail",
          action: "SEND_EMAIL",
          toolSlug: "GMAIL_SEND_EMAIL",
          data: { delivered: true },
          logId: null,
          attempts: 1
        };
      }
    }
  );

  assert.equal(response.status, "completed");
  assert.equal((capturedSendArgs?.["to"] as string | undefined) ?? "", "x@example.com");
  assert.equal((capturedSendArgs?.["subject"] as string | undefined) ?? "", "Hello");
  assert.equal((capturedSendArgs?.["body"] as string | undefined) ?? "", "Test message");
});
