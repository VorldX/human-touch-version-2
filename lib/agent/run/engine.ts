import type { ExecuteAgentToolResult } from "../tools/execute.ts";
import type { GmailPlannerOutput } from "../prompts/gmailPlanner.ts";
import {
  parseStructuredSendFields,
  sanitizeEmailBody,
  sanitizeEmailSubject
} from "./email-request-parser.ts";

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

function parseBooleanEnv(name: string, fallback: boolean) {
  const raw = process.env[name];
  if (typeof raw !== "string") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

const AGENT_RUN_ENABLE_LLM_PLANNER = parseBooleanEnv("AGENT_RUN_ENABLE_LLM_PLANNER", false);
const AGENT_RUN_ENABLE_LLM_WRITER = parseBooleanEnv("AGENT_RUN_ENABLE_LLM_WRITER", false);

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

function isLikelyGmailPrompt(prompt: string, providedInput: Record<string, unknown>) {
  const normalized = prompt.toLowerCase();
  if (/\b(gmail|emails?|mail|inbox|messages?|reply|subject)\b/.test(normalized)) {
    return true;
  }

  const signalFields = [
    "recipient_email",
    "to",
    "subject",
    "body",
    "message_id",
    "search_query",
    "query"
  ];
  return signalFields.some((field) => Object.prototype.hasOwnProperty.call(providedInput, field));
}

function extractMeetingLink(prompt: string) {
  const match = prompt.match(
    /https?:\/\/(?:meet\.google\.com|zoom\.us|teams\.microsoft\.com|calendar\.google\.com)\/[^\s)]+/i
  );
  return match?.[0]?.trim() || "";
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

function summarizePromptForDraftBody(prompt: string) {
  const compact = prompt.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  const stripped = compact
    .replace(/^(?:please\s+|kindly\s+|can\s+you\s+|could\s+you\s+|would\s+you\s+|cn\s*u\s+)+/i, "")
    .replace(/\b(send|compose|draft|write)\b/i, "")
    .replace(/\b(?:an?\s+)?(?:gmail\s+)?(?:email|mail)\b/i, "")
    .replace(/\bto\s+[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, "")
    .replace(/\bsubject\s*[:\-][\s\S]*$/i, "")
    .replace(/\b(?:body|message|content)\s*[:\-][\s\S]*$/i, "")
    .replace(/^[\s,:;\-]+/, "")
    .trim();
  if (!stripped) return "";
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

function inferPlannerFallback(
  prompt: string,
  providedInput: Record<string, unknown>
): GmailPlannerOutput {
  const args: Record<string, unknown> = { ...providedInput };
  const needs = new Set<string>();
  const structuredSend = parseStructuredSendFields(prompt);

  const inferredRecipient =
    asText(providedInput.recipient_email) ||
    asText(providedInput.to) ||
    structuredSend.recipientEmail;
  if (inferredRecipient) {
    args.recipient_email = inferredRecipient;
  }

  const inferredSubject = asText(providedInput.subject) || structuredSend.subject;
  if (inferredSubject) {
    args.subject = inferredSubject;
  }

  const inferredBody = asText(providedInput.body) || structuredSend.body;
  if (inferredBody) {
    args.body = inferredBody;
  }
  const inferredCc = asText(providedInput.cc) || structuredSend.cc;
  if (inferredCc) {
    args.cc = inferredCc;
  }
  const inferredBcc = asText(providedInput.bcc) || structuredSend.bcc;
  if (inferredBcc) {
    args.bcc = inferredBcc;
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
    /\bemail\b[\s\S]*\bto\b/i.test(prompt) ||
    /\b(?:email|mail)\s+[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(prompt);
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
    if (structuredSend.hasStructuredSubject && !asText(args.subject)) {
      needs.add("subject");
    }
    if (structuredSend.hasStructuredBody && !asText(args.body)) {
      needs.add("body");
    }
    const requiresConfirmation = structuredSend.sendMode !== "direct_send";
    return {
      intent: "send_email",
      needs: [...needs],
      args,
      requires_confirmation: requiresConfirmation,
      assistant_message: needs.size > 0
        ? "I need the required email fields before I can send this message."
        : requiresConfirmation
          ? "I drafted the email. Please confirm before sending."
          : "I can send this email directly."
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
  const meetingLink = extractMeetingLink(input.prompt);
  const looksLikeMeetingShare =
    /\b(meeting|invite|invitation|calendar|google meet|zoom|join link)\b/i.test(
      normalizedPrompt
    ) && /\b(send|share|email|mail)\b/i.test(normalizedPrompt);

  let subject = "Quick note";
  if (looksLikeMeetingShare) {
    subject = "Meeting details";
  } else if (/\bcongrat/i.test(normalizedPrompt) && /\bwedding\b/i.test(normalizedPrompt)) {
    subject = "Congratulations on your wedding";
  } else if (/\bcongrat/i.test(normalizedPrompt)) {
    subject = "Congratulations";
  } else if (/\bthank\b/i.test(normalizedPrompt)) {
    subject = "Thank you";
  } else if (/\bmeeting\b/i.test(normalizedPrompt)) {
    subject = "Quick follow-up";
  }

  const summarizedPurpose = summarizePromptForDraftBody(input.prompt);

  const body = [
    `Hi ${recipientLabel},`,
    "",
    looksLikeMeetingShare
      ? "Sharing the meeting details below."
      : summarizedPurpose || `I wanted to reach out to ${input.recipientEmail}.`,
    looksLikeMeetingShare && meetingLink ? `Meeting link: ${meetingLink}` : "",
    looksLikeMeetingShare ? "Please let me know if you need any changes." : "",
    "",
    "Best regards,"
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, body };
}

function buildReplyDraftFallback(input: {
  prompt: string;
  recipientEmail: string;
  originalSubject?: string;
}) {
  const subjectBase = asText(input.originalSubject);
  const subject = subjectBase
    ? /^re:/i.test(subjectBase)
      ? subjectBase
      : `Re: ${subjectBase}`
    : "Re: Quick follow-up";

  const body = [
    "Hi,",
    "",
    "Thanks for your email.",
    "I will get back to you shortly.",
    "",
    `Context: ${input.prompt.slice(0, 220)}`,
    "",
    "Best regards,"
  ].join("\n");

  return {
    to: input.recipientEmail,
    subject,
    body
  };
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
  if (key === "subject") {
    return {
      key,
      label: "Email subject",
      type: "text" as const,
      placeholder: "Project update"
    };
  }
  if (key === "body") {
    return {
      key,
      label: "Email body",
      type: "text" as const,
      placeholder: "Write the message you want to send"
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
  if (!isLikelyGmailPrompt(prompt, providedInput)) {
    return {
      status: "error",
      assistant_message:
        "This endpoint currently handles Gmail send, search, read, and summarize actions.",
      error: {
        code: "UNSUPPORTED_INTENT",
        message: "Prompt does not look like a Gmail workflow request."
      }
    };
  }

  const deterministicPlanner = inferPlannerFallback(prompt, providedInput);
  let planner: GmailPlannerOutput = deterministicPlanner;

  if (AGENT_RUN_ENABLE_LLM_PLANNER && deterministicPlanner.intent === "unknown") {
    try {
      const llmPlanner = await deps.plan({ prompt, providedInput });
      if (
        llmPlanner.intent !== "unknown" ||
        llmPlanner.needs.length > 0 ||
        Object.keys(llmPlanner.args ?? {}).length > 0
      ) {
        planner = llmPlanner;
      }
    } catch {
      planner = deterministicPlanner;
    }
  }

  const args = mergeArgs(planner.args, providedInput);
  const actionsTaken: AgentRunResponse["actions_taken"] = [];

  if (planner.intent === "send_email") {
    const structuredSend = parseStructuredSendFields(prompt);
    let recipientEmail =
      asText(args.recipient_email) ||
      asText(args.to) ||
      structuredSend.recipientEmail ||
      pickEmailFromPrompt(prompt);
    const recipientName = asText(args.recipient_name) || asText(args.name);
    const requiresConfirmation =
      planner.requires_confirmation !== false &&
      structuredSend.sendMode !== "direct_send";

    const missing = new Set<string>(planner.needs);
    if (!recipientEmail) {
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

    if (!isValidEmail(recipientEmail)) {
      return {
        status: "needs_input",
        assistant_message: "Please provide a valid recipient email address.",
        required_inputs: [toRequiredInput("recipient_email")]
      };
    }

    const rawDraft = asRecord(args.draft);
    let subject = asText(rawDraft.subject) || asText(args.subject) || structuredSend.subject;
    let body = asText(rawDraft.body) || asText(args.body) || structuredSend.body;

    const missingStructuredFields = new Set<string>();
    if (structuredSend.hasStructuredSubject && !subject) {
      missingStructuredFields.add("subject");
    }
    if (structuredSend.hasStructuredBody && !body) {
      missingStructuredFields.add("body");
    }
    if (missingStructuredFields.size > 0) {
      return {
        status: "needs_input",
        assistant_message: "Please provide the missing structured email fields before sending.",
        required_inputs: [...missingStructuredFields].map(toRequiredInput)
      };
    }

    const shouldGenerateBody = !body && !structuredSend.hasStructuredSignal;
    if (shouldGenerateBody) {
      if (AGENT_RUN_ENABLE_LLM_WRITER) {
        try {
          const generated = await deps.writeEmail({
            prompt,
            recipientEmail,
            ...(recipientName ? { recipientName } : {}),
            ...(asText(args.context) ? { extraContext: asText(args.context) } : {})
          });
          if (!subject) {
            subject = asText(generated.subject);
          }
          if (!body) {
            body = asText(generated.body);
          }
        } catch {
          // Deterministic fallback below.
        }
      }
      if (!body) {
        const fallbackDraft = buildDraftFallback({
          prompt,
          recipientEmail,
          ...(recipientName ? { recipientName } : {})
        });
        if (!subject) {
          subject = asText(fallbackDraft.subject);
        }
        body = asText(fallbackDraft.body);
      }
    }

    subject = sanitizeEmailSubject(subject);
    if (!subject) {
      subject = "Quick note";
    }
    body = sanitizeEmailBody(body);

    if (!body) {
      return {
        status: "needs_input",
        assistant_message: "Email body is required before sending.",
        required_inputs: [
          ...(!body ? [toRequiredInput("body")] : [])
        ]
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

    if (requiresConfirmation && payload.confirm !== true) {
      return {
        status: "needs_confirmation",
        assistant_message:
          planner.assistant_message || "Please confirm this draft before sending.",
        draft: {
          to: recipientEmail,
          subject,
          body
        },
        actions_taken: [
          {
            type: "draft_created",
            meta: {
              to: recipientEmail,
              subjectLength: subject.length,
              bodyLength: body.length
            }
          }
        ]
      };
    }

    if (payload.confirm === true && requiresConfirmation) {
      const confirmDraftInput = asRecord(providedInput.draft);
      const confirmRecipient =
        asText(providedInput.recipient_email) ||
        asText(providedInput.to) ||
        asText(confirmDraftInput.to);
      const confirmSubjectRaw =
        asText(providedInput.subject) || asText(confirmDraftInput.subject);
      const confirmBodyRaw = asText(providedInput.body) || asText(confirmDraftInput.body);
      const confirmSubject = sanitizeEmailSubject(confirmSubjectRaw);
      const confirmBody = sanitizeEmailBody(confirmBodyRaw);

      if (!confirmRecipient || !confirmSubject || !confirmBody) {
        return {
          status: "needs_confirmation",
          assistant_message:
            "Approval requires reviewing the draft preview first. Please approve the visible draft to send.",
          draft: {
            to: recipientEmail,
            subject,
            body
          },
          actions_taken: [
            {
              type: "draft_created",
              meta: {
                to: recipientEmail,
                subjectLength: subject.length,
                bodyLength: body.length
              }
            }
          ]
        };
      }

      if (!isValidEmail(confirmRecipient)) {
        return {
          status: "needs_input",
          assistant_message: "Please provide a valid recipient email address.",
          required_inputs: [toRequiredInput("recipient_email")]
        };
      }

      recipientEmail = confirmRecipient;
      subject = confirmSubject;
      body = confirmBody;
    }

    if (payload.confirm === true && !requiresConfirmation) {
      const confirmDraftInput = asRecord(providedInput.draft);
      const confirmRecipient =
        asText(providedInput.recipient_email) ||
        asText(providedInput.to) ||
        asText(confirmDraftInput.to);
      const confirmSubjectRaw =
        asText(providedInput.subject) || asText(confirmDraftInput.subject);
      const confirmBodyRaw = asText(providedInput.body) || asText(confirmDraftInput.body);
      const confirmSubject = sanitizeEmailSubject(confirmSubjectRaw);
      const confirmBody = sanitizeEmailBody(confirmBodyRaw);

      if (confirmRecipient && isValidEmail(confirmRecipient)) {
        recipientEmail = confirmRecipient;
      }
      if (confirmSubject) {
        subject = confirmSubject;
      }
      if (confirmBody) {
        body = confirmBody;
      }
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

    const sendResult = await deps.executeGmailAction({
      action: "SEND_EMAIL",
      arguments: {
        to: recipientEmail,
        subject,
        body,
        ...(asText(args.cc) || structuredSend.cc
          ? { cc: asText(args.cc) || structuredSend.cc }
          : {}),
        ...(asText(args.bcc) || structuredSend.bcc
          ? { bcc: asText(args.bcc) || structuredSend.bcc }
          : {})
      }
    });

    if (!sendResult.ok) {
      return mapToolExecutionError(sendResult);
    }

    const sendAction = {
      type: "email_sent",
      meta: {
        to: recipientEmail,
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
      assistant_message: `Email sent to ${recipientEmail}.`,
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

      let replySubject = "";
      let replyBody = "";
      if (AGENT_RUN_ENABLE_LLM_WRITER) {
        try {
          const emailContext = stringifyPreview(read.data.email);
          const replyDraft = await deps.writeEmail({
            prompt: `Draft a reply to this email:\n${emailContext}\n\nUser request: ${prompt}`,
            recipientEmail: to,
            ...(asText(emailRecord.from) ? { recipientName: asText(emailRecord.from) } : {}),
            extraContext: "This is a reply draft. Keep it concise and context-aware."
          });
          replySubject = asText(replyDraft.subject);
          replyBody = asText(replyDraft.body);
        } catch {
          // Deterministic fallback below.
        }
      }

      if (!replySubject || !replyBody) {
        const fallbackReply = buildReplyDraftFallback({
          prompt,
          recipientEmail: to,
          originalSubject: asText(emailRecord.subject)
        });
        replySubject = fallbackReply.subject;
        replyBody = fallbackReply.body;
      }

      return {
        status: "completed",
        assistant_message: "I drafted a reply based on the latest matching email.",
        draft: {
          to,
          subject: replySubject,
          body: replyBody
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
