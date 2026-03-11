export interface ParsedMeetingIntent {
  isMeetingRelated: boolean;
  wantsCreate: boolean;
  wantsShareDetails: boolean;
  wantsNotification: boolean;
  recipientEmail: string;
  recipientPhone: string;
  topic: string;
  durationMinutes: number | null;
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractFirstEmail(value: string) {
  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0]?.trim() ?? "";
}

export function extractFirstPhoneNumber(value: string) {
  const labeled =
    extractLabeledValue(value, [
      "phone",
      "phone number",
      "mobile",
      "whatsapp",
      "whatsapp number",
      "number"
    ]) || "";
  const inline = value.match(/(?:\+?\d[\d\s().-]{7,}\d)/)?.[0] ?? "";
  const candidate = (labeled || inline).trim();
  if (!candidate) {
    return "";
  }

  const normalized = candidate.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  const digits = normalized.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) {
    return "";
  }
  return normalized.startsWith("+") ? `+${digits}` : digits;
}

export function extractLabeledValue(prompt: string, labels: string[]) {
  const labelsPattern = labels.map((label) => escapeRegex(label)).join("|");
  const pattern = new RegExp(
    `(?:\\*{1,2})?(?:${labelsPattern})(?:\\*{1,2})?\\s*[:\\-]\\s*(.+)`,
    "i"
  );
  const line = prompt
    .split(/\r?\n/g)
    .map((item) => item.trim())
    .find((item) => pattern.test(item));
  if (!line) {
    return "";
  }

  const match = line.match(pattern);
  if (!match?.[1]) {
    return "";
  }

  return match[1].trim().replace(/^["'`]+|["'`]+$/g, "").trim();
}

export function extractDurationMinutes(prompt: string) {
  const labeled = extractLabeledValue(prompt, ["duration", "length"]);
  const candidate = labeled || prompt;
  const match = candidate.match(/(\d{1,3})\s*(minutes?|mins?|hours?|hrs?)/i);
  if (!match?.[1]) {
    return null;
  }

  const amount = Number.parseInt(match[1], 10);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const unit = (match[2] ?? "").toLowerCase();
  if (unit.startsWith("hour") || unit.startsWith("hr")) {
    return Math.min(8 * 60, amount * 60);
  }
  return Math.min(24 * 60, amount);
}

export function parseMeetingIntent(prompt: string): ParsedMeetingIntent {
  const normalized = prompt.toLowerCase();
  const mentionsMeeting = /\b(meet|meeting|calendar|invite|invitation|zoom|gmeet|google meet)\b/.test(
    normalized
  );
  const wantsCreate = /\b(create|schedule|set up|setup|book|arrange|plan|add)\b/.test(normalized);
  const wantsShare = /\b(send|share|mail|email)\b/.test(normalized);
  const wantsDetails = /\b(details?|invite|invitation|link|meeting code)\b/.test(normalized);
  const wantsNotification =
    /\b(send|share|notify|notification|message|text|ping|alert)\b/.test(normalized) &&
    /\b(whatsapp|notification|message|text|update)\b/.test(normalized);
  const recipientEmail =
    extractFirstEmail(prompt) || extractLabeledValue(prompt, ["recipient", "to"]);
  const recipientPhone = extractFirstPhoneNumber(prompt);
  const topic =
    extractLabeledValue(prompt, ["topic", "title", "subject"]) ||
    cleanText(prompt.replace(/\s+/g, " ").trim().slice(0, 120));
  const durationMinutes = extractDurationMinutes(prompt);

  return {
    isMeetingRelated: mentionsMeeting,
    wantsCreate: mentionsMeeting && wantsCreate,
    wantsShareDetails: mentionsMeeting && wantsShare && wantsDetails,
    wantsNotification: mentionsMeeting && wantsNotification,
    recipientEmail,
    recipientPhone,
    topic,
    durationMinutes
  };
}

export function shouldSendMeetingDetailsEmail(prompt: string) {
  const parsed = parseMeetingIntent(prompt);
  return parsed.wantsShareDetails;
}

export function shouldSendMeetingNotification(prompt: string) {
  const parsed = parseMeetingIntent(prompt);
  return parsed.wantsNotification;
}

export function buildMeetingDetailsEmailTemplate(input: {
  recipient: string;
  meetingUri: string;
  meetingCode?: string;
  meetingTopic?: string;
  durationMinutes?: number | null;
  prompt: string;
}) {
  const safeCode = cleanText(input.meetingCode);
  const safeTopic = cleanText(input.meetingTopic);
  const durationLine =
    typeof input.durationMinutes === "number" && Number.isFinite(input.durationMinutes)
      ? `${Math.max(1, Math.floor(input.durationMinutes))} minutes`
      : "";
  const subjectBase = safeTopic ? `Meeting details: ${safeTopic}` : "Meeting details";
  const subject = safeCode ? `${subjectBase} (${safeCode})` : subjectBase;

  const body = [
    "Hello,",
    "",
    "Your meeting is confirmed.",
    safeTopic ? `Topic: ${safeTopic}` : "",
    `Meeting link: ${input.meetingUri}`,
    safeCode ? `Meeting code: ${safeCode}` : "",
    durationLine ? `Duration: ${durationLine}` : "",
    "",
    "Request context:",
    cleanText(input.prompt).slice(0, 320),
    "",
    "Regards,",
    "VorldX Agent"
  ]
    .filter(Boolean)
    .join("\n");

  return {
    to: input.recipient,
    recipient_email: input.recipient,
    subject,
    body
  };
}

export function buildMeetingNotificationTemplate(input: {
  recipientPhone: string;
  meetingUri: string;
  meetingCode?: string;
  meetingTopic?: string;
  durationMinutes?: number | null;
  prompt: string;
}) {
  const safeCode = cleanText(input.meetingCode);
  const safeTopic = cleanText(input.meetingTopic);
  const durationLine =
    typeof input.durationMinutes === "number" && Number.isFinite(input.durationMinutes)
      ? `${Math.max(1, Math.floor(input.durationMinutes))} min`
      : "";

  const message = [
    "Meeting confirmed.",
    safeTopic ? `Topic: ${safeTopic}.` : "",
    `Link: ${input.meetingUri}`,
    safeCode ? `Code: ${safeCode}.` : "",
    durationLine ? `Duration: ${durationLine}.` : "",
    `Context: ${cleanText(input.prompt).slice(0, 140)}`
  ]
    .filter(Boolean)
    .join(" ");

  return {
    to: input.recipientPhone,
    phone_number: input.recipientPhone,
    recipient_phone: input.recipientPhone,
    message,
    text: message,
    body: message
  };
}
