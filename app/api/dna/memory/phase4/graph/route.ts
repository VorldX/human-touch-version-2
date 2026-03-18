export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { getKnowledgeGraphSnapshot } from "@/lib/dna/phase4";
import { requireOrgAccess } from "@/lib/security/org-access";

function parseLimit(value: string | null, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
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
  if (!access.ok) return access.response;

  const nodeLimit = parseLimit(request.nextUrl.searchParams.get("nodeLimit"), 180, 1200);
  const edgeLimit = parseLimit(request.nextUrl.searchParams.get("edgeLimit"), 260, 2400);

  const graph = await getKnowledgeGraphSnapshot({
    tenantId: orgId,
    userId: access.actor.userId,
    nodeLimit,
    edgeLimit
  });

  return NextResponse.json({
    ok: true,
    orgId,
    actor: {
      userId: access.actor.userId,
      role: access.actor.role,
      isAdmin: access.actor.isAdmin
    },
    ...graph
  });
}
