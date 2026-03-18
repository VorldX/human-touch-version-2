import "server-only";

import { mapLegacyEventToQueueJob } from "@/lib/queue/event-mapper";
import { writeOutboxEvent } from "@/lib/queue/outbox";

export interface ShadowDispatchResult {
  ok: boolean;
  reason: "mapped_and_outboxed" | "not_mapped" | "outbox_failed";
  outboxId?: string | null;
  deduped?: boolean;
  error?: string;
}

export async function dispatchLegacyEventToQueueShadow(input: {
  name: string;
  data: Record<string, unknown>;
}): Promise<ShadowDispatchResult> {
  const job = mapLegacyEventToQueueJob({
    name: input.name,
    data: input.data
  });

  if (!job) {
    return {
      ok: false,
      reason: "not_mapped"
    };
  }

  const outbox = await writeOutboxEvent({
    orgId: job.orgId,
    runId: job.runId,
    eventName: job.name,
    eventKey: job.idempotencyKey,
    traceId: job.traceId,
    payload: job
  });
  if (!outbox.ok) {
    return {
      ok: false,
      reason: "outbox_failed",
      error: outbox.error
    };
  }

  return {
    ok: true,
    reason: "mapped_and_outboxed",
    outboxId: outbox.outboxId ?? null,
    deduped: outbox.deduped
  };
}
