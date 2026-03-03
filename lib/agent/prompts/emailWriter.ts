import "server-only";

export interface EmailWriterOutput {
  subject: string;
  body: string;
}

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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

export function buildEmailWriterPrompt(input: {
  userPrompt: string;
  recipientEmail: string;
  recipientName?: string;
  extraContext?: string;
}) {
  const systemPrompt = [
    "You draft concise Gmail messages.",
    "Return ONLY valid JSON with this schema:",
    '{ "subject": string, "body": string }',
    "Rules:",
    "1) Keep tone friendly and professional.",
    "2) Subject max 120 chars.",
    "3) Body should be concise and clear.",
    "4) Do not include signatures unless asked."
  ].join("\n");

  const userPrompt = [
    `Original request: ${input.userPrompt}`,
    `Recipient email: ${input.recipientEmail}`,
    `Recipient name: ${input.recipientName?.trim() || "Unknown"}`,
    `Extra context: ${input.extraContext?.trim() || "None"}`,
    "Return JSON now."
  ].join("\n");

  return { systemPrompt, userPrompt };
}

export function parseEmailWriterOutput(text: string): EmailWriterOutput | null {
  const parsed = extractJsonObject(text);
  if (!parsed) {
    return null;
  }

  const subject = asText(parsed.subject);
  const body = asText(parsed.body);
  if (!subject || !body) {
    return null;
  }

  return { subject, body };
}
