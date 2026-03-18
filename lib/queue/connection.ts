import "server-only";

import type { ConnectionOptions } from "bullmq";

let redisConnection: ConnectionOptions | null | undefined;

export function getBullMqConnection(): ConnectionOptions | null {
  if (redisConnection !== undefined) {
    return redisConnection;
  }

  const url = process.env.REDIS_URL?.trim();
  if (!url) {
    redisConnection = null;
    return redisConnection;
  }

  redisConnection = { url };
  return redisConnection;
}

export function isQueueInfraConfigured() {
  return Boolean(getBullMqConnection());
}
