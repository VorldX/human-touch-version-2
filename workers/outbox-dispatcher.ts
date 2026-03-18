import { publishQueueJob } from "@/lib/queue/producer";

import { prisma } from "@/lib/db/prisma";
import type { QueueJob } from "@/lib/queue/job-types";

type PendingOutboxRow = {
  id: string;
  eventName: string;
  payload: unknown;
};

const BATCH_SIZE = 50;
const POLL_MS = 1200;

async function claimPendingRows() {
  const rows = await prisma.$queryRawUnsafe<PendingOutboxRow[]>(
    `
    WITH cte AS (
      SELECT id
      FROM "ExecutionOutboxEvent"
      WHERE status = 'PENDING'
        AND "availableAt" <= NOW()
      ORDER BY "createdAt" ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "ExecutionOutboxEvent" e
    SET status = 'DISPATCHING',
        "updatedAt" = NOW()
    FROM cte
    WHERE e.id = cte.id
    RETURNING e.id, e."eventName", e.payload
    `,
    BATCH_SIZE
  );

  return rows;
}

async function markDispatched(id: string) {
  await prisma.$executeRawUnsafe(
    `
    UPDATE "ExecutionOutboxEvent"
    SET status = 'DISPATCHED',
        "dispatchedAt" = NOW(),
        "updatedAt" = NOW()
    WHERE id = $1
    `,
    id
  );
}

async function markFailed(id: string, error: string) {
  await prisma.$executeRawUnsafe(
    `
    UPDATE "ExecutionOutboxEvent"
    SET status = 'FAILED',
        "retryCount" = "retryCount" + 1,
        "lastError" = $2,
        "availableAt" = NOW() + INTERVAL '5 seconds',
        "updatedAt" = NOW()
    WHERE id = $1
    `,
    id,
    error.slice(0, 700)
  );
}

function asQueueJob(payload: unknown): QueueJob | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const raw = payload as Record<string, unknown>;
  if (typeof raw.name !== "string") {
    return null;
  }
  return raw as unknown as QueueJob;
}

async function tick() {
  const rows = await claimPendingRows();
  for (const row of rows) {
    const job = asQueueJob(row.payload);
    if (!job) {
      await markFailed(row.id, "invalid_outbox_payload");
      continue;
    }
    const published = await publishQueueJob(job);
    if (!published.ok) {
      await markFailed(row.id, published.error ?? published.reason);
      continue;
    }
    await markDispatched(row.id);
  }
}

async function main() {
  // eslint-disable-next-line no-console
  console.info("[outbox-dispatcher] started");

  while (true) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await tick();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[outbox-dispatcher] tick failed", error);
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

void main();
