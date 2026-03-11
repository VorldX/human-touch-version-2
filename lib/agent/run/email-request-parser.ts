export type EmailSendMode = "approval_required" | "direct_send" | "draft_only";

export interface StructuredSendFields {
  recipientEmail: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  sendMode: EmailSendMode;
  hasStructuredSubject: boolean;
  hasStructuredBody: boolean;
  hasStructuredSignal: boolean;
  inferredInformalBody: boolean;
}

export type EmailDraftReplyIntent = "approve" | "cancel" | "edit";

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const COMMAND_PREFIX_PATTERN =
  /^(?:please\s+|kindly\s+|pls\s+|plz\s+|can\s+you\s+|could\s+you\s+|would\s+you\s+|will\s+you\s+|cn\s*u\s+|can\s*u\s+)+/i;
const SEND_COMMAND_PATTERN =
  /^(?:send|compose|draft|write|mail|email)(?:\s+(?:an?|the))?(?:\s+(?:email|mail))?/i;

function cleanExtractedText(value: string) {
  return value
    .trim()
    .replace(/^['"`]+|['"`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePrompt(prompt: string) {
  return prompt.replace(/\r\n/g, "\n").trim();
}

function uniqueEmails(value: string) {
  const seen = new Set<string>();
  const matches = value.match(EMAIL_PATTERN) ?? [];
  for (const email of matches) {
    seen.add(email.toLowerCase());
  }
  return [...seen];
}

function extractAddressGroup(prompt: string, key: "cc" | "bcc") {
  const match = prompt.match(
    new RegExp(
      `\\b${key}\\s*[:\\-]?\\s*([\\s\\S]+?)(?=\\s+\\b(?:to|cc|bcc|subject|body|message|content)\\b\\s*[:\\-]?|$)`,
      "i"
    )
  );
  if (!match?.[1]) {
    return "";
  }
  const emails = uniqueEmails(match[1]);
  return emails.join(", ");
}

function extractRecipient(prompt: string, excludedEmails: Set<string>) {
  const patterns = [
    /\bto\s*[:\-]?\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i,
    /\bsend(?:\s+(?:an?|the))?(?:\s+(?:email|mail))?\s+to\s*[:\-]?\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i,
    /\b(?:email|mail)\s+([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i
  ];

  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    const email = match?.[1]?.trim().toLowerCase() ?? "";
    if (email && !excludedEmails.has(email)) {
      return email;
    }
  }

  const fallback = uniqueEmails(prompt).find((email) => !excludedEmails.has(email));
  return fallback ?? "";
}

function detectSendMode(prompt: string): EmailSendMode {
  if (/\b(send now|send immediately|send directly|without approval|no approval|direct send)\b/i.test(prompt)) {
    return "direct_send";
  }
  if (
    /\b(draft|preview)\b[\s\S]*\b(email|mail)\b/i.test(prompt) ||
    /\b(approval required|for approval|do not send|don't send|dont send|just draft)\b/i.test(prompt)
  ) {
    return "draft_only";
  }
  return "approval_required";
}

function cutAtFieldBoundary(value: string) {
  return value
    .replace(
      /\s+\b(?:cc|bcc|subject|body|message|content)\b\s*[:\-]?[\s\S]*$/i,
      ""
    )
    .trim();
}

function extractSubject(prompt: string) {
  const colonMatch =
    prompt.match(
      /\bsubject\s*[:\-]\s*([\s\S]+?)(?=\s+\b(?:body|message|content|cc|bcc)\b\s*[:\-]?|$)/i
    )?.[1] ?? "";
  if (colonMatch) {
    const firstLine = colonMatch.split(/\r?\n/, 1)[0] ?? "";
    return cleanExtractedText(cutAtFieldBoundary(firstLine));
  }

  const inlineMatch =
    prompt.match(/\bsubject\s+([^\n\r]+?)(?=\s+\b(?:body|message|content|cc|bcc)\b|$)/i)?.[1] ??
    "";
  return cleanExtractedText(cutAtFieldBoundary(inlineMatch));
}

function stripCommandPhrases(value: string) {
  return value
    .replace(COMMAND_PREFIX_PATTERN, "")
    .replace(SEND_COMMAND_PATTERN, "")
    .replace(/\b(?:an?|the)\s+(?:email|mail)\b/i, "")
    .replace(/\bto\s+[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, "")
    .replace(/^[\s,.;:-]+/, "")
    .trim();
}

function normalizeInformalMessage(value: string) {
  let text = cleanExtractedText(value);
  if (!text) return "";
  text = stripCommandPhrases(text);
  text = text
    .replace(/\bthat he is\b/i, "that you are")
    .replace(/\bthat she is\b/i, "that you are")
    .replace(/\bhe is\b/i, "you are")
    .replace(/\bshe is\b/i, "you are")
    .replace(/^that\s+/i, "")
    .trim();
  if (!text) return "";
  if (!/[.!?]$/.test(text)) {
    text = `${text}.`;
  }
  return text;
}

function formatInformalBody(rawContent: string) {
  const message = normalizeInformalMessage(rawContent);
  if (!message) {
    return "";
  }

  const startsWithPronoun = /^(?:you|he|she|they|i)\b/i.test(message);
  const sentence = startsWithPronoun
    ? `Just wanted to let you know that ${message.charAt(0).toLowerCase()}${message.slice(1)}`
    : `${message.charAt(0).toUpperCase()}${message.slice(1)}`;

  return ["Hi,", "", sentence, "", "Best regards,"].join("\n");
}

function extractExplicitBody(prompt: string) {
  const withDelimiter =
    prompt.match(
      /\b(?:body|message|content)\s*[:\-]\s*([\s\S]+?)(?=\s+\b(?:cc|bcc)\b\s*[:\-]?|$)/i
    )?.[1] ?? "";
  if (withDelimiter) {
    return cleanExtractedText(withDelimiter);
  }

  const withQuotes =
    prompt.match(/\b(?:body|message|content)\s+(?:is\s+)?["']([\s\S]+?)["']/i)?.[1] ?? "";
  if (withQuotes) {
    return cleanExtractedText(withQuotes);
  }

  const inline =
    prompt.match(/\bbody\s+([^\n\r]+?)(?=\s+\b(?:cc|bcc)\b\s*[:\-]?|$)/i)?.[1] ??
    "";
  return cleanExtractedText(cutAtFieldBoundary(inline));
}

function extractAdditionalEdits(prompt: string) {
  const edits =
    prompt.match(/\badditional edits from user\s*:\s*([\s\S]+)$/i)?.[1] ??
    prompt.match(/\bedits?\s*:\s*([\s\S]+)$/i)?.[1] ??
    "";
  return cleanExtractedText(edits);
}

function extractInformalBody(prompt: string, recipientEmail: string) {
  const edits = extractAdditionalEdits(prompt);
  if (edits) {
    return edits;
  }

  let tail = prompt;
  if (recipientEmail) {
    const recipientIndex = prompt.toLowerCase().indexOf(recipientEmail.toLowerCase());
    if (recipientIndex >= 0) {
      tail = prompt.slice(recipientIndex + recipientEmail.length);
    }
  }

  tail = tail.replace(/^[\s,.;:-]+/, "");
  if (!tail) {
    return "";
  }

  const candidates = [
    tail.match(
      /^(?:that|saying|saying that|to say|and tell (?:him|her|them)(?: that)?|tell (?:him|her|them)(?: that)?)\s+([\s\S]+)$/i
    )?.[1] ?? "",
    tail.match(
      /\b(?:that|saying|to say|tell (?:him|her|them)(?: that)?)\s+([\s\S]+)$/i
    )?.[1] ?? ""
  ];

  for (const candidate of candidates) {
    const cleaned = cleanExtractedText(cutAtFieldBoundary(candidate));
    if (cleaned) {
      return cleaned;
    }
  }

  const trimmedTail = cleanExtractedText(cutAtFieldBoundary(tail));
  if (!trimmedTail) {
    return "";
  }
  if (/\b(?:subject|body|message|content)\s*[:\-]/i.test(trimmedTail)) {
    return "";
  }
  return trimmedTail;
}

function hasStructuredSubjectMarker(prompt: string) {
  return /\bsubject\s*[:\-]/i.test(prompt) || /\bsubject\s+.+\b(?:body|message|content)\b/i.test(prompt);
}

function hasStructuredBodyMarker(prompt: string) {
  return (
    /\b(?:body|message|content)\s*[:\-]/i.test(prompt) ||
    /\b(?:body|message|content)\s+["']/i.test(prompt) ||
    /\bbody\s+\S+/i.test(prompt)
  );
}

function isLikelyCommandText(value: string) {
  return (
    /^(?:please\s+|kindly\s+|can\s+you\s+|could\s+you\s+|would\s+you\s+|cn\s*u\s+)?(?:send|compose|draft|write|mail|email)\b/i.test(
      value
    ) ||
    /\b(?:send email to|send mail to|mail to|email to)\b/i.test(value)
  );
}

export function parseStructuredSendFields(prompt: string): StructuredSendFields {
  const normalizedPrompt = normalizePrompt(prompt);
  const cc = extractAddressGroup(normalizedPrompt, "cc");
  const bcc = extractAddressGroup(normalizedPrompt, "bcc");
  const excluded = new Set([
    ...uniqueEmails(cc),
    ...uniqueEmails(bcc)
  ]);
  const recipientEmail = extractRecipient(normalizedPrompt, excluded);

  const hasStructuredSubject = hasStructuredSubjectMarker(normalizedPrompt);
  const hasStructuredBody = hasStructuredBodyMarker(normalizedPrompt);
  const hasStructuredSignal =
    hasStructuredSubject ||
    hasStructuredBody ||
    /\b(?:to|cc|bcc)\s*[:\-]/i.test(normalizedPrompt);

  const explicitSubject = extractSubject(normalizedPrompt);
  const explicitBody = extractExplicitBody(normalizedPrompt);
  const informalBody = explicitBody ? "" : extractInformalBody(normalizedPrompt, recipientEmail);
  const inferredInformalBody = Boolean(informalBody) && !hasStructuredBody;

  const subject = explicitSubject || (explicitBody || informalBody ? "Quick note" : "");
  const body = explicitBody || (informalBody ? formatInformalBody(informalBody) : "");

  return {
    recipientEmail,
    cc,
    bcc,
    subject,
    body,
    sendMode: detectSendMode(normalizedPrompt),
    hasStructuredSubject,
    hasStructuredBody,
    hasStructuredSignal,
    inferredInformalBody
  };
}

export function sanitizeEmailSubject(value: string) {
  const normalized = normalizePrompt(value);
  if (!normalized) {
    return "";
  }

  const reparsed = parseStructuredSendFields(normalized);
  if (reparsed.hasStructuredSubject && reparsed.subject) {
    return reparsed.subject;
  }

  const cleaned = cleanExtractedText(normalized.replace(/^subject\s*[:\-]?\s*/i, ""));
  if (!cleaned || isLikelyCommandText(cleaned)) {
    return "";
  }
  return cleaned;
}

export function sanitizeEmailBody(value: string) {
  let normalized = normalizePrompt(value);
  if (!normalized) {
    return "";
  }

  const reparsed = parseStructuredSendFields(normalized);
  if (reparsed.hasStructuredBody && reparsed.body) {
    normalized = reparsed.body;
  }

  const approvalLeakPatterns = [
    /^draft email \(approval required\)$/i,
    /^i drafted the email\. please confirm before sending\.?$/i,
    /^reply ["']?approve["']? to send this email, or reply with edits\.?$/i,
    /^to\s*:/i,
    /^subject\s*:/i
  ];

  normalized = normalized
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      return approvalLeakPatterns.every((pattern) => !pattern.test(trimmed));
    })
    .join("\n")
    .trim();

  if (!normalized) {
    return "";
  }

  const cleaned = stripCommandPhrases(normalized);
  if (!cleaned) {
    return "";
  }
  if (isLikelyCommandText(cleaned)) {
    return "";
  }
  return cleaned;
}

export function classifyEmailDraftReply(value: string): EmailDraftReplyIntent {
  const normalized = value.trim().toLowerCase();
  if (
    /^(approve|approved|confirm|confirmed|yes|send|send it|go ahead|ok send|okay send|looks good send|proceed)$/i.test(
      normalized
    )
  ) {
    return "approve";
  }
  if (/\b(reject|cancel|dont send|don't send|stop|discard|abort)\b/i.test(normalized)) {
    return "cancel";
  }
  return "edit";
}
