import type { OrganizationGraphAdapters } from "../adapters/contracts.ts";
import type { SwarmOrganizationState } from "../state.ts";

export async function persistAgentsToSquadNode(
  state: SwarmOrganizationState,
  adapters: OrganizationGraphAdapters
) {
  if (!state.teamBlueprint || state.createdAgents.length === 0) {
    return state;
  }

  const results = await adapters.persistSquadAgents({
    orgId: state.orgId,
    userId: state.userId,
    teamType: state.teamBlueprint.teamType,
    graphRunId: state.graphRunId,
    mission: state.teamBlueprint.mission,
    agents: state.createdAgents,
    reuseExistingAgents: state.reuseExistingAgents
  });

  const failures = results
    .filter((result) => result.status === "failed")
    .map((result) => `${result.role}: ${result.error ?? "unknown error"}`);

  return {
    ...state,
    squadWriteResults: results,
    warnings: failures.length > 0 ? [...state.warnings, ...failures] : state.warnings
  };
}
