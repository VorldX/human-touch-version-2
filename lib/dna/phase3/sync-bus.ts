import "server-only";

import { prisma } from "@/lib/db/prisma";
import { DNA_PHASE3_SCHEMA_VERSION, dnaPhase3Config } from "@/lib/dna/phase3/config";
import { ensurePhase3Partitions } from "@/lib/dna/phase3/pathway-registry";
import { publishRedisMessage } from "@/lib/redis/stream-client";

interface SyncEventInsertRow {
  id: number;
  eventId: string;
  version: number;
}

interface SyncEventRow {
  eventId: string;
  channel: string;
  eventType: string;
  payloadJsonb: unknown;
  publishedToRedis: boolean;
  createdAt: Date;
}

function asJson(value: unknown) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

export async function publishDnaUpdateEvent(input: {
  tenantId: string;
  userId: string;
  payload: Record<string, unknown>;
  channel?: string;
  eventType?: string;
}) {
  await ensurePhase3Partitions({
    tenantId: input.tenantId,
    userId: input.userId
  });

  const channel = input.channel?.trim() || dnaPhase3Config.syncBus.channel;
  const eventType = input.eventType?.trim() || dnaPhase3Config.syncBus.eventType;

  const insertedRows = await prisma.$queryRawUnsafe<SyncEventInsertRow[]>(
    `
      INSERT INTO dna_memory.dna_sync_events (
        tenant_id,
        user_id,
        channel,
        event_type,
        payload_jsonb,
        schema_version
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6)
      RETURNING id, event_id::text AS "eventId", version
    `,
    input.tenantId,
    input.userId,
    channel,
    eventType,
    asJson({
      ...input.payload,
      schema_version: DNA_PHASE3_SCHEMA_VERSION
    }),
    DNA_PHASE3_SCHEMA_VERSION
  );

  const inserted = insertedRows[0];
  if (!inserted?.eventId) {
    throw new Error("Unable to persist DNA update event.");
  }

  const message = asJson({
    event_id: inserted.eventId,
    tenant_id: input.tenantId,
    user_id: input.userId,
    event_type: eventType,
    schema_version: DNA_PHASE3_SCHEMA_VERSION,
    payload: input.payload
  });

  const publishResult = await publishRedisMessage({
    channel,
    message
  });

  if (publishResult.ok) {
    await prisma.$executeRawUnsafe(
      `
        UPDATE dna_memory.dna_sync_events
        SET
          published_to_redis = TRUE,
          version = version + 1,
          updated_at = NOW()
        WHERE tenant_id = $1
          AND user_id = $2
          AND id = $3
          AND version = $4
      `,
      input.tenantId,
      input.userId,
      inserted.id,
      inserted.version
    );
  }

  return {
    eventId: inserted.eventId,
    channel,
    eventType,
    publishedToRedis: publishResult.ok,
    warning: publishResult.ok ? null : publishResult.reason
  };
}

export async function listRecentDnaSyncEvents(input: {
  tenantId: string;
  userId: string;
  limit?: number;
}) {
  await ensurePhase3Partitions({
    tenantId: input.tenantId,
    userId: input.userId
  });

  const rows = await prisma.$queryRawUnsafe<SyncEventRow[]>(
    `
      SELECT
        event_id::text AS "eventId",
        channel,
        event_type AS "eventType",
        payload_jsonb AS "payloadJsonb",
        published_to_redis AS "publishedToRedis",
        created_at AS "createdAt"
      FROM dna_memory.dna_sync_events
      WHERE tenant_id = $1
        AND user_id = $2
      ORDER BY created_at DESC
      LIMIT $3
    `,
    input.tenantId,
    input.userId,
    Math.max(1, Math.min(200, Math.floor(input.limit ?? dnaPhase3Config.syncBus.recentLimit)))
  );

  return rows;
}
