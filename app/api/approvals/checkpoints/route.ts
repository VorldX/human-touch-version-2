export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { requireOrgAccess } from "@/lib/security/org-access";

function parseLimit(value: string | null) {
  if (!value) return 100;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 100;
  }
  return Math.min(parsed, 500);
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

  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  const status = request.nextUrl.searchParams.get("status")?.trim();
  const flowId = request.nextUrl.searchParams.get("flowId")?.trim();
  const taskId = request.nextUrl.searchParams.get("taskId")?.trim();
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));

  const checkpoints = await prisma.approvalCheckpoint.findMany({
    where: {
      orgId,
      ...(status ? { status } : {}),
      ...(flowId ? { flowId } : {}),
      ...(taskId ? { taskId } : {})
    },
    orderBy: [{ requestedAt: "desc" }, { createdAt: "desc" }],
    take: limit
  });

  return NextResponse.json({
    ok: true,
    checkpoints
  });
}

