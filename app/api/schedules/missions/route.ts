import { NextRequest, NextResponse } from "next/server";

import { createMissionSchedule, listMissionSchedules } from "@/lib/schedule/mission-schedules";

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

  const schedules = await listMissionSchedules(orgId);
  return NextResponse.json({
    ok: true,
    schedules
  });
}

export async function POST(request: NextRequest) {
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
      }
    | null;

  const orgId = body?.orgId?.trim() ?? "";
  const direction = body?.direction?.trim() ?? "";
  if (!orgId || !direction) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId and direction are required."
      },
      { status: 400 }
    );
  }

  const schedule = await createMissionSchedule(orgId, {
    title: body?.title ?? "Scheduled Mission",
    direction,
    ...(body?.directionId?.trim() ? { directionId: body.directionId.trim() } : {}),
    cadence: body?.cadence ?? "DAILY",
    nextRunAt: body?.nextRunAt ?? new Date().toISOString(),
    timezone: body?.timezone ?? "UTC",
    swarmDensity: body?.swarmDensity ?? 24,
    requiredSignatures: body?.requiredSignatures ?? 1,
    predictedBurn: body?.predictedBurn ?? 1200,
    enabled: body?.enabled ?? true
  });

  return NextResponse.json(
    {
      ok: true,
      schedule
    },
    { status: 201 }
  );
}
