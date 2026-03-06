import { NextRequest, NextResponse } from "next/server";

import { createPlan, listPlans, type PlanSource, type PlanStatus } from "@/lib/plans/plans";
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

export async function GET(request: NextRequest) {
  try {
    const orgId = request.nextUrl.searchParams.get("orgId")?.trim() ?? "";
    if (!orgId) {
      return NextResponse.json(
        { ok: false, message: "orgId query param is required." },
        { status: 400 }
      );
    }

    const access = await requireOrgAccess({ request, orgId });
    if (!access.ok) {
      return access.response;
    }

    const plans = await listPlans(orgId);
    return NextResponse.json({
      ok: true,
      plans
    });
  } catch (error) {
    console.error("[api/plans][GET] unexpected error", error);
    return NextResponse.json(
      {
        ok: false,
        message: "Failed to load plans."
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
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
    const title = asTrimmed(body?.title);
    const direction = asTrimmed(body?.direction);

    if (!orgId || !title || !direction) {
      return NextResponse.json(
        { ok: false, message: "orgId, title, and direction are required." },
        { status: 400 }
      );
    }

    const access = await requireOrgAccess({ request, orgId });
    if (!access.ok) {
      return access.response;
    }

    const created = await createPlan(orgId, {
      title,
      summary: asTrimmed(body?.summary),
      direction,
      directionId: body?.directionId ?? null,
      humanPlan: body?.humanPlan ?? "",
      primaryPlan: asObject(body?.primaryPlan),
      fallbackPlan: asObject(body?.fallbackPlan),
      ...(parseStatus(body?.status) ? { status: parseStatus(body?.status) } : {}),
      ...(parseSource(body?.source) ? { source: parseSource(body?.source) } : {}),
      ownerEmail: body?.ownerEmail ?? access.actor.email
    });

    return NextResponse.json(
      {
        ok: true,
        plan: created
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[api/plans][POST] unexpected error", error);
    return NextResponse.json(
      {
        ok: false,
        message: "Failed to create plan."
      },
      { status: 500 }
    );
  }
}
