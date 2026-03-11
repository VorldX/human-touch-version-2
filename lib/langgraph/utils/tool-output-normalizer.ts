export interface NormalizedToolOutput {
  category: string;
  title: string;
  summary: string;
  content: string;
}

function summarizeValue(value: unknown) {
  if (typeof value === "string") {
    return value.slice(0, 400);
  }

  try {
    return JSON.stringify(value, null, 2).slice(0, 1400);
  } catch {
    return "Tool output could not be serialized.";
  }
}

function categoryForToolkit(toolkit: string) {
  const normalized = toolkit.toLowerCase();
  if (["hubspot", "salesforce", "pipedrive"].includes(normalized)) return "crm_updates";
  if (["gmail", "slack", "microsoftteams"].includes(normalized)) return "operational_updates";
  if (["googleads", "stripe", "shopify", "googlesheets"].includes(normalized))
    return "analytics_snapshots";
  if (["notion", "googledocs", "googledrive"].includes(normalized)) return "draft_artifacts";
  if (["googlemeet", "gmeet", "zoom", "googlecalendar"].includes(normalized))
    return "action_logs";
  return "tool_results";
}

export function normalizeToolOutputForHub(input: {
  role: string;
  toolkit: string;
  action: string;
  data: unknown;
}): NormalizedToolOutput {
  const category = categoryForToolkit(input.toolkit);
  const title = `${input.role} - ${input.toolkit}:${input.action}`;
  const summary = `Tool ${input.toolkit}:${input.action} completed and published for team reuse.`;
  const content = summarizeValue({
    role: input.role,
    toolkit: input.toolkit,
    action: input.action,
    data: input.data
  });

  return {
    category,
    title,
    summary,
    content
  };
}
