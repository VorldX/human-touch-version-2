const TOOL_CATEGORY_MAP: Record<string, string[]> = {
  analytics: ["googleads", "hubspot", "salesforce", "shopify", "stripe", "googlesheets"],
  social: ["linkedin", "twitter", "instagram", "youtube", "mailchimp"],
  communication: ["gmail", "slack", "microsoftteams", "discord", "telegram", "whatsapp"],
  content: ["googledocs", "notion", "wordpress", "webflow", "googledrive"],
  docs: ["googledocs", "notion", "googledrive", "googlesheets"],
  research: ["notion", "googledrive", "github", "googledocs"],
  crm: ["hubspot", "salesforce", "pipedrive", "airtable"],
  meeting: ["googlecalendar", "googlemeet", "gmeet", "zoom", "calendly", "outlook"],
  project: ["jira", "trello", "asana", "monday", "linear", "clickup"]
};

export function resolveToolkitsForCategories(input: {
  categories: string[];
  availableToolkits: string[];
}) {
  const available = new Set(input.availableToolkits.map((item) => item.trim().toLowerCase()));
  const resolved = new Set<string>();

  for (const category of input.categories) {
    const mapped = TOOL_CATEGORY_MAP[category.trim().toLowerCase()] ?? [];
    for (const toolkit of mapped) {
      if (available.has(toolkit)) {
        resolved.add(toolkit);
      }
    }
  }

  return [...resolved];
}
