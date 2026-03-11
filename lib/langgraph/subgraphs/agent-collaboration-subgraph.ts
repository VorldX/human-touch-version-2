import type { OrganizationGraphAdapters } from "../adapters/contracts.ts";
import { assignInitialTasksNode } from "../nodes/assign-initial-tasks.ts";
import { collectAgentOutputsNode } from "../nodes/collect-agent-outputs.ts";
import { resolveDependenciesNode } from "../nodes/resolve-dependencies.ts";
import { runCollaborationCycleNode } from "../nodes/run-collaboration-cycle.ts";
import type { SwarmOrganizationState } from "../state.ts";

export async function runAgentCollaborationSubgraph(
  state: SwarmOrganizationState,
  adapters: OrganizationGraphAdapters
) {
  let next = assignInitialTasksNode(state);
  next = await runCollaborationCycleNode(next, adapters);
  next = collectAgentOutputsNode(next);
  next = resolveDependenciesNode(next);
  return next;
}
