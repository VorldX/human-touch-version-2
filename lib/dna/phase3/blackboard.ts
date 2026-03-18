import "server-only";

import { prisma } from "@/lib/db/prisma";
import { DNA_PHASE3_SCHEMA_VERSION, dnaPhase3Config } from "@/lib/dna/phase3/config";
import { ensurePhase3Partitions } from "@/lib/dna/phase3/pathway-registry";
import { publishDnaUpdateEvent } from "@/lib/dna/phase3/sync-bus";
import {
  acquireRedisMutexLock,
  getRedisClient,
  readRedisLockToken,
  releaseRedisMutexLock
} from "@/lib/redis/stream-client";

interface PathwayLookupRow {
  pathwayId: string;
  pathwayName: string;
  pathwayJsonb: unknown;
}

interface BlackboardInsertRow {
  id: number;
  boardId: string;
  version: number;
}

interface BlackboardStepRow {
  id: number;
  version: number;
  stepKey: string;
  stepOrder: number;
  status: "PENDING" | "CLAIMED" | "IN_PROGRESS" | "COMPLETED" | "SKIPPED";
  stepPayloadJsonb: unknown;
  claimedByAgentId: string | null;
  lockToken: string | null;
  lockExpiresAt: Date | null;
  completedAt: Date | null;
  resultJsonb: unknown;
  updatedAt: Date;
}

interface BoardOverviewRow {
  boardId: string;
  pathwayId: string | null;
  sessionId: string;
  boardStatus: "ACTIVE" | "COMPLETED" | "FAILED" | "CANCELLED";
  createdAt: Date;
  totalSteps: number;
  pendingSteps: number;
  claimedSteps: number;
  completedSteps: number;
}

interface PathwayStep {
  stepKey: string;
  title: string;
  payload: Record<string, unknown>;
}

function asJson(value: unknown) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function lockKey(input: {
  tenantId: string;
  userId: string;
  boardId: string;
  stepId: number;
}) {
  return `dna_memory:blackboard:lock:${input.tenantId}:${input.userId}:${input.boardId}:${input.stepId}`;
}

function boardStepsKey(input: {
  tenantId: string;
  userId: string;
  boardId: string;
}) {
  return `dna_memory:blackboard:${input.tenantId}:${input.userId}:${input.boardId}:steps`;
}

function boardMetaKey(input: {
  tenantId: string;
  userId: string;
  boardId: string;
}) {
  return `dna_memory:blackboard:${input.tenantId}:${input.userId}:${input.boardId}:meta`;
}

function parsePathwaySteps(pathwayJsonb: unknown) {
  const root = asRecord(pathwayJsonb);
  const rawSteps = Array.isArray(root.steps) ? root.steps : [];

  const maxSteps = Math.max(1, dnaPhase3Config.pathwayRegistry.maxSteps);

  const parsed = rawSteps
    .slice(0, maxSteps)
    .map((item, index) => {
      if (typeof item === "string") {
        const title = item.trim() || `Step ${index + 1}`;
        return {
          stepKey: `step_${index + 1}`,
          title,
          payload: {
            step_key: `step_${index + 1}`,
            title
          }
        } satisfies PathwayStep;
      }

      const record = asRecord(item);
      const explicitKey = normalizeText(record.step_key) || normalizeText(record.key) || `step_${index + 1}`;
      const explicitTitle =
        normalizeText(record.title) ||
        normalizeText(record.step) ||
        normalizeText(record.description) ||
        (() => {
          const loose = Object.keys(record).find((key) => /^step[_-]?\d+$/i.test(key));
          return loose ? normalizeText(record[loose]) : "";
        })() ||
        `Step ${index + 1}`;

      return {
        stepKey: explicitKey,
        title: explicitTitle,
        payload: {
          step_key: explicitKey,
          title: explicitTitle,
          ...record
        }
      } satisfies PathwayStep;
    })
    .filter((step) => step.title.length > 0);

  if (parsed.length === 0) {
    throw new Error("Pathway has no executable steps.");
  }

  return parsed;
}

