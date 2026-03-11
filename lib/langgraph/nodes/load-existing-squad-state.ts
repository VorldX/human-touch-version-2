import type { OrganizationGraphAdapters } from "../adapters/contracts.ts";
import type { SwarmOrganizationState } from "../state.ts";

export async function loadExistingSquadStateNode(
  state: SwarmOrganizationState,
  adapters: OrganizationGraphAdapters
) {
  const members = await adapters.loadExistingSquad({
    orgId: state.orgId
  });
  const humansAlreadyInSquad = members.some((member) => member.type === "HUMAN");

  return {
    ...state,
    existingSquadState: members,
    humansAlreadyInSquad
  };
}
