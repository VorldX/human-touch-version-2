import {
  fillDraftDetails,
  parseDraftFromResponse,
  type ActiveDraft
} from "../agent/run/email-request-parser.ts";
import {
  generateIntentEmailDraft,
  inferRecipientNameFromMessage,
  inferSenderNameFromMessage,
  isDraftRegenerationRequest,
  isResendRequestMessage
} from "../agent/run/draft-intent.ts";

export function isSimpleGreeting(message: string) {
  const normalized = message.toLowerCase().replace(/[^a-z]/g, "");
  return (
    normalized === "hi" ||
    normalized === "hii" ||
    normalized === "hello" ||
    normalized === "hey"
  );
}

export function isCapabilityOverviewRequest(message: string) {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (
    /^(?:hi|hello|hey|ok|okay|yo|pls|please)?[\s,]*(?:what|how)\s+can\s+(?:you|u)\s+(?:do|help)(?:\s+for\s+me)?\??$/.test(
      normalized
    )
  ) {
    return true;
  }

  if (/^(?:what\s+do\s+you\s+do|what\s+are\s+your\s+capabilities)\??$/.test(normalized)) {
    return true;
  }

  if (
    /^(?:list|show)\s+(?:your\s+)?(?:capability|capabilities|tools)(?:\s+available)?\??$/.test(
      normalized
    )
  ) {
    return true;
  }

  if (
    /^(?:which|what)\s+tools\s+(?:are\s+)?(?:available|connected|can\s+(?:you|u)\s+use)\??$/.test(
      normalized
    )
  ) {
    return true;
  }

  return /\bcapabilities\b/.test(normalized) && normalized.split(/\s+/g).length <= 8;
}

export interface DirectionChatGmailIntent {
  action:
    | "LIST_RECENT_EMAILS"
    | "SEARCH_EMAILS"
    | "SUMMARIZE_EMAILS"
    | "SEND_EMAIL"
    | "DRAFT_EMAIL";
  arguments: Record<string, unknown>;
}

export interface DraftIntentHandlingResult {
  reply: string;
  activeDraft: ActiveDraft;
}

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLimit(value: unknown, fallback = 5) {
  const raw = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(25, Math.max(1, Math.floor(raw)));
}

