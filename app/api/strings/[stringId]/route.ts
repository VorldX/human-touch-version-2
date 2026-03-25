export const dynamic = "force-dynamic";

import { FlowStatus, LogType, MemoryTier, TaskStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import type { ChatAudience, ChatMessage } from "@/components/chat-ui/types";
import { prisma } from "@/lib/db/prisma";
import { listDirectionFlowLinksByDirection } from "@/lib/direction/directions";
import { publishRealtimeEvent } from "@/lib/realtime/publish";
import { requireOrgAccess } from "@/lib/security/org-access";
import { buildComplianceHash } from "@/lib/security/audit";
import {
  deleteString,
  getString,
  saveString,
  type PersistedStringRecord
} from "@/lib/strings/store";

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isStringCreator(record: PersistedStringRecord, userId: string) {
  const createdByUserId = record.createdByUserId?.trim() ?? "";
  return createdByUserId.length > 0 && createdByUserId === userId;
}

function extractFlowIdFromPlanLink(input: { key: string; value: unknown }) {
  const fromValue =
    input.value && typeof input.value === "object" && !Array.isArray(input.value)
      ? (input.value as { flowId?: unknown }).flowId
      : null;
  if (typeof fromValue === "string" && fromValue.trim().length > 0) {
    return fromValue.trim();
  }

  const prefix = "plan.flow.";
  if (!input.key.startsWith(prefix)) {
    return "";
  }
  const keyParts = input.key.split(".");
  return keyParts.length >= 4 ? keyParts[3]?.trim() ?? "" : "";
}

async function listLinkedFlowIdsForString(orgId: string, record: PersistedStringRecord) {
  const flowIds = new Set<string>();

  if (record.planId) {
    const linkedPlanRows = await prisma.memoryEntry.findMany({
      where: {
        orgId,
        tier: MemoryTier.ORG,
        key: {
          startsWith: `plan.flow.${record.planId}.`
        },
        redactedAt: null
      },
      orderBy: {
        updatedAt: "desc"
      },
      take: 120,
      select: {
        key: true,
        value: true
      }
    });

    for (const row of linkedPlanRows) {
      const flowId = extractFlowIdFromPlanLink(row);
      if (flowId) {
        flowIds.add(flowId);
      }
    }
  }

  if (record.directionId) {
    const directionLinks = await listDirectionFlowLinksByDirection(orgId, record.directionId).catch(
      () => []
    );
    for (const link of directionLinks) {
      if (link.flowId?.trim()) {
        flowIds.add(link.flowId.trim());
      }
    }
  }

  return [...flowIds];
}

async function listActiveLinkedFlowsForString(orgId: string, record: PersistedStringRecord) {
  const linkedFlowIds = await listLinkedFlowIdsForString(orgId, record);
  if (linkedFlowIds.length === 0) {
    return [] as Array<{ id: string; status: FlowStatus }>;
  }

  return prisma.flow.findMany({
    where: {
      orgId,
      id: {
        in: linkedFlowIds
      },
      status: {
        in: [FlowStatus.DRAFT, FlowStatus.QUEUED, FlowStatus.ACTIVE, FlowStatus.PAUSED]
      }
    },
    select: {
      id: true,
      status: true
    }
  });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ stringId: string }> }
) {
  const { stringId } = await context.params;
  const orgId = request.nextUrl.searchParams.get("orgId")?.trim() ?? "";

  if (!orgId || !stringId) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId and stringId are required."
      },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  try {
    const record = await getString(
      orgId,
      {
        userId: access.actor.userId,
        role: access.actor.role ?? null
      },
      stringId
    );
    if (!record) {
      return NextResponse.json(
        {
          ok: false,
          message: "String not found."
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      string: record
    });
  } catch (error) {
    console.error("[api/strings/[stringId]][GET] unexpected error", error);
    return NextResponse.json(
      {
        ok: false,
        message: "Failed to load string."
      },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ stringId: string }> }
) {
  const { stringId } = await context.params;
  const body = (await request.json().catch(() => null)) as
      | {
        orgId?: string;
        title?: string;
        mode?: "discussion" | "direction";
        updatedAt?: string;
        createdAt?: string;
        directionId?: string | null;
        planId?: string | null;
        selectedTeamId?: string | null;
        selectedTeamLabel?: string | null;
        activeAudience?: ChatAudience | null;
        source?: "workspace" | "direction" | "plan";
        workspaceState?: Record<string, unknown> | null;
        messages?: unknown;
      }
    | null;

  const orgId = asText(body?.orgId);
  if (!orgId || !stringId) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId and stringId are required."
      },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  try {
    const record = await saveString(
      orgId,
      {
        userId: access.actor.userId,
        role: access.actor.role ?? null
      },
      {
      id: stringId,
      title: body?.title,
      mode: body?.mode,
      updatedAt: body?.updatedAt,
      createdAt: body?.createdAt,
      directionId: body?.directionId,
      planId: body?.planId,
      selectedTeamId: body?.selectedTeamId,
      selectedTeamLabel: body?.selectedTeamLabel,
      activeAudience: body?.activeAudience ?? undefined,
      source: body?.source,
      workspaceState:
        body?.workspaceState &&
        typeof body.workspaceState === "object" &&
        !Array.isArray(body.workspaceState)
          ? body.workspaceState
          : undefined,
      messages: Array.isArray(body?.messages) ? (body.messages as ChatMessage[]) : undefined
      }
    );

    return NextResponse.json({
      ok: true,
      string: record
    });
  } catch (error) {
    if (error instanceof Error && error.message === "String not found.") {
      return NextResponse.json(
        {
          ok: false,
          message: error.message
        },
        { status: 404 }
      );
    }
    console.error("[api/strings/[stringId]][PATCH] unexpected error", error);
    return NextResponse.json(
      {
        ok: false,
        message: "Failed to update string."
      },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ stringId: string }> }
) {
  const { stringId } = await context.params;
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        action?: "KILL_PROCESS";
      }
    | null;

  const orgId = asText(body?.orgId);
  const action = asText(body?.action);
  if (!orgId || !stringId) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId and stringId are required."
      },
      { status: 400 }
    );
  }

  if (action !== "KILL_PROCESS") {
    return NextResponse.json(
      {
        ok: false,
        message: "Unsupported string action."
      },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  try {
    const record = await getString(
      orgId,
      {
        userId: access.actor.userId,
        role: access.actor.role ?? null
      },
      stringId
    );
    if (!record) {
      return NextResponse.json(
        {
          ok: false,
          message: "String not found."
        },
        { status: 404 }
      );
    }

    if (!isStringCreator(record, access.actor.userId)) {
      return NextResponse.json(
        {
          ok: false,
          message: "Only the string creator can kill the linked process."
        },
        { status: 403 }
      );
    }

    const activeFlows = await listActiveLinkedFlowsForString(orgId, record);
    if (activeFlows.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          message: "No active linked process was found for this string."
        },
        { status: 409 }
      );
    }

    const flowIds = activeFlows.map((flow) => flow.id);
    const complianceHash = buildComplianceHash({
      actionType: "STRING_PROCESS_ABORTED",
      orgId,
      flowIds,
      actor: access.actor.userId
    });

    const result = await prisma.$transaction(async (tx) => {
      const abortedFlows = await tx.flow.updateMany({
        where: {
          id: {
            in: flowIds
          },
          status: {
            in: [FlowStatus.DRAFT, FlowStatus.QUEUED, FlowStatus.ACTIVE, FlowStatus.PAUSED]
          }
        },
        data: {
          status: FlowStatus.ABORTED
        }
      });

      const abortedTasks = await tx.task.updateMany({
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
      });

      const activeLocks = await tx.hubFileLock.findMany({
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
      });

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
          type: LogType.USER,
          actor: "STRING_CREATOR_ACTION",
          message: `String ${stringId} aborted ${abortedFlows.count} linked flow(s): ${flowIds.join(", ")}.`
        }
      });

      await tx.complianceAudit.create({
        data: {
          orgId,
          flowId: flowIds[0] ?? null,
          humanActorId: access.actor.userId,
          actionType: "STRING_PROCESS_ABORTED",
          complianceHash
        }
      });

      return {
        flowsAborted: abortedFlows.count,
        tasksAborted: abortedTasks.count,
        locksReleased: locksReleased.count
      };
    });

    await Promise.all(
      flowIds.map((flowId) =>
        publishRealtimeEvent({
          orgId,
          event: "flow.updated",
          payload: {
            flowId,
            status: FlowStatus.ABORTED
          }
        }).catch(() => undefined)
      )
    );

    return NextResponse.json({
      ok: true,
      message: `Aborted ${result.flowsAborted} linked process(es) for this string.`,
      result: {
        ...result,
        flowIds
      }
    });
  } catch (error) {
    console.error("[api/strings/[stringId]][POST] unexpected error", error);
    return NextResponse.json(
      {
        ok: false,
        message: "Failed to kill the linked process."
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ stringId: string }> }
) {
  const { stringId } = await context.params;
  const orgId = request.nextUrl.searchParams.get("orgId")?.trim() ?? "";

  if (!orgId || !stringId) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId and stringId are required."
      },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  try {
    const record = await getString(
      orgId,
      {
        userId: access.actor.userId,
        role: access.actor.role ?? null
      },
      stringId
    );
    if (!record) {
      return NextResponse.json(
        {
          ok: false,
          message: "String not found."
        },
        { status: 404 }
      );
    }

    if (!isStringCreator(record, access.actor.userId)) {
      return NextResponse.json(
        {
          ok: false,
          message: "Only the string creator can delete this string."
        },
        { status: 403 }
      );
    }

    const activeFlows = await listActiveLinkedFlowsForString(orgId, record);
    if (activeFlows.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          message: "Kill the linked process before deleting this string.",
          activeFlowIds: activeFlows.map((flow) => flow.id)
        },
        { status: 409 }
      );
    }

    const deleted = await deleteString(orgId, access.actor.userId, stringId);
    if (!deleted) {
      return NextResponse.json(
        {
          ok: false,
          message: "String not found."
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true
    });
  } catch (error) {
    console.error("[api/strings/[stringId]][DELETE] unexpected error", error);
    return NextResponse.json(
      {
        ok: false,
        message: "Failed to delete string."
      },
      { status: 500 }
    );
  }
}
