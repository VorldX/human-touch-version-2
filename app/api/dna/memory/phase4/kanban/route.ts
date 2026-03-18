export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { getKanbanRealtimeSnapshot } from "@/lib/dna/phase4";
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

  const boardId = request.nextUrl.searchParams.get("boardId")?.trim() ?? "";
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"), 40, 150);

  const snapshot = await getKanbanRealtimeSnapshot({
    tenantId: orgId,
    userId: access.actor.userId,
    boardId,
    limit
  });

  return NextResponse.json({
    ok: true,
    orgId,
    actor: {
      userId: access.actor.userId,
      role: access.actor.role,
      isAdmin: access.actor.isAdmin
    },
    ...snapshot
  });
}
