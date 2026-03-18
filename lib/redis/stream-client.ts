import "server-only";

import { randomUUID } from "node:crypto";

import { createClient } from "redis";

let redisClientPromise: Promise<any | null> | null = null;

async function createRedisClient() {
  const url = process.env.REDIS_URL?.trim();
  if (!url) {
    return null;
  }

  const client = createClient({ url });
  client.on("error", (error) => {
    console.warn("[dna-memory][redis] client error", error);
  });

  await client.connect();
  return client;
}

export async function getRedisClient() {
  if (!redisClientPromise) {
    redisClientPromise = createRedisClient();
  }

  try {
    return await redisClientPromise;
  } catch (error) {
    redisClientPromise = null;
    console.warn("[dna-memory][redis] unable to connect", error);
    return null;
  }
}

export async function xaddStreamPointer(input: {
  stream: string;
  fields: Record<string, string>;
}) {
  const client = await getRedisClient();
  if (!client) {
    return {
      ok: false as const,
      reason: "redis_unavailable" as const,
      streamId: null as string | null
    };
  }

  try {
    const streamId = await client.xAdd(input.stream, "*", input.fields);
    return {
      ok: true as const,
      reason: "published" as const,
      streamId
    };
  } catch (error) {
    return {
      ok: false as const,
      reason: error instanceof Error ? error.message : "redis_xadd_failed",
      streamId: null as string | null
    };
  }
}

export async function publishRedisMessage(input: {
  channel: string;
  message: string;
}) {
  const client = await getRedisClient();
  if (!client) {
    return {
      ok: false as const,
      reason: "redis_unavailable" as const
    };
  }

  try {
    await client.publish(input.channel, input.message);
    return {
      ok: true as const,
      reason: "published" as const
    };
  } catch (error) {
    return {
      ok: false as const,
      reason: error instanceof Error ? error.message : "redis_publish_failed"
    };
  }
}

export async function acquireRedisMutexLock(input: {
  key: string;
  owner: string;
  ttlMs: number;
}) {
  const client = await getRedisClient();
  if (!client) {
    return {
      ok: false as const,
      acquired: false as const,
      token: null as string | null,
      reason: "redis_unavailable" as const
    };
  }

  const token = `${input.owner}:${randomUUID().slice(0, 12)}`;

  try {
    const result = await client.set(input.key, token, {
      NX: true,
      PX: Math.max(1000, Math.floor(input.ttlMs))
    });
    if (result !== "OK") {
      return {
        ok: true as const,
        acquired: false as const,
        token: null as string | null,
        reason: "already_locked" as const
      };
    }
    return {
      ok: true as const,
      acquired: true as const,
      token,
      reason: "acquired" as const
    };
  } catch (error) {
    return {
      ok: false as const,
      acquired: false as const,
      token: null as string | null,
      reason: error instanceof Error ? error.message : "redis_mutex_set_failed"
    };
  }
}

export async function readRedisLockToken(input: { key: string }) {
  const client = await getRedisClient();
  if (!client) {
    return null;
  }
  try {
    const value = await client.get(input.key);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

export async function releaseRedisMutexLock(input: {
  key: string;
  token: string;
}) {
  const client = await getRedisClient();
  if (!client) {
    return {
      ok: false as const,
      released: false as const,
      reason: "redis_unavailable" as const
    };
  }

  try {
    const released = await client.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      {
        keys: [input.key],
        arguments: [input.token]
      }
    );

    return {
      ok: true as const,
      released: Number(released) > 0,
      reason: Number(released) > 0 ? ("released" as const) : ("not_owner" as const)
    };
  } catch (error) {
    return {
      ok: false as const,
      released: false as const,
      reason: error instanceof Error ? error.message : "redis_mutex_release_failed"
    };
  }
}
