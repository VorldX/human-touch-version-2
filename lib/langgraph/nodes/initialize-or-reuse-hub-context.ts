import type { OrganizationGraphAdapters } from "../adapters/contracts.ts";
import type { SwarmOrganizationState } from "../state.ts";

export async function initializeOrReuseHubContextNode(
  state: SwarmOrganizationState,
  adapters: OrganizationGraphAdapters
) {
  if (!state.teamBlueprint) {
    return state;
  }

  const hubContext = await adapters.initializeOrReuseHubContext({
    orgId: state.orgId,
    teamType: state.teamBlueprint.teamType,
    mission: state.teamBlueprint.mission,
    graphRunId: state.graphRunId
  });

  return {
    ...state,
    hubContext: {
      workspaceId: hubContext.workspaceId,
      existed: hubContext.existed,
      missionEntryId: hubContext.missionEntryId
    },
    hubWorkspaceExists: hubContext.existed
  };
}
