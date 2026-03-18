import { Worker } from "bullmq";

import { prisma } from "@/lib/db/prisma";
import { getBullMqConnection } from "@/lib/queue/connection";

const connection = getBullMqConnection();

if (!connection) {
  // eslint-disable-next-line no-console
  console.error("[queue-shadow-worker] REDIS_URL is not configured.");
  process.exit(1);
}

function parseBoolean(value: string | undefined, fallback = false) {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

const enabled = parseBoolean(process.env.FEATURE_QUEUE_SHADOW_CONSUMER, false);

if (!enabled) {
  // eslint-disable-next-line no-console
  console.warn("[queue-shadow-worker] FEATURE_QUEUE_SHADOW_CONSUMER=false, exiting.");
  process.exit(0);
}

const QUEUES = [
  "orchestrator-control",
  "planning-jobs",
  "task-lifecycle",
  "tool-execution",
  "run-completion",
  "dead-letter"
] as const;

for (const queueName of QUEUES) {
  // Shadow worker must never mutate production task state.
  // It only records observability rows for side-by-side comparison.
  new Worker(
    queueName,
    async (job) => {
      const data = (job.data ?? {}) as Record<string, unknown>;
      const orgId = typeof data.orgId === "string" ? data.orgId : "";
      if (!orgId) {
        return;
      }

      await prisma.log.create({
        data: {
          orgId,
          type: "EXE",
          actor: "QUEUE_SHADOW_WORKER",
          message: `[shadow] observed ${job.name} on ${queueName} job=${String(job.id ?? "n/a")} attempts=${job.attemptsMade} runId=${typeof data.runId === "string" ? data.runId : "n/a"} traceId=${typeof data.traceId === "string" ? data.traceId : "n/a"}`
        }
      });
    },
    {
      connection,
      concurrency: 10
    }
  );
}

// eslint-disable-next-line no-console
console.info("[queue-shadow-worker] started.");
