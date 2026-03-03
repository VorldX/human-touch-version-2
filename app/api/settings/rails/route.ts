import { LogType, Prisma, SovereignRailType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";

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

  const rails = await prisma.sovereignRailConfig.findMany({
    where: { orgId },
    orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }]
  });

  return NextResponse.json({
    ok: true,
    rails
  });
}

export async function POST(request: NextRequest) {
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
  const name = body?.name?.trim() ?? "";
  const railType = parseRailType(body?.railType ?? "ONDC");
  const baseUrl = body?.baseUrl?.trim() ?? "";
  const region = body?.region?.trim() ?? null;
  const isActive = body?.isActive ?? true;
  const config =
    body?.config && typeof body.config === "object" && !Array.isArray(body.config)
      ? (body.config as Prisma.InputJsonValue)
      : undefined;

  if (!orgId || !name || !railType || !baseUrl) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId, name, railType, and baseUrl are required."
      },
      { status: 400 }
    );
  }

  if (!isValidHttpUrl(baseUrl)) {
    return NextResponse.json(
      {
        ok: false,
        message: "baseUrl must be a valid http(s) URL."
      },
      { status: 400 }
    );
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true }
  });
  if (!org) {
    return NextResponse.json(
      {
        ok: false,
        message: "Organization not found."
      },
      { status: 404 }
    );
  }

  const rail = await prisma.$transaction(async (tx) => {
    if (isActive) {
      await tx.sovereignRailConfig.updateMany({
        where: { orgId, railType, isActive: true },
        data: { isActive: false }
      });
    }

    const created = await tx.sovereignRailConfig.create({
      data: {
        orgId,
        name,
        railType,
        baseUrl,
        region,
        isActive: Boolean(isActive),
        ...(config ? { config } : {})
      }
    });

    await tx.log.create({
      data: {
        orgId,
        type: LogType.USER,
        actor: "SETTINGS",
        message: `Sovereign rail ${created.name} (${created.railType}) configured.`
      }
    });

    return created;
  });

  return NextResponse.json({ ok: true, rail }, { status: 201 });
}
