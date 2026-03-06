export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { runMissionSchedule } from "@/lib/schedule/mission-runner";
import { requireOrgAccess } from "@/lib/security/org-access";

interface RouteContext {
  params: Promise<{
    scheduleId: string;
  }>;
}

function readOrgId(request: NextRequest, body: { orgId?: string } | null) {
  return (
    request.nextUrl.searchParams.get("orgId")?.trim() ||
    body?.orgId?.trim() ||
    ""
  );
}

export async function POST(request: NextRequest, context: RouteContext) {
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
      }
    | null;

  const orgId = readOrgId(request, body);
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

  const { scheduleId } = await context.params;
  const result = await runMissionSchedule({
    origin: request.nextUrl.origin,
    orgId,
    scheduleId
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        message: result.message
      },
      { status: result.status }
    );
  }

  return NextResponse.json({
    ok: true,
    flow: result.flow,
    schedule: result.schedule,
    ...(result.warning ? { warning: result.warning } : {})
  });
}
