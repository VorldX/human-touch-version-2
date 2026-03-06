export const dynamic = "force-dynamic";

import { FlowStatus, LogType, TaskStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { publishInngestEvent } from "@/lib/inngest/publish";
import { publishRealtimeEvent } from "@/lib/realtime/publish";
import { buildComplianceHash } from "@/lib/security/audit";
import { requireOrgAccess } from "@/lib/security/org-access";

interface PauseTaskRequest {
  orgId?: string;
  reason?: string;
  humanActorId?: string;
}

interface RouteContext {
  params: {
    taskId: string;
  };
}

export async function POST(request: NextRequest, context: RouteContext) {
  const taskId = context.params.taskId?.trim();
  if (!taskId) {
    return NextResponse.json(
      {
        ok: false,
        message: "taskId is required."
      },
      { status: 400 }
    );
  }

  let body: PauseTaskRequest;
  try {
    body = (await request.json()) as PauseTaskRequest;
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
  const reason = body.reason?.trim();
  const requestedHumanActorId = body.humanActorId?.trim() || "";

  if (!orgId || !reason) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId and reason are required."
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

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      flow: {
        select: {
          id: true,
          orgId: true
        }
      }
    }
  });

  if (!task) {
    return NextResponse.json(
      {
        ok: false,
        message: "Task not found."
      },
      { status: 404 }
    );
  }

  if (task.flow.orgId !== orgId) {
    return NextResponse.json(
      {
        ok: false,
        message: "Task does not belong to this organization."
      },
      { status: 403 }
    );
  }

  const actionType = "HUMAN_TOUCH_PAUSE";
  const complianceHash = buildComplianceHash({
    actionType,
    orgId,
    flowId: task.flowId,
    taskId: task.id,
    reason,
    actor: humanActorId
  });

  const updatedTask = await prisma.$transaction(async (tx) => {
    const releasedLocks = await tx.hubFileLock.updateMany({
      where: {
        orgId,
        taskId: task.id,
        releasedAt: null
      },
      data: {
        releasedAt: new Date()
      }
    });

    const nextTask = await tx.task.update({
      where: { id: task.id },
      data: {
        status: TaskStatus.PAUSED,
        isPausedForInput: true,
        humanInterventionReason: reason
      }
    });

    await tx.flow.update({
      where: { id: task.flowId },
      data: {
        status: FlowStatus.PAUSED
      }
    });

    await tx.log.create({
      data: {
        orgId,
        type: LogType.USER,
        actor: humanActorId ?? "CARBON_NODE",
        message: `Task ${task.id} paused for Human Touch: ${reason}. Released ${releasedLocks.count} file lock(s).`
      }
    });

    await tx.complianceAudit.create({
      data: {
        orgId,
        flowId: task.flowId,
        humanActorId,
        actionType,
        complianceHash
      }
    });

    return nextTask;
  });

  const publish = await publishInngestEvent("vorldx/task.paused", {
    orgId,
    flowId: task.flowId,
    taskId: task.id,
    reason
  });

  await publishRealtimeEvent({
    orgId,
    event: "task.paused",
    payload: {
      taskId: task.id,
      flowId: task.flowId,
      reason
    }
  });

  await publishRealtimeEvent({
    orgId,
    event: "flow.updated",
    payload: {
      flowId: task.flowId,
      status: FlowStatus.PAUSED
    }
  });

  return NextResponse.json({
    ok: true,
    task: updatedTask,
    warning: publish.ok ? undefined : publish.message
  });
}
