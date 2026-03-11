export interface RouterToolBinding {
  toolkit: string;
  slug: string;
  name: string;
  description: string;
}

const DETERMINISTIC_FIRST_TOOLKITS = new Set([
  "gmail",
  "googlemeet",
  "gmeet",
  "zoom",
  "googlecalendar"
]);

function canonicalToolkit(toolkit: string) {
  const normalized = toolkit.trim().toLowerCase();
  if (normalized === "googlemeet" || normalized === "gmeet") {
    return "gmeet";
  }
  return normalized;
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((item) => item.trim())
    .filter((item) => item.length > 1);
}

function tokenOverlapScore(prompt: string, binding: RouterToolBinding) {
  const promptTokens = new Set(tokenize(prompt));
  if (promptTokens.size === 0) {
    return 0;
  }
  const bindingTokens = tokenize(
    `${binding.toolkit} ${binding.slug} ${binding.name} ${binding.description}`
  );
  let score = 0;
  for (const token of bindingTokens) {
    if (promptTokens.has(token)) {
      score += 1;
    }
  }
  if (prompt.toLowerCase().includes(binding.toolkit.toLowerCase())) {
    score += 2;
  }
  return score;
}

export function filterToolCatalogForPrompt(input: {
  prompt: string;
  bindings: RouterToolBinding[];
  maxItems: number;
}) {
  const maxItems = Math.max(1, input.maxItems);
  return [...input.bindings]
    .map((binding) => ({
      binding,
      score: tokenOverlapScore(input.prompt, binding)
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.binding.slug.localeCompare(right.binding.slug);
    })
    .slice(0, maxItems)
    .map((item) => item.binding);
}

export function inferDeterministicHumanInputReason(input: {
  prompt: string;
  requestedToolkits: string[];
}) {
  const normalizedPrompt = input.prompt.toLowerCase();
  const hasGmailToolkit = input.requestedToolkits.includes("gmail");
  const hasWhatsappToolkit = input.requestedToolkits.includes("whatsapp");
  const hasMeetingToolkit = input.requestedToolkits.some((toolkit) =>
    ["googlemeet", "gmeet", "googlecalendar", "zoom"].includes(toolkit)
  );
  const hasMeetingCreateIntent =
    /\b(set up|setup|schedule|book|arrange|create|plan)\b[\s\S]{0,80}\b(meeting|call|invite|invitation|session)\b/i.test(
      normalizedPrompt
    ) ||
    /\b(meeting|call|invite|invitation|session)\b[\s\S]{0,80}\b(set up|setup|schedule|book|arrange|create|plan)\b/i.test(
      normalizedPrompt
    );
  const hasMeetingShareIntent =
    /\b(send|share|mail|email)\b/i.test(normalizedPrompt) &&
    /\b(details?|invite|invitation|link|meeting)\b/i.test(normalizedPrompt);

  if (hasGmailToolkit) {
    const sendIntent =
      /\b(send|compose)\b/.test(normalizedPrompt) &&
      /\b(email|mail|inbox|gmail)\b/.test(normalizedPrompt);
    if (sendIntent) {
      // Composite "create meeting then email details" workflows should continue through planning.
      if (hasMeetingCreateIntent || (hasMeetingShareIntent && hasMeetingToolkit)) {
        return null;
      }

      const hasRecipient = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(input.prompt);
      const hasSubject = /\bsubject\s*[:\-]\s*.+/i.test(input.prompt);
      const hasBody = /\b(body|message|content)\s*[:\-]\s*.+/i.test(input.prompt);
      if (!hasRecipient || !hasSubject || !hasBody) {
        return "Email send requires recipient, subject, and body. Please provide missing fields.";
      }
    }
  }

  if (hasWhatsappToolkit) {
    const sendIntent =
      /\b(send|share|notify|message|text|ping|alert)\b/.test(normalizedPrompt) &&
      /\b(whatsapp|notification|message|text|update)\b/.test(normalizedPrompt);
    if (sendIntent) {
      const hasPhone = /(?:\+?\d[\d\s().-]{7,}\d)/.test(input.prompt);
      const hasBody = /\b(message|body|content|text)\s*[:\-]\s*.+/i.test(input.prompt);
      if (!hasPhone || !hasBody) {
        return "WhatsApp notification requires recipient phone and message content. Please provide missing fields.";
      }
    }
  }

  return null;
}

export function shouldBypassLlmToolRouter(input: {
  prompt: string;
  requestedToolkits: string[];
  candidateBindings: RouterToolBinding[];
}) {
  if (input.candidateBindings.length === 0) {
    return {
      bypass: true,
      reason: "no_candidate_bindings"
    };
  }

  const normalizedToolkits = [
    ...new Set(input.requestedToolkits.map((item) => canonicalToolkit(item)).filter(Boolean))
  ];

  const deterministicOnly =
    normalizedToolkits.length > 0 &&
    normalizedToolkits.every((toolkit) => DETERMINISTIC_FIRST_TOOLKITS.has(toolkit));
  if (!deterministicOnly) {
    return {
      bypass: false,
      reason: "non_deterministic_toolkit_requested"
    };
  }

  const deterministicIntent =
    /\b(gmail|email|mail|inbox|meeting|calendar|zoom|google meet|gmeet|schedule|invite|send|search|read|summarize)\b/i.test(
      input.prompt
    );

  return {
    bypass: deterministicIntent,
    reason: deterministicIntent
      ? "deterministic_common_toolkit_intent"
      : "deterministic_common_toolkit_ambiguous"
  };
}
