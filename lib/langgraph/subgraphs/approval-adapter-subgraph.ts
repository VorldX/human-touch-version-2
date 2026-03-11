import type { OrganizationGraphAdapters } from "../adapters/contracts.ts";
import { requestApprovalIfNeededNode } from "../nodes/request-approval-if-needed.ts";
import type { SwarmOrganizationState } from "../state.ts";

export async function runApprovalAdapterSubgraph(
  state: SwarmOrganizationState,
  adapters: OrganizationGraphAdapters
): Promise<SwarmOrganizationState> {
  return requestApprovalIfNeededNode(state, adapters);
}
