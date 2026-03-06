export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import {
  deleteDirection,
  getDirection,
  updateDirection,
  type DirectionSource,
  type DirectionStatus
} from "@/lib/direction/directions";
import { requireOrgAccess } from "@/lib/security/org-access";

interface RouteContext {
  params: Promise<{
    directionId: string;
  }>;
}

function asTrimmed(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseStatus(value: unknown): DirectionStatus | undefined {
  if (value === "DRAFT" || value === "ACTIVE" || value === "ARCHIVED") {
    return value;
  }
  return undefined;
}

function parseSource(value: unknown): DirectionSource | undefined {
  if (value === "MANUAL" || value === "CHAT" || value === "SYSTEM") {
    return value;
  }
  return undefined;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { directionId } = await context.params;
  const orgId = request.nextUrl.searchParams.get("orgId")?.trim();

  if (!orgId || !directionId?.trim()) {
    return NextResponse.json(
      { ok: false, message: "orgId and directionId are required." },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  const direction = await getDirection(orgId, directionId);
  if (!direction) {
    return NextResponse.json({ ok: false, message: "Direction not found." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    direction
  });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { directionId } = await context.params;
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        title?: string;
        summary?: string;
        direction?: string;
        status?: DirectionStatus;
        source?: DirectionSource;
        ownerUserId?: string | null;
        ownerEmail?: string | null;
        ownerName?: string | null;
        tags?: string[];
        impactScore?: number;
        lastExecutedAt?: string;
      }
    | null;

  const orgId = asTrimmed(body?.orgId);
  if (!orgId || !directionId?.trim()) {
    return NextResponse.json(
      { ok: false, message: "orgId and directionId are required." },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true }
  });
  if (!org) {
    return NextResponse.json({ ok: false, message: "Organization not found." }, { status: 404 });
  }

  const updated = await updateDirection(orgId, directionId, {
    ...(body?.title !== undefined ? { title: body.title } : {}),
    ...(body?.summary !== undefined ? { summary: body.summary } : {}),
    ...(body?.direction !== undefined ? { direction: body.direction } : {}),
    ...(parseStatus(body?.status) ? { status: parseStatus(body?.status) } : {}),
    ...(parseSource(body?.source) ? { source: parseSource(body?.source) } : {}),
    ...(body?.ownerUserId !== undefined ? { ownerUserId: body.ownerUserId } : {}),
    ...(body?.ownerEmail !== undefined ? { ownerEmail: body.ownerEmail } : {}),
    ...(body?.ownerName !== undefined ? { ownerName: body.ownerName } : {}),
    ...(Array.isArray(body?.tags) ? { tags: body.tags } : {}),
    ...(typeof body?.impactScore === "number" ? { impactScore: body.impactScore } : {}),
    ...(typeof body?.lastExecutedAt === "string" ? { lastExecutedAt: body.lastExecutedAt } : {})
  });

  if (!updated) {
    return NextResponse.json({ ok: false, message: "Direction not found." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    direction: updated
  });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { directionId } = await context.params;
  const orgId =
    request.nextUrl.searchParams.get("orgId")?.trim() ||
    ((await request.json().catch(() => null)) as { orgId?: string } | null)?.orgId?.trim() ||
    "";

  if (!orgId || !directionId?.trim()) {
    return NextResponse.json(
      { ok: false, message: "orgId and directionId are required." },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  const deleted = await deleteDirection(orgId, directionId);
  if (!deleted) {
    return NextResponse.json({ ok: false, message: "Direction not found." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true
  });
}
