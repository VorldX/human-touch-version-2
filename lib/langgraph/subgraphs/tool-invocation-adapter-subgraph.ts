import type { OrganizationGraphAdapters } from "../adapters/contracts.ts";
import { runCollaborationCycleNode } from "../nodes/run-collaboration-cycle.ts";
import type { SwarmOrganizationState } from "../state.ts";

export async function runToolInvocationAdapterSubgraph(
  state: SwarmOrganizationState,
  adapters: OrganizationGraphAdapters
) {
  return runCollaborationCycleNode(state, adapters);
}
