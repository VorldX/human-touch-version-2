export const dynamic = "force-dynamic";

import { HubFileType, TaskStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { requireOrgAccess } from "@/lib/security/org-access";

type WorkflowLane = "QUEUED" | "INPUT" | "INPROCESS" | "OUTPUT";

function resolveLane(task: { status: TaskStatus; isPausedForInput: boolean }): WorkflowLane {
  if (task.status === TaskStatus.QUEUED) return "QUEUED";
  if (task.status === TaskStatus.RUNNING) return "INPROCESS";
  if (task.status === TaskStatus.PAUSED || task.isPausedForInput) return "INPUT";
  return "OUTPUT";
}

function asRecord(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function toAgentPlan(prompt: string, executionTrace: unknown) {
  const trace = asRecord(executionTrace);
  const fromTrace =
    typeof trace.agentPlan === "string"
      ? trace.agentPlan
      : typeof trace.plannedAction === "string"
        ? trace.plannedAction
        : typeof trace.nextAction === "string"
          ? trace.nextAction
          : null;

  if (fromTrace && fromTrace.trim().length > 0) {
    return fromTrace.trim().slice(0, 180);
  }

  return prompt.trim().slice(0, 180);
}

export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("orgId")?.trim();
  const laneFilter = request.nextUrl.searchParams.get("lane")?.trim() as WorkflowLane | null;

  if (!orgId) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId query param is required."
      },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  const tasks = await prisma.task.findMany({
    where: {
      flow: {
        orgId
      }
    },
    include: {
      flow: {
        select: {
          id: true,
          prompt: true,
          status: true,
          progress: true,
          updatedAt: true
        }
      },
      agent: {
        select: {
          id: true,
          name: true,
          role: true,
          status: true
        }
      }
    },
    orderBy: {
      createdAt: "asc"
    },
    take: 500
  });

  const requiredRefs = new Set<string>();
  for (const task of tasks) {
    for (const fileRef of task.requiredFiles) {
      if (fileRef.trim().length > 0) requiredRefs.add(fileRef.trim());
    }
  }

  const refs = [...requiredRefs];
  const files =
    refs.length > 0
      ? await prisma.file.findMany({
          where: {
            orgId,
            OR: [{ id: { in: refs } }, { url: { in: refs } }]
          },
          select: {
            id: true,
            url: true,
            name: true
          }
        })
      : [];

  const fileByRef = new Map<string, { id: string; name: string }>();
  for (const file of files) {
    fileByRef.set(file.id, { id: file.id, name: file.name });
    fileByRef.set(file.url, { id: file.id, name: file.name });
  }

  const outputFiles = await prisma.file.findMany({
    where: {
      orgId,
      type: HubFileType.OUTPUT
    },
    orderBy: {
      updatedAt: "desc"
    },
    take: 500,
    select: {
      id: true,
      name: true,
      url: true,
      updatedAt: true,
      metadata: true
    }
  });

  const outputByTaskId = new Map<
    string,
    {
      fileId: string;
      fileName: string;
      fileUrl: string;
      updatedAt: Date;
      preview: string | null;
    }
  >();

  for (const outputFile of outputFiles) {
    const meta = asRecord(outputFile.metadata);
    const sourceTaskId =
      typeof meta.sourceTaskId === "string" ? meta.sourceTaskId.trim() : "";
    if (!sourceTaskId || outputByTaskId.has(sourceTaskId)) {
      continue;
    }

    const preview =
      typeof meta.outputPreview === "string"
        ? meta.outputPreview
        : typeof meta.content === "string"
          ? meta.content
          : null;

    outputByTaskId.set(sourceTaskId, {
      fileId: outputFile.id,
      fileName: outputFile.name,
      fileUrl: outputFile.url,
      updatedAt: outputFile.updatedAt,
      preview
    });
  }

  const activeLocks = await prisma.hubFileLock.findMany({
    where: {
      orgId,
      releasedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
    },
    include: {
      file: {
        select: {
          id: true,
          name: true
        }
      },
      agent: {
        select: {
          id: true,
          name: true
        }
      }
    },
    orderBy: {
      acquiredAt: "asc"
    }
  });

  const activeLockByFileId = new Map<string, (typeof activeLocks)[number]>();
  for (const lock of activeLocks) {
    if (!activeLockByFileId.has(lock.fileId)) {
      activeLockByFileId.set(lock.fileId, lock);
    }
  }

  const flowCounters = new Map<
    string,
    {
      total: number;
      completed: number;
    }
  >();

  for (const task of tasks) {
    const value = flowCounters.get(task.flowId) ?? { total: 0, completed: 0 };
    value.total += 1;
    if (task.status === TaskStatus.COMPLETED) {
      value.completed += 1;
    }
    flowCounters.set(task.flowId, value);
  }

  const flowTaskOrder = new Map<string, string[]>();
  for (const task of tasks) {
    const entry = flowTaskOrder.get(task.flowId) ?? [];
    entry.push(task.id);
    flowTaskOrder.set(task.flowId, entry);
  }

  const items = tasks.map((task) => {
    const lane = resolveLane(task);
    const linkedFiles = task.requiredFiles
      .map((fileRef) => fileByRef.get(fileRef))
      .filter((value): value is { id: string; name: string } => Boolean(value));
    const uniqueLinkedFiles = [...new Map(linkedFiles.map((item) => [item.id, item])).values()];

    const blockingLocks = uniqueLinkedFiles
      .map((file) => activeLockByFileId.get(file.id))
      .filter(
        (lock): lock is (typeof activeLocks)[number] => {
          if (!lock) return false;
          return lock.taskId !== task.id;
        }
      );
    const heldLocks = uniqueLinkedFiles
      .map((file) => activeLockByFileId.get(file.id))
      .filter(
        (lock): lock is (typeof activeLocks)[number] => {
          if (!lock) return false;
          return lock.taskId === task.id;
        }
      );

    const independent = uniqueLinkedFiles.length === 0;
    const readyForIndependentWork = independent || blockingLocks.length === 0;
    const counters = flowCounters.get(task.flowId) ?? { total: 1, completed: 0 };
    const remainingInFlow = Math.max(0, counters.total - counters.completed);
    const flowOrder = flowTaskOrder.get(task.flowId) ?? [task.id];
    const taskIndex = Math.max(0, flowOrder.indexOf(task.id));
    const output = outputByTaskId.get(task.id) ?? null;

    return {
      id: task.id,
      flowId: task.flowId,
      flowPrompt: task.flow.prompt,
      flowStatus: task.flow.status,
      lane,
      status: task.status,
      subtaskLabel: `Task ${taskIndex + 1} of ${flowOrder.length}`,
      isPausedForInput: task.isPausedForInput,
      humanInterventionReason: task.humanInterventionReason,
      specificPrompt: task.prompt,
      agentPlan: toAgentPlan(task.prompt, task.executionTrace),
      assignment: `${task.agent?.name ?? "Unassigned Agent"} | ${task.agent?.role ?? "N/A"}`,
      requiredFiles: uniqueLinkedFiles,
      blockedByLocks: blockingLocks.map((lock) => ({
        lockId: lock.id,
        fileId: lock.file.id,
        fileName: lock.file.name,
        lockOwnerTaskId: lock.taskId,
        lockOwnerAgent: lock.agent?.name ?? null,
        acquiredAt: lock.acquiredAt
      })),
      heldLocks: heldLocks.map((lock) => ({
        lockId: lock.id,
        fileId: lock.file.id,
        fileName: lock.file.name,
        acquiredAt: lock.acquiredAt
      })),
      lockState:
        blockingLocks.length > 0
          ? "BLOCKED_BY_OTHER_AGENT"
          : uniqueLinkedFiles.length > 0
            ? "LOCK_READY"
            : "NO_LOCK_REQUIRED",
      independent,
      readyForIndependentWork,
      independentTag:
        independent || readyForIndependentWork
          ? "Independent Task"
          : "Depends on Locked File",
      done: task.status === TaskStatus.COMPLETED,
      remainingInFlow,
      output,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    };
  });

  const filtered = laneFilter ? items.filter((item) => item.lane === laneFilter) : items;
  const lanes: Record<WorkflowLane, number> = {
    QUEUED: items.filter((item) => item.lane === "QUEUED").length,
    INPUT: items.filter((item) => item.lane === "INPUT").length,
    INPROCESS: items.filter((item) => item.lane === "INPROCESS").length,
    OUTPUT: items.filter((item) => item.lane === "OUTPUT").length
  };

  return NextResponse.json({
    ok: true,
    lanes,
    items: filtered
  });
}
