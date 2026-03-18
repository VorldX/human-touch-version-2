-- Additive migration for queue-first execution scaffolding.
-- Non-destructive by design: old reads/writes remain valid.

CREATE TYPE "IdempotencyStatus" AS ENUM ('IN_PROGRESS', 'SUCCEEDED', 'FAILED');
CREATE TYPE "OutboxEventStatus" AS ENUM ('PENDING', 'DISPATCHING', 'DISPATCHED', 'FAILED');
CREATE TYPE "TaskLifecycleState" AS ENUM (
  'CREATED',
  'QUEUED',
  'RUNNING',
  'WAITING_TOOL',
  'RETRYING',
  'FAILED',
  'COMPLETED'
);
CREATE TYPE "ToolExecutionStatus" AS ENUM ('REQUESTED', 'SUCCEEDED', 'FAILED', 'TIMEOUT');

CREATE TABLE "IdempotencyKey" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "responseCode" INTEGER,
  "responseBody" JSONB,
  "status" "IdempotencyStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExecutionOutboxEvent" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "eventName" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "traceId" TEXT NOT NULL,
  "status" "OutboxEventStatus" NOT NULL DEFAULT 'PENDING',
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dispatchedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExecutionOutboxEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaskExecutionState" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "state" "TaskLifecycleState" NOT NULL DEFAULT 'CREATED',
  "assignedAgentId" TEXT,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "version" INTEGER NOT NULL DEFAULT 1,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaskExecutionState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaskExecutionAttempt" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "attemptNo" INTEGER NOT NULL,
  "state" "TaskLifecycleState" NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "workerId" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "tokenInput" INTEGER,
  "tokenOutput" INTEGER,
  "latencyMs" INTEGER,
  CONSTRAINT "TaskExecutionAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ToolExecutionReceipt" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "attemptNo" INTEGER NOT NULL,
  "toolCallId" TEXT NOT NULL,
  "agentId" TEXT,
  "tool" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "argsHash" TEXT NOT NULL,
  "resultHash" TEXT,
  "status" "ToolExecutionStatus" NOT NULL,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "latencyMs" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ToolExecutionReceipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeadLetterEvent" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "runId" TEXT,
  "failedJobName" TEXT NOT NULL,
  "failedJobId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeadLetterEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IdempotencyKey_orgId_scope_key_key" ON "IdempotencyKey"("orgId", "scope", "key");
CREATE INDEX "IdempotencyKey_expiresAt_idx" ON "IdempotencyKey"("expiresAt");

CREATE UNIQUE INDEX "ExecutionOutboxEvent_orgId_eventKey_key" ON "ExecutionOutboxEvent"("orgId", "eventKey");
CREATE INDEX "ExecutionOutboxEvent_status_availableAt_idx" ON "ExecutionOutboxEvent"("status", "availableAt");
CREATE INDEX "ExecutionOutboxEvent_runId_idx" ON "ExecutionOutboxEvent"("runId");

CREATE UNIQUE INDEX "TaskExecutionState_taskId_key" ON "TaskExecutionState"("taskId");
CREATE INDEX "TaskExecutionState_runId_state_priority_idx" ON "TaskExecutionState"("runId", "state", "priority");

CREATE UNIQUE INDEX "TaskExecutionAttempt_taskId_attemptNo_key" ON "TaskExecutionAttempt"("taskId", "attemptNo");
CREATE INDEX "TaskExecutionAttempt_runId_state_idx" ON "TaskExecutionAttempt"("runId", "state");
ALTER TABLE "TaskExecutionAttempt"
  ADD CONSTRAINT "TaskExecutionAttempt_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "TaskExecutionState"("taskId") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ToolExecutionReceipt_orgId_toolCallId_key" ON "ToolExecutionReceipt"("orgId", "toolCallId");
CREATE INDEX "ToolExecutionReceipt_taskId_attemptNo_idx" ON "ToolExecutionReceipt"("taskId", "attemptNo");
CREATE INDEX "ToolExecutionReceipt_runId_status_createdAt_idx" ON "ToolExecutionReceipt"("runId", "status", "createdAt");

CREATE INDEX "DeadLetterEvent_orgId_createdAt_idx" ON "DeadLetterEvent"("orgId", "createdAt");
CREATE INDEX "DeadLetterEvent_runId_idx" ON "DeadLetterEvent"("runId");
