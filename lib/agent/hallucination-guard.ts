interface InferredToolAction {
  toolkit: string;
  action: string;
}

interface ToolExecutionResult {
  ok: boolean;
  error?: {
    message?: string;
    toolkit?: string;
    action?: string;
  };
}

interface HallucinationGuardInput {
  outputText: string;
  requestedToolkits: string[];
  inferredToolAction: InferredToolAction | null;
  toolActionExecution: ToolExecutionResult | null;
}

const EXTERNAL_SUCCESS_PATTERN =
  /\b(?:i|we|agent|system)\s+(?:(?:have|has|had)\s+)?(?:just\s+|successfully\s+)?(?:sent|emailed|created|scheduled|booked|posted|updated|deleted|removed|connected|synced|executed|launched|submitted|completed)\b|\b(?:has been|was)\s+(?:sent|created|scheduled|booked|posted|updated|deleted|removed|submitted|completed)\b|\b(?:sent|emailed|created|scheduled|booked|posted|updated|deleted|removed|connected|synced|executed|launched|submitted|completed)\s+successfully\b/i;

const EXTERNAL_OBJECT_PATTERN =
  /\b(email|mail|meeting|webinar|calendar|invite|event|ticket|issue|task|message|post|record|lead|contact|deal|document|file|channel|thread|repository|repo|pull request|campaign)\b/i;

const NON_EXECUTION_PATTERN =
  /\b(not sent|not created|not scheduled|failed to|unable to|cannot|can't|could not|pending|waiting|awaiting|draft|proposed|plan to|would|should)\b/i;

const TOOLKIT_TERMS: Record<string, string[]> = {
  gmail: ["gmail", "email", "mail", "inbox", "recipient", "subject"],
  zoom: ["zoom", "meeting", "webinar", "video call", "video meeting"],
  slack: ["slack", "channel", "thread", "dm", "message"],
  notion: ["notion", "page", "database", "doc", "workspace"],
  github: ["github", "repo", "repository", "pull request", "issue", "commit"],
  googlecalendar: ["google calendar", "calendar", "event", "invite", "schedule"],
  googledrive: ["google drive", "drive", "folder", "file"],
  jira: ["jira", "ticket", "issue", "sprint", "backlog"],
  hubspot: ["hubspot", "crm", "lead", "contact", "deal", "record"],
  salesforce: ["salesforce", "crm", "lead", "contact", "opportunity", "record"],
  pipedrive: ["pipedrive", "crm", "lead", "contact", "deal", "record"],
  stripe: ["stripe", "payment", "invoice", "charge", "customer"]
};

function normalizeToolkitList(value: string[]) {
  return [...new Set(value.map((item) => item.trim().toLowerCase()).filter(Boolean))];
}

function buildToolkitTerms(toolkits: string[]) {
  const terms = new Set<string>();
  for (const toolkit of normalizeToolkitList(toolkits)) {
    terms.add(toolkit);
    const mapped = TOOLKIT_TERMS[toolkit] ?? [];
    for (const term of mapped) {
      terms.add(term);
    }
  }
  return [...terms].filter(Boolean);
}

export function inferUnverifiedExternalActionClaim(input: HallucinationGuardInput) {
  const output = input.outputText.trim();
  if (!output) {
    return null;
  }

  const lower = output.toLowerCase();
  if (!EXTERNAL_SUCCESS_PATTERN.test(lower)) {
    return null;
  }
  if (!EXTERNAL_OBJECT_PATTERN.test(lower)) {
    return null;
  }
  if (NON_EXECUTION_PATTERN.test(lower)) {
    return null;
  }

  const requestedToolkits = normalizeToolkitList(input.requestedToolkits);
  const inferredToolkit = input.inferredToolAction?.toolkit?.trim().toLowerCase() ?? "";
  const hasToolkitContext = requestedToolkits.length > 0 || Boolean(inferredToolkit);
  if (!hasToolkitContext) {
    return null;
  }

  const scopeTerms = buildToolkitTerms([
    ...requestedToolkits,
    ...(inferredToolkit ? [inferredToolkit] : [])
  ]);
  if (scopeTerms.length > 0 && !scopeTerms.some((term) => lower.includes(term))) {
    return null;
  }

  if (input.toolActionExecution?.ok) {
    return null;
  }

  if (input.toolActionExecution && !input.toolActionExecution.ok) {
    const failedToolkit = input.toolActionExecution.error?.toolkit || inferredToolkit || "tool";
    const failedAction = input.toolActionExecution.error?.action || input.inferredToolAction?.action || "action";
    const message = input.toolActionExecution.error?.message?.trim();
    return message
      ? `Output claims successful external execution, but ${failedToolkit}/${failedAction} failed: ${message}`
      : `Output claims successful external execution, but ${failedToolkit}/${failedAction} has no successful tool evidence.`;
  }

  if (input.inferredToolAction) {
    return `Output claims successful external execution, but no successful tool evidence exists for ${input.inferredToolAction.toolkit}/${input.inferredToolAction.action}.`;
  }

  return `Output claims successful external execution, but no successful tool evidence exists for requested toolkits: ${requestedToolkits.join(", ")}.`;
}
