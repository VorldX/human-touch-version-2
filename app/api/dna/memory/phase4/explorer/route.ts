export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { listDnaExplorerEntries } from "@/lib/dna/phase4";
import { requireOrgAccess } from "@/lib/security/org-access";

function parseLimit(value: string | null, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

function parseOffset(value: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
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
  if (!access.ok) return access.response;

  const limit = parseLimit(request.nextUrl.searchParams.get("limit"), 120, 500);
  const offset = parseOffset(request.nextUrl.searchParams.get("offset"));
  const tier = request.nextUrl.searchParams.get("tier")?.trim() ?? "";
  const memoryDomain = request.nextUrl.searchParams.get("memoryDomain")?.trim() ?? "";

  const data = await listDnaExplorerEntries({
    tenantId: orgId,
    userId: access.actor.userId,
    limit,
    offset,
    tier,
    memoryDomain
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
