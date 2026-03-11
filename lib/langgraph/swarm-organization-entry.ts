import "server-only";

import { randomUUID } from "node:crypto";

import { createDefaultOrganizationGraphAdapters } from "@/lib/langgraph/adapters/default/create-default-adapters";
import { SwarmOrganizationGraph } from "@/lib/langgraph/swarm-organization-graph";
import { isOrganizationGraphEnabledForActor } from "@/lib/langgraph/utils/feature-gating";
import { featureFlags } from "@/lib/config/feature-flags";

export async function maybeRunSwarmOrganizationGraph(input: {
  orgId: string;
  userId: string;
  sessionId: string;
  userRequest: string;
}) {
  const enabled = isOrganizationGraphEnabledForActor({
    featureEnabled: featureFlags.langgraphOrganizationTeams,
    orgAllowlist: featureFlags.langgraphOrganizationOrgAllowlist,
    userAllowlist: featureFlags.langgraphOrganizationUserAllowlist,
    orgId: input.orgId,
    userId: input.userId
  });

  if (!enabled) {
    return {
      handled: false,
      reply: "",
      reason: "LangGraph organization feature not enabled for actor.",
      graphRunId: "",
      requestType: "NORMAL_SWARM_REQUEST",
      warnings: [],
      createdAgentCount: 0,
      reusedAgentCount: 0,
      approvalPendingCount: 0
    };
  }

  const graph = new SwarmOrganizationGraph({
    adapters: createDefaultOrganizationGraphAdapters()
  });

  return graph.run({
    orgId: input.orgId,
    userId: input.userId,
    sessionId: input.sessionId,
    userRequest: input.userRequest,
    traceId: `lg-trace-${randomUUID().slice(0, 10)}`,
    featureFlagEnabled: enabled
  });
}
