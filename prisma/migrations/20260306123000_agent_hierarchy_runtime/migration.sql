-- CreateEnum
CREATE TYPE "AgentRole" AS ENUM ('MAIN', 'MANAGER', 'WORKER');

-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM (
  'ACTIVE',
  'BLOCKED',
  'PAUSED',
  'WAITING_HUMAN',
  'COMPLETED',
  'FAILED',
  'ARCHIVED'
);

-- CreateEnum
CREATE TYPE "OrgExecutionMode" AS ENUM ('ECO', 'BALANCED', 'TURBO');

-- CreateEnum
CREATE TYPE "AgentDecisionType" AS ENUM (
  'EXECUTE_SELF',
  'DELEGATE_EXISTING',
  'DELEGATE_NEW',
  'ASK_HUMAN',
  'HALT_BUDGET',
  'HALT_POLICY',
  'HALT_TOOL_GAP'
);

-- AlterTable
ALTER TABLE "MemoryEntry"
ADD COLUMN "agentRunId" TEXT;

-- AlterTable
ALTER TABLE "Organization"
ADD COLUMN "executionMode" "OrgExecutionMode" NOT NULL DEFAULT 'BALANCED';

-- CreateTable
CREATE TABLE "Agent" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "personnelId" TEXT,
  "missionFlowId" TEXT,
  "parentAgentId" TEXT,
  "createdByRunId" TEXT,
  "role" "AgentRole" NOT NULL,
  "status" "AgentStatus" NOT NULL DEFAULT 'ACTIVE',
  "name" TEXT NOT NULL,
  "goal" TEXT,
  "instructions" JSONB,
  "allowedTools" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "memoryScope" JSONB,
  "budgetScope" JSONB,
  "approvalPolicy" JSONB,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "flowId" TEXT,
  "taskId" TEXT,
  "parentRunId" TEXT,
  "status" "AgentStatus" NOT NULL DEFAULT 'ACTIVE',
  "goal" TEXT,
  "prompt" TEXT,
  "instructionsSnapshot" JSONB,
  "contextPack" JSONB,
  "decisionType" "AgentDecisionType",
  "decisionReason" TEXT,
  "executionMode" "OrgExecutionMode",
  "estimatedCost" DECIMAL(18, 4),
  "actualCost" DECIMAL(18, 4),
  "budgetBefore" DECIMAL(18, 4),
  "budgetAfter" DECIMAL(18, 4),
  "tokenInput" INTEGER,
  "tokenOutput" INTEGER,
  "modelProvider" TEXT,
  "modelName" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentDelegation" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "flowId" TEXT,
  "taskId" TEXT,
  "fromAgentId" TEXT NOT NULL,
  "toAgentId" TEXT NOT NULL,
  "fromRunId" TEXT,
  "toRunId" TEXT,
  "decisionType" "AgentDecisionType" NOT NULL,
  "reason" TEXT,
  "status" TEXT NOT NULL DEFAULT 'issued',
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AgentDelegation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalCheckpoint" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "flowId" TEXT,
  "taskId" TEXT,
  "agentId" TEXT,
  "agentRunId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "reason" TEXT NOT NULL,
  "approvalPolicy" JSONB,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "resolvedByUserId" TEXT,
  "resolutionNote" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ApprovalCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Agent_orgId_role_status_idx" ON "Agent"("orgId", "role", "status");

-- CreateIndex
CREATE INDEX "Agent_personnelId_idx" ON "Agent"("personnelId");

-- CreateIndex
CREATE INDEX "Agent_missionFlowId_idx" ON "Agent"("missionFlowId");

-- CreateIndex
CREATE INDEX "Agent_parentAgentId_idx" ON "Agent"("parentAgentId");

-- CreateIndex
CREATE INDEX "AgentRun_orgId_flowId_taskId_idx" ON "AgentRun"("orgId", "flowId", "taskId");

-- CreateIndex
CREATE INDEX "AgentRun_agentId_status_idx" ON "AgentRun"("agentId", "status");

-- CreateIndex
CREATE INDEX "AgentRun_parentRunId_idx" ON "AgentRun"("parentRunId");

