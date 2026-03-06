export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import {
  getDirection,
  listDirectionFlowLinksByDirection
} from "@/lib/direction/directions";
import { requireOrgAccess } from "@/lib/security/org-access";

interface RouteContext {
  params: Promise<{
    directionId: string;
  }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { directionId } = await context.params;
  const orgId = request.nextUrl.searchParams.get("orgId")?.trim();
  if (!orgId || !directionId?.trim()) {
    return NextResponse.json(
      { ok: false, message: "orgId and directionId are required." },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  const direction = await getDirection(orgId, directionId);
  if (!direction) {
    return NextResponse.json({ ok: false, message: "Direction not found." }, { status: 404 });
  }

  const links = await listDirectionFlowLinksByDirection(orgId, directionId);
  const flowIds = [...new Set(links.map((item) => item.flowId))];
  const flows =
    flowIds.length === 0
      ? []
      : await prisma.flow.findMany({
          where: {
            orgId,
            id: { in: flowIds }
          },
          include: {
            tasks: {
              select: {
                id: true,
                status: true,
                isPausedForInput: true
              }
            }
          },
          orderBy: { updatedAt: "desc" }
        });

  return NextResponse.json({
    ok: true,
    direction,
    workflows: flows.map((flow) => ({
      id: flow.id,
      prompt: flow.prompt,
      status: flow.status,
      progress: flow.progress,
      predictedBurn: flow.predictedBurn,
      requiredSignatures: flow.requiredSignatures,
      parentFlowId: flow.parentFlowId,
      taskCount: flow.tasks.length,
      pausedTaskCount: flow.tasks.filter((task) => task.status === "PAUSED" || task.isPausedForInput)
        .length,
      createdAt: flow.createdAt,
      updatedAt: flow.updatedAt
    })),
    links
  });
}
