import "server-only";

import { logError, logInfo } from "@/lib/observability/logger";
import { createDeterministicPlan } from "@/src/agents/planner";
import { inngest } from "@/src/inngest/client";
import { INNGEST_EVENTS } from "@/src/inngest/events/catalog";
import type { AgentPlanCreatedEventData, AgentTaskCreatedEventData } from "@/src/inngest/events/types";
import { persistWorkflowPlanMemory } from "@/src/memory/long-term/store";
import { saveWorkflowState } from "@/src/memory/short-term/store";
import {
  claimIdempotency,
  markIdempotencyFailed,
  markIdempotencySucceeded,
  stableHash
} from "@/src/orchestrator/idempotency";

export const plannerFunction = inngest.createFunction(
  { id: "planner-function", retries: 2 },
  { event: INNGEST_EVENTS.agentPlanCreated },
  async ({ event, step }) => {
    const startedAt = Date.now();
    const payload = event.data as AgentPlanCreatedEventData;
    const scope = "inngest.planner";
    const key = `${payload.workflowId}:${payload.requestId}`;
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
        console.log("PLANNER_EVENT_RECEIVED", payload.workflowId, payload.requestId);
        return true;
      });

      const plan = await step.run("build-deterministic-plan", () =>
        createDeterministicPlan({
          orgId: payload.orgId,
          workflowId: payload.workflowId,
          requestId: payload.requestId,
          prompt: payload.prompt,
          createdAt: payload.createdAt
        })
      );

      await step.run("persist-plan-memory", () =>
        persistWorkflowPlanMemory({
          orgId: payload.orgId,
          workflowId: payload.workflowId,
          requestId: payload.requestId,
          prompt: payload.prompt,
          plan
        })
      );

      await step.run("seed-short-term-state", () =>
        saveWorkflowState({
          state: {
            workflowId: payload.workflowId,
            orgId: payload.orgId,
            requestId: payload.requestId,
            prompt: payload.prompt,
            plan,
            taskResults: {},
            finalReview: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        })
      );

      const taskEvents: Array<{ name: string; data: AgentTaskCreatedEventData }> = plan.tasks.map(
        (task) => ({
          name: INNGEST_EVENTS.agentTaskCreated,
          data: {
            orgId: payload.orgId,
            workflowId: payload.workflowId,
            requestId: payload.requestId,
            task,
            totalTasks: plan.tasks.length,
            createdAt: new Date().toISOString()
          }
        })
      );

      await step.sendEvent("emit-agent-task-created", taskEvents);

      await step.run("idempotency-mark-success", () =>
        markIdempotencySucceeded({
          orgId: payload.orgId,
          scope,
          key,
          response: {
            workflowId: payload.workflowId,
            taskCount: plan.tasks.length
          }
        })
      );

      await step.run("log-planner-completed", () => {
        const latencyMs = Date.now() - startedAt;
        logInfo({
          service: "inngest-planner",
          orgId: payload.orgId,
          runId: payload.workflowId,
          event: "function.completed",
          message: `planner emitted ${plan.tasks.length} tasks`,
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
        taskCount: plan.tasks.length
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

      await step.run("log-planner-failed", () => {
        logError({
          service: "inngest-planner",
          orgId: payload.orgId,
          runId: payload.workflowId,
          event: "function.failed",
          message: error instanceof Error ? error.message : "planner failed"
        });
        return true;
      });

      throw error;
    }
  }
);
