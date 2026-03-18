export const INNGEST_EVENTS = {
  agentRun: "agent/run",
  agentPlanCreated: "agent/plan.created",
  agentTaskCreated: "agent/task.created",
  agentTaskCompleted: "agent/task.completed",
  memoryUpdate: "memory/update",
  workflowCompleted: "workflow/completed"
} as const;

export type InngestEventName = (typeof INNGEST_EVENTS)[keyof typeof INNGEST_EVENTS];

