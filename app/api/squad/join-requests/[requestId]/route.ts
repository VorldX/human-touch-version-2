export const dynamic = "force-dynamic";

import { LogType, OrgRole } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { requireOrgAccess } from "@/lib/security/org-access";
import {
  decideJoinRequest,
  type JoinRequestRole
} from "@/lib/squad/join-requests";

function normalizeDecision(value: unknown) {
  if (value === "APPROVE") return "APPROVE";
  if (value === "REJECT") return "REJECT";
  return null;
}

function normalizeRole(value: unknown): JoinRequestRole {
  return value === "ADMIN" ? "ADMIN" : "EMPLOYEE";
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
        role?: JoinRequestRole;
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

  if (
    !membership ||
    (membership.role !== OrgRole.FOUNDER && membership.role !== OrgRole.ADMIN)
  ) {
    return NextResponse.json(
      {
        ok: false,
        message: "Only Founder/Admin can review join requests."
      },
      { status: 403 }
    );
  }

  const updated = await decideJoinRequest({
    orgId,
    requestId,
    decision,
    role: normalizeRole(body?.role),
    note: body?.note?.trim() || "",
    decidedByUserId: access.actor.userId,
    decidedByEmail: access.actor.email
  });

  if (!updated) {
    return NextResponse.json(
      {
        ok: false,
        message: "Join request not found."
      },
      { status: 404 }
    );
  }

  await prisma.log.create({
    data: {
      orgId,
      type: LogType.USER,
      actor: "SQUAD",
      message: `Join request ${requestId} ${decision === "APPROVE" ? "approved" : "rejected"} by ${access.actor.email}.`
    }
  });

  return NextResponse.json({
    ok: true,
    request: updated
  });
}
