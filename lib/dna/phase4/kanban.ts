import "server-only";

import { listBlackboardSnapshot } from "@/lib/dna/phase3";
import { getRedisClient } from "@/lib/redis/stream-client";

function boardStepsKey(input: {
  tenantId: string;
  userId: string;
  boardId: string;
}) {
  return `dna_memory:blackboard:${input.tenantId}:${input.userId}:${input.boardId}:steps`;
}

function boardMetaKey(input: {
  tenantId: string;
  userId: string;
  boardId: string;
}) {
  return `dna_memory:blackboard:${input.tenantId}:${input.userId}:${input.boardId}:meta`;
}

export async function getKanbanRealtimeSnapshot(input: {
  tenantId: string;
  userId: string;
  boardId?: string;
  limit?: number;
}) {
  const snapshot = await listBlackboardSnapshot({
    tenantId: input.tenantId,
    userId: input.userId,
    boardId: input.boardId ?? null,
    limit: input.limit
  });

  const selectedBoardId = input.boardId?.trim() || snapshot.boards[0]?.boardId || "";
  const client = await getRedisClient();

  let redisMeta: Record<string, string> = {};
  let redisPendingSteps: Array<Record<string, unknown>> = [];

  if (client && selectedBoardId) {
    try {
      const [meta, stepRaw] = await Promise.all([
        client.hGetAll(
          boardMetaKey({
            tenantId: input.tenantId,
            userId: input.userId,
            boardId: selectedBoardId
          })
        ),
        client.lRange(
          boardStepsKey({
            tenantId: input.tenantId,
            userId: input.userId,
            boardId: selectedBoardId
          }),
          0,
          80
        )
      ]);

      redisMeta = meta ?? {};
      redisPendingSteps = (stepRaw ?? []).map((item: string) => {
        try {
          const parsed = JSON.parse(item);
          return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : { raw: item };
        } catch {
          return { raw: item };
        }
      });
    } catch {
      redisMeta = {};
      redisPendingSteps = [];
    }
  }

  return {
    ...snapshot,
    selectedBoardId,
    redis: {
      connected: Boolean(client),
      meta: redisMeta,
      pendingSteps: redisPendingSteps
    }
  };
}
