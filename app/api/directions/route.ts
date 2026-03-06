export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import {
  createDirection,
  listDirections,
  type DirectionSource,
  type DirectionStatus
} from "@/lib/direction/directions";
import { requireOrgAccess } from "@/lib/security/org-access";

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

function parseTags(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("orgId")?.trim();
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

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true }
  });
  if (!org) {
    return NextResponse.json({ ok: false, message: "Organization not found." }, { status: 404 });
  }

  const ownerEmail = request.nextUrl.searchParams.get("ownerEmail")?.trim().toLowerCase();
  const status = parseStatus(request.nextUrl.searchParams.get("status"));
  const directions = await listDirections(orgId, {
    ...(ownerEmail ? { ownerEmail } : {}),
    ...(status ? { status } : {})
  });

  return NextResponse.json({
    ok: true,
    directions
  });
}

export async function POST(request: NextRequest) {
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

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true }
  });
  if (!org) {
    return NextResponse.json({ ok: false, message: "Organization not found." }, { status: 404 });
  }

  const created = await createDirection(orgId, {
    title,
    summary: asTrimmed(body?.summary),
    direction,
    ...(parseStatus(body?.status) ? { status: parseStatus(body?.status) } : {}),
    ...(parseSource(body?.source) ? { source: parseSource(body?.source) } : {}),
    ...(body?.ownerUserId !== undefined ? { ownerUserId: body.ownerUserId } : { ownerUserId: access.actor.userId }),
    ...(body?.ownerEmail !== undefined ? { ownerEmail: body.ownerEmail } : { ownerEmail: access.actor.email }),
    ...(body?.ownerName !== undefined ? { ownerName: body.ownerName } : {}),
    ...(Array.isArray(body?.tags) ? { tags: parseTags(body?.tags) } : {}),
    ...(typeof body?.impactScore === "number" ? { impactScore: body.impactScore } : {})
  });

  return NextResponse.json(
    {
      ok: true,
      direction: created
    },
    { status: 201 }
  );
}
