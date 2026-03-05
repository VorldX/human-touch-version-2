import { LogType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import {
  canReviewPermissionRequests,
  decidePermissionRequest
} from "@/lib/requests/permission-requests";
import { requireOrgAccess } from "@/lib/security/org-access";

function normalizeDecision(value: unknown): "APPROVE" | "REJECT" | null {
  if (value === "APPROVE") return "APPROVE";
  if (value === "REJECT") return "REJECT";
  return null;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ requestId: string }> }
) {
  const params = await context.params;
  const requestId = params.requestId?.trim() ?? "";
  if (!requestId) {
    return NextResponse.json(
      {
        ok: false,
        message: "requestId is required."
      },
      { status: 400 }
    );
  }

  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        decision?: "APPROVE" | "REJECT";
        note?: string;
      }
    | null;

  const orgId = body?.orgId?.trim() ?? "";
  const decision = normalizeDecision(body?.decision);
  if (!orgId || !decision) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId and decision are required."
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

  if (!canReviewPermissionRequests(membership?.role)) {
    return NextResponse.json(
      {
        ok: false,
        message: "Only Founder/Admin can approve or reject permission requests."
      },
      { status: 403 }
    );
  }

  const updated = await decidePermissionRequest({
    orgId,
    requestId,
    decision,
    decidedByUserId: access.actor.userId,
    decidedByEmail: access.actor.email,
    note: body?.note?.trim() || ""
  });

  if (!updated) {
    return NextResponse.json(
      {
        ok: false,
        message: "Request not found."
      },
      { status: 404 }
    );
  }

  await prisma.log.create({
    data: {
      orgId,
      type: LogType.USER,
      actor: "REQUESTS",
      message: `Permission request ${requestId} ${decision === "APPROVE" ? "approved" : "rejected"} by ${access.actor.email}.`
    }
  });

  return NextResponse.json({
    ok: true,
    request: updated
  });
}
