export const dynamic = "force-dynamic";

import { FlowStatus, LogType, TaskStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { publishInngestEvent } from "@/lib/inngest/publish";
import { publishRealtimeEvent } from "@/lib/realtime/publish";
import { buildComplianceHash } from "@/lib/security/audit";
import { requireOrgAccess } from "@/lib/security/org-access";

interface KillSwitchRequest {
  orgId?: string;
  humanActorId?: string;
}

export async function POST(request: NextRequest) {
  let body: KillSwitchRequest;
  try {
    body = (await request.json()) as KillSwitchRequest;
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message: "Invalid JSON payload."
      },
      { status: 400 }
    );
  }

  const orgId = body.orgId?.trim();
  const requestedHumanActorId = body.humanActorId?.trim() || "";
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

  if (requestedHumanActorId && requestedHumanActorId !== access.actor.userId) {
    return NextResponse.json(
      {
        ok: false,
        message: "humanActorId must match the authenticated user."
      },
      { status: 403 }
    );
  }

  const humanActorId = access.actor.userId;

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true }
  });

  if (!org) {
    return NextResponse.json(
      {
        ok: false,
        message: "Organization not found."
      },
      { status: 404 }
    );
  }

  const targetFlows = await prisma.flow.findMany({
    where: {
      orgId,
      status: {
        in: [FlowStatus.QUEUED, FlowStatus.ACTIVE, FlowStatus.PAUSED]
      }
    },
    select: { id: true }
  });

  const flowIds = targetFlows.map((flow) => flow.id);
  const complianceHash = buildComplianceHash({
    actionType: "KILL_SWITCH_EXECUTED",
    orgId,
    flowIds,
    actor: humanActorId
  });

  const result = await prisma.$transaction(async (tx) => {
    const abortedFlows = await tx.flow.updateMany({
      where: {
        id: {
          in: flowIds
        }
      },
      data: {
        status: FlowStatus.ABORTED
      }
    });

    const abortedTasks =
      flowIds.length > 0
        ? await tx.task.updateMany({
            where: {
              flowId: {
                in: flowIds
              },
              status: {
                in: [TaskStatus.QUEUED, TaskStatus.RUNNING, TaskStatus.PAUSED]
              }
            },
            data: {
              status: TaskStatus.ABORTED,
              isPausedForInput: false,
              humanInterventionReason: null
            }
          })
        : { count: 0 };

    const activeLocks =
      flowIds.length > 0
        ? await tx.hubFileLock.findMany({
            where: {
              orgId,
              releasedAt: null,
              task: {
                is: {
                  flowId: {
                    in: flowIds
                  }
                }
              }
            },
            select: {
              id: true
            }
          })
        : [];

    const locksReleased =
      activeLocks.length > 0
        ? await tx.hubFileLock.updateMany({
            where: {
              id: {
                in: activeLocks.map((lock) => lock.id)
              },
              releasedAt: null
            },
            data: {
              releasedAt: new Date()
            }
          })
        : { count: 0 };

    await tx.log.create({
      data: {
        orgId,
        type: LogType.SYS,
        actor: "GLOBAL_KILL_SWITCH",
        message: `Kill switch executed. Aborted ${abortedFlows.count} flows and ${abortedTasks.count} tasks. Released ${locksReleased.count} file locks.`
      }
    });

    await tx.complianceAudit.create({
      data: {
        orgId,
        humanActorId,
        actionType: "KILL_SWITCH_EXECUTED",
        complianceHash
      }
    });

    return {
      flowsAborted: abortedFlows.count,
      tasksAborted: abortedTasks.count,
      locksReleased: locksReleased.count
    };
  });

  const publish = await publishInngestEvent("vorldx/kill-switch.activated", {
    orgId,
    organizationName: org.name,
    flowsAborted: result.flowsAborted,
    tasksAborted: result.tasksAborted
  });

  await publishRealtimeEvent({
    orgId,
    event: "kill-switch.triggered",
    payload: {
      flowsAborted: result.flowsAborted,
      tasksAborted: result.tasksAborted,
      organizationName: org.name
    }
  });

  return NextResponse.json({
    ok: true,
    message: `Kill switch executed for ${org.name}.`,
    result,
    warning: publish.ok ? undefined : publish.message
  });
}
