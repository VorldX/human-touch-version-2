-- Create table for relational DNA memory folders.
CREATE TABLE "Folder" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "functionalityGroup" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);

-- Add relational pointers without breaking existing metadata-based reads.
ALTER TABLE "File"
ADD COLUMN "folderId" TEXT;

ALTER TABLE "AgentMemory"
ADD COLUMN "fileId" TEXT;

-- Backfill Folder rows and File.folderId for DNA files using existing metadata.
WITH legacy_dna_files AS (
    SELECT
        f.id AS file_id,
        f."orgId" AS org_id,
        NULLIF(BTRIM(f.metadata->>'targetFolderId'), '') AS folder_key,
        COALESCE(
            NULLIF(BTRIM(f.metadata->>'targetFolderTitle'), ''),
            NULLIF(BTRIM(f.metadata->>'targetFolderId'), ''),
            'General'
        ) AS folder_name_raw,
        COALESCE(
            NULLIF(BTRIM(f.metadata->>'functionalityGroupLabel'), ''),
            NULLIF(
                BTRIM(
                    INITCAP(
                        regexp_replace(
                            regexp_replace(COALESCE(f.metadata->>'functionalityGroupKey', ''), '^function:', ''),
                            '[_:-]+',
                            ' ',
                            'g'
                        )
                    )
                ),
                ''
            ),
            'General'
        ) AS functionality_group_raw
    FROM "File" f
    WHERE f.type = 'DNA'
),
normalized_dna_files AS (
    SELECT
        file_id,
        org_id,
        COALESCE(folder_key, '__general__') AS folder_key,
        LEFT(regexp_replace(folder_name_raw, '\s+', ' ', 'g'), 160) AS folder_name,
        LEFT(regexp_replace(functionality_group_raw, '\s+', ' ', 'g'), 120) AS functionality_group
    FROM legacy_dna_files
),
folder_rows AS (
    SELECT
        'folder_' || md5(org_id || '|' || folder_key) AS id,
        org_id,
        MAX(NULLIF(folder_name, '')) AS name,
        MAX(NULLIF(functionality_group, '')) AS functionality_group
    FROM normalized_dna_files
    GROUP BY org_id, folder_key
)
INSERT INTO "Folder" ("id", "orgId", "name", "functionalityGroup")
SELECT
    id,
    org_id,
    COALESCE(name, 'General'),
    COALESCE(functionality_group, 'General')
FROM folder_rows;

WITH legacy_dna_files AS (
    SELECT
        f.id AS file_id,
        f."orgId" AS org_id,
        COALESCE(NULLIF(BTRIM(f.metadata->>'targetFolderId'), ''), '__general__') AS folder_key
    FROM "File" f
    WHERE f.type = 'DNA'
)
UPDATE "File" f
SET "folderId" = 'folder_' || md5(legacy_dna_files.org_id || '|' || legacy_dna_files.folder_key)
FROM legacy_dna_files
WHERE f.id = legacy_dna_files.file_id
  AND f."folderId" IS NULL;

-- Backfill AgentMemory.fileId from existing metadata to avoid JSON joins on hot paths.
UPDATE "AgentMemory" am
SET "fileId" = f.id
FROM "File" f
WHERE am."fileId" IS NULL
  AND NULLIF(BTRIM(am.metadata->>'fileId'), '') = f.id;

ALTER TABLE "Folder"
ADD CONSTRAINT "Folder_orgId_fkey"
FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "File"
ADD CONSTRAINT "File_folderId_fkey"
FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AgentMemory"
ADD CONSTRAINT "AgentMemory_fileId_fkey"
FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Folder_orgId_functionalityGroup_idx" ON "Folder"("orgId", "functionalityGroup");
CREATE INDEX "Folder_orgId_createdAt_idx" ON "Folder"("orgId", "createdAt");
CREATE INDEX "File_orgId_folderId_idx" ON "File"("orgId", "folderId");
CREATE INDEX "AgentMemory_fileId_idx" ON "AgentMemory"("fileId");
