import type {
  OrchestratorReview,
  OrchestratorTaskPlan,
  OrchestratorTaskResult,
  OrchestratorWorkflowPlan
} from "@/src/orchestrator/types";

export interface AgentRunEventData {
  orgId: string;
  workflowId: string;
  requestId: string;
  prompt: string;
  initiatedByUserId?: string | null;
  context?: Record<string, unknown>;
  createdAt: string;
}

export interface AgentPlanCreatedEventData {
  orgId: string;
  workflowId: string;
  requestId: string;
  prompt: string;
  initiatedByUserId?: string | null;
  createdAt: string;
}

export interface AgentTaskCreatedEventData {
  orgId: string;
  workflowId: string;
  requestId: string;
  task: OrchestratorTaskPlan;
  totalTasks: number;
  createdAt: string;
}

export interface AgentTaskCompletedEventData {
  orgId: string;
  workflowId: string;
  requestId: string;
  result: OrchestratorTaskResult;
  totalTasks: number;
  completedAt: string;
}

export interface MemoryUpdateEventData {
  orgId: string;
  workflowId: string;
  requestId: string;
  prompt: string;
  plan: OrchestratorWorkflowPlan;
  review: OrchestratorReview;
  taskResults: OrchestratorTaskResult[];
  updatedAt: string;
}

export interface WorkflowCompletedEventData {
  orgId: string;
  workflowId: string;
  requestId: string;
  prompt: string;
  review: OrchestratorReview;
  taskResults: OrchestratorTaskResult[];
  completedAt: string;
}

