export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import {
  deleteMissionSchedule,
  getMissionSchedule,
  updateMissionSchedule
} from "@/lib/schedule/mission-schedules";
import { requireOrgAccess } from "@/lib/security/org-access";

interface RouteContext {
  params: Promise<{
    scheduleId: string;
  }>;
}

function clampRequiredSignatures(value: unknown, fallback: number) {
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

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { scheduleId } = await context.params;
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

  const current = await getMissionSchedule(orgId, scheduleId);
  if (!current) {
    return NextResponse.json(
      {
        ok: false,
        message: "Schedule not found."
      },
      { status: 404 }
    );
  }

  const touchesSignatureConfig =
    body?.requiredSignatures !== undefined || body?.approvalUserIds !== undefined;
  if (touchesSignatureConfig) {
    const nextRequiredSignatures = clampRequiredSignatures(
      body?.requiredSignatures,
      current.requiredSignatures
    );
    const nextApprovalUserIds =
      body?.approvalUserIds !== undefined
        ? normalizeApprovalUserIds(body.approvalUserIds)
        : current.approvalUserIds;

    if (nextRequiredSignatures > nextApprovalUserIds.length) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "requiredSignatures cannot exceed approvalUserIds count for scheduled launches."
        },
        { status: 412 }
      );
    }
  }

  const updated = await updateMissionSchedule(orgId, scheduleId, {
    ...(body?.title !== undefined ? { title: body.title } : {}),
    ...(body?.direction !== undefined ? { direction: body.direction } : {}),
    ...(body?.directionId !== undefined ? { directionId: body.directionId } : {}),
    ...(body?.approvalUserIds !== undefined ? { approvalUserIds: body.approvalUserIds } : {}),
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
