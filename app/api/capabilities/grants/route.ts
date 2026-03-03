import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { featureFlags } from "@/lib/config/feature-flags";

export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("orgId")?.trim();
  if (!orgId) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId query param is required."
      },
      { status: 400 }
    );
  }

  const grants = await prisma.capabilityGrant.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" }
  });

  return NextResponse.json({
    ok: true,
    enabled: featureFlags.capabilityVault,
    grants
  });
}

export async function POST(request: NextRequest) {
  if (!featureFlags.capabilityVault) {
    return NextResponse.json(
      {
        ok: false,
        message: "Capability Vault feature flag is disabled."
      },
      { status: 409 }
    );
  }

  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        agentId?: string;
        linkedAccountId?: string;
        scopes?: Record<string, unknown>;
      }
    | null;

  const orgId = body?.orgId?.trim() ?? "";
  const agentId = body?.agentId?.trim() ?? "";
  const linkedAccountId = body?.linkedAccountId?.trim() ?? "";

  if (!orgId || !agentId || !linkedAccountId) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId, agentId, and linkedAccountId are required."
      },
      { status: 400 }
    );
  }

  const [agent, account] = await Promise.all([
    prisma.personnel.findUnique({ where: { id: agentId }, select: { id: true, orgId: true } }),
    prisma.linkedAccount.findUnique({
      where: { id: linkedAccountId },
      select: { id: true, user: { select: { orgMemberships: { where: { orgId }, select: { orgId: true } } } } }
    })
  ]);

  if (!agent || agent.orgId !== orgId || !account || account.user.orgMemberships.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        message: "Invalid agent/account pairing for this organization."
      },
      { status: 403 }
    );
  }

  const grant = await prisma.capabilityGrant.create({
    data: {
      orgId,
      agentId,
      linkedAccountId,
      scopes: (body?.scopes ?? {}) as Prisma.InputJsonValue
    }
  });

  return NextResponse.json({ ok: true, grant }, { status: 201 });
}
