export const dynamic = "force-dynamic";

import { LogType, Prisma, SovereignRailType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { requireOrgAccess } from "@/lib/security/org-access";

function parseRailType(value: string | undefined): SovereignRailType | null {
  if (!value) return null;
  if (value === "ONDC") return SovereignRailType.ONDC;
  if (value === "CUSTOM") return SovereignRailType.CUSTOM;
  return null;
}

function isValidHttpUrl(input: string) {
  try {
    const url = new URL(input);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function resolveOrgId(request: NextRequest) {
  const fromQuery = request.nextUrl.searchParams.get("orgId")?.trim();
  if (fromQuery) {
    return fromQuery;
  }
  const body = (await request.json().catch(() => null)) as { orgId?: string } | null;
  return body?.orgId?.trim() ?? "";
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ railId: string }> }
) {
  const { railId } = await context.params;
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        name?: string;
        railType?: string;
        baseUrl?: string;
        region?: string;
        isActive?: boolean;
        config?: Record<string, unknown>;
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
  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  const current = await prisma.sovereignRailConfig.findUnique({
    where: { id: railId }
  });
  if (!current || current.orgId !== orgId) {
    return NextResponse.json(
      {
        ok: false,
        message: "Rail config not found for this organization."
      },
      { status: 404 }
    );
  }

  const railType = body?.railType ? parseRailType(body.railType) : undefined;
  if (body?.railType && !railType) {
    return NextResponse.json(
      {
        ok: false,
        message: "Invalid railType."
      },
      { status: 400 }
    );
  }

  const baseUrl = body?.baseUrl?.trim();
  if (baseUrl && !isValidHttpUrl(baseUrl)) {
    return NextResponse.json(
      {
        ok: false,
        message: "baseUrl must be a valid http(s) URL."
      },
      { status: 400 }
    );
  }

  const config =
    body?.config && typeof body.config === "object" && !Array.isArray(body.config)
      ? (body.config as Prisma.InputJsonValue)
      : undefined;

  const updated = await prisma.$transaction(async (tx) => {
    const targetRailType = railType ?? current.railType;
    if (body?.isActive === true) {
      await tx.sovereignRailConfig.updateMany({
        where: {
          orgId,
          railType: targetRailType,
          isActive: true
        },
        data: {
          isActive: false
        }
      });
    }

    const rail = await tx.sovereignRailConfig.update({
      where: { id: railId },
      data: {
        ...(body?.name ? { name: body.name.trim() } : {}),
        ...(railType ? { railType } : {}),
        ...(baseUrl ? { baseUrl } : {}),
        ...(body?.region !== undefined ? { region: body.region?.trim() || null } : {}),
        ...(typeof body?.isActive === "boolean" ? { isActive: body.isActive } : {}),
        ...(config ? { config } : {})
      }
    });

    await tx.log.create({
      data: {
        orgId,
        type: LogType.USER,
        actor: "SETTINGS",
        message: `Sovereign rail ${rail.id} updated.`
      }
    });

    return rail;
  });

  return NextResponse.json({ ok: true, rail: updated });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ railId: string }> }
) {
  const { railId } = await context.params;
  const orgId = await resolveOrgId(request);
  if (!orgId) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId is required."
      },
      { status: 400 }
    );
  }
  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  const current = await prisma.sovereignRailConfig.findUnique({
    where: { id: railId }
  });
  if (!current || current.orgId !== orgId) {
    return NextResponse.json(
      {
        ok: false,
        message: "Rail config not found for this organization."
      },
      { status: 404 }
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.sovereignRailConfig.delete({
      where: { id: railId }
    });

    await tx.log.create({
      data: {
        orgId,
        type: LogType.USER,
        actor: "SETTINGS",
        message: `Sovereign rail ${railId} removed.`
      }
    });
  });

  return NextResponse.json({ ok: true });
}
