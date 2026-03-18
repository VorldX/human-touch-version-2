import "server-only";

import { prisma } from "@/lib/db/prisma";
import {
  DNA_PHASE2_SCHEMA_VERSION,
  dnaPhase2Config
} from "@/lib/dna/phase2/config";
import {
  enqueueClaimCheckTask,
  ensurePhase2Partitions,
  listIdleSessionsForBatch,
  markSessionQueued
} from "@/lib/dna/phase2/claim-check";

const globalTimers = globalThis as unknown as {
  dnaPhase2IdleTimers?: Map<string, ReturnType<typeof setTimeout>>;
};

const idleTimers =
  globalTimers.dnaPhase2IdleTimers ??
  (globalTimers.dnaPhase2IdleTimers = new Map<string, ReturnType<typeof setTimeout>>());

function timerKey(input: { tenantId: string; userId: string; sessionId: string }) {
  return `${input.tenantId}:${input.userId}:${input.sessionId}`;
}

export async function registerSessionActivity(input: {
  tenantId: string;
  userId: string;
  sessionId: string;
  activityAt?: Date;
}) {
  if (!dnaPhase2Config.enabled) {
    return;
  }

  const activityAt = input.activityAt ?? new Date();
  await ensurePhase2Partitions({ tenantId: input.tenantId, userId: input.userId });

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO dna_memory.session_activity (
        tenant_id,
        user_id,
        session_id,
        last_message_at,
        schema_version
      )
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (tenant_id, user_id, session_id)
      DO UPDATE
      SET
        last_message_at = EXCLUDED.last_message_at,
        version = dna_memory.session_activity.version + 1,
        updated_at = NOW()
    `,
    input.tenantId,
    input.userId,
    input.sessionId,
    activityAt,
    DNA_PHASE2_SCHEMA_VERSION
  );

  scheduleIdleTrigger({
    tenantId: input.tenantId,
    userId: input.userId,
    sessionId: input.sessionId
  });
}

function scheduleIdleTrigger(input: {
  tenantId: string;
  userId: string;
  sessionId: string;
}) {
  const key = timerKey(input);
  const existing = idleTimers.get(key);
  if (existing) {
    clearTimeout(existing);
  }

  const delayMs = Math.max(1, dnaPhase2Config.idleWindowMinutes) * 60 * 1000;
  const handle = setTimeout(() => {
    void enqueueIdleSessionIfDue(input).catch((error) => {
      console.warn("[dna-memory][phase2] idle enqueue failed", error);
    });
  }, delayMs);

  idleTimers.set(key, handle);
}

export async function enqueueIdleSessionIfDue(input: {
  tenantId: string;
  userId: string;
  sessionId: string;
}) {
  if (!dnaPhase2Config.enabled) {
    return {
      queued: false,
      reason: "disabled" as const
    };
  }

  const dueRows = await prisma.$queryRawUnsafe<Array<{ due: boolean }>>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM dna_memory.session_activity
        WHERE tenant_id = $1
          AND user_id = $2
          AND session_id = $3
          AND last_message_at <= NOW() - (($4::text || ' minutes')::interval)
          AND (last_queued_at IS NULL OR last_queued_at < last_message_at)
      ) AS due
    `,
    input.tenantId,
    input.userId,
    input.sessionId,
    Math.max(1, dnaPhase2Config.idleWindowMinutes)
  );

  if (!dueRows[0]?.due) {
    return {
      queued: false,
      reason: "not_due" as const
    };
  }

  const queued = await enqueueClaimCheckTask({
    tenantId: input.tenantId,
    userId: input.userId,
    sessionId: input.sessionId,
    payload: {
      reason: "SESSION_IDLE_10M",
      idle_minutes: dnaPhase2Config.idleWindowMinutes,
      triggered_at: new Date().toISOString()
    }
  });

  await markSessionQueued({
    tenantId: input.tenantId,
    userId: input.userId,
    sessionId: input.sessionId
  });

  return {
    queued: true,
    taskId: queued.taskId,
    streamPublished: queued.streamPublished,
    warning: queued.warning
  };
}

export async function enqueueIdleSessionsForOrg(input: {
  tenantId: string;
  limit?: number;
}) {
  if (!dnaPhase2Config.enabled) {
    return {
      inspected: 0,
      queued: 0,
      streamPublished: 0,
      warnings: [] as string[]
    };
  }

  const rows = await listIdleSessionsForBatch({
    tenantId: input.tenantId,
    idleMinutes: dnaPhase2Config.idleWindowMinutes,
    limit: Math.max(1, input.limit ?? dnaPhase2Config.sessionSweepLimit)
  });

  let queuedCount = 0;
  let streamPublished = 0;
  const warnings: string[] = [];

  for (const row of rows) {
    // Keep queue ordering deterministic for backpressure control.
    // eslint-disable-next-line no-await-in-loop
    const queued = await enqueueClaimCheckTask({
      tenantId: row.tenantId,
      userId: row.userId,
      sessionId: row.sessionId,
      payload: {
        reason: "SCHEDULED_IDLE_SWEEP",
        idle_minutes: dnaPhase2Config.idleWindowMinutes,
        triggered_at: new Date().toISOString()
      }
    });

    // eslint-disable-next-line no-await-in-loop
    await markSessionQueued({
      tenantId: row.tenantId,
      userId: row.userId,
      sessionId: row.sessionId
    });

    queuedCount += 1;
    if (queued.streamPublished) {
      streamPublished += 1;
    }
    if (queued.warning) {
      warnings.push(`${row.sessionId}: ${queued.warning}`);
    }
  }

  return {
    inspected: rows.length,
    queued: queuedCount,
    streamPublished,
    warnings
  };
}
