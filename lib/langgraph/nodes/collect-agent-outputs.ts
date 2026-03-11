import type { SwarmOrganizationState } from "../state.ts";

export function collectAgentOutputsNode(state: SwarmOrganizationState): SwarmOrganizationState {
  if (!state.collaborationSummary) {
    return state;
  }

  const summaryOutput = {
    role: "Swarm",
    taskId: "lg-aggregate",
    summary: "Collected multi-agent outputs for manager synthesis.",
    deliverable: `Collected ${state.agentOutputs.length} output item(s).`,
    usedToolRequestIds: []
  };

  return {
    ...state,
    agentOutputs: [...state.agentOutputs, summaryOutput]
  };
}
