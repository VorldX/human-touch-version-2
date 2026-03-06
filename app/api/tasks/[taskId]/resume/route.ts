export const dynamic = "force-dynamic";

import { AgentStatus, FlowStatus, LogType, TaskStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { publishInngestEvent } from "@/lib/inngest/publish";
import { publishRealtimeEvent } from "@/lib/realtime/publish";
import { buildComplianceHash } from "@/lib/security/audit";
import { buildInternalApiHeaders } from "@/lib/security/internal-api";
import { requireOrgAccess } from "@/lib/security/org-access";

interface ResumeTaskRequest {
  orgId?: string;
  fileUrl?: string;
  fileUrls?: string[];
  overridePrompt?: string;
  humanActorId?: string;
  note?: string;
}

interface RouteContext {
  params: {
    taskId: string;
  };
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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

  let body: ResumeTaskRequest;
  try {
    body = (await request.json()) as ResumeTaskRequest;
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

  const trace = asRecord(task.executionTrace);
  const runtimeTrace = asRecord(trace.agentRuntime);
  const runtimeAgentId = asString(runtimeTrace.logicalAgentId);
  const runtimeAgentRunId = asString(runtimeTrace.agentRunId);

  const fileUrl = body.fileUrl?.trim();
  const fileUrlsFromBody = Array.isArray(body.fileUrls)
    ? body.fileUrls
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value) => value.length > 0)
    : [];
  const overridePrompt = body.overridePrompt?.trim();
  const requestedHumanActorId = body.humanActorId?.trim() || "";
  const note = body.note?.trim();

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

  const requiredFiles = [...task.requiredFiles];
  const incomingFiles = [...new Set([...(fileUrl ? [fileUrl] : []), ...fileUrlsFromBody])];
  for (const incoming of incomingFiles) {
    if (!requiredFiles.includes(incoming)) {
      requiredFiles.push(incoming);
    }
  }

  const actionType = "HUMAN_TOUCH_RESUME";
  const complianceHash = buildComplianceHash({
    actionType,
    orgId,
    flowId: task.flowId,
    taskId: task.id,
    fileUrl: fileUrl ?? null,
    fileUrls: incomingFiles,
    overridePrompt: overridePrompt ?? null,
    note: note ?? null,
    actor: humanActorId
  });

  const updatedTask = await prisma.$transaction(async (tx) => {
    const nextTask = await tx.task.update({
      where: { id: task.id },
      data: {
        prompt: overridePrompt ?? task.prompt,
        requiredFiles,
        status: TaskStatus.QUEUED,
        isPausedForInput: false,
        humanInterventionReason: note ?? null
      }
    });

    await tx.flow.update({
      where: { id: task.flowId },
      data: {
        status: FlowStatus.ACTIVE
      }
    });

    await tx.log.create({
      data: {
        orgId,
        type: LogType.USER,
        actor: humanActorId ?? "CARBON_NODE",
        message: `Task ${task.id} resumed via Human Touch${incomingFiles.length > 0 ? ` (files: ${incomingFiles.join(", ")})` : ""}.`
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

    await tx.approvalCheckpoint.updateMany({
      where: {
        orgId,
        flowId: task.flowId,
        taskId: task.id,
        status: "PENDING"
      },
      data: {
        status: "APPROVED",
        resolvedAt: new Date(),
        resolvedByUserId: humanActorId,
        resolutionNote: note || "Resolved via task resume."
      }
    });

    if (runtimeAgentId) {
      await tx.agent.updateMany({
        where: {
          id: runtimeAgentId,
          orgId
        },
        data: {
          status: AgentStatus.ACTIVE
        }
      });
    }

    if (runtimeAgentRunId) {
      await tx.agentRun.updateMany({
        where: {
          id: runtimeAgentRunId,
          orgId,
          status: AgentStatus.WAITING_HUMAN
        },
        data: {
          status: AgentStatus.COMPLETED
        }
      });
    }

    return nextTask;
  });

  const publish = await publishInngestEvent("vorldx/task.resumed", {
    orgId,
    flowId: task.flowId,
    taskId: task.id,
    fileUrl: fileUrl ?? null,
    fileUrls: incomingFiles,
    overridePrompt: overridePrompt ?? null,
    note: note ?? null
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
          name: "vorldx/task.resumed",
          data: {
            orgId,
            flowId: task.flowId,
            taskId: task.id,
            fileUrl: fileUrl ?? null,
            fileUrls: incomingFiles,
            overridePrompt: overridePrompt ?? null,
            note: note ?? null
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
    event: "task.resumed",
      payload: {
        taskId: task.id,
        flowId: task.flowId,
        status: TaskStatus.QUEUED
      }
    });

  await publishRealtimeEvent({
    orgId,
    event: "flow.updated",
    payload: {
      flowId: task.flowId,
      status: FlowStatus.ACTIVE
    }
  });

  return NextResponse.json({
    ok: true,
    task: updatedTask,
    warning: [publish.ok ? undefined : publish.message, localKickWarning]
      .filter(Boolean)
      .join(" | ") || undefined
  });
}
