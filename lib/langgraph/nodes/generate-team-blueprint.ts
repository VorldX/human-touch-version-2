import type { SwarmOrganizationState } from "../state.ts";
import {
  getTeamTemplate,
  resolveTeamTypeFromText
} from "../templates/team-template-registry.ts";

export function generateTeamBlueprintNode(state: SwarmOrganizationState): SwarmOrganizationState {
  const teamType = state.teamIntent.teamType ?? resolveTeamTypeFromText(state.userRequest);
  const template = getTeamTemplate(teamType);

  const mission = state.swarmGoal
    ? `Execute this mission through a ${teamType} team: ${state.swarmGoal}`
    : template.objective;

  return {
    ...state,
    teamBlueprint: {
      teamType,
      mission,
      objective: template.objective,
      successCriteria: template.successCriteria,
      sharedMemoryScope: template.sharedMemoryScope,
      collaborationStyle: template.collaborationStyle,
      approvalSensitivity: template.approvalSensitivity,
      roles: template.roles,
      toolCategories: template.toolCategories,
      exampleDeliverables: template.exampleDeliverables
    }
  };
}
