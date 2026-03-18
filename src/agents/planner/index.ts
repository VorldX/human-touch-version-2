import "server-only";

import type { OrchestratorTaskPlan, OrchestratorWorkflowPlan } from "@/src/orchestrator/types";

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function sentenceChunks(prompt: string) {
  const segments = prompt
    .split(/[\n\r]+|(?<=[.!?])\s+/g)
    .map((item) => compact(item))
    .filter(Boolean);
  return segments.length > 0 ? segments : [compact(prompt)];
}

function toTaskTitle(segment: string, index: number) {
  const normalized = segment.replace(/[^\w\s-]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return `Task ${index + 1}`;
  }
  const clipped = normalized.slice(0, 70).trim();
  return clipped[0].toUpperCase() + clipped.slice(1);
}

function buildFallbackTasks(): OrchestratorTaskPlan[] {
  const now = Date.now();
  return [
    {
      taskId: `task-${now}-discover`,
      title: "Capture objective and constraints",
      instructions: "Normalize the request into deterministic execution goals and constraints.",
      order: 1,
      expectedOutput: "Validated execution scope"
    },
    {
      taskId: `task-${now}-execute`,
      title: "Execute primary action deterministically",
      instructions: "Run the primary action path and capture machine-readable output.",
      order: 2,
      expectedOutput: "Execution output artifact"
    },
    {
      taskId: `task-${now}-verify`,
      title: "Verify outcomes and edge cases",
      instructions: "Validate completion criteria and record any unresolved risks.",
      order: 3,
      expectedOutput: "Verification report"
    }
  ];
}

export function createDeterministicPlan(input: {
  orgId: string;
  workflowId: string;
  requestId: string;
  prompt: string;
  createdAt?: string;
}): OrchestratorWorkflowPlan {
  const prompt = compact(input.prompt);
  const createdAt = input.createdAt ?? new Date().toISOString();
  const segments = sentenceChunks(prompt).slice(0, 8);

  const tasks =
    segments.length === 0
      ? buildFallbackTasks()
      : segments.map((segment, index) => ({
          taskId: `${input.workflowId}-task-${index + 1}`,
          title: toTaskTitle(segment, index),
          instructions: segment,
          order: index + 1,
          expectedOutput: "Deterministic execution output"
        }));

  if (tasks.length < 2) {
    tasks.push({
      taskId: `${input.workflowId}-task-${tasks.length + 1}`,
      title: "Verification and handoff",
      instructions:
        "Verify deterministic completion and package concise handoff context for downstream review.",
      order: tasks.length + 1,
      expectedOutput: "Handoff package"
    });
  }

  return {
    workflowId: input.workflowId,
    orgId: input.orgId,
    requestId: input.requestId,
    prompt,
    tasks,
    createdAt
  };
}

