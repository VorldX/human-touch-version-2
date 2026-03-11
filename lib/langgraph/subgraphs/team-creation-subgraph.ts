import type { OrganizationGraphAdapters } from "../adapters/contracts.ts";
import { detectExistingTeamMatchNode } from "../nodes/detect-existing-team-match.ts";
import { generateAgentSpecsNode } from "../nodes/generate-agent-specs.ts";
import { generateTeamBlueprintNode } from "../nodes/generate-team-blueprint.ts";
import { initializeOrReuseHubContextNode } from "../nodes/initialize-or-reuse-hub-context.ts";
import { persistAgentsToSquadNode } from "../nodes/persist-agents-to-squad.ts";
import { validateTeamBlueprintNode } from "../nodes/validate-team-blueprint.ts";
import type { SwarmOrganizationState } from "../state.ts";

export async function runTeamCreationSubgraph(
  state: SwarmOrganizationState,
  adapters: OrganizationGraphAdapters
) {
  let next = detectExistingTeamMatchNode(state);
  next = generateTeamBlueprintNode(next);
  next = validateTeamBlueprintNode(next);
  next = generateAgentSpecsNode(next);
  next = await persistAgentsToSquadNode(next, adapters);
  next = await initializeOrReuseHubContextNode(next, adapters);
  return next;
}
