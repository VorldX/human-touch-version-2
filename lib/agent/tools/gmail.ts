import "server-only";

import {
  ComposioServiceError,
  executeToolAction,
  getToolsForAgent
} from "@/lib/integrations/composio/service";

export interface GmailEmailRecord {
  id: string;
  threadId: string | null;
  from: string | null;
  to: string | null;
  subject: string | null;
  snippet: string | null;
  bodyText: string | null;
  receivedAt: string | null;
  raw: Record<string, unknown>;
}

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asObjectArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => item);
}

function normalizeLimit(value: unknown, fallback = 10) {
  const raw = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(25, Math.max(1, Math.floor(raw)));
}

function dedupeSlugs(slugs: string[]) {
  return [...new Set(slugs.map((item) => item.trim().toUpperCase()).filter(Boolean))];
}

function pickByCandidates(available: Set<string>, candidates: string[], fallback: string) {
  for (const candidate of candidates) {
    if (available.has(candidate)) {
      return candidate;
    }
  }
  return fallback;
}

function pickReadSlug(available: Set<string>) {
  const explicitCandidates = [
    "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
    "GMAIL_GET_MESSAGE_BY_ID",
    "GMAIL_GET_EMAIL_BY_ID",
    "GMAIL_FETCH_EMAIL_BY_ID",
    "GMAIL_GET_MESSAGE",
    "GMAIL_FETCH_MESSAGE"
  ];
  for (const candidate of explicitCandidates) {
    if (available.has(candidate)) {
      return candidate;
    }
  }

  for (const slug of available) {
    if (
      slug.includes("MESSAGE") &&
      (slug.includes("GET") || slug.includes("FETCH")) &&
      !slug.includes("MESSAGES")
    ) {
      return slug;
    }
  }

  for (const slug of available) {
    if (
      slug.includes("EMAIL") &&
      (slug.includes("GET") || slug.includes("FETCH")) &&
      !slug.includes("EMAILS")
    ) {
      return slug;
    }
  }

  return "";
}

async function resolveGmailTools(input: {
  userId: string;
  orgId: string;
  action: string;
}) {
  const toolsForAgent = await getToolsForAgent({
    userId: input.userId,
    orgId: input.orgId,
    requestedToolkits: ["gmail"],
    action: input.action
  });

  if (!toolsForAgent.ok) {
    throw new ComposioServiceError("Gmail integration is not connected.", {
      code: "INTEGRATION_NOT_CONNECTED",
      status: 409
    });
  }

  const slugs = dedupeSlugs(
    toolsForAgent.bindings
      .filter((item) => item.toolkit === "gmail")
      .map((item) => item.slug)
  );
  const available = new Set(slugs);

  return {
    listSlug: pickByCandidates(available, ["GMAIL_FETCH_EMAILS"], "GMAIL_FETCH_EMAILS"),
    sendSlug: pickByCandidates(available, ["GMAIL_SEND_EMAIL"], "GMAIL_SEND_EMAIL"),
    readSlug: pickReadSlug(available)
  };
}

function collectCandidates(value: unknown, out: Record<string, unknown>[], depth = 0) {
  if (depth > 4 || value === null || value === undefined) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectCandidates(item, out, depth + 1);
    }
    return;
  }
  if (typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;
  out.push(record);
  for (const key of ["emails", "messages", "items", "results", "data", "threads"]) {
    collectCandidates(record[key], out, depth + 1);
  }
}

function normalizeEmailRecord(input: Record<string, unknown>): GmailEmailRecord | null {
  const id =
    asText(input.id) ||
    asText(input.messageId) ||
    asText(input.message_id) ||
    asText(input.gmailMessageId);
  if (!id) {
    return null;
  }

  return {
    id,
    threadId: asText(input.threadId) || asText(input.thread_id) || null,
    from:
      asText(input.from) ||
      asText(input.sender) ||
      asText(input.fromAddress) ||
      asText(input.from_email) ||
      null,
    to: asText(input.to) || asText(input.toAddress) || asText(input.to_email) || null,
    subject: asText(input.subject) || asText(input.title) || null,
    snippet: asText(input.snippet) || asText(input.preview) || asText(input.bodyPreview) || null,
    bodyText:
      asText(input.bodyText) ||
      asText(input.body_text) ||
      asText(input.body) ||
      asText(input.text) ||
      asText(input.content) ||
      null,
    receivedAt:
      asText(input.internalDate) ||
      asText(input.date) ||
      asText(input.receivedAt) ||
      asText(input.timestamp) ||
      null,
    raw: input
  };
}

