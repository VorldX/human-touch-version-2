export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { createMissionSchedule, listMissionSchedules } from "@/lib/schedule/mission-schedules";
import { requireOrgAccess } from "@/lib/security/org-access";

function clampRequiredSignatures(value: unknown, fallback = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.min(5, Math.floor(value)));
}

function normalizeApprovalUserIds(value: unknown, limit = 16) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }
  const normalized = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  return [...new Set(normalized)].slice(0, limit);
}

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
  const access = await requireOrgAccess({ request, orgId, allowInternal: true });
  if (!access.ok) {
    return access.response;
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
        approvalUserIds?: string[];
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
  const access = await requireOrgAccess({ request, orgId, allowInternal: true });
  if (!access.ok) {
    return access.response;
  }

  const parsedApprovalUserIds = normalizeApprovalUserIds(body?.approvalUserIds);
  const approvalUserIds =
    parsedApprovalUserIds.length > 0
      ? parsedApprovalUserIds
      : access.actor.isInternal
        ? []
        : [access.actor.userId];
  const requiredSignatures = clampRequiredSignatures(body?.requiredSignatures, 1);

  if (requiredSignatures > approvalUserIds.length) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "requiredSignatures cannot exceed approvalUserIds count for scheduled launches."
      },
      { status: 412 }
    );
  }

  const schedule = await createMissionSchedule(orgId, {
    title: body?.title ?? "Scheduled Mission",
    direction,
    ...(body?.directionId?.trim() ? { directionId: body.directionId.trim() } : {}),
    ...(access.actor.isInternal ? {} : { createdByUserId: access.actor.userId }),
    approvalUserIds,
    cadence: body?.cadence ?? "DAILY",
    nextRunAt: body?.nextRunAt ?? new Date().toISOString(),
    timezone: body?.timezone ?? "UTC",
    swarmDensity: body?.swarmDensity ?? 24,
    requiredSignatures,
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
