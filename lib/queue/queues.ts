import "server-only";

import { Queue } from "bullmq";

import type { QueueJobName } from "@/lib/queue/job-types";
import { getBullMqConnection } from "@/lib/queue/connection";

type QueueName =
  | "orchestrator-control"
  | "planning-jobs"
  | "task-lifecycle"
  | "tool-execution"
  | "run-completion"
  | "dead-letter";

const JOB_QUEUE_MAP: Record<QueueJobName, QueueName> = {
  RUN_CREATED: "orchestrator-control",
  PLAN_GENERATED: "planning-jobs",
  TASK_READY: "task-lifecycle",
  TASK_EXECUTE: "task-lifecycle",
  TOOL_CALL: "tool-execution",
  TASK_COMPLETED: "task-lifecycle",
  RUN_COMPLETED: "run-completion",
  DEAD_LETTER: "dead-letter"
};

const queueCache = new Map<QueueName, Queue>();

export function resolveQueueName(jobName: QueueJobName) {
  return JOB_QUEUE_MAP[jobName];
}

export function getQueue(jobName: QueueJobName): Queue | null {
  const queueName = resolveQueueName(jobName);
  const existing = queueCache.get(queueName);
  if (existing) {
    return existing;
  }

  const connection = getBullMqConnection();
  if (!connection) {
    return null;
  }

  const queue = new Queue(queueName, { connection });
  queueCache.set(queueName, queue);
  return queue;
}
