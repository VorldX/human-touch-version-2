import { NextRequest, NextResponse } from "next/server";

import { listDueMissionSchedules } from "@/lib/schedule/mission-schedules";
import { runMissionSchedule } from "@/lib/schedule/mission-runner";

function asBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }
  return false;
}

function asPositiveInt(value: unknown, fallback: number, max: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.min(max, Math.floor(value)));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.max(1, Math.min(max, parsed));
    }
  }
  return fallback;
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        limit?: number;
        dryRun?: boolean;
        force?: boolean;
      }
    | null;

  const orgId =
    body?.orgId?.trim() || request.nextUrl.searchParams.get("orgId")?.trim() || "";
  if (!orgId) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId is required."
      },
      { status: 400 }
    );
  }

  const dryRun = asBoolean(body?.dryRun ?? request.nextUrl.searchParams.get("dryRun"));
  const force = asBoolean(body?.force ?? request.nextUrl.searchParams.get("force"));
  const limit = asPositiveInt(
    body?.limit ?? request.nextUrl.searchParams.get("limit"),
    10,
    100
  );
  const now = new Date();
  const dueSchedules = await listDueMissionSchedules(orgId, now);
  const queue = dueSchedules
    .sort((a, b) => new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime())
    .slice(0, limit);

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      orgId,
      now: now.toISOString(),
      dueCount: dueSchedules.length,
      queuedCount: queue.length,
      schedules: queue
    });
  }

  const launched: Array<{
    scheduleId: string;
    flowId: string;
    flowStatus: string;
    warning?: string;
  }> = [];
  const failed: Array<{
    scheduleId: string;
    message: string;
  }> = [];

  for (const schedule of queue) {
    // Keep launch order deterministic across due schedules.
    // eslint-disable-next-line no-await-in-loop
    const run = await runMissionSchedule({
      origin: request.nextUrl.origin,
      orgId,
      scheduleId: schedule.id,
      force
    });

    if (!run.ok) {
      failed.push({
        scheduleId: schedule.id,
        message: run.message
      });
      continue;
    }

    launched.push({
      scheduleId: schedule.id,
      flowId: run.flow.id,
      flowStatus: run.flow.status,
      ...(run.warning ? { warning: run.warning } : {})
    });
  }

  return NextResponse.json({
    ok: true,
    orgId,
    now: now.toISOString(),
    dueCount: dueSchedules.length,
    queuedCount: queue.length,
    launchedCount: launched.length,
    failedCount: failed.length,
    launched,
    failed
  });
}
