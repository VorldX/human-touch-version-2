import "server-only";

import { logError, logInfo } from "@/lib/observability/logger";
import { inngest } from "@/src/inngest/client";
import { INNGEST_EVENTS } from "@/src/inngest/events/catalog";
import type { MemoryUpdateEventData } from "@/src/inngest/events/types";
import { persistWorkflowReviewMemory } from "@/src/memory/long-term/store";
import { patchWorkflowState } from "@/src/memory/short-term/store";
import {
  claimIdempotency,
  markIdempotencyFailed,
  markIdempotencySucceeded,
  stableHash
} from "@/src/orchestrator/idempotency";

export const memoryWriterFunction = inngest.createFunction(
  { id: "memory-writer", retries: 2 },
  { event: INNGEST_EVENTS.memoryUpdate },
  async ({ event, step }) => {
    const payload = event.data as MemoryUpdateEventData;
    const scope = "inngest.memory-writer";
    const key = payload.workflowId;
    const requestHash = stableHash(payload);

    const claim = await step.run("idempotency-claim", () =>
      claimIdempotency({
        orgId: payload.orgId,
        scope,
        key,
        requestHash
      })
    );
    if (!claim.acquired) {
      return {
        ok: true,
        deduped: true,
        reason: claim.reason
      };
    }

    try {
      await step.run("log-event-received", () => {
        // eslint-disable-next-line no-console
        console.log("MEMORY_UPDATE_EVENT_RECEIVED", payload.workflowId);
        return true;
      });

      await step.run("persist-review-to-long-term-memory", () =>
        persistWorkflowReviewMemory({
          orgId: payload.orgId,
          workflowId: payload.workflowId,
          requestId: payload.requestId,
          prompt: payload.prompt,
          review: payload.review,
          taskResults: payload.taskResults
        })
      );

      await step.run("sync-short-term-review", () =>
        patchWorkflowState(payload.workflowId, (current) => ({
          ...current,
          finalReview: payload.review,
          updatedAt: new Date().toISOString()
        }))
      );

      await step.run("idempotency-mark-success", () =>
        markIdempotencySucceeded({
          orgId: payload.orgId,
          scope,
          key,
          response: {
            workflowId: payload.workflowId,
            score: payload.review.score
          }
        })
      );

      await step.run("log-memory-write-complete", () => {
        logInfo({
          service: "inngest-memory-writer",
          orgId: payload.orgId,
          runId: payload.workflowId,
          event: "function.completed",
          message: `memory/update persisted for workflow=${payload.workflowId}`,
          meta: {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0
          }
        });
        return true;
      });

      return {
        ok: true,
        workflowId: payload.workflowId
      };
    } catch (error) {
      await step.run("idempotency-mark-failed", () =>
        markIdempotencyFailed({
          orgId: payload.orgId,
          scope,
          key,
          error
        })
      );
      await step.run("log-memory-write-failed", () => {
        logError({
          service: "inngest-memory-writer",
          orgId: payload.orgId,
          runId: payload.workflowId,
          event: "function.failed",
          message: error instanceof Error ? error.message : "memory-writer failed"
        });
        return true;
      });
      throw error;
    }
  }
);
