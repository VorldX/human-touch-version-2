export const dynamic = "force-dynamic";

import { MemoryTier } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { featureFlags } from "@/lib/config/feature-flags";
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

  const entry = await prisma.memoryEntry.create({
    data: {
      orgId,
      flowId: body?.flowId?.trim() || null,
      taskId: body?.taskId?.trim() || null,
      agentId: body?.agentId?.trim() || null,
      userId: body?.userId?.trim() || null,
      tier,
      key,
      value: (body?.value as object) ?? null,
      ttlSeconds,
      expiresAt: ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000) : null
    }
  });

  return NextResponse.json({ ok: true, entry }, { status: 201 });
}
