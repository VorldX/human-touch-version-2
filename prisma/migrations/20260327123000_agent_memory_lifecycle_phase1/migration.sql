DO $$
BEGIN
  CREATE TYPE "AgentMemoryLifecycleState" AS ENUM ('SHORT_TERM', 'LONG_TERM', 'QUARANTINE', 'ARCHIVE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE "AgentMemory"
ADD COLUMN IF NOT EXISTS "lifecycleState" "AgentMemoryLifecycleState",
ADD COLUMN IF NOT EXISTS "lifecycleUpdatedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "pinned" BOOLEAN,
ADD COLUMN IF NOT EXISTS "retrievalCount" INTEGER,
ADD COLUMN IF NOT EXISTS "lastRetrievedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "lastUsedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "quarantineReason" TEXT,
ADD COLUMN IF NOT EXISTS "quarantineSource" TEXT;

UPDATE "AgentMemory"
SET
  "lifecycleState" = COALESCE(
    "lifecycleState",
    CASE
      WHEN "archivedAt" IS NOT NULL THEN 'ARCHIVE'::"AgentMemoryLifecycleState"
      ELSE 'SHORT_TERM'::"AgentMemoryLifecycleState"
    END
  ),
  "lifecycleUpdatedAt" = COALESCE("lifecycleUpdatedAt", "archivedAt", "updatedAt", "createdAt", CURRENT_TIMESTAMP),
  "pinned" = COALESCE("pinned", FALSE),
  "retrievalCount" = COALESCE("retrievalCount", 0);

ALTER TABLE "AgentMemory"
ALTER COLUMN "lifecycleState" SET DEFAULT 'SHORT_TERM',
ALTER COLUMN "lifecycleState" SET NOT NULL,
ALTER COLUMN "lifecycleUpdatedAt" SET DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "lifecycleUpdatedAt" SET NOT NULL,
ALTER COLUMN "pinned" SET DEFAULT FALSE,
ALTER COLUMN "pinned" SET NOT NULL,
ALTER COLUMN "retrievalCount" SET DEFAULT 0,
ALTER COLUMN "retrievalCount" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'AgentMemory_archive_consistency_check'
  ) THEN
    ALTER TABLE "AgentMemory"
    ADD CONSTRAINT "AgentMemory_archive_consistency_check"
    CHECK (
      (
        "lifecycleState" = 'ARCHIVE'::"AgentMemoryLifecycleState"
        AND "archivedAt" IS NOT NULL
      )
      OR
      (
        "lifecycleState" <> 'ARCHIVE'::"AgentMemoryLifecycleState"
        AND "archivedAt" IS NULL
      )
    );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "AgentMemory_orgId_lifecycleState_archivedAt_idx"
ON "AgentMemory"("orgId", "lifecycleState", "archivedAt");
