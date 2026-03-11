import type { OrganizationGraphAdapters } from "../adapters/contracts.ts";
import type { SwarmOrganizationState } from "../state.ts";

export async function loadSharedKnowledgeNode(
  state: SwarmOrganizationState,
  adapters: OrganizationGraphAdapters
) {
  const refs = await adapters.searchSharedKnowledge({
    orgId: state.orgId,
    userId: state.userId,
    query: state.userRequest,
    limit: 8
  });

  return {
    ...state,
    sharedKnowledgeRefs: refs
  };
}
