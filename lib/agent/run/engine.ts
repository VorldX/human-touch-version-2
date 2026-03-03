import type { ExecuteAgentToolResult } from "@/lib/agent/tools/execute";
import type { GmailPlannerOutput } from "@/lib/agent/prompts/gmailPlanner";

export interface AgentRunResponse {
  status: "needs_input" | "needs_confirmation" | "completed" | "error";
  assistant_message: string;
  required_inputs?: Array<{
    key: string;
    label: string;
    type: "text" | "email" | "number";
    placeholder: string;
  }>;
  draft?: {
    to: string;
    subject: string;
    body: string;
  };
  actions_taken?: Array<{
    type: string;
    meta?: Record<string, unknown>;
  }>;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface AgentRunEngineInput {
  prompt: string;
  input?: Record<string, unknown>;
  confirm?: boolean;
}

interface EngineDependencies {
  plan: (input: {
    prompt: string;
    providedInput: Record<string, unknown>;
  }) => Promise<GmailPlannerOutput>;
  writeEmail: (input: {
    prompt: string;
    recipientEmail: string;
    recipientName?: string;
    extraContext?: string;
  }) => Promise<{
    subject: string;
    body: string;
  }>;
  executeGmailAction: (input: {
    action: string;
    arguments: Record<string, unknown>;
  }) => Promise<ExecuteAgentToolResult>;
  logAction?: (entry: { type: string; meta?: Record<string, unknown> }) => Promise<void>;
}

const MAX_EMAIL_BODY_CHARS = 4000;

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function normalizeLimit(value: unknown, fallback = 10) {
  const raw = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(25, Math.max(1, Math.floor(raw)));
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function pickEmailFromPrompt(prompt: string) {
  const match = prompt.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0]?.trim() || "";
}

function extractLimitFromPrompt(prompt: string) {
  const match =
    prompt.match(/\b(?:last|latest)\s+(\d{1,2})\s+emails?\b/i) ??
    prompt.match(/\b(\d{1,2})\s+emails?\b/i);
  if (!match?.[1]) {
    return undefined;
  }
  const parsed = Number.parseInt(match[1], 10);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.min(25, Math.max(1, parsed));
}

function extractFromHint(prompt: string) {
  const match = prompt.match(/\bfrom\s+([a-z0-9._%+-]+(?:@[a-z0-9.-]+\.[a-z]{2,})?)/i);
  return match?.[1]?.trim() || "";
}

function inferPlannerFallback(
  prompt: string,
  providedInput: Record<string, unknown>
): GmailPlannerOutput {
  const lowered = prompt.toLowerCase();
  const args: Record<string, unknown> = { ...providedInput };
  const needs = new Set<string>();

  const inferredRecipient =
    asText(providedInput.recipient_email) ||
    asText(providedInput.to) ||
    pickEmailFromPrompt(prompt);
  if (inferredRecipient) {
    args.recipient_email = inferredRecipient;
  }

  const inferredLimit = extractLimitFromPrompt(prompt);
  if (inferredLimit && args.limit === undefined) {
    args.limit = inferredLimit;
  }

  const fromHint = extractFromHint(prompt);
  if (fromHint) {
    if (fromHint.includes("@")) {
      args.search_query = asText(args.search_query) || `from:${fromHint}`;
      args.sender = asText(args.sender) || fromHint;
    } else if (!asText(args.search_query)) {
      args.search_query = `from:${fromHint}`;
      args.sender = asText(args.sender) || fromHint;
    }
  }

  const sendIntent =
    /\b(send|compose|draft|write)\b[\s\S]*\b(email|mail)\b/i.test(prompt) ||
    /\bemail\b[\s\S]*\bto\b/i.test(prompt);
  const summarizeIntent =
    /\b(summarize|summary)\b[\s\S]*(email|mail|inbox|gmail)/i.test(prompt) ||
    /\b(last|latest)\s+\d{1,2}\s+emails?\b/i.test(prompt);
  const searchIntent =
    /\b(find|search|lookup|look up)\b[\s\S]*(email|mail|inbox|gmail)/i.test(prompt) ||
    /\bemails?\s+from\b/i.test(prompt);
  const readIntent =
    /\b(read|open|show)\b[\s\S]*(email|mail)\b/i.test(prompt) ||
    /\breply\b/i.test(prompt);

  if (sendIntent) {
    if (!asText(args.recipient_email)) {
      needs.add("recipient_email");
    }
    return {
      intent: "send_email",
      needs: [...needs],
      args,
      requires_confirmation: true,
      assistant_message: needs.size > 0
        ? "I need recipient email before I can draft this message."
        : "I drafted the email. Please confirm before sending."
    };
  }

  if (summarizeIntent) {
    return {
      intent: "summarize_emails",
      needs: [],
      args,
      requires_confirmation: false,
      assistant_message: "Summarizing your recent emails."
    };
  }

  if (searchIntent) {
    const searchQuery = asText(args.search_query) || asText(args.query);
    if (!searchQuery) {
      needs.add("search_query");
    } else {
      args.search_query = searchQuery;
    }
    return {
      intent: "search_emails",
      needs: [...needs],
      args,
      requires_confirmation: false,
      assistant_message:
        needs.size > 0 ? "Tell me what to search for." : "Searching your inbox."
    };
  }

  if (readIntent) {
    if (/\breply\b/i.test(prompt)) {
      args.draft_reply = true;
    }
    return {
      intent: "read_email",
      needs: [],
      args,
      requires_confirmation: false,
      assistant_message: "Fetching the email details."
    };
  }

  return {
    intent: "unknown",
    needs: [],
    args,
    requires_confirmation: false,
    assistant_message: "I can help with Gmail send, search, read, and summarize actions."
  };
}

function buildDraftFallback(input: {
  prompt: string;
  recipientName?: string;
  recipientEmail: string;
}) {
  const normalizedPrompt = input.prompt.replace(/\s+/g, " ").trim();
  const recipientLabel = input.recipientName?.trim() || "there";

  let subject = "Quick update";
  if (/\bcongrat/i.test(normalizedPrompt) && /\bwedding\b/i.test(normalizedPrompt)) {
    subject = "Congratulations on your wedding";
  } else if (/\bcongrat/i.test(normalizedPrompt)) {
    subject = "Congratulations";
  } else if (/\bthank\b/i.test(normalizedPrompt)) {
    subject = "Thank you";
  } else if (/\bmeeting\b/i.test(normalizedPrompt)) {
    subject = "Quick follow-up";
  } else {
    const compact = normalizedPrompt.slice(0, 56).trim();
    if (compact) {
      subject = `Regarding: ${compact}`;
    }
  }

  const body = [
    `Hi ${recipientLabel},`,
    "",
    normalizedPrompt || `I wanted to reach out to ${input.recipientEmail}.`,
    "",
    "Best regards,"
  ].join("\n");

  return { subject, body };
}

function isLikelyReplyIntent(prompt: string, args: Record<string, unknown>) {
  if (args.draft_reply === true || args.reply === true) {
    return true;
  }
  return /\breply\b|\bdraft a reply\b/i.test(prompt);
}

function toRequiredInput(key: string) {
  if (key === "recipient_email") {
    return {
      key,
      label: "Recipient email",
      type: "email" as const,
      placeholder: "name@example.com"
    };
  }
  if (key === "search_query") {
    return {
      key,
      label: "Search query",
      type: "text" as const,
      placeholder: "from:alice@example.com"
    };
  }
  if (key === "message_id") {
    return {
      key,
      label: "Message ID",
      type: "text" as const,
      placeholder: "17c6f7b..."
    };
  }
  if (key === "limit") {
    return {
      key,
      label: "How many emails",
      type: "number" as const,
      placeholder: "10"
    };
  }
  return {
    key,
    label: key.replace(/_/g, " "),
    type: "text" as const,
    placeholder: `Enter ${key.replace(/_/g, " ")}`
  };
}

function mapToolExecutionError(result: Extract<ExecuteAgentToolResult, { ok: false }>): AgentRunResponse {
  if (result.error.code === "INTEGRATION_NOT_CONNECTED") {
    return {
      status: "error",
      assistant_message: "Gmail is not connected for this user.",
      error: {
        code: "INTEGRATION_NOT_CONNECTED",
        message: result.error.message,
        details: {
          toolkit: result.error.toolkit,
          action: result.error.action,
          ...(result.error.connectUrl ? { connectUrl: result.error.connectUrl } : {})
        }
      }
    };
  }

  return {
    status: "error",
    assistant_message: "I could not complete the Gmail action.",
    error: {
      code: result.error.code,
      message: result.error.message,
      details: {
        toolkit: result.error.toolkit,
        action: result.error.action,
        ...(typeof result.error.retryable === "boolean"
          ? { retryable: result.error.retryable }
          : {})
      }
    }
  };
}

function stringifyPreview(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

function mergeArgs(
  plannerArgs: Record<string, unknown>,
  providedInput: Record<string, unknown>
) {
  return {
    ...plannerArgs,
    ...providedInput
  };
}

export async function runAgentEngine(
  payload: AgentRunEngineInput,
  deps: EngineDependencies
): Promise<AgentRunResponse> {
  const prompt = asText(payload.prompt);
  if (!prompt) {
    return {
      status: "error",
      assistant_message: "Prompt is required.",
      error: {
        code: "INVALID_REQUEST",
        message: "prompt is required."
      }
    };
  }

  const providedInput = asRecord(payload.input);
  let planner: GmailPlannerOutput;
  try {
    planner = await deps.plan({ prompt, providedInput });
  } catch {
    planner = inferPlannerFallback(prompt, providedInput);
  }

  const args = mergeArgs(planner.args, providedInput);
  const actionsTaken: AgentRunResponse["actions_taken"] = [];

  if (planner.intent === "send_email") {
    const rawRecipientEmail =
      asText(args.recipient_email) || asText(args.to) || pickEmailFromPrompt(prompt);
    const recipientName = asText(args.recipient_name) || asText(args.name);

    const missing = new Set<string>(planner.needs);
    if (!rawRecipientEmail) {
      missing.add("recipient_email");
    }

    if (missing.size > 0) {
      return {
        status: "needs_input",
        assistant_message:
          planner.assistant_message ||
          "I need a couple of details before I can draft this email.",
        required_inputs: [...missing].map(toRequiredInput)
      };
    }

    if (!isValidEmail(rawRecipientEmail)) {
      return {
        status: "needs_input",
        assistant_message: "Please provide a valid recipient email address.",
        required_inputs: [toRequiredInput("recipient_email")]
      };
    }

    const rawDraft = asRecord(args.draft);
    let subject = asText(rawDraft.subject) || asText(args.subject);
    let body = asText(rawDraft.body) || asText(args.body);

    if (!subject || !body) {
      try {
        const generated = await deps.writeEmail({
          prompt,
          recipientEmail: rawRecipientEmail,
          ...(recipientName ? { recipientName } : {}),
          ...(asText(args.context) ? { extraContext: asText(args.context) } : {})
        });
        subject = asText(generated.subject);
        body = asText(generated.body);
      } catch {
        const fallbackDraft = buildDraftFallback({
          prompt,
          recipientEmail: rawRecipientEmail,
          ...(recipientName ? { recipientName } : {})
        });
        subject = asText(fallbackDraft.subject);
        body = asText(fallbackDraft.body);
      }
    }

    if (!subject || !body) {
      return {
        status: "error",
        assistant_message: "Draft generation failed because subject/body are empty.",
        error: {
          code: "INVALID_DRAFT",
          message: "Email subject and body are required."
        }
      };
    }

    if (body.length > MAX_EMAIL_BODY_CHARS) {
      return {
        status: "error",
        assistant_message: "Draft is too long. Please shorten the request.",
        error: {
          code: "INVALID_DRAFT",
          message: `Email body exceeds ${MAX_EMAIL_BODY_CHARS} characters.`
        }
      };
    }

    if (payload.confirm !== true) {
      return {
        status: "needs_confirmation",
        assistant_message:
          planner.assistant_message || "Please confirm this draft before sending.",
        draft: {
          to: rawRecipientEmail,
          subject,
          body
        },
        actions_taken: [
          {
            type: "draft_created",
            meta: {
              to: rawRecipientEmail,
              subjectLength: subject.length,
              bodyLength: body.length
            }
          }
        ]
      };
    }

    const sendResult = await deps.executeGmailAction({
      action: "SEND_EMAIL",
      arguments: {
        to: rawRecipientEmail,
        subject,
        body,
        ...(asText(args.cc) ? { cc: asText(args.cc) } : {}),
        ...(asText(args.bcc) ? { bcc: asText(args.bcc) } : {})
      }
    });

    if (!sendResult.ok) {
      return mapToolExecutionError(sendResult);
    }

    const sendAction = {
      type: "email_sent",
      meta: {
        to: rawRecipientEmail,
        subject,
        toolSlug: sendResult.toolSlug
      }
    };
    actionsTaken.push(sendAction);
    if (deps.logAction) {
      await deps.logAction(sendAction);
    }

    return {
      status: "completed",
      assistant_message: `Email sent to ${rawRecipientEmail}.`,
      actions_taken: actionsTaken
    };
  }

  if (planner.intent === "summarize_emails") {
    const limit = normalizeLimit(args.limit ?? 10, 10);
    const query = asText(args.query || args.search_query);

    const summaryResult = await deps.executeGmailAction({
      action: "SUMMARIZE_EMAILS",
      arguments: {
        limit,
        prompt,
        ...(query ? { query } : {})
      }
    });
    if (!summaryResult.ok) {
      return mapToolExecutionError(summaryResult);
    }

    actionsTaken.push({
      type: "emails_summarized",
      meta: {
        limit,
        query,
        toolSlug: summaryResult.toolSlug
      }
    });

    return {
      status: "completed",
      assistant_message:
        asText(summaryResult.data.summary) ||
        "Summary is ready.",
      actions_taken: actionsTaken
    };
  }

  if (planner.intent === "search_emails") {
    const query = asText(args.query || args.search_query);
    if (!query) {
      return {
        status: "needs_input",
        assistant_message: planner.assistant_message || "Tell me what to search for.",
        required_inputs: [toRequiredInput("search_query")]
      };
    }

    const limit = normalizeLimit(args.limit ?? 10, 10);
    const shouldSummarize =
      args.summarize === true ||
      /\bsummarize\b|\bsummary\b/i.test(prompt);

    if (shouldSummarize) {
      const summarized = await deps.executeGmailAction({
        action: "SUMMARIZE_EMAILS",
        arguments: {
          query,
          limit,
          prompt
        }
      });
      if (!summarized.ok) {
        return mapToolExecutionError(summarized);
      }
      actionsTaken.push({
        type: "emails_searched",
        meta: { query, limit }
      });
      actionsTaken.push({
        type: "emails_summarized",
        meta: { query, limit, toolSlug: summarized.toolSlug }
      });
      return {
        status: "completed",
        assistant_message: asText(summarized.data.summary) || "I summarized the matched emails.",
        actions_taken: actionsTaken
      };
    }

    const searched = await deps.executeGmailAction({
      action: "SEARCH_EMAILS",
      arguments: {
        query,
        limit
      }
    });
    if (!searched.ok) {
      return mapToolExecutionError(searched);
    }

    const count = typeof searched.data.count === "number" ? searched.data.count : 0;
    actionsTaken.push({
      type: "emails_searched",
      meta: { query, limit, count }
    });
    return {
      status: "completed",
      assistant_message: `Found ${count} email(s) for "${query}".`,
      actions_taken: actionsTaken
    };
  }

  if (planner.intent === "read_email") {
    let messageId = asText(args.message_id || args.messageId || args.id);
    const sender = asText(args.sender || args.from || args.recipient_email);
    if (!messageId && sender) {
      const recentFromSender = await deps.executeGmailAction({
        action: "SEARCH_EMAILS",
        arguments: {
          query: `from:${sender}`,
          limit: 1
        }
      });
      if (!recentFromSender.ok) {
        return mapToolExecutionError(recentFromSender);
      }

      const rawEmails = Array.isArray(recentFromSender.data.emails)
        ? recentFromSender.data.emails
        : [];
      const first = asRecord(rawEmails[0]);
      messageId = asText(first.id || first.messageId || first.message_id);
    }

    if (!messageId) {
      return {
        status: "needs_input",
        assistant_message:
          planner.assistant_message || "I need a message ID (or sender) to read the email.",
        required_inputs: [toRequiredInput("message_id")]
      };
    }

    const read = await deps.executeGmailAction({
      action: "READ_EMAIL",
      arguments: {
        messageId
      }
    });
    if (!read.ok) {
      return mapToolExecutionError(read);
    }

    actionsTaken.push({
      type: "email_read",
      meta: {
        messageId,
        toolSlug: read.toolSlug
      }
    });

    const wantsReplyDraft = isLikelyReplyIntent(prompt, args);
    const emailRecord = asRecord(read.data.email);
    if (wantsReplyDraft) {
      const to = asText(emailRecord.from) || sender;
      if (!to || !isValidEmail(to)) {
        return {
          status: "error",
          assistant_message: "I could not infer a valid recipient for the reply draft.",
          error: {
            code: "INVALID_REPLY_RECIPIENT",
            message: "No valid sender email found on the selected message."
          }
        };
      }

      const emailContext = stringifyPreview(read.data.email);
      const replyDraft = await deps.writeEmail({
        prompt: `Draft a reply to this email:\n${emailContext}\n\nUser request: ${prompt}`,
        recipientEmail: to,
        ...(asText(emailRecord.from) ? { recipientName: asText(emailRecord.from) } : {}),
        extraContext: "This is a reply draft. Keep it concise and context-aware."
      });

      return {
        status: "completed",
        assistant_message: "I drafted a reply based on the latest matching email.",
        draft: {
          to,
          subject: asText(replyDraft.subject),
          body: asText(replyDraft.body)
        },
        actions_taken: actionsTaken
      };
    }

    return {
      status: "completed",
      assistant_message: "I read the requested email.",
      actions_taken: actionsTaken
    };
  }

  return {
    status: "error",
    assistant_message:
      planner.assistant_message ||
      "I can currently help with sending, searching, reading, and summarizing Gmail emails.",
    error: {
      code: "UNSUPPORTED_INTENT",
      message: `Unsupported intent: ${planner.intent}`
    }
  };
}
