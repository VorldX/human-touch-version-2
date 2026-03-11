import type { OrganizationGraphAdapters } from "../adapters/contracts.ts";
import type { SwarmOrganizationState } from "../state.ts";

export async function loadOrgContextNode(
  state: SwarmOrganizationState,
  adapters: OrganizationGraphAdapters
) {
  const context = await adapters.loadOrganizationContext({
    orgId: state.orgId,
    userId: state.userId
  });

  return {
    ...state,
    workspaceId: context.workspaceId,
    orgName: context.orgName,
    managerName: context.managerName,
    availableToolkits: context.availableToolkits,
    warnings: [
      ...state.warnings,
      `Org context loaded for ${context.orgName} with ${context.availableToolkits.length} toolkit(s).`
    ]
  };
}
