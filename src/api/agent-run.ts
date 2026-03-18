import "server-only";

import { randomUUID } from "node:crypto";

import { inngest } from "@/src/inngest/client";
import { INNGEST_EVENTS } from "@/src/inngest/events/catalog";
import { assertInngestEmitterConfig } from "@/src/inngest/env";
import type { AgentRunEventData } from "@/src/inngest/events/types";

export async function emitAgentRunEvent(input: {
  orgId: string;
  prompt: string;
  initiatedByUserId?: string | null;
  workflowId?: string;
  requestId?: string;
  context?: Record<string, unknown>;
}) {
  assertInngestEmitterConfig();

  const workflowId = input.workflowId?.trim() || `wf_${randomUUID().slice(0, 12)}`;
  const requestId = input.requestId?.trim() || randomUUID();
  const payload: AgentRunEventData = {
    orgId: input.orgId,
    workflowId,
    requestId,
    prompt: input.prompt.trim(),
    initiatedByUserId: input.initiatedByUserId ?? null,
    context: input.context ?? {},
    createdAt: new Date().toISOString()
  };

  await inngest.send({
    name: INNGEST_EVENTS.agentRun,
    data: payload
  });

  return payload;
}

