-- CreateEnum
CREATE TYPE "AgentMemoryType" AS ENUM ('WORKING', 'EPISODIC', 'SEMANTIC', 'TASK');

-- CreateEnum
CREATE TYPE "AgentMemoryVisibility" AS ENUM ('PRIVATE', 'SHARED');

-- CreateTable
CREATE TABLE "AgentMemory" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT,
    "agentId" TEXT,
    "sessionId" TEXT,
    "projectId" TEXT,
    "content" TEXT NOT NULL,
    "summary" TEXT,
    "embedding" vector(1536),
    "memoryType" "AgentMemoryType" NOT NULL DEFAULT 'EPISODIC',
    "visibility" "AgentMemoryVisibility" NOT NULL DEFAULT 'PRIVATE',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importance" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "recency" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "metadata" JSONB,
    "contentHash" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentMemory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentMemory_orgId_timestamp_idx" ON "AgentMemory"("orgId", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "AgentMemory_orgId_sessionId_timestamp_idx" ON "AgentMemory"("orgId", "sessionId", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "AgentMemory_orgId_userId_timestamp_idx" ON "AgentMemory"("orgId", "userId", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "AgentMemory_orgId_agentId_timestamp_idx" ON "AgentMemory"("orgId", "agentId", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "AgentMemory_orgId_projectId_timestamp_idx" ON "AgentMemory"("orgId", "projectId", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "AgentMemory_orgId_memoryType_timestamp_idx" ON "AgentMemory"("orgId", "memoryType", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "AgentMemory_orgId_visibility_timestamp_idx" ON "AgentMemory"("orgId", "visibility", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "AgentMemory_orgId_archivedAt_idx" ON "AgentMemory"("orgId", "archivedAt");

-- CreateIndex
CREATE INDEX "AgentMemory_orgId_contentHash_idx" ON "AgentMemory"("orgId", "contentHash");

-- CreateIndex
CREATE INDEX "AgentMemory_embedding_ivfflat_idx" ON "AgentMemory" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);

-- AddForeignKey
ALTER TABLE "AgentMemory" ADD CONSTRAINT "AgentMemory_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMemory" ADD CONSTRAINT "AgentMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMemory" ADD CONSTRAINT "AgentMemory_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
