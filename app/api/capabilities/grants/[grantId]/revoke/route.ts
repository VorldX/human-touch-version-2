import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { featureFlags } from "@/lib/config/feature-flags";

interface RouteContext {
  params: {
    grantId: string;
  };
}

export async function POST(request: NextRequest, context: RouteContext) {
  if (!featureFlags.capabilityVault) {
    return NextResponse.json(
      {
        ok: false,
        message: "Capability Vault feature flag is disabled."
      },
      { status: 409 }
    );
  }

  const grantId = context.params.grantId?.trim();
  const body = (await request.json().catch(() => null)) as { orgId?: string } | null;
  const orgId = body?.orgId?.trim() ?? "";

  if (!grantId || !orgId) {
    return NextResponse.json(
      {
        ok: false,
        message: "grantId and orgId are required."
      },
      { status: 400 }
    );
  }

  const grant = await prisma.capabilityGrant.findUnique({
    where: { id: grantId },
    select: { id: true, orgId: true, revokedAt: true }
  });

  if (!grant || grant.orgId !== orgId) {
    return NextResponse.json(
      {
        ok: false,
        message: "Capability grant not found for this organization."
      },
      { status: 404 }
    );
  }

  const updated = await prisma.capabilityGrant.update({
    where: { id: grantId },
    data: {
      revokedAt: new Date()
    }
  });

  return NextResponse.json({ ok: true, grant: updated });
}

