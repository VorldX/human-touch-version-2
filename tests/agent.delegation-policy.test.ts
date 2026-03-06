import test from "node:test";
import assert from "node:assert/strict";

import { decideDelegation } from "../lib/agent/orchestration/delegation-policy.ts";

const baseInput = {
  executionMode: "BALANCED" as const,
  agentRole: "MAIN" as const,
  budget: {
    monthlyBudgetUsd: 1000,
    currentSpendUsd: 120,
    remainingBudgetUsd: 880,
    monthlyBtuCap: 200000,
    currentBtuBurn: 3400,
    remainingBtu: 196600,
    flowPredictedBurn: 0
  },
  complexity: {
    score: 0.72,
    parallelizationBenefit: 0.62,
    riskScore: 0.25,
    signals: ["planning", "parallelizable"]
  },
  estimatedSelfCostUsd: 0.08,
  estimatedDelegationCostUsd: 0.12,
  requiredToolkits: ["gmail"],
  missingToolkits: [],
  requiresApproval: false,
  blockedByPolicy: false,
  availableChildAgents: 0
};

test("halts when budget cannot cover self execution", () => {
  const decision = decideDelegation({
    ...baseInput,
    budget: {
      ...baseInput.budget,
      remainingBudgetUsd: 0.01
    },
    estimatedSelfCostUsd: 0.1
  });

  assert.equal(decision.decision, "HALT_BUDGET");
});

test("turbo mode delegates with high complexity and no existing child", () => {
  const decision = decideDelegation({
    ...baseInput,
    executionMode: "TURBO",
    complexity: {
      ...baseInput.complexity,
      score: 0.9
    }
  });

  assert.equal(decision.decision, "DELEGATE_NEW");
  assert.equal(decision.shouldCreateChild, true);
  assert.equal(decision.targetRole, "MANAGER");
});

test("eco mode prefers self execution for moderate complexity", () => {
  const decision = decideDelegation({
    ...baseInput,
    executionMode: "ECO",
    complexity: {
      ...baseInput.complexity,
      score: 0.74
    }
  });

  assert.equal(decision.decision, "EXECUTE_SELF");
});

test("halts on missing toolkit integration", () => {
  const decision = decideDelegation({
    ...baseInput,
    missingToolkits: ["gmail"]
  });

  assert.equal(decision.decision, "HALT_TOOL_GAP");
});

test("asks human when approval is required", () => {
  const decision = decideDelegation({
    ...baseInput,
    requiresApproval: true
  });

  assert.equal(decision.decision, "ASK_HUMAN");
});

test("balanced mode forces delegation on structured multi-agent execution steps", () => {
  const decision = decideDelegation({
    ...baseInput,
    complexity: {
      ...baseInput.complexity,
      score: 0.48,
      parallelizationBenefit: 0.44
    },
    multiAgentRequested: true,
    taskStage: "EXECUTION",
    stepIndex: 2,
    totalSteps: 4
  });

  assert.equal(decision.decision, "DELEGATE_NEW");
});
