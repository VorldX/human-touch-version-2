import { randomUUID } from "node:crypto";

import type { QueueEnvelope, QueueJob, QueueJobName } from "@/lib/queue/job-types";

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function baseEnvelope<TName extends QueueJobName>(input: {
  jobName: TName;
  orgId: string;
  runId: string;
  traceId?: string;
  idempotencyKey: string;
}) {
  return {
    id: randomUUID(),
    name: input.jobName,
    version: 1 as const,
    orgId: input.orgId,
    runId: input.runId,
    idempotencyKey: input.idempotencyKey,
    traceId: input.traceId || randomUUID(),
    createdAt: new Date().toISOString()
  } as Omit<QueueEnvelope<TName, never>, "payload">;
}

export function mapLegacyEventToQueueJob(input: {
  name: string;
  data: Record<string, unknown>;
}): QueueJob | null {
  const eventName = input.name.trim();
  const payload = asRecord(input.data);
  const orgId = asString(payload.orgId);
  const runId = asString(payload.flowId) || asString(payload.runId);
  const taskId = asString(payload.taskId);
  const traceId = asString(payload.traceId);

  if (!orgId || !runId) {
    return null;
  }

  if (eventName === "vorldx/flow.launched") {
    return {
      ...baseEnvelope({
        jobName: "RUN_CREATED",
        orgId,
        runId,
        traceId,
        idempotencyKey: `legacy:${runId}:RUN_CREATED`
      }),
      payload: {
        initiatedByUserId: asString(payload.initiatedByUserId) || undefined,
        prompt: asString(payload.prompt),
        executionMode: ["ECO", "BALANCED", "TURBO"].includes(asString(payload.executionMode))
          ? (asString(payload.executionMode) as "ECO" | "BALANCED" | "TURBO")
          : undefined,
        legacyEventName: eventName,
        legacyPayload: payload
      }
    };
  }

  if (eventName === "vorldx/task.resumed" && taskId) {
    return {
      ...baseEnvelope({
        jobName: "TASK_READY",
        orgId,
        runId,
        traceId,
        idempotencyKey: `legacy:${runId}:${taskId}:TASK_READY`
      }),
      payload: {
        taskId,
        priority: 100,
        attemptNo: 1,
        legacyEventName: eventName,
        legacyPayload: payload
      }
    };
  }

  if (eventName === "vorldx/task.completed" && taskId) {
    return {
      ...baseEnvelope({
        jobName: "TASK_COMPLETED",
        orgId,
        runId,
        traceId,
        idempotencyKey: `legacy:${runId}:${taskId}:TASK_COMPLETED`
      }),
      payload: {
        taskId,
        attemptNo: 1,
        outputRef: asString(payload.outputRef) || undefined,
        outputHash: asString(payload.outputHash) || undefined,
        legacyEventName: eventName,
        legacyPayload: payload
      }
    };
  }

  if (eventName === "vorldx/task.failed" && taskId) {
    return {
      ...baseEnvelope({
        jobName: "DEAD_LETTER",
        orgId,
        runId,
        traceId,
        idempotencyKey: `legacy:${runId}:${taskId}:DEAD_LETTER`
      }),
      payload: {
        failedJobName: "TASK_EXECUTE",
        failedJobId: taskId,
        reason: asString(payload.reason) || "legacy_task_failed",
        retryCount: 0,
        payloadSnapshot: payload
      }
    };
  }

  if (eventName === "vorldx/flow.progress") {
    return {
      ...baseEnvelope({
        jobName: "PLAN_GENERATED",
        orgId,
        runId,
        traceId,
        idempotencyKey: `legacy:${runId}:PLAN_GENERATED`
      }),
      payload: {
        plannerAgentId: asString(payload.plannerAgentId) || undefined,
        planId: asString(payload.planId) || undefined,
        taskIds: Array.isArray(payload.taskIds)
          ? payload.taskIds.map((item) => asString(item)).filter(Boolean)
          : [],
        legacyEventName: eventName,
        legacyPayload: payload
      }
    };
  }

  return null;
}
