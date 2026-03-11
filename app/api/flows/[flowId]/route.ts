export const dynamic = "force-dynamic";

import { FlowStatus, LogType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { publishInngestEvent } from "@/lib/inngest/publish";
import { publishRealtimeEvent } from "@/lib/realtime/publish";
import { buildInternalApiHeaders } from "@/lib/security/internal-api";
import { requireOrgAccess } from "@/lib/security/org-access";

interface RouteContext {
  params: {
    flowId: string;
  };
}

interface CaptureFlowSignatureRequest {
  orgId?: string;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const flowId = context.params.flowId?.trim();
  if (!flowId) {
    return NextResponse.json(
      {
        ok: false,
        message: "flowId is required."
      },
      { status: 400 }
    );
  }

  const flow = await prisma.flow.findUnique({
    where: { id: flowId },
    include: {
      approvals: {
        select: {
          id: true,
          timestamp: true,
          user: {
            select: {
              id: true,
              username: true,
              email: true
            }
          }
        },
        orderBy: { timestamp: "asc" }
      },
      tasks: {
        include: {
          agent: {
            select: {
              id: true,
              name: true,
              role: true,
              type: true,
              status: true
            }
          }
        },
        orderBy: { createdAt: "asc" }
      },
      complianceAudits: {
        select: {
          id: true,
          actionType: true,
          timestamp: true,
          complianceHash: true,
          humanActor: {
            select: {
              id: true,
              username: true,
              email: true
            }
          }
        },
        orderBy: { timestamp: "asc" }
      }
    }
  });

  if (!flow) {
    return NextResponse.json(
      {
        ok: false,
        message: "Flow not found."
      },
      { status: 404 }
    );
  }

  const access = await requireOrgAccess({
    request,
    orgId: flow.orgId
  });
  if (!access.ok) {
    return access.response;
  }

  const logs = await prisma.log.findMany({
    where: {
      orgId: flow.orgId,
      message: {
        contains: flow.id
      }
    },
    orderBy: { timestamp: "desc" },
    take: 100
  });

  return NextResponse.json({
    ok: true,
    flow: {
      id: flow.id,
      orgId: flow.orgId,
      prompt: flow.prompt,
      status: flow.status,
      progress: flow.progress,
      predictedBurn: flow.predictedBurn,
      requiredSignatures: flow.requiredSignatures,
      parentFlowId: flow.parentFlowId,
      createdAt: flow.createdAt,
      updatedAt: flow.updatedAt,
      approvals: flow.approvals,
      tasks: flow.tasks,
      complianceAudits: flow.complianceAudits
    },
    logs
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const flowId = context.params.flowId?.trim();
  if (!flowId) {
    return NextResponse.json(
      {
        ok: false,
        message: "flowId is required."
      },
      { status: 400 }
    );
  }

  const body = (await request.json().catch(() => null)) as CaptureFlowSignatureRequest | null;
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

  const flow = await prisma.flow.findUnique({
    where: { id: flowId },
    select: {
      id: true,
      orgId: true,
      prompt: true,
      status: true,
      requiredSignatures: true
    }
  });

  if (!flow || flow.orgId !== orgId) {
    return NextResponse.json(
      {
        ok: false,
        message: "Flow not found for this organization."
      },
      { status: 404 }
    );
  }

  if (
    flow.status === FlowStatus.ABORTED ||
    flow.status === FlowStatus.FAILED ||
    flow.status === FlowStatus.COMPLETED
  ) {
    return NextResponse.json(
      {
        ok: false,
        message: `Flow is ${flow.status.toLowerCase()} and cannot accept new signatures.`
      },
      { status: 409 }
    );
  }

  const transactionResult = await prisma.$transaction(async (tx) => {
    const existingSignature = await tx.flowApproval.findUnique({
      where: {
        flowId_userId: {
          flowId: flow.id,
          userId: access.actor.userId
        }
      },
      select: {
        id: true
      }
    });

    if (!existingSignature) {
      await tx.flowApproval.create({
        data: {
          flowId: flow.id,
          userId: access.actor.userId
        }
      });
    }

    const approvalsProvided = await tx.flowApproval.count({
      where: {
        flowId: flow.id
      }
    });

    const launchTriggered = approvalsProvided >= flow.requiredSignatures && flow.status === FlowStatus.DRAFT;
    if (launchTriggered) {
      await tx.flow.update({
        where: { id: flow.id },
        data: {
          status: FlowStatus.QUEUED
        }
      });
      await tx.log.create({
        data: {
          orgId,
          type: LogType.EXE,
          actor: "SIGNATURE_GATE",
          message: `Flow ${flow.id} reached signature threshold (${approvalsProvided}/${flow.requiredSignatures}) and is now queued.`
        }
      });
    }

    return {
      signatureRecorded: !existingSignature,
      approvalsProvided,
      launchTriggered,
      status: launchTriggered ? FlowStatus.QUEUED : flow.status
    };
  });

  await publishRealtimeEvent({
    orgId,
    event: "signature.captured",
    payload: {
      flowId: flow.id,
      userId: access.actor.userId,
      requiredSignatures: flow.requiredSignatures,
      approvalsProvided: transactionResult.approvalsProvided
    }
  });

  await publishRealtimeEvent({
    orgId,
    event: "signature.updated",
    payload: {
      flowId: flow.id,
      requiredSignatures: flow.requiredSignatures,
      approvalsProvided: transactionResult.approvalsProvided
    }
  });

  let warning: string | undefined;
  if (transactionResult.launchTriggered) {
    const publish = await publishInngestEvent("vorldx/flow.launched", {
      flowId: flow.id,
      orgId,
      prompt: flow.prompt,
      requiredSignatures: flow.requiredSignatures,
      initiatedByUserId: access.actor.userId
    });

    let localKickWarning: string | undefined;
    try {
      const response = await fetch(`${request.nextUrl.origin}/api/inngest`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...buildInternalApiHeaders()
        },
        body: JSON.stringify([
          {
            name: "vorldx/flow.launched",
            data: {
              flowId: flow.id,
              orgId,
              prompt: flow.prompt,
              requiredSignatures: flow.requiredSignatures,
              initiatedByUserId: access.actor.userId
            }
          }
        ]),
        cache: "no-store"
      });

      if (!response.ok) {
        const detail = await response.text();
        localKickWarning = `Local worker kick failed (${response.status}): ${detail.slice(0, 140)}`;
      }
    } catch (error) {
      localKickWarning = error instanceof Error ? error.message : "Local worker kick failed.";
    }

    await publishRealtimeEvent({
      orgId,
      event: "flow.updated",
      payload: {
        flowId: flow.id,
        status: FlowStatus.QUEUED
      }
    });

    warning = [publish.ok ? undefined : publish.message, localKickWarning]
      .filter(Boolean)
      .join(" | ") || undefined;
  }

  return NextResponse.json({
    ok: true,
    flow: {
      id: flow.id,
      status: transactionResult.status,
      requiredSignatures: flow.requiredSignatures,
      approvalsProvided: transactionResult.approvalsProvided,
      launchTriggered: transactionResult.launchTriggered
    },
    signatureRecorded: transactionResult.signatureRecorded,
    warning
  });
}
