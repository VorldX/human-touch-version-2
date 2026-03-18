import "server-only";

import { prisma } from "@/lib/db/prisma";
import { DNA_PHASE4_SCHEMA_VERSION, dnaPhase4Config } from "@/lib/dna/phase4/config";
import { ensurePhase4Partitions } from "@/lib/dna/phase4/quarantine";
import { publishDnaUpdateEvent } from "@/lib/dna/phase3";

interface AdminConfigRow {
  id: number;
  configId: string;
  configKey: string;
  configJsonb: unknown;
  version: number;
  updatedAt: Date;
}

interface BackupRecordRow {
  id: number;
  backupId: string;
  backupLabel: string;
  rowCount: number;
  metadataJsonb: unknown;
  createdAt: Date;
}

interface CentralMemoryBackupRow {
  id: number;
  tier: "LONG_TERM" | "ARCHIVE" | "STAGING";
  memoryDomain: "CONTEXTUAL" | "WORKING";
  memoryKind: "FACT" | "GRAPH_NODE" | "RULE" | "SOP_PATHWAY";
  documentId: string;
  chunkIndex: number;
  tokenCount: number;
  content: string;
  embeddingText: string;
  metadataJsonb: unknown;
  schemaVersion: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt: Date;
}

interface NodeBackupRow {
  id: number;
  label: string;
  propertiesJsonb: unknown;
  schemaVersion: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

interface EdgeBackupRow {
  id: number;
  sourceId: number;
  targetId: number;
  relationshipType: string;
  weight: number;
  schemaVersion: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

function asJson(value: unknown) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

export async function listAdminJsonConfigs(input: {
  tenantId: string;
  userId: string;
}) {
  await ensurePhase4Partitions({ tenantId: input.tenantId, userId: input.userId });

  const rows = await prisma.$queryRawUnsafe<AdminConfigRow[]>(
    `
      SELECT
        id,
        config_id::text AS "configId",
        config_key AS "configKey",
        config_jsonb AS "configJsonb",
        version,
        updated_at AS "updatedAt"
      FROM dna_memory.admin_json_configs
      WHERE tenant_id = $1
        AND user_id = $2
      ORDER BY updated_at DESC
    `,
    input.tenantId,
    input.userId
  );

  return rows;
}

export async function upsertAdminJsonConfig(input: {
  tenantId: string;
  userId: string;
  configKey: string;
  configJson: Record<string, unknown>;
  expectedVersion?: number;
}) {
  await ensurePhase4Partitions({ tenantId: input.tenantId, userId: input.userId });

  const existingRows = await prisma.$queryRawUnsafe<AdminConfigRow[]>(
    `
      SELECT
        id,
        config_id::text AS "configId",
        config_key AS "configKey",
        config_jsonb AS "configJsonb",
        version,
        updated_at AS "updatedAt"
      FROM dna_memory.admin_json_configs
      WHERE tenant_id = $1
        AND user_id = $2
        AND config_key = $3
      LIMIT 1
    `,
    input.tenantId,
    input.userId,
    input.configKey
  );

  const existing = existingRows[0];

  if (!existing) {
    const insertedRows = await prisma.$queryRawUnsafe<AdminConfigRow[]>(
      `
        INSERT INTO dna_memory.admin_json_configs (
          tenant_id,
          user_id,
          config_key,
          config_jsonb,
          schema_version
        )
        VALUES ($1, $2, $3, $4::jsonb, $5)
        RETURNING
          id,
          config_id::text AS "configId",
          config_key AS "configKey",
          config_jsonb AS "configJsonb",
          version,
          updated_at AS "updatedAt"
      `,
      input.tenantId,
      input.userId,
      input.configKey,
      asJson(input.configJson),
      DNA_PHASE4_SCHEMA_VERSION
    );

    await publishDnaUpdateEvent({
      tenantId: input.tenantId,
      userId: input.userId,
      payload: {
        source: "phase4.admin.config",
        action: "create",
        config_key: input.configKey
      }
    });

    return {
      applied: true,
      created: true,
      config: insertedRows[0] ?? null
    };
  }

  if (!input.expectedVersion || input.expectedVersion < 1) {
    return {
      applied: false,
      created: false,
      reason: "expected_version_required" as const,
      config: existing
    };
  }

  const occRows = await prisma.$queryRawUnsafe<Array<{ applied: boolean; newVersion: number | null }>>(
    `
      SELECT
        applied,
        new_version AS "newVersion"
      FROM dna_memory.update_admin_json_config_occ(
        $1,
        $2,
        $3,
        $4,
        $5::jsonb
      )
    `,
    input.tenantId,
    input.userId,
    existing.id,
    input.expectedVersion,
    asJson(input.configJson)
  );

  if (!occRows[0]?.applied) {
    return {
      applied: false,
      created: false,
      reason: "occ_conflict" as const,
      config: existing
    };
  }

  const updatedRows = await prisma.$queryRawUnsafe<AdminConfigRow[]>(
    `
      SELECT
        id,
        config_id::text AS "configId",
        config_key AS "configKey",
        config_jsonb AS "configJsonb",
        version,
        updated_at AS "updatedAt"
      FROM dna_memory.admin_json_configs
      WHERE tenant_id = $1
        AND user_id = $2
        AND id = $3
      LIMIT 1
    `,
    input.tenantId,
    input.userId,
    existing.id
  );

  await publishDnaUpdateEvent({
    tenantId: input.tenantId,
    userId: input.userId,
    payload: {
      source: "phase4.admin.config",
      action: "update",
      config_key: input.configKey
    }
  });

  return {
    applied: true,
    created: false,
    config: updatedRows[0] ?? null
  };
}

export async function deleteAdminJsonConfig(input: {
  tenantId: string;
  userId: string;
  configKey: string;
}) {
  await ensurePhase4Partitions({ tenantId: input.tenantId, userId: input.userId });

  const deletedRows = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
    `
      DELETE FROM dna_memory.admin_json_configs
      WHERE tenant_id = $1
        AND user_id = $2
        AND config_key = $3
      RETURNING id
    `,
    input.tenantId,
    input.userId,
    input.configKey
  );

