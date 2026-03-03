import "server-only";

export type GmailPlannerIntent =
  | "send_email"
  | "summarize_emails"
  | "search_emails"
  | "read_email"
  | "unknown";

export interface GmailPlannerOutput {
  intent: GmailPlannerIntent;
  needs: string[];
  args: Record<string, unknown>;
  requires_confirmation: boolean;
  assistant_message: string;
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

function extractJsonObject(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  try {
    return JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    const firstBrace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");
    if (firstBrace < 0 || lastBrace <= firstBrace) {
      return null;
    }
    const sliced = candidate.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(sliced) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

export function buildGmailPlannerPrompt(input: {
  prompt: string;
  providedInput: Record<string, unknown>;
}) {
  const systemPrompt = [
    "You are a Gmail intent planner for a production agent.",
    "Return ONLY valid JSON. No markdown, no prose outside JSON.",
    "Schema:",
    "{",
    '  "intent": "send_email" | "summarize_emails" | "search_emails" | "read_email" | "unknown",',
    '  "needs": string[],',
    '  "args": object,',
    '  "requires_confirmation": boolean,',
    '  "assistant_message": string',
    "}",
    "Rules:",
    "1) Never invent recipient_email.",
    "2) If user wants to send email and recipient email is missing, include recipient_email in needs.",
    "3) If user references a person name without an email for send flow, include recipient_email in needs.",
    "4) For send_email set requires_confirmation=true.",
    "5) Keep assistant_message concise and actionable.",
    "6) Put parsed values in args when available (recipient_email, recipient_name, query, message_id, limit, tone, context)."
  ].join("\n");

  const userPrompt = [
    "User prompt:",
    input.prompt,
    "",
    "Already provided structured input (JSON):",
    JSON.stringify(input.providedInput ?? {}, null, 2),
    "",
    "Return JSON now."
  ].join("\n");

  return { systemPrompt, userPrompt };
}

export function parseGmailPlannerOutput(text: string): GmailPlannerOutput | null {
  const parsed = extractJsonObject(text);
  if (!parsed) {
    return null;
  }

  const intentRaw = asText(parsed.intent).toLowerCase();
  const intent: GmailPlannerIntent =
    intentRaw === "send_email" ||
    intentRaw === "summarize_emails" ||
    intentRaw === "search_emails" ||
    intentRaw === "read_email" ||
    intentRaw === "unknown"
      ? intentRaw
      : "unknown";

  const needs = Array.isArray(parsed.needs)
    ? parsed.needs
        .map((item) => asText(item).toLowerCase())
        .filter(Boolean)
    : [];

  const args = asRecord(parsed.args);
  const requiresConfirmation =
    parsed.requires_confirmation === true || intent === "send_email";
  const assistantMessage =
    asText(parsed.assistant_message) || "I can help with Gmail. Tell me what you want to do.";

  return {
    intent,
    needs: [...new Set(needs)],
    args,
    requires_confirmation: requiresConfirmation,
    assistant_message: assistantMessage
  };
}
