import "server-only";

import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";

function isUniqueConflict(error: unknown) {
  const code =
    typeof (error as { code?: unknown })?.code === "string"
      ? (error as { code: string }).code
      : "";
  return code === "P2002";
}

export function hashIdempotencyRequest(payload: unknown) {
  const raw = JSON.stringify(payload ?? null);
  return createHash("sha256").update(raw).digest("hex");
}

export async function withIdempotency<T>(input: {
  orgId: string;
  scope: string;
  key: string;
  requestHash: string;
  ttlSeconds?: number;
  execute: () => Promise<{ code: number; body: T }>;
}) {
  const uniqueWhere = {
    orgId_scope_key: {
      orgId: input.orgId,
      scope: input.scope,
      key: input.key
    }
  };

  const existing = await prisma.idempotencyKey.findUnique({
    where: uniqueWhere
  });

  if (existing?.status === "SUCCEEDED" && existing.responseBody) {
    return {
      source: "cache" as const,
      code: existing.responseCode ?? 200,
      body: existing.responseBody as T
    };
  }

  if (!existing) {
    try {
      await prisma.idempotencyKey.create({
        data: {
          orgId: input.orgId,
          scope: input.scope,
          key: input.key,
          requestHash: input.requestHash,
          status: "IN_PROGRESS",
          expiresAt: new Date(Date.now() + (input.ttlSeconds ?? 24 * 3600) * 1000)
        }
      });
    } catch (error) {
      if (!isUniqueConflict(error)) {
        throw error;
      }
    }
  }

  const result = await input.execute();

  await prisma.idempotencyKey.update({
    where: uniqueWhere,
    data: {
      status: "SUCCEEDED",
      responseCode: result.code,
      responseBody: result.body as Prisma.InputJsonValue
    }
  });

  return {
    source: "fresh" as const,
    code: result.code,
    body: result.body
  };
}
