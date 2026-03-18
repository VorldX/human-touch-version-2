import "server-only";

import { prisma } from "@/lib/db/prisma";
import {
  DNA_PHASE2_SCHEMA_VERSION,
  dnaPhase2Config
} from "@/lib/dna/phase2/config";
import { xaddStreamPointer } from "@/lib/redis/stream-client";

interface EnqueuedTaskRow {
  taskId: string;
  version: number;
}

interface IdleSessionRow {
  tenantId: string;
  userId: string;
  sessionId: string;
}

function asJson(value: unknown) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

export async function ensurePhase2Partitions(input: {
  tenantId: string;
  userId: string;
}) {
  await prisma.$queryRawUnsafe(
    "SELECT * FROM dna_memory.ensure_phase2_partition_for_subject($1, $2)",
    input.tenantId,
    input.userId
  );
}

export async function enqueueClaimCheckTask(input: {
  tenantId: string;
  userId: string;
  sessionId: string;
  taskType?: string;
  payload: Record<string, unknown>;
  availableAt?: Date;
}) {
  await ensurePhase2Partitions({
    tenantId: input.tenantId,
    userId: input.userId
  });

  const taskType = input.taskType?.trim() || dnaPhase2Config.slm.taskType;
  const payload = {
    schema_version: DNA_PHASE2_SCHEMA_VERSION,
    tenant_id: input.tenantId,
    user_id: input.userId,
    session_id: input.sessionId,
    ...input.payload
  };

  const rows = await prisma.$queryRawUnsafe<EnqueuedTaskRow[]>(
    `
      INSERT INTO dna_memory.claim_check_tasks (
        tenant_id,
        user_id,
        session_id,
        task_type,
        payload_jsonb,
        available_at,
        schema_version
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
      RETURNING task_id::text AS "taskId", version
    `,
    input.tenantId,
    input.userId,
    input.sessionId,
    taskType,
    asJson(payload),
    input.availableAt ?? new Date(),
    DNA_PHASE2_SCHEMA_VERSION
  );

  const row = rows[0];
  if (!row?.taskId) {
    throw new Error("Unable to enqueue claim-check task.");
  }

  const streamPush = await xaddStreamPointer({
    stream: dnaPhase2Config.queue.streamKey,
    fields: {
      task_id: row.taskId,
      tenant_id: input.tenantId,
      user_id: input.userId,
      session_id: input.sessionId,
      task_type: taskType,
      schema_version: DNA_PHASE2_SCHEMA_VERSION
    }
  });

  if (streamPush.ok && streamPush.streamId) {
    await prisma.$executeRawUnsafe(
      `
        UPDATE dna_memory.claim_check_tasks
        SET stream_id = $1,
            updated_at = NOW()
        WHERE tenant_id = $2
          AND user_id = $3
          AND task_id = $4::uuid
      `,
      streamPush.streamId,
      input.tenantId,
      input.userId,
      row.taskId
    );
  }

  return {
    taskId: row.taskId,
    streamPublished: streamPush.ok,
    streamId: streamPush.streamId,
    warning: streamPush.ok ? null : streamPush.reason
  };
}

export async function markSessionQueued(input: {
  tenantId: string;
  userId: string;
  sessionId: string;
  queuedAt?: Date;
}) {
  await prisma.$executeRawUnsafe(
    `
      UPDATE dna_memory.session_activity
      SET
        last_queued_at = $4,
        version = version + 1,
        updated_at = NOW()
      WHERE tenant_id = $1
        AND user_id = $2
        AND session_id = $3
        AND (last_queued_at IS NULL OR last_queued_at < last_message_at)
    `,
    input.tenantId,
    input.userId,
    input.sessionId,
    input.queuedAt ?? new Date()
  );
}

export async function listIdleSessionsForBatch(input: {
  tenantId: string;
  idleMinutes: number;
  limit: number;
}) {
  const rows = await prisma.$queryRawUnsafe<IdleSessionRow[]>(
    `
      SELECT
        tenant_id AS "tenantId",
        user_id AS "userId",
        session_id AS "sessionId"
      FROM dna_memory.session_activity
      WHERE tenant_id = $1
        AND last_message_at <= NOW() - (($2::text || ' minutes')::interval)
        AND (last_queued_at IS NULL OR last_queued_at < last_message_at)
      ORDER BY last_message_at ASC
      LIMIT $3
    `,
    input.tenantId,
    Math.max(1, input.idleMinutes),
    Math.max(1, input.limit)
  );

  return rows;
}
