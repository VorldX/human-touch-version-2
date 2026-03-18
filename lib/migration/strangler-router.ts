import "server-only";

import { featureFlags, isCanaryEnabled } from "@/lib/config/feature-flags";

export type ExecutionBoundary = "legacy_inngest_route" | "queue_runtime";
export type ExecutionMode = "legacy_only" | "shadow" | "queue_primary";

export interface StranglerDecision {
  mode: ExecutionMode;
  sourceOfTruth: ExecutionBoundary;
  shadowTarget: ExecutionBoundary | null;
}

export function decideExecutionMode(input: { orgId: string }): StranglerDecision {
  const queueCanary = isCanaryEnabled({
    flag: "USE_QUEUE_EXECUTION",
    orgId: input.orgId
  });

  if (featureFlags.useQueueExecution && queueCanary) {
    return {
      mode: "queue_primary",
      sourceOfTruth: "queue_runtime",
      shadowTarget: "legacy_inngest_route"
    };
  }

  if (featureFlags.useQueueExecutionShadow) {
    return {
      mode: "shadow",
      sourceOfTruth: "legacy_inngest_route",
      shadowTarget: "queue_runtime"
    };
  }

  return {
    mode: "legacy_only",
    sourceOfTruth: "legacy_inngest_route",
    shadowTarget: null
  };
}

export const STRANGLER_BOUNDARIES = {
  oldSystem: {
    ingress: "app/api/inngest/route.ts",
    dispatcher: "lib/inngest/publish.ts",
    execution: "inline sequential event handling"
  },
  newSystem: {
    ingress: "app/api/* command routes",
    dispatcher: "outbox + BullMQ queues",
    execution: "workers consuming queue jobs"
  }
} as const;
