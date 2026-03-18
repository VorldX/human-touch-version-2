export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { listRecentDnaSyncEvents, publishDnaUpdateEvent } from "@/lib/dna/phase3";
import { requireOrgAccess } from "@/lib/security/org-access";

function parseLimit(value: string | null, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("orgId")?.trim() ?? "";
  if (!orgId) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId query param is required."
      },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId, allowInternal: true });
  if (!access.ok) {
    return access.response;
  }

  const limit = parseLimit(request.nextUrl.searchParams.get("limit"), 40, 160);
  const events = await listRecentDnaSyncEvents({
    tenantId: orgId,
    userId: access.actor.userId,
    limit
  });

  return NextResponse.json({
    ok: true,
    orgId,
    userId: access.actor.userId,
    events
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        eventType?: string;
        channel?: string;
        payload?: Record<string, unknown>;
      }
    | null;

  const orgId = body?.orgId?.trim() ?? "";
  if (!orgId || !body?.payload) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId and payload are required."
      },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId, allowInternal: true });
  if (!access.ok) {
    return access.response;
  }

  const event = await publishDnaUpdateEvent({
    tenantId: orgId,
    userId: access.actor.userId,
    payload: body.payload,
    eventType: body.eventType,
    channel: body.channel
  });

  return NextResponse.json({
    ok: true,
    orgId,
    userId: access.actor.userId,
    event
  });
}