export function extractGmailEmailRecords(data: Record<string, unknown>) {
  const candidates: Record<string, unknown>[] = [];
  collectCandidates(data, candidates);

  const normalized = candidates.map(normalizeEmailRecord).filter((item): item is GmailEmailRecord => Boolean(item));
  const seen = new Set<string>();
  const result: GmailEmailRecord[] = [];
  for (const item of normalized) {
    const dedupeKey = `${item.id}:${item.subject ?? ""}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    result.push(item);
  }
  return result;
}

function pickMatchingMessage(records: GmailEmailRecord[], messageId: string) {
  const normalizedId = messageId.trim().toLowerCase();
  if (!normalizedId) return null;

  const exact = records.find((item) => item.id.toLowerCase() === normalizedId);
  if (exact) return exact;

  return (
    records.find((item) => item.id.toLowerCase().includes(normalizedId)) ??
    null
  );
}

export async function listRecentEmails(input: {
  userId: string;
  orgId: string;
  max?: number;
  query?: string;
}) {
  const tools = await resolveGmailTools({
    userId: input.userId,
    orgId: input.orgId,
    action: "LIST_RECENT_EMAILS"
  });

  const maxResults = normalizeLimit(input.max ?? 10, 10);
  const query = asText(input.query);

  const result = await executeToolAction({
    userId: input.userId,
    orgId: input.orgId,
    toolkit: "gmail",
    toolSlug: tools.listSlug,
    action: "LIST_RECENT_EMAILS",
    arguments: {
      maxResults,
      max_results: maxResults,
      limit: maxResults,
      ...(query ? { query } : {})
    }
  });

  return {
    toolSlug: tools.listSlug,
    data: result.data,
    logId: result.logId,
    emails: extractGmailEmailRecords(result.data)
  };
}

export async function searchEmails(input: {
  userId: string;
  orgId: string;
  query: string;
  max?: number;
}) {
  return listRecentEmails({
    userId: input.userId,
    orgId: input.orgId,
    query: input.query,
    max: input.max ?? 10
  });
}

export async function readEmail(input: {
  userId: string;
  orgId: string;
  messageId: string;
}) {
  const messageId = asText(input.messageId);
  if (!messageId) {
    throw new ComposioServiceError("messageId is required.", {
      code: "INVALID_TOOL_ACTION",
      status: 400
    });
  }

  const tools = await resolveGmailTools({
    userId: input.userId,
    orgId: input.orgId,
    action: "READ_EMAIL"
  });

  if (tools.readSlug) {
    const result = await executeToolAction({
      userId: input.userId,
      orgId: input.orgId,
      toolkit: "gmail",
      toolSlug: tools.readSlug,
      action: "READ_EMAIL",
      arguments: {
        id: messageId,
        messageId,
        message_id: messageId
      }
    });

    const records = extractGmailEmailRecords(result.data);
    const email = pickMatchingMessage(records, messageId) ?? records[0] ?? null;
    return {
      toolSlug: tools.readSlug,
      data: result.data,
      logId: result.logId,
      email
    };
  }

  const fallback = await listRecentEmails({
    userId: input.userId,
    orgId: input.orgId,
    query: messageId,
    max: 10
  });
  return {
    toolSlug: fallback.toolSlug,
    data: fallback.data,
    logId: fallback.logId,
    email: pickMatchingMessage(fallback.emails, messageId)
  };
}

export async function sendEmail(input: {
  userId: string;
  orgId: string;
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
}) {
  const tools = await resolveGmailTools({
    userId: input.userId,
    orgId: input.orgId,
    action: "SEND_EMAIL"
  });

  const to = asText(input.to);
  const subject = asText(input.subject);
  const body = asText(input.body);
  const cc = asText(input.cc);
  const bcc = asText(input.bcc);

  if (!to || !subject || !body) {
    throw new ComposioServiceError("to, subject and body are required.", {
      code: "INVALID_TOOL_ACTION",
      status: 400
    });
  }

  const result = await executeToolAction({
    userId: input.userId,
    orgId: input.orgId,
    toolkit: "gmail",
    toolSlug: tools.sendSlug,
    action: "SEND_EMAIL",
    arguments: {
      to,
      recipient: to,
      recipients: [to],
      subject,
      body,
      content: body,
      ...(cc ? { cc } : {}),
      ...(bcc ? { bcc } : {})
    }
  });

  return {
    toolSlug: tools.sendSlug,
    data: result.data,
    logId: result.logId
  };
}

export function normalizeEmailList(value: unknown) {
  return asObjectArray(value);
}
