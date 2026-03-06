import type {
  AgentLogicalRole,
  DelegationPolicyDecision,
  DelegationPolicyInput
} from "@/lib/agent/orchestration/types";

function delegationThresholdByMode(mode: DelegationPolicyInput["executionMode"]) {
  if (mode === "ECO") return 0.84;
  if (mode === "TURBO") return 0.46;
  return 0.64;
}

function targetRoleForDelegation(role: AgentLogicalRole, complexityScore: number): AgentLogicalRole {
  if (role === "MAIN") {
    return complexityScore >= 0.78 ? "MANAGER" : "WORKER";
  }
  return "WORKER";
}

export function decideDelegation(input: DelegationPolicyInput): DelegationPolicyDecision {
  if (input.blockedByPolicy) {
    return {
      decision: "HALT_POLICY",
      reason: "Execution halted by policy constraints.",
      targetRole: null,
      shouldCreateChild: false,
      estimatedCostUsd: input.estimatedSelfCostUsd,
      estimatedDelegationCostUsd: input.estimatedDelegationCostUsd
    };
  }

  if (input.requiresApproval) {
    return {
      decision: "ASK_HUMAN",
      reason: "Approval is required before this action can proceed.",
      targetRole: null,
      shouldCreateChild: false,
      estimatedCostUsd: input.estimatedSelfCostUsd,
      estimatedDelegationCostUsd: input.estimatedDelegationCostUsd
    };
  }

  if (input.missingToolkits.length > 0) {
    return {
      decision: "HALT_TOOL_GAP",
      reason: `Missing tool integrations: ${input.missingToolkits.join(", ")}`,
      targetRole: null,
      shouldCreateChild: false,
      estimatedCostUsd: input.estimatedSelfCostUsd,
      estimatedDelegationCostUsd: input.estimatedDelegationCostUsd
    };
  }

  if (input.budget.remainingBudgetUsd < input.estimatedSelfCostUsd) {
    return {
      decision: "HALT_BUDGET",
      reason: `Estimated self execution cost (${input.estimatedSelfCostUsd.toFixed(4)} USD) exceeds remaining budget.`,
      targetRole: null,
      shouldCreateChild: false,
      estimatedCostUsd: input.estimatedSelfCostUsd,
      estimatedDelegationCostUsd: input.estimatedDelegationCostUsd
    };
  }

  const threshold = delegationThresholdByMode(input.executionMode);
  const totalSteps = Math.max(0, input.totalSteps ?? 0);
  const stepIndex = Math.max(0, input.stepIndex ?? 0);
  const stage = input.taskStage ?? "GENERAL";
  const hasMultiAgentMissionHint = Boolean(input.multiAgentRequested && totalSteps >= 3);
  const enforceStructuredDelegation =
    hasMultiAgentMissionHint &&
    input.agentRole === "MAIN" &&
    stage !== "PLANNING" &&
    stepIndex >= 1 &&
    input.budget.remainingBudgetUsd >= input.estimatedDelegationCostUsd &&
    input.complexity.parallelizationBenefit >= 0.2 &&
    input.complexity.score >= (input.executionMode === "ECO" ? 0.66 : 0.42);

  if (enforceStructuredDelegation) {
    const targetRole = targetRoleForDelegation(input.agentRole, input.complexity.score);
    if (input.availableChildAgents > 0) {
      return {
        decision: "DELEGATE_EXISTING",
        reason: "Structured multi-agent mission favors delegated execution for this task step.",
        targetRole,
        shouldCreateChild: false,
        estimatedCostUsd: input.estimatedSelfCostUsd,
        estimatedDelegationCostUsd: input.estimatedDelegationCostUsd
      };
    }

    return {
      decision: "DELEGATE_NEW",
      reason: "Structured multi-agent mission requires a child agent for this task step.",
      targetRole,
      shouldCreateChild: true,
      estimatedCostUsd: input.estimatedSelfCostUsd,
      estimatedDelegationCostUsd: input.estimatedDelegationCostUsd
    };
  }

  const isDelegationValuable =
    input.complexity.score >= threshold &&
    input.complexity.parallelizationBenefit >= 0.32 &&
    input.budget.remainingBudgetUsd >= input.estimatedDelegationCostUsd;

  if (!isDelegationValuable) {
    return {
      decision: "EXECUTE_SELF",
      reason: "Self execution selected based on cost/performance threshold.",
      targetRole: null,
      shouldCreateChild: false,
      estimatedCostUsd: input.estimatedSelfCostUsd,
      estimatedDelegationCostUsd: input.estimatedDelegationCostUsd
    };
  }

  const targetRole = targetRoleForDelegation(input.agentRole, input.complexity.score);
  if (input.availableChildAgents > 0) {
    return {
      decision: "DELEGATE_EXISTING",
      reason: "Delegation selected to existing child agent for parallel execution.",
      targetRole,
      shouldCreateChild: false,
      estimatedCostUsd: input.estimatedSelfCostUsd,
      estimatedDelegationCostUsd: input.estimatedDelegationCostUsd
    };
  }

  return {
    decision: "DELEGATE_NEW",
    reason: "Delegation selected and no reusable child agent available.",
    targetRole,
    shouldCreateChild: true,
    estimatedCostUsd: input.estimatedSelfCostUsd,
    estimatedDelegationCostUsd: input.estimatedDelegationCostUsd
  };
}
