import type { OrganizationGraphAdapters } from "../adapters/contracts.ts";
import type { SwarmOrganizationState } from "../state.ts";

export async function requestApprovalIfNeededNode(
  state: SwarmOrganizationState,
  adapters: OrganizationGraphAdapters
): Promise<SwarmOrganizationState> {
  if (state.approvalRequests.length === 0) {
    return {
      ...state,
      approvalStatus: "NONE"
    };
  }

  const resolved = [];
  for (const request of state.approvalRequests) {
    const created = await adapters.createApprovalRequest({
      orgId: state.orgId,
      reason: request.reason,
      metadata: request.metadata
    });
    resolved.push({
      ...request,
      status: created.status,
      checkpointId: created.checkpointId
    });
  }

  const pending = resolved.filter((item) => item.status === "PENDING").length;

  return {
    ...state,
    approvalRequests: resolved,
    approvalStatus: pending > 0 ? "PENDING" : "APPROVED"
  };
}
