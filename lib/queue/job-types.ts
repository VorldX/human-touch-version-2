import "server-only";

export type QueueJobName =
  | "RUN_CREATED"
  | "PLAN_GENERATED"
  | "TASK_READY"
  | "TASK_EXECUTE"
  | "TOOL_CALL"
  | "TASK_COMPLETED"
  | "RUN_COMPLETED"
  | "DEAD_LETTER";

export interface QueueEnvelope<TName extends QueueJobName, TPayload> {
  id: string;
  name: TName;
  version: 1;
  orgId: string;
  runId: string;
  idempotencyKey: string;
  traceId: string;
  createdAt: string;
  payload: TPayload;
}

export type RunCreatedJob = QueueEnvelope<
  "RUN_CREATED",
  {
    initiatedByUserId?: string;
    prompt: string;
    executionMode?: "ECO" | "BALANCED" | "TURBO";
    legacyEventName?: string;
    legacyPayload?: Record<string, unknown>;
  }
>;

export type PlanGeneratedJob = QueueEnvelope<
  "PLAN_GENERATED",
  {
    plannerAgentId?: string;
    planId?: string;
    taskIds: string[];
    legacyEventName?: string;
    legacyPayload?: Record<string, unknown>;
  }
>;

export type TaskReadyJob = QueueEnvelope<
  "TASK_READY",
  {
    taskId: string;
    priority: number;
    attemptNo: number;
    legacyEventName?: string;
    legacyPayload?: Record<string, unknown>;
  }
>;

export type TaskExecuteJob = QueueEnvelope<
  "TASK_EXECUTE",
  {
    taskId: string;
    attemptNo: number;
    agentId?: string;
    contextRef?: { sessionId?: string; memoryCursor?: string };
    legacyEventName?: string;
    legacyPayload?: Record<string, unknown>;
  }
>;

export type ToolCallJob = QueueEnvelope<
  "TOOL_CALL",
  {
    taskId: string;
    attemptNo: number;
    toolCallId: string;
    agentId?: string;
    tool: string;
    action: string;
    args: Record<string, unknown>;
    legacyEventName?: string;
    legacyPayload?: Record<string, unknown>;
  }
>;

export type TaskCompletedJob = QueueEnvelope<
  "TASK_COMPLETED",
  {
    taskId: string;
    attemptNo: number;
    outputRef?: string;
    outputHash?: string;
    legacyEventName?: string;
    legacyPayload?: Record<string, unknown>;
  }
>;

export type RunCompletedJob = QueueEnvelope<
  "RUN_COMPLETED",
  {
    completedTaskCount: number;
    failedTaskCount: number;
    legacyEventName?: string;
    legacyPayload?: Record<string, unknown>;
  }
>;

export type DeadLetterJob = QueueEnvelope<
  "DEAD_LETTER",
  {
    failedJobName: QueueJobName;
    failedJobId: string;
    reason: string;
    retryCount: number;
    payloadSnapshot: unknown;
  }
>;

export type QueueJob =
  | RunCreatedJob
  | PlanGeneratedJob
  | TaskReadyJob
  | TaskExecuteJob
  | ToolCallJob
  | TaskCompletedJob
  | RunCompletedJob
  | DeadLetterJob;
