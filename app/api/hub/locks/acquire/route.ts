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
  const fileId = body?.fileId?.trim() ?? "";
  const taskId = body?.taskId?.trim() || null;
  const agentId = body?.agentId?.trim() || null;
  const reason = body?.reason?.trim() || null;

  if (!orgId || !fileId) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId and fileId are required."
      },
      { status: 400 }
    );
  }
  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  const file = await prisma.file.findUnique({
    where: { id: fileId },
    select: { id: true, orgId: true, name: true }
  });

  if (!file || file.orgId !== orgId) {
    return NextResponse.json(
      {
        ok: false,
        message: "File not found for this organization."
      },
      { status: 404 }
    );
  }

  const activeLock = await prisma.hubFileLock.findFirst({
    where: {
      orgId,
      fileId,
      releasedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
    },
    include: {
      agent: {
        select: {
          id: true,
          name: true
        }
      }
    },
    orderBy: { acquiredAt: "asc" }
  });

  if (activeLock && activeLock.taskId !== taskId) {
    return NextResponse.json(
      {
        ok: false,
        message: "File is already locked by another task.",
        lock: {
          id: activeLock.id,
          fileId: activeLock.fileId,
          lockOwnerTaskId: activeLock.taskId,
          lockOwnerAgent: activeLock.agent?.name ?? null,
          acquiredAt: activeLock.acquiredAt
        }
      },
      { status: 409 }
    );
  }

  if (activeLock) {
    return NextResponse.json({
      ok: true,
      lock: {
        id: activeLock.id,
        fileId: activeLock.fileId,
        lockOwnerTaskId: activeLock.taskId,
        lockOwnerAgent: activeLock.agent?.name ?? null,
        acquiredAt: activeLock.acquiredAt
      }
    });
  }

  const lock = await prisma.$transaction(async (tx) => {
    const created = await tx.hubFileLock.create({
      data: {
        orgId,
        fileId,
        taskId,
        agentId,
        reason
      }
    });

    await tx.log.create({
      data: {
        orgId,
        type: LogType.EXE,
        actor: "HUB_LOCK",
        message: `File ${file.name} (${file.id}) locked${taskId ? ` by task ${taskId}` : ""}.`
      }
    });

    return created;
  });

  return NextResponse.json(
    {
      ok: true,
      lock: {
        id: lock.id,
        fileId: lock.fileId,
        lockOwnerTaskId: lock.taskId,
        acquiredAt: lock.acquiredAt
      }
    },
    { status: 201 }
  );
}
