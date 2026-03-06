export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { deleteMissionSchedule, updateMissionSchedule } from "@/lib/schedule/mission-schedules";
import { requireOrgAccess } from "@/lib/security/org-access";

interface RouteContext {
  params: Promise<{
    scheduleId: string;
  }>;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { scheduleId } = await context.params;
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        title?: string;
        direction?: string;
        directionId?: string;
        cadence?: "DAILY" | "WEEKLY" | "MONTHLY" | "CUSTOM";
        nextRunAt?: string;
        timezone?: string;
        swarmDensity?: number;
        requiredSignatures?: number;
        predictedBurn?: number;
        enabled?: boolean;
        lastRunAt?: string;
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

  const updated = await updateMissionSchedule(orgId, scheduleId, {
    ...(body?.title !== undefined ? { title: body.title } : {}),
    ...(body?.direction !== undefined ? { direction: body.direction } : {}),
    ...(body?.directionId !== undefined ? { directionId: body.directionId } : {}),
    ...(body?.cadence !== undefined ? { cadence: body.cadence } : {}),
    ...(body?.nextRunAt !== undefined ? { nextRunAt: body.nextRunAt } : {}),
    ...(body?.timezone !== undefined ? { timezone: body.timezone } : {}),
    ...(body?.swarmDensity !== undefined ? { swarmDensity: body.swarmDensity } : {}),
    ...(body?.requiredSignatures !== undefined
      ? { requiredSignatures: body.requiredSignatures }
      : {}),
    ...(body?.predictedBurn !== undefined ? { predictedBurn: body.predictedBurn } : {}),
    ...(body?.enabled !== undefined ? { enabled: body.enabled } : {}),
    ...(body?.lastRunAt !== undefined ? { lastRunAt: body.lastRunAt } : {})
  });

  if (!updated) {
    return NextResponse.json(
      {
        ok: false,
        message: "Schedule not found."
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    ok: true,
    schedule: updated
  });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { scheduleId } = await context.params;
  const orgId =
    request.nextUrl.searchParams.get("orgId")?.trim() ||
    ((await request.json().catch(() => null)) as { orgId?: string } | null)?.orgId?.trim() ||
    "";

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

  const deleted = await deleteMissionSchedule(orgId, scheduleId);
  if (!deleted) {
    return NextResponse.json(
      {
        ok: false,
        message: "Schedule not found."
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    ok: true
  });
}
