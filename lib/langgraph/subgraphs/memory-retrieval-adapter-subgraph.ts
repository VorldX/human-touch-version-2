import type { OrganizationGraphAdapters } from "../adapters/contracts.ts";
import { loadSharedKnowledgeNode } from "../nodes/load-shared-knowledge.ts";
import type { SwarmOrganizationState } from "../state.ts";

export async function runMemoryRetrievalAdapterSubgraph(
  state: SwarmOrganizationState,
  adapters: OrganizationGraphAdapters
) {
  return loadSharedKnowledgeNode(state, adapters);
}