  if (deletedRows.length > 0) {
    await publishDnaUpdateEvent({
      tenantId: input.tenantId,
      userId: input.userId,
      payload: {
        source: "phase4.admin.config",
        action: "delete",
        config_key: input.configKey
      }
    });
  }

  return {
    deleted: deletedRows.length > 0
  };
}

export async function listPgvectorBackups(input: {
  tenantId: string;
  userId: string;
  limit?: number;
}) {
  await ensurePhase4Partitions({ tenantId: input.tenantId, userId: input.userId });

  const limit = Math.max(
    1,
    Math.min(60, Math.floor(input.limit ?? dnaPhase4Config.admin.defaultBackupLimit))
  );

  const rows = await prisma.$queryRawUnsafe<BackupRecordRow[]>(
    `
      SELECT
        id,
        backup_id::text AS "backupId",
        backup_label AS "backupLabel",
        row_count AS "rowCount",
        metadata_jsonb AS "metadataJsonb",
        created_at AS "createdAt"
      FROM dna_memory.pgvector_backups
      WHERE tenant_id = $1
        AND user_id = $2
      ORDER BY created_at DESC
      LIMIT $3
    `,
    input.tenantId,
    input.userId,
    limit
  );

  return rows;
}

export async function createPgvectorBackup(input: {
  tenantId: string;
  userId: string;
  backupLabel?: string;
  requestedBy: string;
}) {
  await ensurePhase4Partitions({ tenantId: input.tenantId, userId: input.userId });

  const maxRows = dnaPhase4Config.admin.maxBackupRows;

  const [centralCountRows, nodeCountRows, edgeCountRows] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{ count: number }>>(
      `
        SELECT COUNT(*)::int AS count
        FROM dna_memory.central_memory
        WHERE tenant_id = $1
          AND user_id = $2
      `,
      input.tenantId,
      input.userId
    ),
    prisma.$queryRawUnsafe<Array<{ count: number }>>(
      `
        SELECT COUNT(*)::int AS count
        FROM dna_memory.nodes
        WHERE tenant_id = $1
          AND user_id = $2
      `,
      input.tenantId,
      input.userId
    ),
    prisma.$queryRawUnsafe<Array<{ count: number }>>(
      `
        SELECT COUNT(*)::int AS count
        FROM dna_memory.edges
        WHERE tenant_id = $1
          AND user_id = $2
      `,
      input.tenantId,
      input.userId
    )
  ]);

  const totalRows =
    (centralCountRows[0]?.count ?? 0) +
    (nodeCountRows[0]?.count ?? 0) +
    (edgeCountRows[0]?.count ?? 0);

  if (totalRows > maxRows) {
    throw new Error(
      `Backup aborted: ${totalRows} rows exceed configured max ${maxRows}.`
    );
  }

  const [centralMemory, nodes, edges] = await Promise.all([
    prisma.$queryRawUnsafe<CentralMemoryBackupRow[]>(
      `
        SELECT
          id,
          tier::text AS tier,
          memory_domain::text AS "memoryDomain",
          memory_kind::text AS "memoryKind",
          document_id AS "documentId",
          chunk_index AS "chunkIndex",
          token_count AS "tokenCount",
          content,
          embedding::text AS "embeddingText",
          metadata_jsonb AS "metadataJsonb",
          schema_version AS "schemaVersion",
          version,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          last_accessed_at AS "lastAccessedAt"
        FROM dna_memory.central_memory
        WHERE tenant_id = $1
          AND user_id = $2
        ORDER BY id ASC
      `,
      input.tenantId,
      input.userId
    ),
    prisma.$queryRawUnsafe<NodeBackupRow[]>(
      `
        SELECT
          id,
          label,
          properties_jsonb AS "propertiesJsonb",
          schema_version AS "schemaVersion",
          version,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM dna_memory.nodes
        WHERE tenant_id = $1
          AND user_id = $2
        ORDER BY id ASC
      `,
      input.tenantId,
      input.userId
    ),
    prisma.$queryRawUnsafe<EdgeBackupRow[]>(
      `
        SELECT
          id,
          source_id AS "sourceId",
          target_id AS "targetId",
          relationship_type AS "relationshipType",
          weight,
          schema_version AS "schemaVersion",
          version,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM dna_memory.edges
        WHERE tenant_id = $1
          AND user_id = $2
        ORDER BY id ASC
      `,
      input.tenantId,
      input.userId
    )
  ]);

  const backupPayload = {
    central_memory: centralMemory,
    nodes,
    edges
  };

  const label = input.backupLabel?.trim() || `backup-${new Date().toISOString()}`;

  const backupRows = await prisma.$queryRawUnsafe<Array<{ backupId: string }>>(
    `
      INSERT INTO dna_memory.pgvector_backups (
        tenant_id,
        user_id,
        backup_label,
        backup_payload_jsonb,
        row_count,
        metadata_jsonb,
        schema_version
      )
      VALUES (
        $1,
        $2,
        $3,
        $4::jsonb,
        $5,
        $6::jsonb,
        $7
      )
      RETURNING backup_id::text AS "backupId"
    `,
    input.tenantId,
    input.userId,
    label,
    asJson(backupPayload),
    totalRows,
    asJson({
      requested_by: input.requestedBy,
      requested_at: new Date().toISOString(),
      central_memory_rows: centralMemory.length,
      node_rows: nodes.length,
      edge_rows: edges.length
    }),
    DNA_PHASE4_SCHEMA_VERSION
  );

  const backupId = backupRows[0]?.backupId;
  if (!backupId) {
    throw new Error("Unable to create backup record.");
  }

  await publishDnaUpdateEvent({
    tenantId: input.tenantId,
    userId: input.userId,
    payload: {
      source: "phase4.admin.backup",
      action: "backup_created",
      backup_id: backupId,
      row_count: totalRows
    }
  });

  return {
    backupId,
    rowCount: totalRows,
    label
  };
}