-- CreateIndex
CREATE INDEX "AgentRun_startedAt_idx" ON "AgentRun"("startedAt");

-- CreateIndex
CREATE INDEX "AgentDelegation_orgId_flowId_taskId_idx" ON "AgentDelegation"("orgId", "flowId", "taskId");

-- CreateIndex
CREATE INDEX "AgentDelegation_fromAgentId_toAgentId_idx" ON "AgentDelegation"("fromAgentId", "toAgentId");

-- CreateIndex
CREATE INDEX "AgentDelegation_fromRunId_toRunId_idx" ON "AgentDelegation"("fromRunId", "toRunId");

-- CreateIndex
CREATE INDEX "AgentDelegation_createdAt_idx" ON "AgentDelegation"("createdAt");

-- CreateIndex
CREATE INDEX "ApprovalCheckpoint_orgId_status_requestedAt_idx" ON "ApprovalCheckpoint"("orgId", "status", "requestedAt");

-- CreateIndex
CREATE INDEX "ApprovalCheckpoint_flowId_idx" ON "ApprovalCheckpoint"("flowId");

-- CreateIndex
CREATE INDEX "ApprovalCheckpoint_taskId_idx" ON "ApprovalCheckpoint"("taskId");

-- CreateIndex
CREATE INDEX "ApprovalCheckpoint_agentId_idx" ON "ApprovalCheckpoint"("agentId");

-- CreateIndex
CREATE INDEX "ApprovalCheckpoint_agentRunId_idx" ON "ApprovalCheckpoint"("agentRunId");

-- CreateIndex
CREATE INDEX "ApprovalCheckpoint_resolvedByUserId_idx" ON "ApprovalCheckpoint"("resolvedByUserId");

-- CreateIndex
CREATE INDEX "MemoryEntry_agentRunId_idx" ON "MemoryEntry"("agentRunId");

-- AddForeignKey
ALTER TABLE "MemoryEntry"
ADD CONSTRAINT "MemoryEntry_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent"
ADD CONSTRAINT "Agent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent"
ADD CONSTRAINT "Agent_personnelId_fkey" FOREIGN KEY ("personnelId") REFERENCES "Personnel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent"
ADD CONSTRAINT "Agent_missionFlowId_fkey" FOREIGN KEY ("missionFlowId") REFERENCES "Flow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent"
ADD CONSTRAINT "Agent_parentAgentId_fkey" FOREIGN KEY ("parentAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun"
ADD CONSTRAINT "AgentRun_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun"
ADD CONSTRAINT "AgentRun_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun"
ADD CONSTRAINT "AgentRun_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun"
ADD CONSTRAINT "AgentRun_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun"
ADD CONSTRAINT "AgentRun_parentRunId_fkey" FOREIGN KEY ("parentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent"
ADD CONSTRAINT "Agent_createdByRunId_fkey" FOREIGN KEY ("createdByRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDelegation"
ADD CONSTRAINT "AgentDelegation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDelegation"
ADD CONSTRAINT "AgentDelegation_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDelegation"
ADD CONSTRAINT "AgentDelegation_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDelegation"
ADD CONSTRAINT "AgentDelegation_fromAgentId_fkey" FOREIGN KEY ("fromAgentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDelegation"
ADD CONSTRAINT "AgentDelegation_toAgentId_fkey" FOREIGN KEY ("toAgentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDelegation"
ADD CONSTRAINT "AgentDelegation_fromRunId_fkey" FOREIGN KEY ("fromRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDelegation"
ADD CONSTRAINT "AgentDelegation_toRunId_fkey" FOREIGN KEY ("toRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalCheckpoint"
ADD CONSTRAINT "ApprovalCheckpoint_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalCheckpoint"
ADD CONSTRAINT "ApprovalCheckpoint_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalCheckpoint"
ADD CONSTRAINT "ApprovalCheckpoint_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalCheckpoint"
ADD CONSTRAINT "ApprovalCheckpoint_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalCheckpoint"
ADD CONSTRAINT "ApprovalCheckpoint_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalCheckpoint"
ADD CONSTRAINT "ApprovalCheckpoint_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
