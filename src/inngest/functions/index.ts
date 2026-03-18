import { agentRunnerFunction } from "@/src/inngest/functions/agent/agent-runner";
import { executorFunction } from "@/src/inngest/functions/agent/executor-function";
import { plannerFunction } from "@/src/inngest/functions/agent/planner-function";
import { reviewerFunction } from "@/src/inngest/functions/agent/reviewer-function";
import { memoryWriterFunction } from "@/src/inngest/functions/memory/memory-writer";
import { workflowCompletedSystemFunction } from "@/src/inngest/functions/system/workflow-completed";

export const orchestratorInngestFunctions = [
  agentRunnerFunction,
  plannerFunction,
  executorFunction,
  reviewerFunction,
  memoryWriterFunction,
  workflowCompletedSystemFunction
];

