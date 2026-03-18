export type OrchestratorTaskStatus = "QUEUED" | "COMPLETED" | "FAILED";

export interface OrchestratorTaskPlan {
  taskId: string;
  title: string;
  instructions: string;
  order: number;
  expectedOutput: string;
}

export interface OrchestratorWorkflowPlan {
  workflowId: string;
  orgId: string;
  requestId: string;
  prompt: string;
  tasks: OrchestratorTaskPlan[];
  createdAt: string;
}

export interface OrchestratorTaskResult {
  workflowId: string;
  orgId: string;
  requestId: string;
  taskId: string;
  status: OrchestratorTaskStatus;
  output: string;
  details: Record<string, unknown>;
  startedAt: string;
  completedAt: string;
  latencyMs: number;
  retryCount: number;
}

export interface OrchestratorReview {
  workflowId: string;
  orgId: string;
  requestId: string;
  approved: boolean;
  score: number;
  summary: string;
  findings: string[];
  totalTasks: number;
  completedTasks: number;
  reviewedAt: string;
}

export interface ShortTermWorkflowState {
  workflowId: string;
  orgId: string;
  requestId: string;
  prompt: string;
  plan: OrchestratorWorkflowPlan;
  taskResults: Record<string, OrchestratorTaskResult>;
  finalReview: OrchestratorReview | null;
  createdAt: string;
  updatedAt: string;
}

