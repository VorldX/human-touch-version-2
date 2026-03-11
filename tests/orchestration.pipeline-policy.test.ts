import assert from "node:assert/strict";
import test from "node:test";

import { resolveOrchestrationPipelineEffectivePolicy } from "../lib/agent/orchestration/pipeline-policy-shared.ts";

test("strict pipeline stays inactive when global feature flag is disabled", () => {
  const policy = resolveOrchestrationPipelineEffectivePolicy(
    {
      mode: "ENFORCE",
      updatedAt: null,
      rules: [
        {
          id: "r1",
          name: "Require plan",
          type: "REQUIRE_PLAN_BEFORE_EXECUTION",
          enabled: true,
          priority: 10
        }
      ]
    },
    false
  );

  assert.equal(policy.strictFeatureEnabled, false);
  assert.equal(policy.enforcePlanBeforeExecution, false);
});

test("mode OFF disables enforcement even when rules are enabled", () => {
  const policy = resolveOrchestrationPipelineEffectivePolicy(
    {
      mode: "OFF",
      updatedAt: null,
      rules: [
        {
          id: "r1",
          name: "Require plan",
          type: "REQUIRE_PLAN_BEFORE_EXECUTION",
          enabled: true,
          priority: 10
        },
        {
          id: "r2",
          name: "Block direct launch",
          type: "BLOCK_DIRECT_WORKFLOW_LAUNCH",
          enabled: true,
          priority: 20
        }
      ]
    },
    true
  );

  assert.equal(policy.enforcePlanBeforeExecution, false);
  assert.equal(policy.blockDirectWorkflowLaunch, false);
});

test("mode ENFORCE activates plan-first rules", () => {
  const policy = resolveOrchestrationPipelineEffectivePolicy(
    {
      mode: "ENFORCE",
      updatedAt: null,
      rules: [
        {
          id: "r1",
          name: "Require plan",
          type: "REQUIRE_PLAN_BEFORE_EXECUTION",
          enabled: true,
          priority: 10
        },
        {
          id: "r2",
          name: "Require workflows",
          type: "REQUIRE_PLAN_WORKFLOWS",
          enabled: true,
          priority: 20
        },
        {
          id: "r3",
          name: "Block direct launch",
          type: "BLOCK_DIRECT_WORKFLOW_LAUNCH",
          enabled: true,
          priority: 30
        }
      ]
    },
    true
  );

  assert.equal(policy.enforcePlanBeforeExecution, true);
  assert.equal(policy.requirePlanWorkflows, true);
  assert.equal(policy.blockDirectWorkflowLaunch, true);
});

test("extended rule set activates detailed planning and specialist assignment toggles", () => {
  const policy = resolveOrchestrationPipelineEffectivePolicy(
    {
      mode: "ENFORCE",
      updatedAt: null,
      rules: [
        {
          id: "r1",
          name: "Require detailed plan",
          type: "REQUIRE_DETAILED_PLAN",
          enabled: true,
          priority: 10
        },
        {
          id: "r2",
          name: "Require multi-workflow decomposition",
          type: "REQUIRE_MULTI_WORKFLOW_DECOMPOSITION",
          enabled: true,
          priority: 20
        },
        {
          id: "r3",
          name: "Enforce specialist assignment",
          type: "ENFORCE_SPECIALIST_TOOL_ASSIGNMENT",
          enabled: true,
          priority: 30
        }
      ]
    },
    true
  );

  assert.equal(policy.requireDetailedPlan, true);
  assert.equal(policy.requireMultiWorkflowDecomposition, true);
  assert.equal(policy.enforceSpecialistToolAssignment, true);
});

test("disabled rules do not contribute to effective policy", () => {
  const policy = resolveOrchestrationPipelineEffectivePolicy(
    {
      mode: "ENFORCE",
      updatedAt: null,
      rules: [
        {
          id: "r1",
          name: "Freeze plan",
          type: "FREEZE_EXECUTION_TO_APPROVED_PLAN",
          enabled: false,
          priority: 10
        }
      ]
    },
    true
  );

  assert.equal(policy.freezeExecutionToApprovedPlan, false);
});
