export const dynamic = "force-dynamic";

import { LogType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { requireOrgAccess } from "@/lib/security/org-access";

interface BlueprintTaskUpdateRequest {
  orgId?: string;
  taskId?: string;
  agentId?: string | null;
  blueprintOrder?: number | null;
  note?: string;
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

function normalizeOrder(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const rounded = Math.floor(value);
  return Math.max(0, Math.min(100000, rounded));
}

export async function POST(request: NextRequest) {
  let body: BlueprintTaskUpdateRequest;
  try {
    body = (await request.json()) as BlueprintTaskUpdateRequest;
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
  const taskId = body.taskId?.trim();
  if (!orgId || !taskId) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId and taskId are required."
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
          orgId: true
        }
      }
    }
  });
  if (!task || task.flow.orgId !== orgId) {
    return NextResponse.json(
      {
        ok: false,
        message: "Task not found for this organization."
      },
      { status: 404 }
    );
  }

  const shouldUpdateAgent = Object.prototype.hasOwnProperty.call(body, "agentId");
  const normalizedAgentId =
    typeof body.agentId === "string" ? body.agentId.trim() : body.agentId ?? null;

  if (shouldUpdateAgent && normalizedAgentId) {
    const agent = await prisma.personnel.findFirst({
      where: {
        id: normalizedAgentId,
        orgId
      },
      select: {
        id: true
      }
    });
    if (!agent) {
      return NextResponse.json(
        {
          ok: false,
          message: "Assigned personnel was not found in this organization."
        },
        { status: 404 }
      );
    }
  }

  const normalizedOrder = normalizeOrder(body.blueprintOrder);
  if (Object.prototype.hasOwnProperty.call(body, "blueprintOrder") && normalizedOrder === undefined) {
    return NextResponse.json(
      {
        ok: false,
        message: "blueprintOrder must be a finite number or null."
      },
      { status: 400 }
    );
  }

  const note = body.note?.trim() ?? "";
  const trace = asRecord(task.executionTrace);
  const existingBlueprint = asRecord(trace.blueprint);
  const nextBlueprint = {
    ...existingBlueprint,
    ...(normalizedOrder !== undefined ? { order: normalizedOrder } : {}),
    updatedAt: new Date().toISOString(),
    updatedBy: access.actor.userId,
    ...(note ? { note } : {})
  };

  const updated = await prisma.$transaction(async (tx) => {
    const nextTask = await tx.task.update({
      where: { id: task.id },
      data: {
        ...(shouldUpdateAgent ? { agentId: normalizedAgentId || null } : {}),
        executionTrace: {
          ...trace,
          blueprint: nextBlueprint
        }
      },
      select: {
        id: true,
        flowId: true,
        agentId: true,
        status: true
      }
    });

    await tx.log.create({
      data: {
        orgId,
        type: LogType.USER,
        actor: "BLUEPRINT",
        message: `Blueprint updated task ${task.id}: assignment=${shouldUpdateAgent ? normalizedAgentId || "unassigned" : "unchanged"}, order=${normalizedOrder ?? existingBlueprint.order ?? "unchanged"}.`
      }
    });

    return nextTask;
  });

  return NextResponse.json({
    ok: true,
    task: updated
  });
}
