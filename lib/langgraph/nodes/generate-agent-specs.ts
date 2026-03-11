import { randomUUID } from "node:crypto";

import type { SwarmOrganizationState } from "../state.ts";
import { buildRolePromptFromTemplate } from "../templates/team-template-registry.ts";
import { resolveToolkitsForCategories } from "../utils/tool-access.ts";

export function generateAgentSpecsNode(state: SwarmOrganizationState): SwarmOrganizationState {
  if (!state.teamBlueprint) {
    return state;
  }

  const createdAgents = state.teamBlueprint.roles.map((role) => {
    const toolkits = resolveToolkitsForCategories({
      categories: role.toolCategories,
      availableToolkits: state.availableToolkits
    });

    return {
      agentTempId: `lg-agent-${randomUUID().slice(0, 8)}`,
      name: role.roleName,
      role: role.roleName,
      description: role.description,
      responsibilities: role.responsibilities,
      prompt: buildRolePromptFromTemplate({
        teamGoal: state.teamBlueprint!.mission,
        orgName: state.orgName,
        managerName: state.managerName,
        role
      }),
      toolCategories: role.toolCategories,
      toolkits,
      approvalSensitivity: role.approvalSensitivity,
      defaultInitialTasks: role.defaultInitialTasks,
      metadata: {
        createdBy: "Swarm",
        creationSource: "langgraph_team_bootstrap",
        teamType: state.teamBlueprint!.teamType,
        role: role.roleName,
        graphRunId: state.graphRunId,
        autoCreated: true
      }
    };
  });

  return {
    ...state,
    createdAgents
  };
}
