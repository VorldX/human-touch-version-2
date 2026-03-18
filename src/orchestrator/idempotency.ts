import "server-only";

import { createHash } from "node:crypto";

import { IdempotencyStatus, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { readIdempotencyCache, writeIdempotencyCache } from "@/src/orchestrator/redis";

function toJsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function nowIso() {
  return new Date().toISOString();
}

export function stableHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

export async function claimIdempotency(input: {
  orgId: string;
  scope: string;
  key: string;
  requestHash: string;
  ttlSeconds?: number;
}) {
  const ttlSeconds = Math.max(300, Math.floor(input.ttlSeconds ?? 24 * 60 * 60));
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const cached = await readIdempotencyCache({
    orgId: input.orgId,
    scope: input.scope,
    key: input.key
  });
  if (cached) {
    if (cached.status === "SUCCEEDED" && cached.requestHash === input.requestHash) {
      return { acquired: false, reason: "already_succeeded_cache" as const };
    }
    if (cached.status === "IN_PROGRESS") {
      return { acquired: false, reason: "in_progress_cache" as const };
    }
  }

  const existing = await prisma.idempotencyKey.findFirst({
    where: {
      orgId: input.orgId,
      scope: input.scope,
      key: input.key
    },
    select: {
      id: true,
      status: true,
      requestHash: true
    }
  });

  if (existing) {
    if (existing.status === IdempotencyStatus.SUCCEEDED && existing.requestHash === input.requestHash) {
      await writeIdempotencyCache({
        orgId: input.orgId,
        scope: input.scope,
        key: input.key,
        requestHash: input.requestHash,
        status: "SUCCEEDED",
        updatedAt: nowIso(),
        ttlSeconds
      });
      return { acquired: false, reason: "already_succeeded" as const };
    }
    if (existing.status === IdempotencyStatus.IN_PROGRESS) {
      await writeIdempotencyCache({
        orgId: input.orgId,
        scope: input.scope,
        key: input.key,
        requestHash: existing.requestHash,
        status: "IN_PROGRESS",
        updatedAt: nowIso(),
        ttlSeconds
      });
      return { acquired: false, reason: "in_progress" as const };
    }

    await prisma.idempotencyKey.update({
      where: { id: existing.id },
      data: {
        status: IdempotencyStatus.IN_PROGRESS,
        requestHash: input.requestHash,
        expiresAt,
        responseCode: null,
        responseBody: Prisma.JsonNull
      }
    });
    await writeIdempotencyCache({
      orgId: input.orgId,
      scope: input.scope,
      key: input.key,
      requestHash: input.requestHash,
      status: "IN_PROGRESS",
      updatedAt: nowIso(),
      ttlSeconds
    });
    return { acquired: true, reason: "replayed_from_failed" as const };
  }

  await prisma.idempotencyKey.create({
    data: {
      orgId: input.orgId,
      scope: input.scope,
      key: input.key,
      requestHash: input.requestHash,
      status: IdempotencyStatus.IN_PROGRESS,
      expiresAt
    }
  });
  await writeIdempotencyCache({
    orgId: input.orgId,
    scope: input.scope,
    key: input.key,
    requestHash: input.requestHash,
    status: "IN_PROGRESS",
    updatedAt: nowIso(),
    ttlSeconds
  });

  return { acquired: true, reason: "created" as const };
}

export async function markIdempotencySucceeded(input: {
  orgId: string;
  scope: string;
  key: string;
  response?: unknown;
  responseCode?: number;
}) {
  const payload = {
    completedAt: nowIso(),
    response: input.response ?? null
  };
  const existing = await prisma.idempotencyKey.findFirst({
    where: {
      orgId: input.orgId,
      scope: input.scope,
      key: input.key
    },
    select: {
      requestHash: true
    }
  });
  await prisma.idempotencyKey.updateMany({
    where: {
      orgId: input.orgId,
      scope: input.scope,
      key: input.key
    },
    data: {
      status: IdempotencyStatus.SUCCEEDED,
      responseCode: input.responseCode ?? 200,
      responseBody: toJsonInput(payload)
    }
  });
  await writeIdempotencyCache({
    orgId: input.orgId,
    scope: input.scope,
    key: input.key,
    requestHash: existing?.requestHash ?? "",
    status: "SUCCEEDED",
    responseCode: input.responseCode ?? 200,
    responseBody: payload,
    updatedAt: nowIso()
  });
}

export async function markIdempotencyFailed(input: {
  orgId: string;
  scope: string;
  key: string;
  error: unknown;
}) {
  const message =
    input.error instanceof Error ? input.error.message : String(input.error ?? "unknown_error");
  const payload = {
    failedAt: nowIso(),
    message
  };
  const existing = await prisma.idempotencyKey.findFirst({
    where: {
      orgId: input.orgId,
      scope: input.scope,
      key: input.key
    },
    select: {
      requestHash: true
    }
  });
  await prisma.idempotencyKey.updateMany({
    where: {
      orgId: input.orgId,
      scope: input.scope,
      key: input.key
    },
    data: {
      status: IdempotencyStatus.FAILED,
      responseCode: 500,
      responseBody: toJsonInput(payload)
    }
  });
  await writeIdempotencyCache({
    orgId: input.orgId,
    scope: input.scope,
    key: input.key,
    requestHash: existing?.requestHash ?? "",
    status: "FAILED",
    responseCode: 500,
    responseBody: payload,
    updatedAt: nowIso()
  });
}
