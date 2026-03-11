import type { SwarmOrganizationState } from "../state.ts";

export function resolveDependenciesNode(state: SwarmOrganizationState): SwarmOrganizationState {
  if (state.blockedTasks.length === 0) {
    return state;
  }

  const unresolved = state.blockedTasks.map((task) => task.title);
  return {
    ...state,
    warnings: [
      ...state.warnings,
      `Dependencies blocked by approvals: ${unresolved.join("; ")}`
    ]
  };
}
