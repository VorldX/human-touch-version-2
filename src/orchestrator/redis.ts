import "server-only";

import {
  acquireRedisMutexLock,
  getRedisClient,
  releaseRedisMutexLock
} from "@/lib/redis/stream-client";

const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

function workflowCompletedKey(workflowId: string) {
  return `workflow:${workflowId}:completed`;
}

function workflowReviewLockKey(workflowId: string) {
  return `lock:workflow:${workflowId}:review`;
}

function idempotencyCacheKey(input: { orgId: string; scope: string; key: string }) {
  return `idempotency:${input.orgId}:${input.scope}:${input.key}`;
}

export interface IdempotencyCacheValue {
  status: "IN_PROGRESS" | "SUCCEEDED" | "FAILED";
  requestHash: string;
  responseCode?: number;
  responseBody?: unknown;
  updatedAt: string;
}

export async function incrementWorkflowCompletedCounter(input: {
  workflowId: string;
  ttlSeconds?: number;
}) {
  const redis = await getRedisClient();
  if (!redis) {
    return null;
  }

  const key = workflowCompletedKey(input.workflowId);
  const count = await redis.incr(key);
  await redis.expire(key, Math.max(300, Math.floor(input.ttlSeconds ?? DEFAULT_TTL_SECONDS)));
  return count;
}

export async function acquireWorkflowReviewLock(input: {
  workflowId: string;
  owner: string;
  ttlMs?: number;
}) {
  return acquireRedisMutexLock({
    key: workflowReviewLockKey(input.workflowId),
    owner: input.owner,
    ttlMs: Math.max(1500, Math.floor(input.ttlMs ?? 6000))
  });
}

export async function releaseWorkflowReviewLock(input: {
  workflowId: string;
  token: string;
}) {
  return releaseRedisMutexLock({
    key: workflowReviewLockKey(input.workflowId),
    token: input.token
  });
}

export async function readIdempotencyCache(input: {
  orgId: string;
  scope: string;
  key: string;
}) {
  const redis = await getRedisClient();
  if (!redis) {
    return null;
  }

  const raw = await redis.get(idempotencyCacheKey(input));
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as IdempotencyCacheValue;
  } catch {
    return null;
  }
}

export async function writeIdempotencyCache(
  input: {
    orgId: string;
    scope: string;
    key: string;
    ttlSeconds?: number;
  } & IdempotencyCacheValue
) {
  const redis = await getRedisClient();
  if (!redis) {
    return;
  }

  await redis.set(idempotencyCacheKey(input), JSON.stringify(input), {
    EX: Math.max(300, Math.floor(input.ttlSeconds ?? DEFAULT_TTL_SECONDS))
  });
}
