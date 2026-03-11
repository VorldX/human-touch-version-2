import type { SwarmOrganizationState } from "../state.ts";

export function ingestUserRequestNode(state: SwarmOrganizationState) {
  const normalizedRequest = state.userRequest.trim();
  return {
    ...state,
    userRequest: normalizedRequest,
    swarmGoal: normalizedRequest
  };
}
