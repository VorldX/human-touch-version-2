import { randomUUID } from "node:crypto";

import type { SwarmOrganizationState } from "../state.ts";

function normalizeObjective(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function splitRequestIntoObjectives(request: string, limit = 8) {
  const normalized = request.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [] as string[];
  const byLine = normalized
    .split("\n")
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean);
  const bySentence =
    byLine.length > 0
      ? byLine
      : normalized
          .split(/(?<=[.!?])\s+/g)
          .map((line) => line.trim())
          .filter(Boolean);
  return [...new Set(bySentence.map(normalizeObjective).filter(Boolean))].slice(0, limit);
}

function inferTaskPriority(input: { requiresApproval: boolean; role: string }) {
  if (input.requiresApproval) return "high" as const;
  if (/manager|lead|strategist/i.test(input.role)) return "high" as const;
  return "normal" as const;
}

function inferToolPlan(toolHints: string[]) {
  const toolkits = [...new Set(toolHints.map((item) => item.trim().toLowerCase()).filter(Boolean))];
  if (toolkits.length === 0) {
    return [{ toolkit: "internal", action: "GENERATE_OUTPUT" }];
  }
  return toolkits.map((toolkit) => ({
    toolkit,
    action: "TASK_EXECUTION"
  }));
}

export function assignInitialTasksNode(state: SwarmOrganizationState): SwarmOrganizationState {
  if (!state.teamBlueprint) {
    return state;
  }

  const runId = state.durableRunId ?? `r_${state.graphRunId.replace(/^lg-run-/, "")}`;
  const objectives = splitRequestIntoObjectives(state.userRequest);
  const usedFallback = objectives.length === 0;
  const pendingTasks = state.createdAgents.flatMap((agent) => {
    const roleObjectives =
      objectives.length > 0
        ? objectives.map((objective, objectiveIndex) => ({
            objective,
            title: `${agent.role}: ${objective.slice(0, 96)}`,
            order: objectiveIndex
          }))
        : agent.defaultInitialTasks.map((taskTitle, fallbackIndex) => ({
            objective: taskTitle,
            title: taskTitle,
            order: fallbackIndex
          }));

    return roleObjectives.map((entry) => {
      const requiresApproval = agent.approvalSensitivity === "HIGH";
      const nowIso = new Date().toISOString();
      const taskId = `t_${randomUUID().slice(0, 10)}`;
      const toolPlan = inferToolPlan(agent.toolkits);
      return {
        taskId,
        runId,
        role: agent.role,
        title: entry.title,
        description: `Task for ${agent.role}: ${entry.objective}`,
        toolHints: [...agent.toolkits],
        requiresApproval
        ,
        ownerAgentId: agent.agentTempId,
        objective: entry.objective,
        inputs: [],
        expectedOutputs: [{ name: "result", type: "json" as const }],
        successCriteria: [
          "Output persisted to hub with sourceTaskId",
          "Tool receipts verified for tool plan"
        ],
        toolPlan,
        approvalPolicy: {
          required: requiresApproval,
          policyId: requiresApproval ? "policy.high_sensitivity.default" : "policy.default"
        },
        retryPolicy: {
          maxAttempts: 3,
          backoffSec: 15
        },
        timeoutSec: 600,
        priority: inferTaskPriority({
          requiresApproval,
          role: agent.role
        }),
        state: "PENDING" as const,
        attempts: 0,
        createdAt: nowIso,
        updatedAt: nowIso,
        waived: false
      };
    });
  });

  return {
    ...state,
    pendingTasks,
    warnings: usedFallback
      ? [
          ...state.warnings,
          "Request decomposition fallback used template defaults because no actionable objectives were extracted."
        ]
      : state.warnings
  };
}
