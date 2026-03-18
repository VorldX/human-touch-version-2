import "server-only";

import { logError, logInfo } from "@/lib/observability/logger";
import { executeDeterministicTask } from "@/src/agents/executor";
import { inngest } from "@/src/inngest/client";
import { INNGEST_EVENTS } from "@/src/inngest/events/catalog";
import type {
  AgentTaskCompletedEventData,
  AgentTaskCreatedEventData
} from "@/src/inngest/events/types";
import {
  claimIdempotency,
  markIdempotencyFailed,
  markIdempotencySucceeded,
  stableHash
} from "@/src/orchestrator/idempotency";

export const executorFunction = inngest.createFunction(
  { id: "executor-function", retries: 3 },
  { event: INNGEST_EVENTS.agentTaskCreated },
  async ({ event, step }) => {
    const startedAt = Date.now();
    const payload = event.data as AgentTaskCreatedEventData;
    const scope = "inngest.executor";
    const key = `${payload.workflowId}:${payload.task.taskId}`;
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
        console.log("EXECUTOR_EVENT_RECEIVED", payload.workflowId, payload.task.taskId);
        return true;
      });

      await step.sleep("execution-backoff", "1s");

      const result = await step.run("execute-deterministic-task", () =>
        executeDeterministicTask({
          orgId: payload.orgId,
          workflowId: payload.workflowId,
          requestId: payload.requestId,
          task: payload.task
        })
      );

      const completionEvent: AgentTaskCompletedEventData = {
        orgId: payload.orgId,
        workflowId: payload.workflowId,
        requestId: payload.requestId,
        result,
        totalTasks: payload.totalTasks,
        completedAt: new Date().toISOString()
      };
      await step.sendEvent("emit-agent-task-completed", {
        name: INNGEST_EVENTS.agentTaskCompleted,
        data: completionEvent
      });

      await step.run("idempotency-mark-success", () =>
        markIdempotencySucceeded({
          orgId: payload.orgId,
          scope,
          key,
          response: completionEvent
        })
      );

      await step.run("log-executor-completed", () => {
        const latencyMs = Date.now() - startedAt;
        logInfo({
          service: "inngest-executor",
          orgId: payload.orgId,
          runId: payload.workflowId,
          taskId: payload.task.taskId,
          event: "function.completed",
          message: `executor completed task=${payload.task.taskId}`,
          meta: {
            latencyMs,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0
          }
        });
        return true;
      });

      return {
        ok: true,
        workflowId: payload.workflowId,
        taskId: payload.task.taskId
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

      await step.run("log-executor-failed", () => {
        logError({
          service: "inngest-executor",
          orgId: payload.orgId,
          runId: payload.workflowId,
          taskId: payload.task.taskId,
          event: "function.failed",
          message: error instanceof Error ? error.message : "executor failed"
        });
        return true;
      });

      throw error;
    }
  }
);
