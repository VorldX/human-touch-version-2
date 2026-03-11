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
  action: "LIST_RECENT_EMAILS" | "SEARCH_EMAILS" | "SUMMARIZE_EMAILS" | "SEND_EMAIL";
  arguments: Record<string, unknown>;
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

export function inferDirectionChatGmailIntent(message: string): DirectionChatGmailIntent | null {
  const normalized = message.toLowerCase();
  const hasMailboxContext =
    /\b(gmail|email|emails|mail|inbox)\b/i.test(message) ||
    /\b(last|latest|recent)\s+\d{0,2}\s*emails?\b/i.test(message);
  if (!hasMailboxContext) {
    return null;
  }

  const sendIntent =
    /\b(send|compose|draft|write)\b/.test(normalized) &&
    /\b(email|mail|gmail)\b/.test(normalized);
  if (sendIntent) {
    const to = extractEmailByLabel(message, "to") || extractFirstEmail(message);
    const subject = extractSubjectFromMessage(message);
    const body = extractBodyFromMessage(message);
    const cc = extractEmailByLabel(message, "cc");
    const bcc = extractEmailByLabel(message, "bcc");
    const args: Record<string, unknown> = {};
    if (to) args.to = to;
    if (subject) args.subject = subject;
    if (body) args.body = body;
    if (cc) args.cc = cc;
    if (bcc) args.bcc = bcc;
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
