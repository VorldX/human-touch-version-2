import "server-only";

import { logError, logInfo } from "@/lib/observability/logger";
import { reviewWorkflowDeterministically } from "@/src/agents/reviewer";
import { inngest } from "@/src/inngest/client";
import { INNGEST_EVENTS } from "@/src/inngest/events/catalog";
import type {
  AgentTaskCompletedEventData,
  MemoryUpdateEventData,
  WorkflowCompletedEventData
} from "@/src/inngest/events/types";
import { patchWorkflowState } from "@/src/memory/short-term/store";
import {
  acquireWorkflowReviewLock,
  incrementWorkflowCompletedCounter,
  releaseWorkflowReviewLock
} from "@/src/orchestrator/redis";
import {
  claimIdempotency,
  markIdempotencyFailed,
  markIdempotencySucceeded,
  stableHash
} from "@/src/orchestrator/idempotency";
import type { ShortTermWorkflowState } from "@/src/orchestrator/types";

export const reviewerFunction = inngest.createFunction(
  { id: "reviewer-function", retries: 2 },
  { event: INNGEST_EVENTS.agentTaskCompleted },
  async ({ event, step }) => {
    const startedAt = Date.now();
    const payload = event.data as AgentTaskCompletedEventData;
    const scope = "inngest.reviewer.task";
    const key = `${payload.workflowId}:${payload.result.taskId}`;
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
        console.log("WORKFLOW_TASK_COMPLETED_EVENT", payload);
        return true;
      });

      const state = await step.run("append-task-result-to-state", () =>
        patchWorkflowState(payload.workflowId, (current) => {
          if (current.taskResults[payload.result.taskId]) {
            return current;
          }
          const next: ShortTermWorkflowState = {
            ...current,
            taskResults: {
              ...current.taskResults,
              [payload.result.taskId]: payload.result
            },
            updatedAt: new Date().toISOString()
          };
          return next;
        })
      );

      if (!state) {
        throw new Error(`Workflow state missing for ${payload.workflowId}.`);
      }

      const totalTasks = state.plan.tasks.length || payload.totalTasks;
      const counter = await step.run("increment-completed-counter", () =>
        incrementWorkflowCompletedCounter({
          workflowId: payload.workflowId
        })
      );
      const completedTasks =
        typeof counter === "number" ? counter : Object.keys(state.taskResults).length;

      if (completedTasks < totalTasks) {
        await step.run("idempotency-mark-success-partial", () =>
          markIdempotencySucceeded({
            orgId: payload.orgId,
            scope,
            key,
            response: {
              workflowId: payload.workflowId,
              completedTasks,
              totalTasks,
              finalized: false
            }
          })
        );
        return {
          ok: true,
          workflowId: payload.workflowId,
          completedTasks,
          totalTasks,
          finalized: false
        };
      }

      const reviewLock = await step.run("acquire-review-lock", () =>
        acquireWorkflowReviewLock({
          workflowId: payload.workflowId,
          owner: "reviewer-function",
          ttlMs: 10_000
        })
      );

      if (!reviewLock?.ok || !reviewLock?.acquired || !reviewLock.token) {
        await step.run("idempotency-mark-success-locked", () =>
          markIdempotencySucceeded({
            orgId: payload.orgId,
            scope,
            key,
            response: {
              workflowId: payload.workflowId,
              finalized: false,
              reason: "review_lock_unavailable"
            }
          })
        );
        return {
          ok: true,
          workflowId: payload.workflowId,
          finalized: false,
          reason: "review_lock_unavailable"
        };
      }

      try {
        const finalizeScope = "inngest.reviewer.final";
        const finalizeKey = payload.workflowId;
        const finalizeClaim = await step.run("idempotency-claim-final", () =>
          claimIdempotency({
            orgId: payload.orgId,
            scope: finalizeScope,
            key: finalizeKey,
            requestHash: stableHash({
              workflowId: payload.workflowId,
              requestId: payload.requestId,
              completedTasks,
              totalTasks
            })
          })
        );

        if (!finalizeClaim.acquired) {
          await step.run("idempotency-mark-success-dedup", () =>
            markIdempotencySucceeded({
              orgId: payload.orgId,
              scope,
              key,
              response: {
                workflowId: payload.workflowId,
                finalized: true,
                dedupedFinalization: true
              }
            })
          );
          return {
            ok: true,
            workflowId: payload.workflowId,
            finalized: true,
            dedupedFinalization: true
          };
        }

        const taskResults = Object.values(state.taskResults).sort((left, right) =>
          left.taskId.localeCompare(right.taskId)
        );
        const review = await step.run("deterministic-review", () =>
          reviewWorkflowDeterministically({
            orgId: payload.orgId,
            workflowId: payload.workflowId,
            requestId: payload.requestId,
            plan: state.plan,
            taskResults,
            prompt: state.prompt
          })
        );

        await step.run("persist-review-to-short-term-state", () =>
          patchWorkflowState(payload.workflowId, (current) => ({
            ...current,
            finalReview: review,
            updatedAt: new Date().toISOString()
          }))
        );

        const memoryUpdateEvent: MemoryUpdateEventData = {
          orgId: payload.orgId,
          workflowId: payload.workflowId,
          requestId: payload.requestId,
          prompt: state.prompt,
          plan: state.plan,
          review,
          taskResults,
          updatedAt: new Date().toISOString()
        };
        const workflowCompletedEvent: WorkflowCompletedEventData = {
          orgId: payload.orgId,
          workflowId: payload.workflowId,
          requestId: payload.requestId,
          prompt: state.prompt,
          review,
          taskResults,
          completedAt: new Date().toISOString()
        };

        await step.sendEvent("emit-memory-update", {
          name: INNGEST_EVENTS.memoryUpdate,
          data: memoryUpdateEvent
        });
        await step.sendEvent("emit-workflow-completed", {
          name: INNGEST_EVENTS.workflowCompleted,
          data: workflowCompletedEvent
        });

        await step.run("idempotency-mark-final-success", () =>
          markIdempotencySucceeded({
            orgId: payload.orgId,
            scope: finalizeScope,
            key: finalizeKey,
            response: {
              workflowId: payload.workflowId,
              review
            }
          })
        );

        await step.run("idempotency-mark-success", () =>
          markIdempotencySucceeded({
            orgId: payload.orgId,
            scope,
            key,
            response: {
              workflowId: payload.workflowId,
              review,
              finalized: true
            }
          })
        );

        await step.run("log-reviewer-completed", () => {
          const latencyMs = Date.now() - startedAt;
          logInfo({
            service: "inngest-reviewer",
            orgId: payload.orgId,
            runId: payload.workflowId,
            taskId: payload.result.taskId,
            event: "function.completed",
            message: `reviewer finalized workflow=${payload.workflowId}`,
            meta: {
              latencyMs,
              promptTokens: 0,
              completionTokens: 0,
              totalTokens: 0,
              reviewScore: review.score
            }
          });
          return true;
        });

        return {
          ok: true,
          workflowId: payload.workflowId,
          finalized: true,
          review
        };
      } finally {
        await step.run("release-review-lock", () =>
          releaseWorkflowReviewLock({
            workflowId: payload.workflowId,
            token: reviewLock.token
          })
        );
      }
    } catch (error) {
      await step.run("idempotency-mark-failed", () =>
        markIdempotencyFailed({
          orgId: payload.orgId,
          scope,
          key,
          error
        })
      );

      await step.run("log-reviewer-failed", () => {
        logError({
          service: "inngest-reviewer",
          orgId: payload.orgId,
          runId: payload.workflowId,
          taskId: payload.result.taskId,
          event: "function.failed",
          message: error instanceof Error ? error.message : "reviewer failed"
        });
        return true;
      });

      throw error;
    }
  }
);
