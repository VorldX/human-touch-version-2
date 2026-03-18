import "server-only";

import { logInfo } from "@/lib/observability/logger";
import { inngest } from "@/src/inngest/client";
import { INNGEST_EVENTS } from "@/src/inngest/events/catalog";
import type { WorkflowCompletedEventData } from "@/src/inngest/events/types";

export const workflowCompletedSystemFunction = inngest.createFunction(
  { id: "workflow-completed-system", retries: 1 },
  { event: INNGEST_EVENTS.workflowCompleted },
  async ({ event, step }) => {
    const payload = event.data as WorkflowCompletedEventData;
    await step.run("log-workflow-completed", () => {
      logInfo({
        service: "inngest-workflow-system",
        orgId: payload.orgId,
        runId: payload.workflowId,
        event: "workflow.completed",
        message: `workflow/completed received for ${payload.workflowId}`,
        meta: {
          score: payload.review.score,
          approved: payload.review.approved,
          tasks: payload.taskResults.length
        }
      });
      return true;
    });

    return {
      ok: true,
      workflowId: payload.workflowId,
      approved: payload.review.approved
    };
  }
);

