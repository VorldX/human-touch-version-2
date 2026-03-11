import "server-only";

import { createDefaultOrganizationGraphAdapters } from "@/lib/langgraph/adapters/default/create-default-adapters";
import { SwarmPlanningGraph, type SwarmPlanningGraphInput } from "@/lib/langgraph/swarm-planning-graph";

export async function runSwarmPlanningGraph(input: SwarmPlanningGraphInput) {
  const graph = new SwarmPlanningGraph({
    adapters: createDefaultOrganizationGraphAdapters()
  });
  return graph.run(input);
}

