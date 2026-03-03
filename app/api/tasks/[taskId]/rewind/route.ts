import { FlowStatus, LogType, TaskStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { publishInngestEvent } from "@/lib/inngest/publish";
import { publishRealtimeEvent } from "@/lib/realtime/publish";
import { buildComplianceHash } from "@/lib/security/audit";
import { buildInternalApiHeaders } from "@/lib/security/internal-api";
import { requireOrgAccess } from "@/lib/security/org-access";

interface RewindRequest {
  orgId?: string;
  overridePrompt?: string;
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

  let body: RewindRequest;
  try {
    body = (await request.json()) as RewindRequest;
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
  const overridePrompt = body.overridePrompt?.trim();
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

  const sourceTask = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      flow: true
    }
  });

  if (!sourceTask) {
    return NextResponse.json(
      {
        ok: false,
        message: "Task not found."
      },
      { status: 404 }
    );
  }

  if (sourceTask.flow.orgId !== orgId) {
    return NextResponse.json(
      {
        ok: false,
        message: "Task does not belong to this organization."
      },
      { status: 403 }
    );
  }

  if (
    sourceTask.status !== TaskStatus.COMPLETED &&
    sourceTask.status !== TaskStatus.FAILED &&
    sourceTask.status !== TaskStatus.ABORTED
  ) {
    return NextResponse.json(
      {
        ok: false,
        message: "Rewind requires a completed/failed/aborted task anchor."
      },
      { status: 409 }
    );
  }

  const forkPrompt =
    overridePrompt ??
    `Rewind from task ${sourceTask.id}: Correct path and continue mission with refined constraints.`;

  const actionType = "TEMPORAL_BRANCH_FORK";
  const complianceHash = buildComplianceHash({
    actionType,
    orgId,
    sourceFlowId: sourceTask.flowId,
    sourceTaskId: sourceTask.id,
    forkPrompt,
    actor: humanActorId
  });

  const branch = await prisma.$transaction(async (tx) => {
    const flow = await tx.flow.create({
      data: {
        orgId,
        prompt: forkPrompt,
        status: FlowStatus.QUEUED,
        progress: 0,
        predictedBurn: sourceTask.flow.predictedBurn,
        requiredSignatures: sourceTask.flow.requiredSignatures,
        parentFlowId: sourceTask.flowId
      }
    });

    await tx.task.create({
      data: {
        flowId: flow.id,
        agentId: sourceTask.agentId,
        prompt: forkPrompt,
        status: TaskStatus.QUEUED,
        requiredFiles: sourceTask.requiredFiles,
        isPausedForInput: false,
        executionTrace: {
          rewindFromFlowId: sourceTask.flowId,
          rewindFromTaskId: sourceTask.id,
          sourceStatus: sourceTask.status
        }
      }
    });

    await tx.log.create({
      data: {
        orgId,
        type: LogType.EXE,
        actor: humanActorId ?? "TEMPORAL_BRANCH",
        message: `Flow ${flow.id} forked from task ${sourceTask.id}.`
      }
    });

    await tx.complianceAudit.create({
      data: {
        orgId,
        flowId: flow.id,
        humanActorId,
        actionType,
        complianceHash
      }
    });

    return flow;
  });

  const publish = await publishInngestEvent("vorldx/flow.rewindForked", {
    orgId,
    sourceFlowId: sourceTask.flowId,
    sourceTaskId: sourceTask.id,
    branchFlowId: branch.id,
    prompt: forkPrompt
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
          name: "vorldx/flow.rewindForked",
          data: {
            orgId,
            sourceFlowId: sourceTask.flowId,
            sourceTaskId: sourceTask.id,
            branchFlowId: branch.id,
            prompt: forkPrompt
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
    event: "flow.rewound",
    payload: {
      sourceFlowId: sourceTask.flowId,
      sourceTaskId: sourceTask.id,
      branchFlowId: branch.id
    }
  });

  return NextResponse.json(
    {
      ok: true,
      branch: {
        id: branch.id,
        parentFlowId: branch.parentFlowId,
        status: branch.status
      },
      warning: [publish.ok ? undefined : publish.message, localKickWarning]
        .filter(Boolean)
        .join(" | ") || undefined
    },
    { status: 201 }
  );
}
