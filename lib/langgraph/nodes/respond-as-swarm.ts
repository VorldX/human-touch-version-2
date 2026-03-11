import type { SwarmOrganizationState } from "../state.ts";

export function respondAsSwarmNode(state: SwarmOrganizationState): SwarmOrganizationState {
  if (state.finalUserResponse.trim()) {
    return state;
  }

  const fallback = state.errors.length > 0
    ? `Swarm manager could not complete team bootstrap: ${state.errors.join(" | ")}`
    : "Swarm manager did not generate a team summary.";

  return {
    ...state,
    finalUserResponse: fallback
  };
}
