import { randomUUID } from "node:crypto";

import type { SwarmOrganizationState } from "../state.ts";

export function assignInitialTasksNode(state: SwarmOrganizationState): SwarmOrganizationState {
  if (!state.teamBlueprint) {
    return state;
  }

  const pendingTasks = state.createdAgents.flatMap((agent) =>
    agent.defaultInitialTasks.map((taskTitle) => {
      const requiresApproval = agent.approvalSensitivity === "HIGH";
      return {
        taskId: `lg-task-${randomUUID().slice(0, 8)}`,
        role: agent.role,
        title: taskTitle,
        description: `Initial task for ${agent.role}: ${taskTitle}`,
        toolHints: [...agent.toolkits],
        requiresApproval
      };
    })
  );

  return {
    ...state,
    pendingTasks
  };
}
