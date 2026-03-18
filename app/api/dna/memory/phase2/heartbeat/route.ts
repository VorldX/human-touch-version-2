export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { registerSessionActivity } from "@/lib/dna/phase2";
import { requireOrgAccess } from "@/lib/security/org-access";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        sessionId?: string;
      }
    | null;

  const orgId = body?.orgId?.trim() ?? "";
  if (!orgId) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId is required."
      },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId, allowInternal: true });
  if (!access.ok) {
    return access.response;
  }

  const sessionId =
    body?.sessionId?.trim() || `direction-chat:${orgId}:${access.actor.userId}`;

  await registerSessionActivity({
    tenantId: orgId,
    userId: access.actor.userId,
    sessionId
  });

  return NextResponse.json({
    ok: true,
    orgId,
    userId: access.actor.userId,
    sessionId,
    trackedAt: new Date().toISOString()
  });
}