export async function rollbackPgvectorBackup(input: {
  tenantId: string;
  userId: string;
  backupId: string;
  requestedBy: string;
}) {
  await ensurePhase4Partitions({ tenantId: input.tenantId, userId: input.userId });
  await prisma.$queryRawUnsafe(
    "SELECT * FROM dna_memory.ensure_partition_for_subject($1, $2)",
    input.tenantId,
    input.userId
  );

  const backupRows = await prisma.$queryRawUnsafe<Array<{ payload: unknown; backupLabel: string }>>(
    `
      SELECT
        backup_payload_jsonb AS payload,
        backup_label AS "backupLabel"
      FROM dna_memory.pgvector_backups
      WHERE tenant_id = $1
        AND user_id = $2
        AND backup_id = $3::uuid
      LIMIT 1
    `,
    input.tenantId,
    input.userId,
    input.backupId
  );

  const backup = backupRows[0];
  if (!backup) {
    throw new Error("Backup not found.");
  }

  const payload = (backup.payload && typeof backup.payload === "object"
    ? (backup.payload as Record<string, unknown>)
    : {}) as Record<string, unknown>;

  const centralMemory = Array.isArray(payload.central_memory)
    ? (payload.central_memory as Array<Record<string, unknown>>)
    : [];
  const nodes = Array.isArray(payload.nodes) ? (payload.nodes as Array<Record<string, unknown>>) : [];
  const edges = Array.isArray(payload.edges) ? (payload.edges as Array<Record<string, unknown>>) : [];

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `
        DELETE FROM dna_memory.edges
        WHERE tenant_id = $1
          AND user_id = $2
      `,
      input.tenantId,
      input.userId
    );

    await tx.$executeRawUnsafe(
      `
        DELETE FROM dna_memory.nodes
        WHERE tenant_id = $1
          AND user_id = $2
      `,
      input.tenantId,
      input.userId
    );

    await tx.$executeRawUnsafe(
      `
        DELETE FROM dna_memory.central_memory
        WHERE tenant_id = $1
          AND user_id = $2
      `,
      input.tenantId,
      input.userId
    );

    for (const row of nodes) {
      // eslint-disable-next-line no-await-in-loop
      await tx.$executeRawUnsafe(
        `
          INSERT INTO dna_memory.nodes (
            id,
            label,
            properties_jsonb,
            tenant_id,
            user_id,
            schema_version,
            version,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9)
        `,
        Number(row.id),
        String(row.label ?? "Node"),
        asJson(row.propertiesJsonb ?? {}),
        input.tenantId,
        input.userId,
        String(row.schemaVersion ?? "dna.phase1.v1"),
        Number(row.version ?? 1),
        row.createdAt ? new Date(String(row.createdAt)) : new Date(),
        row.updatedAt ? new Date(String(row.updatedAt)) : new Date()
      );
    }

    for (const row of edges) {
      // eslint-disable-next-line no-await-in-loop
      await tx.$executeRawUnsafe(
        `
          INSERT INTO dna_memory.edges (
            id,
            source_id,
            target_id,
            relationship_type,
            weight,
            tenant_id,
            user_id,
            schema_version,
            version,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `,
        Number(row.id),
        Number(row.sourceId),
        Number(row.targetId),
        String(row.relationshipType ?? "related_to"),
        Number(row.weight ?? 1),
        input.tenantId,
        input.userId,
        String(row.schemaVersion ?? "dna.phase1.v1"),
        Number(row.version ?? 1),
        row.createdAt ? new Date(String(row.createdAt)) : new Date(),
        row.updatedAt ? new Date(String(row.updatedAt)) : new Date()
      );
    }

    for (const row of centralMemory) {
      // eslint-disable-next-line no-await-in-loop
      await tx.$executeRawUnsafe(
        `
          INSERT INTO dna_memory.central_memory (
            id,
            tenant_id,
            user_id,
            tier,
            memory_domain,
            memory_kind,
            document_id,
            chunk_index,
            token_count,
            content,
            embedding,
            metadata_jsonb,
            schema_version,
            version,
            created_at,
            updated_at,
            last_accessed_at
          )
          VALUES (
            $1,
            $2,
            $3,
            $4::dna_memory.memory_tier,
            $5::dna_memory.memory_domain,
            $6::dna_memory.memory_kind,
            $7,
            $8,
            $9,
            $10,
            $11::vector,
            $12::jsonb,
            $13,
            $14,
            $15,
            $16,
            $17
          )
        `,
        Number(row.id),
        input.tenantId,
        input.userId,
        String(row.tier ?? "LONG_TERM"),
        String(row.memoryDomain ?? "CONTEXTUAL"),
        String(row.memoryKind ?? "FACT"),
        String(row.documentId ?? `restored.${row.id}`),
        Number(row.chunkIndex ?? 0),
        Number(row.tokenCount ?? 0),
        String(row.content ?? ""),
        String(row.embeddingText ?? "[]"),
        asJson(row.metadataJsonb ?? {}),
        String(row.schemaVersion ?? "dna.phase1.v1"),
        Number(row.version ?? 1),
        row.createdAt ? new Date(String(row.createdAt)) : new Date(),
        row.updatedAt ? new Date(String(row.updatedAt)) : new Date(),
        row.lastAccessedAt ? new Date(String(row.lastAccessedAt)) : new Date()
      );
    }
  });

  await publishDnaUpdateEvent({
    tenantId: input.tenantId,
    userId: input.userId,
    payload: {
      source: "phase4.admin.backup",
      action: "rollback",
      backup_id: input.backupId,
      backup_label: backup.backupLabel,
      requested_by: input.requestedBy
    }
  });

  return {
    rolledBack: true,
    backupId: input.backupId,
    backupLabel: backup.backupLabel,
    rowCount: centralMemory.length + nodes.length + edges.length
  };
}
