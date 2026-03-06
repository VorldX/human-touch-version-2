export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { requireOrgAccess } from "@/lib/security/org-access";

interface RouteContext {
  params: {
    flowId: string;
  };
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
