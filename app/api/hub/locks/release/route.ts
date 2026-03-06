export const dynamic = "force-dynamic";

import { LogType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { requireOrgAccess } from "@/lib/security/org-access";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        fileId?: string;
        taskId?: string;
        agentId?: string;
        reason?: string;
      }
    | null;

  const orgId = body?.orgId?.trim() ?? "";
  const fileId = body?.fileId?.trim() || null;
  const taskId = body?.taskId?.trim() || null;
  const agentId = body?.agentId?.trim() || null;
  const reason = body?.reason?.trim() || "Lock released.";

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

  if (!fileId && !taskId && !agentId) {
    return NextResponse.json(
      {
        ok: false,
        message: "Provide at least one filter: fileId, taskId, or agentId."
      },
      { status: 400 }
    );
  }

  const filter = {
    orgId,
    releasedAt: null,
    ...(fileId ? { fileId } : {}),
    ...(taskId ? { taskId } : {}),
    ...(agentId ? { agentId } : {})
  };

  const now = new Date();

  const released = await prisma.$transaction(async (tx) => {
    const targetLocks = await tx.hubFileLock.findMany({
      where: filter,
      include: {
        file: {
          select: {
            id: true,
            name: true
          }
        }
      },
      take: 250
    });

    if (targetLocks.length === 0) {
      return {
        count: 0,
        lockIds: [] as string[]
      };
    }

    const lockIds = targetLocks.map((lock) => lock.id);

    const result = await tx.hubFileLock.updateMany({
      where: {
        id: {
          in: lockIds
        },
        releasedAt: null
      },
      data: {
        releasedAt: now
      }
    });

    await tx.log.create({
      data: {
        orgId,
        type: LogType.EXE,
        actor: "HUB_LOCK",
        message: `${reason} Released ${result.count} lock(s).`
      }
    });

    return {
      count: result.count,
      lockIds
    };
  });

  return NextResponse.json({
    ok: true,
    released
  });
}
