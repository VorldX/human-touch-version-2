export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import {
  createDirectionLink,
  deleteDirectionLink,
  listDirectionLinks,
  type DirectionRelation
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

function parseRelation(value: unknown): DirectionRelation | undefined {
  if (
    value === "SUPPORTS" ||
    value === "BLOCKS" ||
    value === "DEPENDS_ON" ||
    value === "RELATES_TO"
  ) {
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

  const links = await listDirectionLinks(orgId, directionId);
  return NextResponse.json({
    ok: true,
    links,
    outgoing: links.filter((item) => item.fromDirectionId === directionId),
    incoming: links.filter((item) => item.toDirectionId === directionId)
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { directionId } = await context.params;
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        toDirectionId?: string;
        relation?: DirectionRelation;
        note?: string | null;
      }
    | null;

  const orgId = asTrimmed(body?.orgId);
  const toDirectionId = asTrimmed(body?.toDirectionId);
  if (!orgId || !directionId?.trim() || !toDirectionId) {
    return NextResponse.json(
      { ok: false, message: "orgId, directionId, and toDirectionId are required." },
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

  const created = await createDirectionLink(orgId, {
    fromDirectionId: directionId,
    toDirectionId,
    ...(parseRelation(body?.relation) ? { relation: parseRelation(body?.relation) } : {}),
    ...(body?.note !== undefined ? { note: body.note } : {})
  });

  return NextResponse.json(
    {
      ok: true,
      link: created
    },
    { status: 201 }
  );
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { directionId } = await context.params;
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        toDirectionId?: string;
      }
    | null;

  const orgId =
    asTrimmed(body?.orgId) || request.nextUrl.searchParams.get("orgId")?.trim() || "";
  const toDirectionId =
    asTrimmed(body?.toDirectionId) || request.nextUrl.searchParams.get("toDirectionId")?.trim() || "";

  if (!orgId || !directionId?.trim() || !toDirectionId) {
    return NextResponse.json(
      { ok: false, message: "orgId, directionId, and toDirectionId are required." },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  const deleted = await deleteDirectionLink(orgId, directionId, toDirectionId);
  if (!deleted) {
    return NextResponse.json({ ok: false, message: "Link not found." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true
  });
}
