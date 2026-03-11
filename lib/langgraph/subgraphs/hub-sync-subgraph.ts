import type { OrganizationGraphAdapters } from "../adapters/contracts.ts";
import { initializeOrReuseHubContextNode } from "../nodes/initialize-or-reuse-hub-context.ts";
import type { SwarmOrganizationState } from "../state.ts";

export async function runHubSyncSubgraph(
  state: SwarmOrganizationState,
  adapters: OrganizationGraphAdapters
) {
  return initializeOrReuseHubContextNode(state, adapters);
}
