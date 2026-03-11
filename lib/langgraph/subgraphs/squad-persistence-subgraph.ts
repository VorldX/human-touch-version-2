import type { OrganizationGraphAdapters } from "../adapters/contracts.ts";
import { persistAgentsToSquadNode } from "../nodes/persist-agents-to-squad.ts";
import type { SwarmOrganizationState } from "../state.ts";

export async function runSquadPersistenceSubgraph(
  state: SwarmOrganizationState,
  adapters: OrganizationGraphAdapters
) {
  return persistAgentsToSquadNode(state, adapters);
}
