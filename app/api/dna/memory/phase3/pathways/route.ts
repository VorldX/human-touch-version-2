export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import {
  dnaPhase3Config,
  listPathwayRegistry,
  upsertPathwayRegistry
} from "@/lib/dna/phase3";
import { requireOrgAccess } from "@/lib/security/org-access";

function parseLimit(value: string | null, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("orgId")?.trim() ?? "";
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

  const includeDeprecated =
    request.nextUrl.searchParams.get("includeDeprecated")?.trim() === "1";
  const limit = parseLimit(
    request.nextUrl.searchParams.get("limit"),
    50,
    Math.max(100, dnaPhase3Config.pathwayRegistry.defaultStepLimit)
  );

  const pathways = await listPathwayRegistry({
    tenantId: orgId,
    userId: access.actor.userId,
    includeDeprecated,
    limit
  });

  return NextResponse.json({
    ok: true,
    orgId,
    userId: access.actor.userId,
    pathways
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        pathwayName?: string;
        pathway?: unknown;
        overridesPathwayId?: string;
      }
    | null;

  const orgId = body?.orgId?.trim() ?? "";
  if (!orgId || !body?.pathway) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId and pathway are required."
      },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId, allowInternal: true });
  if (!access.ok) {
    return access.response;
  }

  const pathway = await upsertPathwayRegistry({
    tenantId: orgId,
    userId: access.actor.userId,
    pathwayName: body.pathwayName,
    pathway: body.pathway,
    overridesPathwayId: body.overridesPathwayId,
    actor: access.actor.userId
  });

  return NextResponse.json({
    ok: true,
    orgId,
    userId: access.actor.userId,
    pathway
  });
}
