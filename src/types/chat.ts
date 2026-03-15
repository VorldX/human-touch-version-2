export type Role = "user" | "assistant";
export type Feedback = "up" | "down" | null;

export type WorkflowTaskStatus =
  | "QUEUED"
  | "RUNNING"
  | "PAUSED"
  | "COMPLETED"
  | "FAILED"
  | "ABORTED"
  | "DRAFT"
  | "ACTIVE"
  | "UNKNOWN";

export interface WorkflowTaskCardItem {
  id: string;
  title: string;
  status: WorkflowTaskStatus;
  agentLabel?: string;
  dependsOn?: string[];
}

export interface WorkflowPlanCardItem {
  title: string;
  goal?: string;
  ownerRole?: string;
  tasks: WorkflowTaskCardItem[];
}

export interface AssistantPlanCardMeta {
  kind: "plan_card";
  title: string;
  summary?: string;
  detailScore?: number;
  requiredToolkits?: string[];
  workflows: WorkflowPlanCardItem[];
}

export interface AssistantWorkflowGraphMeta {
  kind: "workflow_graph";
  title: string;
  flowId: string;
  status?: string;
  progress?: number;
  updatedAt?: string;
  taskCount?: number;
  completedCount?: number;
  tasks: WorkflowTaskCardItem[];
}

export interface AssistantWorkflowEventMeta {
  kind: "workflow_event";
  title: string;
  message: string;
  eventName?: string;
  flowId?: string;
  taskId?: string;
  status?: string;
  agentLabel?: string;
  timestamp?: number;
}

export type AssistantMessageMeta =
  | AssistantPlanCardMeta
  | AssistantWorkflowGraphMeta
  | AssistantWorkflowEventMeta;

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  feedback: Feedback;
  isStreaming?: boolean;
  isError?: boolean;
  meta?: AssistantMessageMeta;
}

export interface ToastItem {
  id: string;
  text: string;
}

declare global {
  interface Window {
    sendMessageToUI?: (token: string) => void;
    completeMessageToUI?: () => void;
    showErrorInUI?: (message: string) => void;
    appendStructuredMessageToUI?: (payload: {
      content?: string;
      meta: AssistantMessageMeta;
    }) => void;
    onUserMessage?: (text: string) => void;
    onStopGeneration?: () => void;
  }
}

export {};
