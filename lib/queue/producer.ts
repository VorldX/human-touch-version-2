import "server-only";

import type { QueueJob } from "@/lib/queue/job-types";
import { getQueue } from "@/lib/queue/queues";

export interface QueuePublishResult {
  ok: boolean;
  reason: "published" | "queue_unconfigured" | "publish_failed";
  jobId: string | null;
  error?: string;
}

export async function publishQueueJob(job: QueueJob): Promise<QueuePublishResult> {
  const queue = getQueue(job.name);
  if (!queue) {
    return {
      ok: false,
      reason: "queue_unconfigured",
      jobId: null
    };
  }

  try {
    const enqueued = await queue.add(job.name, job, {
      jobId: job.idempotencyKey,
      removeOnComplete: 2000,
      removeOnFail: 10000,
      attempts: 1
    });

    return {
      ok: true,
      reason: "published",
      jobId: enqueued.id ?? null
    };
  } catch (error) {
    return {
      ok: false,
      reason: "publish_failed",
      jobId: null,
      error: error instanceof Error ? error.message : "unknown_publish_error"
    };
  }
}
