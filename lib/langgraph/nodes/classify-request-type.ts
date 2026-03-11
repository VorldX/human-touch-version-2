import type { SwarmOrganizationState } from "../state.ts";
import {
  classifyRequestType,
  inferTeamIntent
} from "../utils/request-classifier.ts";

export function classifyRequestTypeNode(state: SwarmOrganizationState): SwarmOrganizationState {
  const requestType = classifyRequestType(state.userRequest);
  const teamIntent = inferTeamIntent(state.userRequest);

  return {
    ...state,
    requestType,
    teamIntent,
    wantsCreate: teamIntent.operation === "CREATE",
    wantsUpdate: teamIntent.operation === "UPDATE",
    wantsActivate: teamIntent.operation === "ACTIVATE"
  };
}
