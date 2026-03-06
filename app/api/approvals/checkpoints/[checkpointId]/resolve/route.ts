export const dynamic = "force-dynamic";

import { AgentStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { publishRealtimeEvent } from "@/lib/realtime/publish";
import { requireOrgAccess } from "@/lib/security/org-access";

interface RouteContext {
  params: Promise<{
    checkpointId: string;
  }>;
}

type ResolveDecision = "APPROVE" | "REJECT";

function normalizeDecision(value: unknown): ResolveDecision {
  return value === "REJECT" ? "REJECT" : "APPROVE";
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { checkpointId } = await context.params;
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        decision?: ResolveDecision;
        note?: string;
      }
    | null;

  const orgId = body?.orgId?.trim() ?? "";
  if (!orgId || !checkpointId?.trim()) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId and checkpointId are required."
      },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  const checkpoint = await prisma.approvalCheckpoint.findUnique({
    where: { id: checkpointId }
  });
  if (!checkpoint || checkpoint.orgId !== orgId) {
    return NextResponse.json(
      {
        ok: false,
        message: "Approval checkpoint not found for this organization."
      },
      { status: 404 }
    );
  }

  if (checkpoint.resolvedAt) {
    return NextResponse.json(
      {
        ok: true,
        checkpoint
      },
      { status: 200 }
    );
  }

  const decision = normalizeDecision(body?.decision);
  const status = decision === "APPROVE" ? "APPROVED" : "REJECTED";
  const resolutionNote = body?.note?.trim() || null;

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.approvalCheckpoint.update({
      where: { id: checkpoint.id },
      data: {
        status,
        resolvedAt: new Date(),
        resolvedByUserId: access.actor.userId,
        resolutionNote
      }
    });

    if (checkpoint.agentId) {
      await tx.agent.updateMany({
        where: {
          id: checkpoint.agentId,
          orgId
        },
        data: {
          status: decision === "APPROVE" ? AgentStatus.ACTIVE : AgentStatus.BLOCKED
        }
      });
    }

    return next;
  });

  await publishRealtimeEvent({
    orgId,
    event: "approval.resolved",
    payload: {
      checkpointId: updated.id,
      flowId: updated.flowId,
      taskId: updated.taskId,
      status: updated.status
    }
  });

  return NextResponse.json({
    ok: true,
    checkpoint: updated
  });
}

