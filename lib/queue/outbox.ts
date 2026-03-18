import "server-only";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import type { QueueJob } from "@/lib/queue/job-types";

function isUniqueConflict(error: unknown) {
  const code =
    typeof (error as { code?: unknown })?.code === "string"
      ? (error as { code: string }).code
      : "";
  return code === "P2002";
}

export async function writeOutboxEvent(input: {
  orgId: string;
  runId: string;
  eventName: string;
  eventKey: string;
  traceId: string;
  payload: QueueJob;
}) {
  try {
    const created = await prisma.executionOutboxEvent.create({
      data: {
        orgId: input.orgId,
        runId: input.runId,
        eventName: input.eventName,
        eventKey: input.eventKey,
        traceId: input.traceId,
        payload: input.payload as unknown as Prisma.InputJsonValue
      },
      select: {
        id: true,
        status: true,
        eventKey: true
      }
    });
    return {
      ok: true as const,
      deduped: false as const,
      outboxId: created.id,
      status: created.status
    };
  } catch (error) {
    if (isUniqueConflict(error)) {
      return {
        ok: true as const,
        deduped: true as const,
        outboxId: null,
        status: "PENDING" as const
      };
    }
    return {
      ok: false as const,
      deduped: false as const,
      outboxId: null as string | null,
      status: "FAILED" as const,
      error: error instanceof Error ? error.message : "outbox_insert_failed"
    };
  }
}
