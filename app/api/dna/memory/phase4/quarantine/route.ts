export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { listQuarantineItems, reviewQuarantineItem } from "@/lib/dna/phase4";
import { requireOrgAccess } from "@/lib/security/org-access";

function parseLimit(value: string | null, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

function parseOffset(value: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function denyAdminOnly() {
  return NextResponse.json(
    {
      ok: false,
      message: "Admin access is required for quarantine operations."
    },
    { status: 403 }
  );
}

export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("orgId")?.trim() ?? "";
  if (!orgId) {
    return NextResponse.json({ ok: false, message: "orgId query param is required." }, { status: 400 });
  }

  const access = await requireOrgAccess({ request, orgId, allowInternal: true });
  if (!access.ok) return access.response;
  if (!access.actor.isAdmin) return denyAdminOnly();

  const limit = parseLimit(request.nextUrl.searchParams.get("limit"), 40, 200);
  const offset = parseOffset(request.nextUrl.searchParams.get("offset"));

  const data = await listQuarantineItems({
    tenantId: orgId,
    userId: access.actor.userId,
    limit,
    offset
  });

  return NextResponse.json({
    ok: true,
    orgId,
    actor: {
      userId: access.actor.userId,
      role: access.actor.role,
      isAdmin: access.actor.isAdmin
    },
    ...data
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        memoryId?: number;
        expectedVersion?: number;
        action?: "APPROVE" | "REJECT";
        note?: string;
      }
    | null;

  const orgId = body?.orgId?.trim() ?? "";
  if (!orgId) {
    return NextResponse.json({ ok: false, message: "orgId is required." }, { status: 400 });
  }

  const access = await requireOrgAccess({ request, orgId, allowInternal: true });
  if (!access.ok) return access.response;
  if (!access.actor.isAdmin) return denyAdminOnly();

  const action = body?.action === "REJECT" ? "REJECT" : "APPROVE";
  const memoryId = typeof body?.memoryId === "number" ? Math.floor(body.memoryId) : 0;
  const expectedVersion =
    typeof body?.expectedVersion === "number" ? Math.floor(body.expectedVersion) : 0;

  if (!memoryId || !expectedVersion) {
    return NextResponse.json(
      {
        ok: false,
        message: "memoryId and expectedVersion are required."
      },
      { status: 400 }
    );
  }

  const result = await reviewQuarantineItem({
    tenantId: orgId,
    userId: access.actor.userId,
    reviewerUserId: access.actor.userId,
    memoryId,
    expectedVersion,
    action,
    note: body?.note
  });

  if (!result.applied) {
    return NextResponse.json(
      {
        ok: false,
        message: "Unable to apply review due to OCC conflict or missing record.",
        ...result
      },
      { status: 409 }
    );
  }

  return NextResponse.json({
    ok: true,
    orgId,
    result
  });
}
