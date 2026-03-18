import "server-only";

import {
  acquireRedisMutexLock,
  getRedisClient,
  releaseRedisMutexLock
} from "@/lib/redis/stream-client";
import type { ShortTermWorkflowState } from "@/src/orchestrator/types";

const FALLBACK_CACHE = new Map<
  string,
  {
    expiresAt: number;
    value: ShortTermWorkflowState;
  }
>();

function workflowStateKey(workflowId: string) {
  return `orchestrator:workflow:${workflowId}`;
}

function workflowLockKey(workflowId: string) {
  return `orchestrator:workflow:lock:${workflowId}`;
}

function readFallback(workflowId: string) {
  const entry = FALLBACK_CACHE.get(workflowId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    FALLBACK_CACHE.delete(workflowId);
    return null;
  }
  return entry.value;
}

function writeFallback(state: ShortTermWorkflowState, ttlSeconds: number) {
  FALLBACK_CACHE.set(state.workflowId, {
    expiresAt: Date.now() + ttlSeconds * 1000,
    value: state
  });
}

export async function getWorkflowState(workflowId: string) {
  const redis = await getRedisClient();
  if (!redis) {
    return readFallback(workflowId);
  }
  const raw = await redis.get(workflowStateKey(workflowId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ShortTermWorkflowState;
  } catch {
    return null;
  }
}

export async function saveWorkflowState(input: {
  state: ShortTermWorkflowState;
  ttlSeconds?: number;
}) {
  const ttlSeconds = Math.max(300, Math.floor(input.ttlSeconds ?? 24 * 60 * 60));
  const redis = await getRedisClient();
  if (!redis) {
    writeFallback(input.state, ttlSeconds);
    return;
  }
  await redis.set(workflowStateKey(input.state.workflowId), JSON.stringify(input.state), {
    EX: ttlSeconds
  });
}

export async function patchWorkflowState(
  workflowId: string,
  updater: (current: ShortTermWorkflowState) => ShortTermWorkflowState
) {
  const lock = await acquireRedisMutexLock({
    key: workflowLockKey(workflowId),
    owner: "orchestrator",
    ttlMs: 4000
  });

  try {
    const current = await getWorkflowState(workflowId);
    if (!current) {
      return null;
    }
    const nextState = updater({
      ...current,
      updatedAt: new Date().toISOString()
    });
    await saveWorkflowState({ state: nextState });
    return nextState;
  } finally {
    if (lock.ok && lock.acquired && lock.token) {
      await releaseRedisMutexLock({
        key: workflowLockKey(workflowId),
        token: lock.token
      });
    }
  }
}

