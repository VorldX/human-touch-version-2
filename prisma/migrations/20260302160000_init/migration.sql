-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "OAuthProvider" AS ENUM ('GOOGLE', 'LINKEDIN', 'X');

-- CreateEnum
CREATE TYPE "OrganizationTheme" AS ENUM ('APEX', 'VEDA', 'NEXUS');

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('FOUNDER', 'EMPLOYEE', 'ADMIN');

-- CreateEnum
CREATE TYPE "PersonnelType" AS ENUM ('HUMAN', 'AI');

-- CreateEnum
CREATE TYPE "PricingModel" AS ENUM ('TOKEN', 'SUBSCRIPTION', 'OUTCOME');

-- CreateEnum
CREATE TYPE "PersonnelStatus" AS ENUM ('IDLE', 'ACTIVE', 'PAUSED', 'DISABLED', 'RENTED');

-- CreateEnum
CREATE TYPE "FlowStatus" AS ENUM ('DRAFT', 'QUEUED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ABORTED', 'FAILED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('QUEUED', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'ABORTED');

-- CreateEnum
CREATE TYPE "HubFileType" AS ENUM ('INPUT', 'OUTPUT', 'DNA');

-- CreateEnum
CREATE TYPE "LogType" AS ENUM ('SYS', 'EXE', 'NET', 'DNA', 'SCRUB', 'COMPLIANCE', 'USER');

-- CreateEnum
CREATE TYPE "WebhookEventType" AS ENUM ('FLOW_PAUSED', 'FLOW_COMPLETED', 'FLOW_ABORTED', 'TASK_UPDATED', 'HUMAN_TOUCH_REQUIRED', 'KILL_SWITCH');

-- CreateEnum
CREATE TYPE "SovereignRailType" AS ENUM ('ONDC', 'CUSTOM');

-- CreateEnum
CREATE TYPE "MemoryTier" AS ENUM ('WORKING', 'ORG', 'USER', 'AGENT');

-- CreateEnum
CREATE TYPE "SpendEventType" AS ENUM ('PREDICTED_BURN', 'ACTUAL_BURN', 'RUNAWAY_SIGNAL', 'MANUAL_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PolicyDecision" AS ENUM ('ALLOW', 'WARN', 'DENY');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "activeOrgId" TEXT,
    "sovereignIdentityHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkedAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "OAuthProvider" NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "accessTokenIv" TEXT NOT NULL,
    "accessTokenAuthTag" TEXT NOT NULL,
    "accessTokenKeyVer" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LinkedAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "theme" "OrganizationTheme" NOT NULL DEFAULT 'APEX',
    "monthlyBudget" DECIMAL(18,2) NOT NULL,
    "currentSpend" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "monthlyBtuCap" INTEGER NOT NULL DEFAULT 0,
    "currentBtuBurn" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgMember" (
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgMember_pkey" PRIMARY KEY ("userId","orgId")
);

-- CreateTable
CREATE TABLE "Personnel" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "type" "PersonnelType" NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "expertise" TEXT,
    "brainConfig" JSONB,
    "fallbackBrainConfig" JSONB,
    "brainKeyEnc" TEXT,
    "brainKeyIv" TEXT,
    "brainKeyAuthTag" TEXT,
    "brainKeyKeyVer" INTEGER DEFAULT 1,
    "fallbackBrainKeyEnc" TEXT,
    "fallbackBrainKeyIv" TEXT,
    "fallbackBrainKeyAuthTag" TEXT,
    "fallbackBrainKeyKeyVer" INTEGER DEFAULT 1,
    "salary" DECIMAL(18,2),
    "cost" DECIMAL(18,4),
    "rentRate" DECIMAL(18,4),
    "pricingModel" "PricingModel",
    "autonomyScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isRented" BOOLEAN NOT NULL DEFAULT false,
    "status" "PersonnelStatus" NOT NULL DEFAULT 'IDLE',
    "assignedOAuthIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Personnel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Flow" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "status" "FlowStatus" NOT NULL DEFAULT 'DRAFT',
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "predictedBurn" INTEGER NOT NULL DEFAULT 0,
    "requiredSignatures" INTEGER NOT NULL DEFAULT 1,
    "parentFlowId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Flow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlowApproval" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlowApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "agentId" TEXT,
    "prompt" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'QUEUED',
    "requiredFiles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isPausedForInput" BOOLEAN NOT NULL DEFAULT false,
    "humanInterventionReason" TEXT,
    "executionTrace" JSONB,
    "verifiableProof" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "File" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "HubFileType" NOT NULL,
    "size" BIGINT NOT NULL,
    "url" TEXT NOT NULL,
    "health" INTEGER NOT NULL DEFAULT 100,
    "isAmnesiaProtected" BOOLEAN NOT NULL DEFAULT false,
    "embedding" vector(1536),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "File_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HubFileLock" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "taskId" TEXT,
    "agentId" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "HubFileLock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Log" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "type" "LogType" NOT NULL,
    "actor" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Webhook" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "eventType" "WebhookEventType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Webhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SovereignRailConfig" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "railType" "SovereignRailType" NOT NULL DEFAULT 'ONDC',
    "baseUrl" TEXT NOT NULL,
    "region" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SovereignRailConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceAudit" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "flowId" TEXT,
    "humanActorId" TEXT,
    "actionType" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "complianceHash" TEXT NOT NULL,

    CONSTRAINT "ComplianceAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryEntry" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "flowId" TEXT,
    "taskId" TEXT,
    "agentId" TEXT,
    "userId" TEXT,
    "tier" "MemoryTier" NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB,
    "embedding" vector(1536),
    "ttlSeconds" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "redactedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemoryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpendEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "flowId" TEXT,
    "taskId" TEXT,
    "amount" DECIMAL(18,4) NOT NULL,
    "type" "SpendEventType" NOT NULL,
    "meta" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpendEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyLog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "decision" "PolicyDecision" NOT NULL DEFAULT 'ALLOW',
    "riskScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reason" TEXT,
    "meta" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapabilityGrant" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "linkedAccountId" TEXT NOT NULL,
    "scopes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "CapabilityGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_integrations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'composio',
    "toolkit" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_activeOrgId_idx" ON "User"("activeOrgId");

-- CreateIndex
CREATE INDEX "LinkedAccount_userId_idx" ON "LinkedAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LinkedAccount_provider_providerAccountId_key" ON "LinkedAccount"("provider", "providerAccountId");

-- CreateIndex
CREATE INDEX "OrgMember_orgId_role_idx" ON "OrgMember"("orgId", "role");

-- CreateIndex
CREATE INDEX "Personnel_orgId_type_idx" ON "Personnel"("orgId", "type");

-- CreateIndex
CREATE INDEX "Flow_orgId_status_idx" ON "Flow"("orgId", "status");

-- CreateIndex
CREATE INDEX "Flow_parentFlowId_idx" ON "Flow"("parentFlowId");

-- CreateIndex
CREATE INDEX "FlowApproval_userId_idx" ON "FlowApproval"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FlowApproval_flowId_userId_key" ON "FlowApproval"("flowId", "userId");

-- CreateIndex
CREATE INDEX "Task_flowId_status_idx" ON "Task"("flowId", "status");

-- CreateIndex
CREATE INDEX "Task_agentId_idx" ON "Task"("agentId");

-- CreateIndex
CREATE INDEX "File_orgId_type_idx" ON "File"("orgId", "type");

-- CreateIndex
CREATE INDEX "HubFileLock_orgId_fileId_releasedAt_idx" ON "HubFileLock"("orgId", "fileId", "releasedAt");

-- CreateIndex
CREATE INDEX "HubFileLock_taskId_releasedAt_idx" ON "HubFileLock"("taskId", "releasedAt");

-- CreateIndex
CREATE INDEX "HubFileLock_agentId_releasedAt_idx" ON "HubFileLock"("agentId", "releasedAt");

-- CreateIndex
CREATE INDEX "Log_orgId_timestamp_idx" ON "Log"("orgId", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "Webhook_orgId_eventType_idx" ON "Webhook"("orgId", "eventType");

-- CreateIndex
CREATE INDEX "SovereignRailConfig_orgId_railType_idx" ON "SovereignRailConfig"("orgId", "railType");

-- CreateIndex
CREATE INDEX "SovereignRailConfig_orgId_isActive_idx" ON "SovereignRailConfig"("orgId", "isActive");

-- CreateIndex
CREATE INDEX "ComplianceAudit_orgId_timestamp_idx" ON "ComplianceAudit"("orgId", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "ComplianceAudit_flowId_idx" ON "ComplianceAudit"("flowId");

-- CreateIndex
CREATE INDEX "ComplianceAudit_humanActorId_idx" ON "ComplianceAudit"("humanActorId");

-- CreateIndex
CREATE INDEX "MemoryEntry_orgId_tier_idx" ON "MemoryEntry"("orgId", "tier");

-- CreateIndex
CREATE INDEX "MemoryEntry_expiresAt_idx" ON "MemoryEntry"("expiresAt");

-- CreateIndex
CREATE INDEX "MemoryEntry_redactedAt_idx" ON "MemoryEntry"("redactedAt");

-- CreateIndex
CREATE INDEX "MemoryEntry_flowId_idx" ON "MemoryEntry"("flowId");

-- CreateIndex
CREATE INDEX "MemoryEntry_taskId_idx" ON "MemoryEntry"("taskId");

-- CreateIndex
CREATE INDEX "MemoryEntry_agentId_idx" ON "MemoryEntry"("agentId");

-- CreateIndex
CREATE INDEX "MemoryEntry_userId_idx" ON "MemoryEntry"("userId");

-- CreateIndex
CREATE INDEX "SpendEvent_orgId_timestamp_idx" ON "SpendEvent"("orgId", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "SpendEvent_flowId_idx" ON "SpendEvent"("flowId");

-- CreateIndex
CREATE INDEX "SpendEvent_taskId_idx" ON "SpendEvent"("taskId");

-- CreateIndex
CREATE INDEX "PolicyLog_orgId_timestamp_idx" ON "PolicyLog"("orgId", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "PolicyLog_subjectType_subjectId_idx" ON "PolicyLog"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "CapabilityGrant_orgId_agentId_idx" ON "CapabilityGrant"("orgId", "agentId");

-- CreateIndex
CREATE INDEX "CapabilityGrant_linkedAccountId_idx" ON "CapabilityGrant"("linkedAccountId");

-- CreateIndex
CREATE INDEX "CapabilityGrant_revokedAt_idx" ON "CapabilityGrant"("revokedAt");

-- CreateIndex
CREATE INDEX "user_integrations_userId_provider_idx" ON "user_integrations"("userId", "provider");

-- CreateIndex
CREATE INDEX "user_integrations_orgId_userId_idx" ON "user_integrations"("orgId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_integrations_provider_connectionId_key" ON "user_integrations"("provider", "connectionId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_activeOrgId_fkey" FOREIGN KEY ("activeOrgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkedAccount" ADD CONSTRAINT "LinkedAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgMember" ADD CONSTRAINT "OrgMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgMember" ADD CONSTRAINT "OrgMember_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Personnel" ADD CONSTRAINT "Personnel_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flow" ADD CONSTRAINT "Flow_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flow" ADD CONSTRAINT "Flow_parentFlowId_fkey" FOREIGN KEY ("parentFlowId") REFERENCES "Flow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowApproval" ADD CONSTRAINT "FlowApproval_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowApproval" ADD CONSTRAINT "FlowApproval_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Personnel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HubFileLock" ADD CONSTRAINT "HubFileLock_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HubFileLock" ADD CONSTRAINT "HubFileLock_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HubFileLock" ADD CONSTRAINT "HubFileLock_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HubFileLock" ADD CONSTRAINT "HubFileLock_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Personnel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Log" ADD CONSTRAINT "Log_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Webhook" ADD CONSTRAINT "Webhook_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SovereignRailConfig" ADD CONSTRAINT "SovereignRailConfig_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceAudit" ADD CONSTRAINT "ComplianceAudit_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceAudit" ADD CONSTRAINT "ComplianceAudit_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceAudit" ADD CONSTRAINT "ComplianceAudit_humanActorId_fkey" FOREIGN KEY ("humanActorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryEntry" ADD CONSTRAINT "MemoryEntry_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryEntry" ADD CONSTRAINT "MemoryEntry_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryEntry" ADD CONSTRAINT "MemoryEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryEntry" ADD CONSTRAINT "MemoryEntry_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Personnel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryEntry" ADD CONSTRAINT "MemoryEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpendEvent" ADD CONSTRAINT "SpendEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpendEvent" ADD CONSTRAINT "SpendEvent_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpendEvent" ADD CONSTRAINT "SpendEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyLog" ADD CONSTRAINT "PolicyLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapabilityGrant" ADD CONSTRAINT "CapabilityGrant_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapabilityGrant" ADD CONSTRAINT "CapabilityGrant_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Personnel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapabilityGrant" ADD CONSTRAINT "CapabilityGrant_linkedAccountId_fkey" FOREIGN KEY ("linkedAccountId") REFERENCES "LinkedAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_integrations" ADD CONSTRAINT "user_integrations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

