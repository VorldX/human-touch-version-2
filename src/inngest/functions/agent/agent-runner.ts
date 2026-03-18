import "server-only";

import { logError, logInfo } from "@/lib/observability/logger";
import { inngest } from "@/src/inngest/client";
import { INNGEST_EVENTS } from "@/src/inngest/events/catalog";
import type {
  AgentPlanCreatedEventData,
  AgentRunEventData,
  WorkflowCompletedEventData
} from "@/src/inngest/events/types";
import {
  claimIdempotency,
  markIdempotencyFailed,
  markIdempotencySucceeded,
  stableHash
} from "@/src/orchestrator/idempotency";

export const agentRunnerFunction = inngest.createFunction(
  { id: "agent-runner", retries: 2 },
  { event: INNGEST_EVENTS.agentRun },
  async ({ event, step }) => {
    const startedAt = Date.now();
    const payload = event.data as AgentRunEventData;
    const idempotencyScope = "inngest.agent-runner";
    const idempotencyKey = `${payload.workflowId}:${payload.requestId}`;
    const requestHash = stableHash({
      orgId: payload.orgId,
      workflowId: payload.workflowId,
      requestId: payload.requestId,
      prompt: payload.prompt
    });

    const claim = await step.run("idempotency-claim", () =>
      claimIdempotency({
        orgId: payload.orgId,
        scope: idempotencyScope,
        key: idempotencyKey,
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
      await step.run("log-function-started", () => {
        // eslint-disable-next-line no-console
        console.log("WORKING", payload);
        logInfo({
          service: "inngest-agent-runner",
          orgId: payload.orgId,
          runId: payload.workflowId,
          event: "function.started",
          message: `agent/run received for workflow=${payload.workflowId}`,
          meta: {
            requestId: payload.requestId,
            promptChars: payload.prompt.length
          }
        });
        return true;
      });

      const planEvent: AgentPlanCreatedEventData = {
        orgId: payload.orgId,
        workflowId: payload.workflowId,
        requestId: payload.requestId,
        prompt: payload.prompt,
        initiatedByUserId: payload.initiatedByUserId ?? null,
        createdAt: new Date().toISOString()
      };

      await step.sendEvent("emit-agent-plan-created", {
        name: INNGEST_EVENTS.agentPlanCreated,
        data: planEvent
      });

      const completed = (await step.waitForEvent("wait-workflow-completed", {
        event: INNGEST_EVENTS.workflowCompleted,
        timeout: "20m",
        if: "event.data.workflowId == async.data.workflowId"
      })) as { data?: WorkflowCompletedEventData } | null;

      if (!completed?.data) {
        throw new Error("Timed out waiting for workflow/completed.");
      }
      const completedData = completed.data;

      await step.run("idempotency-mark-success", () =>
        markIdempotencySucceeded({
          orgId: payload.orgId,
          scope: idempotencyScope,
          key: idempotencyKey,
          response: {
            workflowId: payload.workflowId,
            review: completedData.review
          }
        })
      );

      await step.run("log-function-completed", () => {
        const latencyMs = Date.now() - startedAt;
        logInfo({
          service: "inngest-agent-runner",
          orgId: payload.orgId,
          runId: payload.workflowId,
          event: "function.completed",
          message: `agent-runner completed workflow=${payload.workflowId}`,
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
        review: completedData.review
      };
    } catch (error) {
      await step.run("idempotency-mark-failed", () =>
        markIdempotencyFailed({
          orgId: payload.orgId,
          scope: idempotencyScope,
          key: idempotencyKey,
          error
        })
      );

      await step.run("log-function-failed", () => {
        logError({
          service: "inngest-agent-runner",
          orgId: payload.orgId,
          runId: payload.workflowId,
          event: "function.failed",
          message: error instanceof Error ? error.message : "agent-runner failed"
        });
        return true;
      });

      throw error;
    }
  }
);
