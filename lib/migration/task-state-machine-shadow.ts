import "server-only";

import { prisma } from "@/lib/db/prisma";

export enum ShadowTaskState {
  CREATED = "CREATED",
  QUEUED = "QUEUED",
  RUNNING = "RUNNING",
  WAITING_TOOL = "WAITING_TOOL",
  RETRYING = "RETRYING",
  FAILED = "FAILED",
  COMPLETED = "COMPLETED"
}

const ALLOWED: Record<ShadowTaskState, ShadowTaskState[]> = {
  [ShadowTaskState.CREATED]: [ShadowTaskState.QUEUED, ShadowTaskState.FAILED],
  [ShadowTaskState.QUEUED]: [ShadowTaskState.RUNNING, ShadowTaskState.RETRYING, ShadowTaskState.FAILED],
  [ShadowTaskState.RUNNING]: [
    ShadowTaskState.WAITING_TOOL,
    ShadowTaskState.RETRYING,
    ShadowTaskState.COMPLETED,
    ShadowTaskState.FAILED
  ],
  [ShadowTaskState.WAITING_TOOL]: [ShadowTaskState.RUNNING, ShadowTaskState.RETRYING, ShadowTaskState.FAILED],
  [ShadowTaskState.RETRYING]: [ShadowTaskState.QUEUED, ShadowTaskState.FAILED],
  [ShadowTaskState.FAILED]: [],
  [ShadowTaskState.COMPLETED]: []
};

function canTransition(from: ShadowTaskState, to: ShadowTaskState) {
  if (from === to) return true;
  return ALLOWED[from].includes(to);
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function resolveTargetState(eventName: string): ShadowTaskState | null {
  if (eventName === "vorldx/task.resumed") return ShadowTaskState.QUEUED;
  if (eventName === "vorldx/task.completed") return ShadowTaskState.COMPLETED;
  if (eventName === "vorldx/task.failed") return ShadowTaskState.FAILED;
  return null;
}

export async function shadowWriteTaskStateFromLegacyEvent(input: {
  name: string;
  data: Record<string, unknown>;
}) {
  const targetState = resolveTargetState(input.name);
  if (!targetState) {
    return { ok: false as const, reason: "event_not_mapped" as const };
  }

  const orgId = asString(input.data.orgId);
  const runId = asString(input.data.flowId) || asString(input.data.runId);
  const taskId = asString(input.data.taskId);
  if (!orgId || !runId || !taskId) {
    return { ok: false as const, reason: "missing_identity" as const };
  }

  const record = await prisma.taskExecutionState.findUnique({
    where: { taskId },
    select: { id: true, state: true, version: true }
  });

  if (!record) {
    const created = await prisma.taskExecutionState.create({
      data: {
        orgId,
        runId,
        taskId,
        state: targetState
      },
      select: { id: true, state: true, version: true }
    });

    await prisma.taskExecutionAttempt.create({
      data: {
        orgId,
        runId,
        taskId,
        attemptNo: 1,
        state: targetState,
        startedAt: new Date(),
        endedAt:
          targetState === ShadowTaskState.COMPLETED || targetState === ShadowTaskState.FAILED
            ? new Date()
            : null
      }
    });

    return {
      ok: true as const,
      reason: "created" as const,
      state: created.state
    };
  }

  const from = record.state as ShadowTaskState;
  if (!canTransition(from, targetState)) {
    return {
      ok: false as const,
      reason: "illegal_transition" as const,
      from,
      to: targetState
    };
  }

  const updated = await prisma.taskExecutionState.updateMany({
    where: {
      taskId,
      state: from,
      version: record.version
    },
    data: {
      state: targetState,
      version: { increment: 1 },
      ...(targetState === ShadowTaskState.FAILED
        ? { lastError: asString(input.data.reason) || "legacy_failed_event" }
        : {})
    }
  });

  if (updated.count !== 1) {
    return { ok: false as const, reason: "version_conflict" as const };
  }

  const attemptNo = Number.isFinite(Number(input.data.attemptNo))
    ? Math.max(1, Math.floor(Number(input.data.attemptNo)))
    : 1;
  await prisma.taskExecutionAttempt.upsert({
    where: {
      taskId_attemptNo: {
        taskId,
        attemptNo
      }
    },
    create: {
      orgId,
      runId,
      taskId,
      attemptNo,
      state: targetState,
      startedAt: new Date(),
      endedAt:
        targetState === ShadowTaskState.COMPLETED || targetState === ShadowTaskState.FAILED
          ? new Date()
          : null
    },
    update: {
      state: targetState,
      endedAt:
        targetState === ShadowTaskState.COMPLETED || targetState === ShadowTaskState.FAILED
          ? new Date()
          : null
    }
  });

  return { ok: true as const, reason: "updated" as const, state: targetState };
}
