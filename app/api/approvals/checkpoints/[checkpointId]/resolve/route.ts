export const dynamic = "force-dynamic";

import { AgentStatus, FlowStatus, TaskStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { publishInngestEvent } from "@/lib/inngest/publish";
import { publishRealtimeEvent } from "@/lib/realtime/publish";
import { buildInternalApiHeaders } from "@/lib/security/internal-api";
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

  const transactionResult = await prisma.$transaction(async (tx) => {
    let resumeTarget: { taskId: string; flowId: string } | null = null;
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

    if (checkpoint.agentRunId) {
      await tx.agentRun.updateMany({
        where: {
          id: checkpoint.agentRunId,
          orgId,
          status: AgentStatus.WAITING_HUMAN
        },
        data: {
          status: decision === "APPROVE" ? AgentStatus.COMPLETED : AgentStatus.FAILED,
          completedAt: new Date()
        }
      });
    }

    if (decision === "APPROVE" && checkpoint.taskId && checkpoint.flowId) {
      const pendingSiblingCount = await tx.approvalCheckpoint.count({
        where: {
          orgId,
          flowId: checkpoint.flowId,
          taskId: checkpoint.taskId,
          status: "PENDING",
          id: {
            not: checkpoint.id
          }
        }
      });

      if (pendingSiblingCount === 0) {
        const resumeClaim = await tx.task.updateMany({
          where: {
            id: checkpoint.taskId,
            flowId: checkpoint.flowId,
            status: {
              in: [TaskStatus.PAUSED, TaskStatus.QUEUED]
            }
          },
          data: {
            status: TaskStatus.QUEUED,
            isPausedForInput: false,
            humanInterventionReason: null
          }
        });

        if (resumeClaim.count > 0) {
          await tx.flow.updateMany({
            where: {
              id: checkpoint.flowId,
              orgId
            },
            data: {
              status: FlowStatus.ACTIVE
            }
          });
          resumeTarget = {
            taskId: checkpoint.taskId,
            flowId: checkpoint.flowId
          };
        }
      }
    }

    return {
      checkpoint: next,
      resumeTarget
    };
  });
  const updated = transactionResult.checkpoint;

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

  const taskToResume = transactionResult.resumeTarget;
  let warning: string | undefined;
  if (taskToResume) {
    const publish = await publishInngestEvent("vorldx/task.resumed", {
      orgId,
      flowId: taskToResume.flowId,
      taskId: taskToResume.taskId,
      note: resolutionNote ?? "Approved via checkpoint resolve."
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
              flowId: taskToResume.flowId,
              taskId: taskToResume.taskId,
              note: resolutionNote ?? "Approved via checkpoint resolve."
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
        taskId: taskToResume.taskId,
        flowId: taskToResume.flowId
      }
    });

    await publishRealtimeEvent({
      orgId,
      event: "flow.updated",
      payload: {
        flowId: taskToResume.flowId,
        status: FlowStatus.ACTIVE
      }
    });

    warning = [publish.ok ? undefined : publish.message, localKickWarning]
      .filter(Boolean)
      .join(" | ") || undefined;
  }

  return NextResponse.json({
    ok: true,
    checkpoint: updated,
    resumedTask: taskToResume,
    warning
  });
}
