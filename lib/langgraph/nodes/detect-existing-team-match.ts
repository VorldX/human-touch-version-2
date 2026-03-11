import type {
  ExistingTeamMatch,
  SwarmOrganizationState,
  SwarmTeamType
} from "../state.ts";
import { getTeamTemplate } from "../templates/team-template-registry.ts";

function normalizeRole(value: string) {
  return value.trim().toLowerCase();
}

function detectMatchScore(input: {
  teamType: SwarmTeamType;
  squadRoles: string[];
}) {
  const template = getTeamTemplate(input.teamType);
  const expectedRoles = template.roles.map((role) => normalizeRole(role.roleName));
  const squadRoles = new Set(input.squadRoles.map(normalizeRole));
  const matchedRoles = expectedRoles.filter((role) => squadRoles.has(role));
  const matchScore = expectedRoles.length > 0 ? matchedRoles.length / expectedRoles.length : 0;

  return {
    matchedRoles,
    matchScore
  };
}

export function detectExistingTeamMatchNode(state: SwarmOrganizationState): SwarmOrganizationState {
  if (!state.teamIntent.teamType) {
    return state;
  }

  const squadRoles = state.existingSquadState
    .filter((member) => member.type === "AI")
    .map((member) => member.role);
  const score = detectMatchScore({
    teamType: state.teamIntent.teamType,
    squadRoles
  });

  const existingTeamMatch: ExistingTeamMatch | null =
    score.matchScore >= 0.6
      ? {
          teamType: state.teamIntent.teamType,
          matchedRoles: score.matchedRoles,
          memberIds: state.existingSquadState
            .filter((member) =>
              score.matchedRoles.includes(normalizeRole(member.role))
            )
            .map((member) => member.personnelId),
          matchScore: Number(score.matchScore.toFixed(2))
        }
      : null;

  return {
    ...state,
    existingTeamMatch,
    reuseExistingAgents: Boolean(existingTeamMatch)
  };
}
