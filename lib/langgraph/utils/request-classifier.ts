import type {
  SwarmOrganizationRequestType,
  SwarmTeamOperation,
  SwarmTeamType,
  TeamIntent
} from "../state.ts";
import { resolveTeamTypeFromText } from "../templates/team-template-registry.ts";

const TEAM_VERB = /\b(start|set up|setup|create|build|form|assemble|launch|spin up)\b/i;
const UPDATE_VERB = /\b(update|modify|expand|restructure|adjust|change)\b/i;
const ACTIVATE_VERB = /\b(activate|enable|resume|restart|reopen)\b/i;
const TEAM_NOUN = /\b(team|squad|organization unit|org unit|crew)\b/i;
const COLLAB_SIGNAL = /\b(collaborate|coordinate|work together|handoff|cross[-\s]?functional)\b/i;
const SINGLE_AGENT_SIGNAL = /\b(single agent|one agent|solo agent)\b/i;

export function classifyRequestType(message: string): SwarmOrganizationRequestType {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return "NORMAL_SWARM_REQUEST";

  const hasTeamNoun = TEAM_NOUN.test(normalized);
  const hasCreateVerb = TEAM_VERB.test(normalized);
  const hasUpdateVerb = UPDATE_VERB.test(normalized);
  const hasActivateVerb = ACTIVATE_VERB.test(normalized);
  const hasCollaborativeSignal = COLLAB_SIGNAL.test(normalized);

  if (hasTeamNoun && hasCreateVerb) return "TEAM_CREATION_REQUEST";
  if (hasTeamNoun && hasUpdateVerb) return "TEAM_UPDATE_REQUEST";
  if (hasTeamNoun && hasActivateVerb) return "TEAM_ACTIVATION_REQUEST";
  if (hasCollaborativeSignal && hasTeamNoun) return "COLLABORATIVE_EXECUTION_REQUEST";
  if (SINGLE_AGENT_SIGNAL.test(normalized)) return "SINGLE_AGENT_TASK";

  return "NORMAL_SWARM_REQUEST";
}

function inferTeamOperation(requestType: SwarmOrganizationRequestType): SwarmTeamOperation {
  if (requestType === "TEAM_CREATION_REQUEST") return "CREATE";
  if (requestType === "TEAM_UPDATE_REQUEST") return "UPDATE";
  if (requestType === "TEAM_ACTIVATION_REQUEST") return "ACTIVATE";
  return "NONE";
}

export function inferTeamIntent(message: string): TeamIntent {
  const requestType = classifyRequestType(message);
  const operation = inferTeamOperation(requestType);
  const teamType: SwarmTeamType | null =
    operation === "NONE" && requestType !== "COLLABORATIVE_EXECUTION_REQUEST"
      ? null
      : resolveTeamTypeFromText(message);
  const requested =
    requestType === "TEAM_CREATION_REQUEST" ||
    requestType === "TEAM_UPDATE_REQUEST" ||
    requestType === "TEAM_ACTIVATION_REQUEST" ||
    requestType === "COLLABORATIVE_EXECUTION_REQUEST";

  if (!requested) {
    return {
      requested: false,
      operation: "NONE",
      teamType: null,
      confidence: 0,
      reason: "No team orchestration intent detected."
    };
  }

  const confidence =
    requestType === "TEAM_CREATION_REQUEST" ||
    requestType === "TEAM_UPDATE_REQUEST" ||
    requestType === "TEAM_ACTIVATION_REQUEST"
      ? 0.92
      : 0.75;

  return {
    requested: true,
    operation,
    teamType,
    confidence,
    reason: `Classified as ${requestType}.`
  };
}

export function isTeamOrchestrationRequest(requestType: SwarmOrganizationRequestType) {
  return (
    requestType === "TEAM_CREATION_REQUEST" ||
    requestType === "TEAM_UPDATE_REQUEST" ||
    requestType === "TEAM_ACTIVATION_REQUEST" ||
    requestType === "COLLABORATIVE_EXECUTION_REQUEST"
  );
}
