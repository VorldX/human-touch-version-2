import "server-only";

import type {
  OrchestratorReview,
  OrchestratorTaskResult,
  OrchestratorWorkflowPlan
} from "@/src/orchestrator/types";

export function reviewWorkflowDeterministically(input: {
  orgId: string;
  workflowId: string;
  requestId: string;
  plan: OrchestratorWorkflowPlan;
  taskResults: OrchestratorTaskResult[];
  prompt: string;
}): OrchestratorReview {
  const totalTasks = input.plan.tasks.length;
  const completedTasks = input.taskResults.filter((item) => item.status === "COMPLETED").length;
  const failedTasks = input.taskResults.filter((item) => item.status === "FAILED").length;
  const approved = failedTasks === 0 && completedTasks === totalTasks;
  const completionRatio = totalTasks > 0 ? completedTasks / totalTasks : 0;
  const score = Math.max(0, Math.min(100, Math.round(completionRatio * 90 + (approved ? 10 : 0))));

  const findings: string[] = [];
  if (!approved) {
    findings.push(`Workflow incomplete: completed ${completedTasks}/${totalTasks} tasks.`);
  }
  if (failedTasks > 0) {
    findings.push(`${failedTasks} task(s) failed deterministic execution.`);
  }
  if (findings.length === 0) {
    findings.push("All planned tasks completed deterministically.");
  }

  const summary = approved
    ? `Workflow "${input.workflowId}" completed successfully for prompt: ${input.prompt}`
    : `Workflow "${input.workflowId}" requires intervention.`;

  return {
    workflowId: input.workflowId,
    orgId: input.orgId,
    requestId: input.requestId,
    approved,
    score,
    summary,
    findings,
    totalTasks,
    completedTasks,
    reviewedAt: new Date().toISOString()
  };
}

