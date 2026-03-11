export type OrchestrationPipelineMode = "OFF" | "AUDIT" | "ENFORCE";
export type OrchestrationPipelineRuleType =
  | "REQUIRE_PLAN_BEFORE_EXECUTION"
  | "REQUIRE_PLAN_WORKFLOWS"
  | "BLOCK_DIRECT_WORKFLOW_LAUNCH"
  | "FREEZE_EXECUTION_TO_APPROVED_PLAN"
  | "REQUIRE_DETAILED_PLAN"
  | "REQUIRE_MULTI_WORKFLOW_DECOMPOSITION"
  | "ENFORCE_SPECIALIST_TOOL_ASSIGNMENT";

export interface OrchestrationPipelineRule {
  id: string;
  name: string;
  type: OrchestrationPipelineRuleType;
  enabled: boolean;
  priority: number;
}

export interface OrchestrationPipelineSettings {
  mode: OrchestrationPipelineMode;
  rules: OrchestrationPipelineRule[];
  updatedAt: string | null;
}

export interface OrchestrationPipelineEffectivePolicy {
  strictFeatureEnabled: boolean;
  mode: OrchestrationPipelineMode;
  enforcePlanBeforeExecution: boolean;
  requirePlanWorkflows: boolean;
  blockDirectWorkflowLaunch: boolean;
  freezeExecutionToApprovedPlan: boolean;
  requireDetailedPlan: boolean;
  requireMultiWorkflowDecomposition: boolean;
  enforceSpecialistToolAssignment: boolean;
  enabledRuleTypes: OrchestrationPipelineRuleType[];
}

export function defaultOrchestrationPipelineRules(): OrchestrationPipelineRule[] {
  return [
    {
      id: "rule-plan-before-execution",
      name: "Require plan before execution",
      type: "REQUIRE_PLAN_BEFORE_EXECUTION",
      enabled: true,
      priority: 10
    },
    {
      id: "rule-plan-workflows",
      name: "Require workflow breakdown from approved plan",
      type: "REQUIRE_PLAN_WORKFLOWS",
      enabled: true,
      priority: 20
    },
    {
      id: "rule-block-direct-launch",
      name: "Block direct workflow launch",
      type: "BLOCK_DIRECT_WORKFLOW_LAUNCH",
      enabled: true,
      priority: 30
    },
    {
      id: "rule-freeze-plan",
      name: "Freeze execution to approved plan snapshot",
      type: "FREEZE_EXECUTION_TO_APPROVED_PLAN",
      enabled: false,
      priority: 40
    },
    {
      id: "rule-detailed-plan",
      name: "Require detailed plan blueprint",
      type: "REQUIRE_DETAILED_PLAN",
      enabled: true,
      priority: 50
    },
    {
      id: "rule-multi-workflow",
      name: "Require multi-workflow decomposition",
      type: "REQUIRE_MULTI_WORKFLOW_DECOMPOSITION",
      enabled: true,
      priority: 60
    },
    {
      id: "rule-specialist-routing",
      name: "Enforce specialist tool assignment",
      type: "ENFORCE_SPECIALIST_TOOL_ASSIGNMENT",
      enabled: false,
      priority: 70
    }
  ];
}

export function resolveOrchestrationPipelineEffectivePolicy(
  settings: OrchestrationPipelineSettings,
  strictFeatureEnabled: boolean
): OrchestrationPipelineEffectivePolicy {
  const enabledRuleTypes = settings.rules
    .filter((rule) => rule.enabled)
    .sort((left, right) => left.priority - right.priority)
    .map((rule) => rule.type);
  const active = strictFeatureEnabled && settings.mode !== "OFF";

  return {
    strictFeatureEnabled,
    mode: settings.mode,
    enforcePlanBeforeExecution:
      active && enabledRuleTypes.includes("REQUIRE_PLAN_BEFORE_EXECUTION"),
    requirePlanWorkflows: active && enabledRuleTypes.includes("REQUIRE_PLAN_WORKFLOWS"),
    blockDirectWorkflowLaunch:
      active && enabledRuleTypes.includes("BLOCK_DIRECT_WORKFLOW_LAUNCH"),
    freezeExecutionToApprovedPlan:
      active && enabledRuleTypes.includes("FREEZE_EXECUTION_TO_APPROVED_PLAN"),
    requireDetailedPlan: active && enabledRuleTypes.includes("REQUIRE_DETAILED_PLAN"),
    requireMultiWorkflowDecomposition:
      active && enabledRuleTypes.includes("REQUIRE_MULTI_WORKFLOW_DECOMPOSITION"),
    enforceSpecialistToolAssignment:
      active && enabledRuleTypes.includes("ENFORCE_SPECIALIST_TOOL_ASSIGNMENT"),
    enabledRuleTypes
  };
}
