import "server-only";

function parseBoolean(value: string | undefined, defaultValue = false) {
  if (!value) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export const featureFlags = {
  policyEnginePassive: parseBoolean(process.env.FEATURE_POLICY_ENGINE_PASSIVE, false),
  costGuardianPassive: parseBoolean(process.env.FEATURE_COST_GUARDIAN_PASSIVE, false),
  evalGatesScaffold: parseBoolean(process.env.FEATURE_EVAL_GATES_SCAFFOLD, false),
  memoryGovernance: parseBoolean(process.env.FEATURE_MEMORY_GOVERNANCE, true),
  capabilityVault: parseBoolean(process.env.FEATURE_CAPABILITY_VAULT, false),
  composioIntegrations: parseBoolean(process.env.FEATURE_COMPOSIO_INTEGRATIONS, false),
  agentHierarchy: parseBoolean(process.env.FEATURE_AGENT_HIERARCHY, true),
  agentContextRag: parseBoolean(process.env.FEATURE_AGENT_CONTEXT_RAG, true)
} as const;
