import { NextRequest, NextResponse } from "next/server";

import {
  getPlan,
  updatePlan,
  type PlanSource,
  type PlanStatus
} from "@/lib/plans/plans";
import { requireOrgAccess } from "@/lib/security/org-access";

function asTrimmed(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseStatus(value: unknown): PlanStatus | undefined {
  if (value === "DRAFT" || value === "ACTIVE" || value === "ARCHIVED") {
    return value;
  }
  return undefined;
}

function parseSource(value: unknown): PlanSource | undefined {
  if (value === "MANUAL" || value === "CHAT" || value === "SYSTEM") {
    return value;
  }
  return undefined;
}

function asObject(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ planId: string }> }
) {
  const params = await context.params;
  const planId = params.planId?.trim() ?? "";
  const orgId = request.nextUrl.searchParams.get("orgId")?.trim() ?? "";

  if (!planId || !orgId) {
    return NextResponse.json(
      { ok: false, message: "orgId and planId are required." },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  const plan = await getPlan(orgId, planId);
  if (!plan) {
    return NextResponse.json({ ok: false, message: "Plan not found." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    plan
  });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ planId: string }> }
) {
  const params = await context.params;
  const planId = params.planId?.trim() ?? "";

  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        title?: string;
        summary?: string;
        direction?: string;
        directionId?: string | null;
        humanPlan?: string;
        primaryPlan?: Record<string, unknown>;
        fallbackPlan?: Record<string, unknown>;
        status?: PlanStatus;
        source?: PlanSource;
        ownerEmail?: string | null;
      }
    | null;

  const orgId = asTrimmed(body?.orgId);
  if (!planId || !orgId) {
    return NextResponse.json(
      { ok: false, message: "orgId and planId are required." },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  const updated = await updatePlan(orgId, planId, {
    ...(body?.title !== undefined ? { title: asTrimmed(body.title) } : {}),
    ...(body?.summary !== undefined ? { summary: asTrimmed(body.summary) } : {}),
    ...(body?.direction !== undefined ? { direction: asTrimmed(body.direction) } : {}),
    ...(body?.directionId !== undefined ? { directionId: body.directionId } : {}),
    ...(body?.humanPlan !== undefined ? { humanPlan: body.humanPlan } : {}),
    ...(body?.primaryPlan !== undefined ? { primaryPlan: asObject(body.primaryPlan) } : {}),
    ...(body?.fallbackPlan !== undefined ? { fallbackPlan: asObject(body.fallbackPlan) } : {}),
    ...(parseStatus(body?.status) ? { status: parseStatus(body?.status) } : {}),
    ...(parseSource(body?.source) ? { source: parseSource(body?.source) } : {}),
    ...(body?.ownerEmail !== undefined ? { ownerEmail: body.ownerEmail } : {})
  });

  if (!updated) {
    return NextResponse.json({ ok: false, message: "Plan not found." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    plan: updated
  });
}
