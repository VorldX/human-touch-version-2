import { LogType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { requireOrgAccess } from "@/lib/security/org-access";
import {
  canReviewPermissionRequests,
  listOrgPermissionRequests,
  type PermissionRequestStatus
} from "@/lib/requests/permission-requests";

function normalizeStatus(value: unknown): PermissionRequestStatus | undefined {
  if (value === "PENDING") return "PENDING";
  if (value === "APPROVED") return "APPROVED";
  if (value === "REJECTED") return "REJECTED";
  if (value === "CANCELLED") return "CANCELLED";
  return undefined;
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

  const membership = await prisma.orgMember.findUnique({
    where: {
      userId_orgId: {
        userId: access.actor.userId,
        orgId
      }
    },
    select: {
      role: true
    }
  });

  const statusParam = normalizeStatus(
    request.nextUrl.searchParams.get("status")?.trim().toUpperCase()
  );
  const requests = await listOrgPermissionRequests(orgId, statusParam);
  const pendingCount = requests.filter((item) => item.status === "PENDING").length;

  return NextResponse.json({
    ok: true,
    requests,
    pendingCount,
    canReview: canReviewPermissionRequests(membership?.role)
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        message?: string;
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

  await prisma.log.create({
    data: {
      orgId,
      type: LogType.USER,
      actor: "REQUESTS",
      message:
        body?.message?.trim() || "Requests API reached without supported POST payload."
    }
  });

  return NextResponse.json(
    {
      ok: false,
      message: "Use direction planning flow to create permission requests."
    },
    { status: 400 }
  );
}
