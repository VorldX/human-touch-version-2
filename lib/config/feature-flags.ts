import "server-only";

function parseBoolean(value: string | undefined, defaultValue = false) {
  if (!value) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function parseCsv(value: string | undefined) {
  if (!value) {
    return [] as string[];
  }
  return [...new Set(value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean))];
}

export const featureFlags = {
  policyEnginePassive: parseBoolean(process.env.FEATURE_POLICY_ENGINE_PASSIVE, false),
  costGuardianPassive: parseBoolean(process.env.FEATURE_COST_GUARDIAN_PASSIVE, false),
  evalGatesScaffold: parseBoolean(process.env.FEATURE_EVAL_GATES_SCAFFOLD, false),
  strictOrchestrationPipeline: parseBoolean(
    process.env.FEATURE_STRICT_ORCHESTRATION_PIPELINE,
    false
  ),
  memoryGovernance: parseBoolean(process.env.FEATURE_MEMORY_GOVERNANCE, true),
  agentLongTermMemory: parseBoolean(process.env.FEATURE_AGENT_LONG_TERM_MEMORY, true),
  capabilityVault: parseBoolean(process.env.FEATURE_CAPABILITY_VAULT, false),
  composioIntegrations: parseBoolean(process.env.FEATURE_COMPOSIO_INTEGRATIONS, false),
  agentHierarchy: parseBoolean(process.env.FEATURE_AGENT_HIERARCHY, true),
  agentContextRag: parseBoolean(process.env.FEATURE_AGENT_CONTEXT_RAG, true),
  langgraphOrganizationTeams: parseBoolean(
    process.env.FEATURE_LANGGRAPH_ORGANIZATION_TEAMS,
    false
  ),
  langgraphOrganizationOrgAllowlist: parseCsv(
    process.env.FEATURE_LANGGRAPH_ORGANIZATION_ORG_ALLOWLIST
  ),
  langgraphOrganizationUserAllowlist: parseCsv(
    process.env.FEATURE_LANGGRAPH_ORGANIZATION_USER_ALLOWLIST
  )
} as const;
