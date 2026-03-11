import type { SwarmOrganizationState } from "../state.ts";

export function validateTeamBlueprintNode(state: SwarmOrganizationState): SwarmOrganizationState {
  const blueprint = state.teamBlueprint;
  if (!blueprint) {
    return {
      ...state,
      errors: [...state.errors, "Team blueprint is missing."],
      fallbackToLegacySwarmPath: true
    };
  }

  if (blueprint.roles.length < 3 || blueprint.roles.length > 6) {
    return {
      ...state,
      warnings: [
        ...state.warnings,
        `Blueprint role count (${blueprint.roles.length}) is outside preferred range 3-6.`
      ]
    };
  }

  if (!blueprint.mission.trim()) {
    return {
      ...state,
      errors: [...state.errors, "Team mission is empty."],
      fallbackToLegacySwarmPath: true
    };
  }

  return state;
}
