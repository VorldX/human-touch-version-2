import "server-only";

import { createHash } from "node:crypto";

function parseBoolean(value: string | undefined, defaultValue = false) {
  if (!value) {
    return defaultValue;
  }

  const trimmed = value.trim();
  const unquoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1).trim()
      : trimmed;
  const normalized = unquoted.toLowerCase();
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

function parsePercent(value: string | undefined, defaultValue = 0) {
  const parsed = Number(value ?? "");
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }
  return Math.min(100, Math.max(0, Math.floor(parsed)));
}

function stablePercentBucket(seed: string) {
  const digest = createHash("sha256").update(seed).digest("hex");
  const prefix = digest.slice(0, 8);
  const asInt = Number.parseInt(prefix, 16);
  return asInt % 100;
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
  memoryPhase2Orchestrator: parseBoolean(process.env.FEATURE_DNA_MEMORY_PHASE2, true),
  memoryPhase3HiveMind: parseBoolean(process.env.FEATURE_DNA_MEMORY_PHASE3, true),
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
  ),
  useQueueExecution: parseBoolean(process.env.USE_QUEUE_EXECUTION, false),
  useQueueExecutionShadow: parseBoolean(process.env.FEATURE_QUEUE_EXECUTION_SHADOW, false),
  useNewMemoryService: parseBoolean(process.env.USE_NEW_MEMORY_SERVICE, false),
  useAgentRegistry: parseBoolean(process.env.USE_AGENT_REGISTRY, false),
  useToolGateway: parseBoolean(process.env.USE_TOOL_GATEWAY, false),
  useTaskStateMachine: parseBoolean(process.env.USE_TASK_STATE_MACHINE, false),
  queueExecutionCanaryPercent: parsePercent(process.env.FEATURE_QUEUE_EXECUTION_CANARY_PERCENT, 0),
  disableLegacyInngestDispatch: parseBoolean(
    process.env.FEATURE_DISABLE_LEGACY_INNGEST_DISPATCH,
    false
  ),
  toolGatewayEnforce: parseBoolean(process.env.FEATURE_TOOL_GATEWAY_ENFORCE, false),
  agentRegistryEnforce: parseBoolean(process.env.FEATURE_AGENT_REGISTRY_ENFORCE, false)
} as const;

export type MigrationFlagName =
  | "USE_QUEUE_EXECUTION"
  | "USE_NEW_MEMORY_SERVICE"
  | "USE_AGENT_REGISTRY"
  | "USE_TOOL_GATEWAY"
  | "USE_TASK_STATE_MACHINE";

export function isMigrationFlagEnabled(name: MigrationFlagName) {
  if (name === "USE_QUEUE_EXECUTION") return featureFlags.useQueueExecution;
  if (name === "USE_NEW_MEMORY_SERVICE") return featureFlags.useNewMemoryService;
  if (name === "USE_AGENT_REGISTRY") return featureFlags.useAgentRegistry;
  if (name === "USE_TOOL_GATEWAY") return featureFlags.useToolGateway;
  return featureFlags.useTaskStateMachine;
}

export function isCanaryEnabled(input: {
  flag: MigrationFlagName;
  orgId: string;
  percent?: number;
}) {
  if (!isMigrationFlagEnabled(input.flag)) {
    return false;
  }
  const targetPercent = input.percent ?? featureFlags.queueExecutionCanaryPercent;
  if (targetPercent <= 0) return false;
  if (targetPercent >= 100) return true;
  const bucket = stablePercentBucket(`${input.flag}:${input.orgId}`);
  return bucket < targetPercent;
}
