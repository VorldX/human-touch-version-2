export const dynamic = "force-dynamic";

import { LogType, MemoryTier } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { featureFlags } from "@/lib/config/feature-flags";
import { buildComplianceHash } from "@/lib/security/audit";
import { requireOrgAccess } from "@/lib/security/org-access";

function parseTier(value: string | undefined): MemoryTier | null {
  if (value === "WORKING") return MemoryTier.WORKING;
  if (value === "ORG") return MemoryTier.ORG;
  if (value === "USER") return MemoryTier.USER;
  if (value === "AGENT") return MemoryTier.AGENT;
  return null;
}

export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("orgId")?.trim();
  const tier = parseTier(request.nextUrl.searchParams.get("tier") ?? undefined);
  if (!orgId) {
    return NextResponse.json(
      { ok: false, message: "orgId query param is required." },
      { status: 400 }
    );
  }
  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  const entries = await prisma.memoryEntry.findMany({
    where: {
      orgId,
      ...(tier ? { tier } : {})
    },
    orderBy: { createdAt: "desc" },
    take: 250
  });

  return NextResponse.json({
    ok: true,
    featureEnabled: featureFlags.memoryGovernance,
    entries
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        flowId?: string;
        taskId?: string;
        agentId?: string;
        userId?: string;
        tier?: string;
        key?: string;
        value?: unknown;
        ttlSeconds?: number;
      }
    | null;

  const orgId = body?.orgId?.trim() ?? "";
  const tier = parseTier(body?.tier);
  const key = body?.key?.trim() ?? "";

  if (!orgId || !tier || !key) {
    return NextResponse.json(
      { ok: false, message: "orgId, tier, and key are required." },
      { status: 400 }
    );
  }
  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  const ttlSeconds =
    typeof body?.ttlSeconds === "number" && body.ttlSeconds > 0 ? Math.floor(body.ttlSeconds) : null;
  const flowId = body?.flowId?.trim() || null;
  const taskId = body?.taskId?.trim() || null;
  const agentId = body?.agentId?.trim() || null;
  const userId = body?.userId?.trim() || null;
  const value = (body?.value as object) ?? null;

  const valueKind = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  const valueBytes = JSON.stringify(value).length;
  const actionType = "MEMORY_ENTRY_WRITE";
  const complianceHash = buildComplianceHash({
    actionType,
    orgId,
    flowId,
    taskId,
    agentId,
    userId,
    tier,
    key,
    ttlSeconds,
    valueKind,
    valueBytes,
    actor: access.actor.userId
  });
  const humanActorId = access.actor.isInternal ? null : access.actor.userId;

  const entry = await prisma.$transaction(async (tx) => {
    const created = await tx.memoryEntry.create({
      data: {
        orgId,
        flowId,
        taskId,
        agentId,
        userId,
        tier,
        key,
        value,
        ttlSeconds,
        expiresAt: ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000) : null
      }
    });

    await tx.log.create({
      data: {
        orgId,
        type: LogType.USER,
        actor: "MEMORY_API",
        message: `Memory entry ${created.id} created (${created.tier}/${created.key}).`
      }
    });

    await tx.complianceAudit.create({
      data: {
        orgId,
        flowId: created.flowId,
        humanActorId,
        actionType,
        complianceHash
      }
    });

    return created;
  });

  return NextResponse.json({ ok: true, entry }, { status: 201 });
}