function cleanExtractedText(value: string) {
  return value
    .trim()
    .replace(/^['"]+|['"]+$/g, "")
    .trim();
}

function extractFirstEmail(message: string) {
  return message.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.trim() ?? "";
}

function extractEmailByLabel(message: string, label: "to" | "cc" | "bcc") {
  return (
    message.match(
      new RegExp(`\\b${label}\\s*[:\\-]?\\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,})`, "i")
    )?.[1] ?? ""
  ).trim();
}

function extractSubjectFromMessage(message: string) {
  const byLabel =
    message.match(/\bsubject\s*[:\-]\s*(.+?)(?=\s+\b(?:body|message|content)\s*[:\-]|$)/i)?.[1] ??
    message.match(/\bsubject\s+(?:is\s+)?["']([^"']+)["']/i)?.[1] ??
    message.match(/\babout\s+["']([^"']+)["']/i)?.[1] ??
    message.match(/\babout\s+(.+?)(?=\s+\b(?:body|message|content|saying|that says)\b|$)/i)?.[1] ??
    "";
  return cleanExtractedText(byLabel);
}

function extractBodyFromMessage(message: string) {
  const byLabel =
    message.match(/\b(?:body|message|content)\s*[:\-]\s*([\s\S]+)$/i)?.[1] ??
    message.match(/\b(?:body|message|content)\s+(?:is\s+)?["']([^"']+)["']/i)?.[1] ??
    message.match(/\b(?:saying|that says|says)\s+["']([^"']+)["']/i)?.[1] ??
    "";
  return cleanExtractedText(byLabel);
}

function extractLimitFromMessage(message: string) {
  const match =
    message.match(/\b(?:last|latest|recent)\s+(\d{1,2})\s+emails?\b/i) ??
    message.match(/\b(\d{1,2})\s+emails?\b/i);
  if (!match?.[1]) {
    return 5;
  }
  const parsed = Number.parseInt(match[1], 10);
  if (!Number.isFinite(parsed)) {
    return 5;
  }
  return normalizeLimit(parsed, 5);
}

function extractSearchQueryFromMessage(message: string) {
  const quoted =
    message.match(/"(.*?)"/)?.[1] ??
    message.match(/'([^']+)'/)?.[1];
  if (quoted && quoted.trim()) {
    return quoted.trim();
  }

  const fromEmail = message.match(/\bfrom\s+([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i)?.[1];
  if (fromEmail) {
    return `from:${fromEmail.trim()}`;
  }

  const searchTail =
    message.match(/\b(?:search|find|lookup)\b[\s\S]*?\b(?:for|about)\b\s*[:\-]?\s*(.+)$/i)?.[1] ??
    message.match(/\b(?:emails?|mail|gmail|inbox)\b[\s\S]*?\babout\b\s*[:\-]?\s*(.+)$/i)?.[1];
  if (searchTail) {
    return searchTail
      .trim()
      .replace(/[.?!]+$/g, "")
      .trim();
  }

  return "";
}

function buildFallbackDraftBody(input: {
  message: string;
  to: string | null;
  explicitBody: string;
  recipientName: string | null;
  senderName: string | null;
  companyName: string | null;
  intentHint: string | null;
}) {
  if (input.explicitBody) {
    return input.explicitBody;
  }

  const generated = generateIntentEmailDraft({
    message: input.message,
    recipientEmail: input.to,
    recipientName: input.recipientName,
    senderName: input.senderName,
    companyName: input.companyName,
    intentHint: input.intentHint
  });
  return generated.body;
}

function draftFromArgs(input: {
  message: string;
  args: Record<string, unknown>;
  activeDraft: ActiveDraft | null;
  turn: number;
}) {
  const resendRequested =
    input.args.resend === true || isResendRequestMessage(input.message);
  const regenerateRequested = isDraftRegenerationRequest(input.message);
  const preferredDraft =
    resendRequested && input.activeDraft?.lastSentDraft
      ? input.activeDraft.lastSentDraft
      : input.activeDraft;

  const toRaw = asText(input.args.to || input.args.recipient_email);
  const subjectRaw = asText(input.args.subject);
  const explicitBody = asText(input.args.body || input.args.content);
  const explicitRecipientName = asText(input.args.recipient_name || input.args.name);
  const explicitSenderName = asText(input.args.sender_name || input.args.sender);
  const inferredRecipientName = inferRecipientNameFromMessage(input.message);
  const inferredSenderName = inferSenderNameFromMessage(input.message);

  const recipientName =
    explicitRecipientName ||
    preferredDraft?.recipientName ||
    inferredRecipientName ||
    null;
  const senderName =
    explicitSenderName ||
    preferredDraft?.senderName ||
    inferredSenderName ||
    null;

  const generatedDraft = generateIntentEmailDraft({
    message: input.message,
    recipientEmail: toRaw || preferredDraft?.to || null,
    recipientName,
    senderName,
    companyName: preferredDraft?.companyName ?? null,
    intentHint:
      (regenerateRequested ? preferredDraft?.intentHint : null) ??
      preferredDraft?.intentHint ??
      null
  });

  const base: ActiveDraft = {
    subject: subjectRaw || generatedDraft.subject || preferredDraft?.subject || "Quick note",
    body:
      explicitBody ||
      buildFallbackDraftBody({
        message: input.message,
        to: toRaw || preferredDraft?.to || null,
        explicitBody,
        recipientName,
        senderName,
        companyName: preferredDraft?.companyName ?? null,
        intentHint: generatedDraft.intentHint
      }),
    to: toRaw || preferredDraft?.to || null,
    recipientName,
    companyName: preferredDraft?.companyName ?? null,
    senderName,
    intentHint: generatedDraft.intentHint,
    lastSentDraft: input.activeDraft?.lastSentDraft ?? null,
    status: "pending_approval",
    producedAtTurn: input.turn
  };

  const withDetails = fillDraftDetails(base, input.message);
  const preview = [
    `To: ${withDetails.to ?? "[recipient email]"}`,
    `Subject: ${withDetails.subject}`,
    "",
    withDetails.body
  ].join("\n");
  const parsed = parseDraftFromResponse(preview);

  return {
    ...withDetails,
    subject: parsed?.subject || withDetails.subject,
    body: parsed?.body || withDetails.body,
    to: parsed?.to ?? withDetails.to,
    senderName: withDetails.senderName ?? null,
    intentHint: withDetails.intentHint ?? generatedDraft.intentHint,
    lastSentDraft: withDetails.lastSentDraft ?? null
  };
}

export function handleDirectionDraftIntent(input: {
  message: string;
  args: Record<string, unknown>;
  activeDraft: ActiveDraft | null;
  turn?: number;
}): DraftIntentHandlingResult {
  const draft = draftFromArgs({
    message: input.message,
    args: input.args,
    activeDraft: input.activeDraft,
    turn: Number.isFinite(input.turn) ? Number(input.turn) : 0
  });

  const reply = [
    "Here is a draft for your email:",
    "",
    `To: ${draft.to ?? "[recipient email]"}`,
    `Subject: ${draft.subject}`,
    "",
    draft.body,
    "",
    "Want me to adjust the tone, length, or any details?"
  ].join("\n");

  return { reply, activeDraft: draft };
}

export function applyDirectionSendArgsFromActiveDraft(input: {
  args: Record<string, unknown>;
  activeDraft: ActiveDraft | null;
}) {
  const merged: Record<string, unknown> = { ...input.args };
  const sourceDraft =
    merged.resend === true && input.activeDraft?.lastSentDraft
      ? input.activeDraft.lastSentDraft
      : input.activeDraft;
  if (sourceDraft) {
    if (!asText(merged.to || merged.recipient_email) && sourceDraft.to) {
      merged.to = sourceDraft.to;
    }
    if (!asText(merged.subject) && sourceDraft.subject) {
      merged.subject = sourceDraft.subject;
    }
    if (!asText(merged.body || merged.content) && sourceDraft.body) {
      merged.body = sourceDraft.body;
    }
  }
  return merged;
}

export function listMissingDirectionSendFields(args: Record<string, unknown>) {
  const to = asText(args.to || args.recipient_email);
  const subject = asText(args.subject);
  const body = asText(args.body || args.content);
  const missing: string[] = [];
  if (!to) missing.push("recipient email");
  if (!subject) missing.push("subject");
  if (!body) missing.push("body");
  return missing;
}

export function inferDirectionChatGmailIntent(message: string): DirectionChatGmailIntent | null {
  const normalized = message.toLowerCase();
  const resendIntent = isResendRequestMessage(message);
  if (resendIntent) {
    return {
      action: "SEND_EMAIL",
      arguments: {
        resend: true
      }
    };
  }
  if (isDraftRegenerationRequest(message)) {
    return {
      action: "DRAFT_EMAIL",
      arguments: {
        regenerate: true
      }
    };
  }

  const hasRecipientEmail = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(message);
  const hasMailboxContext =
    /\b(gmail|email|emails|mail|inbox)\b/i.test(message) ||
    /\b(last|latest|recent)\s+\d{0,2}\s*emails?\b/i.test(message) ||
    hasRecipientEmail;
  if (!hasMailboxContext) {
    return null;
  }

  const draftIntent =
    /\b(draft|write|compose|create|make|generate)\b/.test(normalized) &&
    /\b(email|mail|gmail)\b/.test(normalized) &&
    !/\b(send|submit|deliver)\b/.test(normalized);
  if (draftIntent) {
    const to = extractEmailByLabel(message, "to") || extractFirstEmail(message);
    const subject = extractSubjectFromMessage(message);
    const body = extractBodyFromMessage(message);
    const cc = extractEmailByLabel(message, "cc");
    const bcc = extractEmailByLabel(message, "bcc");
    const recipientName = inferRecipientNameFromMessage(message);
    const senderName = inferSenderNameFromMessage(message);
    const args: Record<string, unknown> = {};
    if (to) args.to = to;
    if (subject) args.subject = subject;
    if (body) args.body = body;
    if (cc) args.cc = cc;
    if (bcc) args.bcc = bcc;
    if (recipientName) args.recipient_name = recipientName;
    if (senderName) args.sender_name = senderName;
    return {
      action: "DRAFT_EMAIL",
      arguments: args
    };
  }

  const sendIntent =
    /\b(send|submit|deliver)\b/.test(normalized) &&
    (/\b(email|mail|gmail)\b/.test(normalized) || hasRecipientEmail);
  if (sendIntent) {
    const to = extractEmailByLabel(message, "to") || extractFirstEmail(message);
    const subject = extractSubjectFromMessage(message);
    const body = extractBodyFromMessage(message);
    const cc = extractEmailByLabel(message, "cc");
    const bcc = extractEmailByLabel(message, "bcc");
    const recipientName = inferRecipientNameFromMessage(message);
    const senderName = inferSenderNameFromMessage(message);
    const args: Record<string, unknown> = {};
    if (to) args.to = to;
    if (subject) args.subject = subject;
    if (body) args.body = body;
    if (cc) args.cc = cc;
    if (bcc) args.bcc = bcc;
    if (recipientName) args.recipient_name = recipientName;
    if (senderName) args.sender_name = senderName;
    return {
      action: "SEND_EMAIL",
      arguments: args
    };
  }

  const limit = extractLimitFromMessage(message);
  const query = extractSearchQueryFromMessage(message);
  const summarizeIntent =
    /\b(summarize|summary|summarise)\b/.test(normalized) &&
    /\b(email|emails|mail|gmail|inbox)\b/.test(normalized);
  if (summarizeIntent) {
    const args: Record<string, unknown> = { limit };
    if (query) {
      args.query = query;
    }
    return {
      action: "SUMMARIZE_EMAILS",
      arguments: args
    };
  }

  const searchIntent =
    /\b(search|find|lookup)\b/.test(normalized) ||
    /\bfrom\s+[^\s]+\b/.test(normalized);
  if (searchIntent && query) {
    return {
      action: "SEARCH_EMAILS",
      arguments: {
        query,
        limit
      }
    };
  }

  const listIntent =
    /\b(list|show|check|read|open|latest|recent|last)\b/.test(normalized) ||
    /\b(emails?|inbox)\b/.test(normalized);
  if (listIntent) {
    return {
      action: "LIST_RECENT_EMAILS",
      arguments: {
        limit
      }
    };
  }

  return null;
}