async function loadPathway(input: {
  tenantId: string;
  userId: string;
  pathwayId?: string | null;
  pathwayName?: string | null;
}) {
  const pathwayId = normalizeText(input.pathwayId);
  const pathwayName = normalizeText(input.pathwayName);

  const rows = await prisma.$queryRawUnsafe<PathwayLookupRow[]>(
    `
      SELECT
        pathway_id::text AS "pathwayId",
        pathway_name AS "pathwayName",
        pathway_jsonb AS "pathwayJsonb"
      FROM dna_memory.pathway_registry
      WHERE tenant_id = $1
        AND user_id = $2
        AND status = 'ACTIVE'::dna_memory.pathway_status
        AND (
          ($3::text <> '' AND pathway_id = $3::uuid)
          OR ($4::text <> '' AND lower(pathway_name) = lower($4))
        )
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    input.tenantId,
    input.userId,
    pathwayId,
    pathwayName
  );

  return rows[0] ?? null;
}

async function publishBoardToRedis(input: {
  tenantId: string;
  userId: string;
  boardId: string;
  sessionId: string;
  pathwayId: string;
  pathwayName: string;
  steps: PathwayStep[];
}) {
  const client = await getRedisClient();
  if (!client) {
    return {
      published: false,
      reason: "redis_unavailable"
    };
  }

  const stepListKey = boardStepsKey({
    tenantId: input.tenantId,
    userId: input.userId,
    boardId: input.boardId
  });
  const metaKey = boardMetaKey({
    tenantId: input.tenantId,
    userId: input.userId,
    boardId: input.boardId
  });

  try {
    await client.del(stepListKey);
    if (input.steps.length > 0) {
      await client.rPush(
        stepListKey,
        input.steps.map((step, index) =>
          JSON.stringify({
            board_id: input.boardId,
            step_order: index,
            step_key: step.stepKey,
            title: step.title,
            payload: step.payload
          })
        )
      );
    }

    await client.hSet(metaKey, {
      board_id: input.boardId,
      pathway_id: input.pathwayId,
      pathway_name: input.pathwayName,
      session_id: input.sessionId,
      schema_version: DNA_PHASE3_SCHEMA_VERSION,
      updated_at: new Date().toISOString()
    });

    return {
      published: true,
      reason: "published"
    };
  } catch (error) {
    return {
      published: false,
      reason: error instanceof Error ? error.message : "redis_publish_blackboard_failed"
    };
  }
}

export async function createBlackboardSession(input: {
  tenantId: string;
  userId: string;
  sessionId: string;
  pathwayId?: string | null;
  pathwayName?: string | null;
  flowId?: string | null;
  mainAgentId?: string | null;
  payload?: Record<string, unknown>;
}) {
  await ensurePhase3Partitions({ tenantId: input.tenantId, userId: input.userId });

  const pathway = await loadPathway({
    tenantId: input.tenantId,
    userId: input.userId,
    pathwayId: input.pathwayId,
    pathwayName: input.pathwayName
  });

  if (!pathway?.pathwayId) {
    throw new Error("Pathway not found. Create pathway registry entry first.");
  }

  const steps = parsePathwaySteps(pathway.pathwayJsonb);

  const boardRows = await prisma.$queryRawUnsafe<BlackboardInsertRow[]>(
    `
      INSERT INTO dna_memory.blackboard_sessions (
        tenant_id,
        user_id,
        pathway_id,
        session_id,
        flow_id,
        main_agent_id,
        status,
        payload_jsonb,
        schema_version
      )
      VALUES (
        $1,
        $2,
        $3::uuid,
        $4,
        $5,
        $6,
        'ACTIVE'::dna_memory.blackboard_status,
        $7::jsonb,
        $8
      )
      RETURNING id, board_id::text AS "boardId", version
    `,
    input.tenantId,
    input.userId,
    pathway.pathwayId,
    input.sessionId,
    input.flowId ?? null,
    input.mainAgentId ?? null,
    asJson(input.payload ?? {}),
    DNA_PHASE3_SCHEMA_VERSION
  );

  const board = boardRows[0];
  if (!board?.boardId) {
    throw new Error("Unable to create blackboard session.");
  }

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    // eslint-disable-next-line no-await-in-loop
    await prisma.$executeRawUnsafe(
      `
        INSERT INTO dna_memory.blackboard_steps (
          tenant_id,
          user_id,
          board_id,
          pathway_id,
          step_key,
          step_order,
          step_payload_jsonb,
          status,
          schema_version
        )
        VALUES (
          $1,
          $2,
          $3::uuid,
          $4::uuid,
          $5,
          $6,
          $7::jsonb,
          'PENDING'::dna_memory.blackboard_step_status,
          $8
        )
      `,
      input.tenantId,
      input.userId,
      board.boardId,
      pathway.pathwayId,
      step.stepKey,
      index,
      asJson(step.payload),
      DNA_PHASE3_SCHEMA_VERSION
    );
  }

  const redisPublish = await publishBoardToRedis({
    tenantId: input.tenantId,
    userId: input.userId,
    boardId: board.boardId,
    sessionId: input.sessionId,
    pathwayId: pathway.pathwayId,
    pathwayName: pathway.pathwayName,
    steps
  });

  const syncEvent = await publishDnaUpdateEvent({
    tenantId: input.tenantId,
    userId: input.userId,
    payload: {
      source: "phase3.blackboard.create",
      board_id: board.boardId,
      session_id: input.sessionId,
      pathway_id: pathway.pathwayId,
      pathway_name: pathway.pathwayName,
      step_count: steps.length
    }
  });

  return {
    boardId: board.boardId,
    pathwayId: pathway.pathwayId,
    pathwayName: pathway.pathwayName,
    stepCount: steps.length,
    redisPublished: redisPublish.published,
    redisWarning: redisPublish.published ? null : redisPublish.reason,
    syncEventId: syncEvent.eventId
  };
}

export async function claimNextBlackboardStep(input: {
  tenantId: string;
  userId: string;
  boardId: string;
  agentId: string;
}) {
  await ensurePhase3Partitions({ tenantId: input.tenantId, userId: input.userId });

  const candidates = await prisma.$queryRawUnsafe<BlackboardStepRow[]>(
    `
      SELECT
        id,
        version,
        step_key AS "stepKey",
        step_order AS "stepOrder",
        status::text AS status,
        step_payload_jsonb AS "stepPayloadJsonb",
        claimed_by_agent_id AS "claimedByAgentId",
        lock_token AS "lockToken",
        lock_expires_at AS "lockExpiresAt",
        completed_at AS "completedAt",
        result_jsonb AS "resultJsonb",
        updated_at AS "updatedAt"
      FROM dna_memory.blackboard_steps
      WHERE tenant_id = $1
        AND user_id = $2
        AND board_id = $3::uuid
        AND status IN (
          'PENDING'::dna_memory.blackboard_step_status,
          'CLAIMED'::dna_memory.blackboard_step_status,
          'IN_PROGRESS'::dna_memory.blackboard_step_status
        )
      ORDER BY step_order ASC
      LIMIT $4
    `,
    input.tenantId,
    input.userId,
    input.boardId,
    Math.max(1, Math.min(200, dnaPhase3Config.blackboard.claimScanLimit))
  );

  const now = Date.now();

  for (const candidate of candidates) {
    if (
      candidate.status !== "PENDING" &&
      candidate.lockExpiresAt instanceof Date &&
      candidate.lockExpiresAt.getTime() > now
    ) {
      continue;
    }

    const key = lockKey({
      tenantId: input.tenantId,
      userId: input.userId,
      boardId: input.boardId,
      stepId: candidate.id
    });

    // Skip already-locked steps using Redis mutex semantics (SETNX).
    // eslint-disable-next-line no-await-in-loop
    const lock = await acquireRedisMutexLock({
      key,
      owner: input.agentId,
      ttlMs: dnaPhase3Config.blackboard.mutexTtlMs
    });

    if (!lock.acquired || !lock.token) {
      continue;
    }

    const lockExpiresAt = new Date(Date.now() + dnaPhase3Config.blackboard.mutexTtlMs);

    // eslint-disable-next-line no-await-in-loop
    const occRows = await prisma.$queryRawUnsafe<Array<{ applied: boolean; newVersion: number | null }>>(
      `
        SELECT
          applied,
          new_version AS "newVersion"
        FROM dna_memory.update_blackboard_step_occ(
          $1,
          $2,
          $3,
          $4,
          'IN_PROGRESS'::dna_memory.blackboard_step_status,
          $5,
          $6,
          $7,
          NULL,
          NULL
        )
      `,
      input.tenantId,
      input.userId,
      candidate.id,
      candidate.version,
      input.agentId,
      lock.token,
      lockExpiresAt
    );

    if (!occRows[0]?.applied) {
      // eslint-disable-next-line no-await-in-loop
      await releaseRedisMutexLock({
        key,
        token: lock.token
      });
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    await publishDnaUpdateEvent({
      tenantId: input.tenantId,
      userId: input.userId,
      payload: {
        source: "phase3.blackboard.claim",
        board_id: input.boardId,
        step_id: candidate.id,
        step_key: candidate.stepKey,
        claimed_by_agent_id: input.agentId
      }
    });

    return {
      claimed: true,
      step: {
        id: candidate.id,
        stepKey: candidate.stepKey,
        stepOrder: candidate.stepOrder,
        payload: candidate.stepPayloadJsonb,
        status: "IN_PROGRESS",
        claimedByAgentId: input.agentId,
        lockToken: lock.token,
        lockExpiresAt: lockExpiresAt.toISOString()
      }
    };
  }

  return {
    claimed: false,
    step: null
  };
}

export async function completeBlackboardStep(input: {
  tenantId: string;
  userId: string;
  boardId: string;
  stepId: number;
  agentId: string;
  lockToken: string;
  result?: Record<string, unknown>;
}) {
  await ensurePhase3Partitions({ tenantId: input.tenantId, userId: input.userId });

  const rows = await prisma.$queryRawUnsafe<BlackboardStepRow[]>(
    `
      SELECT
        id,
        version,
        step_key AS "stepKey",
        step_order AS "stepOrder",
        status::text AS status,
        step_payload_jsonb AS "stepPayloadJsonb",
        claimed_by_agent_id AS "claimedByAgentId",
        lock_token AS "lockToken",
        lock_expires_at AS "lockExpiresAt",
        completed_at AS "completedAt",
        result_jsonb AS "resultJsonb",
        updated_at AS "updatedAt"
      FROM dna_memory.blackboard_steps
      WHERE tenant_id = $1
        AND user_id = $2
        AND board_id = $3::uuid
        AND id = $4
      LIMIT 1
    `,
    input.tenantId,
    input.userId,
    input.boardId,
    input.stepId
  );

  const step = rows[0];
  if (!step) {
    return {
      completed: false,
      reason: "step_not_found" as const
    };
  }

  const key = lockKey({
    tenantId: input.tenantId,
    userId: input.userId,
    boardId: input.boardId,
    stepId: input.stepId
  });

  const liveToken = await readRedisLockToken({ key });
  if (!liveToken || liveToken !== input.lockToken) {
    return {
      completed: false,
      reason: "lock_token_mismatch" as const
    };
  }

  const resultPayload = {
    ...(input.result ?? {}),
    completed_by_agent_id: input.agentId,
    completed_at: new Date().toISOString()
  };

  const occRows = await prisma.$queryRawUnsafe<Array<{ applied: boolean; newVersion: number | null }>>(
    `
      SELECT
        applied,
        new_version AS "newVersion"
      FROM dna_memory.update_blackboard_step_occ(
        $1,
        $2,
        $3,
        $4,
        'COMPLETED'::dna_memory.blackboard_step_status,
        $5,
        NULL,
        NULL,
        $6::jsonb,
        NOW()
      )
    `,
    input.tenantId,
    input.userId,
    step.id,
    step.version,
    input.agentId,
    asJson(resultPayload)
  );

  if (!occRows[0]?.applied) {
    return {
      completed: false,
      reason: "occ_conflict" as const
    };
  }

  await releaseRedisMutexLock({
    key,
    token: input.lockToken
  });

  await prisma.$executeRawUnsafe(
    `
      UPDATE dna_memory.blackboard_sessions s
      SET
        status = 'COMPLETED'::dna_memory.blackboard_status,
        version = s.version + 1,
        updated_at = NOW()
      WHERE s.tenant_id = $1
        AND s.user_id = $2
        AND s.board_id = $3::uuid
        AND s.status = 'ACTIVE'::dna_memory.blackboard_status
        AND NOT EXISTS (
          SELECT 1
          FROM dna_memory.blackboard_steps st
          WHERE st.tenant_id = s.tenant_id
            AND st.user_id = s.user_id
            AND st.board_id = s.board_id
            AND st.status IN (
              'PENDING'::dna_memory.blackboard_step_status,
              'CLAIMED'::dna_memory.blackboard_step_status,
              'IN_PROGRESS'::dna_memory.blackboard_step_status
            )
        )
    `,
    input.tenantId,
    input.userId,
    input.boardId
  );

  await publishDnaUpdateEvent({
    tenantId: input.tenantId,
    userId: input.userId,
    payload: {
      source: "phase3.blackboard.complete",
      board_id: input.boardId,
      step_id: input.stepId,
      completed_by_agent_id: input.agentId
    }
  });

  return {
    completed: true,
    reason: "completed" as const
  };
}

export async function listBlackboardSnapshot(input: {
  tenantId: string;
  userId: string;
  boardId?: string | null;
  limit?: number;
}) {
  await ensurePhase3Partitions({ tenantId: input.tenantId, userId: input.userId });

  const limit = Math.max(
    1,
    Math.min(200, Math.floor(input.limit ?? dnaPhase3Config.blackboard.boardFetchLimit))
  );

  const boardRows = await prisma.$queryRawUnsafe<BoardOverviewRow[]>(
    `
      SELECT
        board_id::text AS "boardId",
        pathway_id::text AS "pathwayId",
        session_id AS "sessionId",
        board_status::text AS "boardStatus",
        created_at AS "createdAt",
        total_steps::int AS "totalSteps",
        pending_steps::int AS "pendingSteps",
        claimed_steps::int AS "claimedSteps",
        completed_steps::int AS "completedSteps"
      FROM dna_memory.phase3_blackboard_overview
      WHERE tenant_id = $1
        AND user_id = $2
        AND ($3::text = '' OR board_id = $3::uuid)
      ORDER BY created_at DESC
      LIMIT $4
    `,
    input.tenantId,
    input.userId,
    normalizeText(input.boardId),
    limit
  );

  const selectedBoardId = normalizeText(input.boardId) || boardRows[0]?.boardId || "";
  if (!selectedBoardId) {
    return {
      boards: boardRows,
      steps: [] as Array<BlackboardStepRow & { liveLockToken: string | null }>
    };
  }

  const steps = await prisma.$queryRawUnsafe<BlackboardStepRow[]>(
    `
      SELECT
        id,
        version,
        step_key AS "stepKey",
        step_order AS "stepOrder",
        status::text AS status,
        step_payload_jsonb AS "stepPayloadJsonb",
        claimed_by_agent_id AS "claimedByAgentId",
        lock_token AS "lockToken",
        lock_expires_at AS "lockExpiresAt",
        completed_at AS "completedAt",
        result_jsonb AS "resultJsonb",
        updated_at AS "updatedAt"
      FROM dna_memory.blackboard_steps
      WHERE tenant_id = $1
        AND user_id = $2
        AND board_id = $3::uuid
      ORDER BY step_order ASC
      LIMIT $4
    `,
    input.tenantId,
    input.userId,
    selectedBoardId,
    Math.max(1, Math.min(600, limit * 12))
  );

  const enriched: Array<BlackboardStepRow & { liveLockToken: string | null }> = [];

  for (const step of steps) {
    const key = lockKey({
      tenantId: input.tenantId,
      userId: input.userId,
      boardId: selectedBoardId,
      stepId: step.id
    });
    // eslint-disable-next-line no-await-in-loop
    const liveLockToken = await readRedisLockToken({ key });
    enriched.push({
      ...step,
      liveLockToken
    });
  }

  return {
    boards: boardRows,
    steps: enriched
  };
}
