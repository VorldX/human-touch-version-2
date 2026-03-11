export const dynamic = "force-dynamic";

import { MemoryTier, Prisma, TaskStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { requireOrgAccess } from "@/lib/security/org-access";

interface SavedLayoutNode {
  nodeId: string;
  x: number;
  y: number;
}

interface BlueprintSuggestion {
  id: string;
  type:
    | "RESUME_PAUSED_TASK"
    | "REWIND_FAILED_TASK"
    | "ASSIGN_UNOWNED_TASK"
    | "REVIEW_PENDING_APPROVAL";
  severity: "LOW" | "MEDIUM" | "HIGH";
  title: string;
  detail: string;
  flowId?: string | null;
  taskId?: string | null;
  approvalCheckpointId?: string | null;
  recommendedAgentId?: string | null;
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

function readBlueprintOrder(trace: unknown) {
  const root = asRecord(trace);
  const blueprint = asRecord(root.blueprint);
  const value = blueprint.order;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}

function normalizeLayoutNodes(value: unknown): SavedLayoutNode[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: SavedLayoutNode[] = [];
  for (const item of value) {
    const row = asRecord(item);
    const nodeId = typeof row.nodeId === "string" ? row.nodeId.trim() : "";
    const x = typeof row.x === "number" ? row.x : Number.NaN;
    const y = typeof row.y === "number" ? row.y : Number.NaN;
    if (!nodeId || !Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }
    normalized.push({
      nodeId,
      x: Math.max(-20000, Math.min(20000, x)),
      y: Math.max(-20000, Math.min(20000, y))
    });
    if (normalized.length >= 1000) {
      break;
    }
  }

  return normalized;
}

function scoreAgentForTask(taskPrompt: string, roleText: string) {
  const prompt = taskPrompt.toLowerCase();
  const role = roleText.toLowerCase();
  let score = 0;

  if (/\b(marketing|campaign|content|growth|seo|social)\b/.test(prompt)) {
    if (/\b(marketing|content|brand|social|growth)\b/.test(role)) score += 3;
  }
  if (/\b(sales|crm|lead|prospect|outreach|pipeline)\b/.test(prompt)) {
    if (/\b(sales|crm|outreach|pipeline)\b/.test(role)) score += 3;
  }
  if (/\b(research|analysis|insight|competitor)\b/.test(prompt)) {
    if (/\b(research|analyst|insight)\b/.test(role)) score += 3;
  }
  if (/\b(support|ticket|customer)\b/.test(prompt)) {
    if (/\b(support|customer)\b/.test(role)) score += 3;
  }
  if (/\b(email|gmail|meeting|calendar|schedule)\b/.test(prompt)) {
    if (/\b(outreach|calendar|ops|assistant|manager)\b/.test(role)) score += 2;
  }

  if (score === 0 && /\b(manager|lead|strategist)\b/.test(role)) {
    score = 1;
  }

  return score;
}

function buildSuggestions(input: {
  tasks: Array<{
    id: string;
    flowId: string;
    prompt: string;
    status: TaskStatus;
    isPausedForInput: boolean;
    humanInterventionReason: string | null;
    agentId: string | null;
  }>;
  pendingApprovals: Array<{
    id: string;
    flowId: string | null;
    taskId: string | null;
    reason: string;
    requestedAt: Date;
  }>;
  aiPersonnel: Array<{ id: string; role: string }>;
}) {
  const suggestions: BlueprintSuggestion[] = [];

  for (const task of input.tasks) {
    if (task.isPausedForInput || task.status === TaskStatus.PAUSED) {
      suggestions.push({
        id: `resume:${task.id}`,
        type: "RESUME_PAUSED_TASK",
        severity: "HIGH",
        title: "Paused task needs human input",
        detail:
          task.humanInterventionReason?.trim() ||
          "Task is paused. Resume after adding required context/files.",
        flowId: task.flowId,
        taskId: task.id
      });
      continue;
    }

    if (task.status === TaskStatus.FAILED || task.status === TaskStatus.ABORTED) {
      suggestions.push({
        id: `rewind:${task.id}`,
        type: "REWIND_FAILED_TASK",
        severity: "HIGH",
        title: "Task failed and can be rewound",
        detail: "Create a branch from this task and retry with corrected constraints.",
        flowId: task.flowId,
        taskId: task.id
      });
      continue;
    }

    const canAssign =
      !task.agentId && (task.status === TaskStatus.QUEUED || task.status === TaskStatus.RUNNING);
    if (canAssign && input.aiPersonnel.length > 0) {
      const recommended = [...input.aiPersonnel]
        .map((agent) => ({
          id: agent.id,
          score: scoreAgentForTask(task.prompt, agent.role)
        }))
        .sort((a, b) => b.score - a.score)[0];

      suggestions.push({
        id: `assign:${task.id}`,
        type: "ASSIGN_UNOWNED_TASK",
        severity: "MEDIUM",
        title: "Task has no assigned owner",
        detail: "Assign this task to an available AI role for faster throughput.",
        flowId: task.flowId,
        taskId: task.id,
        recommendedAgentId: recommended?.id ?? null
      });
    }
  }

  for (const approval of input.pendingApprovals.slice(0, 40)) {
    suggestions.push({
      id: `approval:${approval.id}`,
      type: "REVIEW_PENDING_APPROVAL",
      severity: "MEDIUM",
      title: "Pending approval is blocking progress",
      detail: approval.reason,
      flowId: approval.flowId,
      taskId: approval.taskId,
      approvalCheckpointId: approval.id
    });
  }

  return suggestions.slice(0, 200);
}

const BLUEPRINT_LAYOUT_KEY = "blueprint.layout.v1";

export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("orgId")?.trim();
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

  try {
    const [personnel, flows, pendingApprovals, delegations, locks, layoutEntry] = await Promise.all([
      prisma.personnel.findMany({
        where: { orgId },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          type: true,
          name: true,
          role: true,
          status: true,
          autonomyScore: true,
          updatedAt: true
        }
      }),
      prisma.flow.findMany({
        where: { orgId },
        orderBy: { updatedAt: "desc" },
        take: 40,
        select: {
          id: true,
          prompt: true,
          status: true,
          progress: true,
          predictedBurn: true,
          requiredSignatures: true,
          parentFlowId: true,
          updatedAt: true,
          tasks: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              flowId: true,
              agentId: true,
              prompt: true,
              status: true,
              isPausedForInput: true,
              humanInterventionReason: true,
              executionTrace: true,
              createdAt: true,
              updatedAt: true
            }
          }
        }
      }),
      prisma.approvalCheckpoint.findMany({
        where: {
          orgId,
          status: "PENDING"
        },
        orderBy: { requestedAt: "desc" },
        take: 200,
        select: {
          id: true,
          flowId: true,
          taskId: true,
          agentId: true,
          reason: true,
          requestedAt: true
        }
      }),
      prisma.agentDelegation.findMany({
        where: { orgId },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: {
          id: true,
          flowId: true,
          taskId: true,
          status: true,
          reason: true,
          createdAt: true,
          fromAgent: {
            select: {
              id: true,
              name: true,
              role: true
            }
          },
          toAgent: {
            select: {
              id: true,
              name: true,
              role: true
            }
          }
        }
      }),
      prisma.hubFileLock.findMany({
        where: {
          orgId,
          releasedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
        },
        orderBy: { acquiredAt: "asc" },
        take: 200,
        select: {
          id: true,
          fileId: true,
          taskId: true,
          agentId: true,
          acquiredAt: true,
          expiresAt: true,
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
        }
      }),
      prisma.memoryEntry.findFirst({
        where: {
          orgId,
          tier: MemoryTier.ORG,
          key: BLUEPRINT_LAYOUT_KEY,
          redactedAt: null
        },
        orderBy: { updatedAt: "desc" },
        select: {
          value: true,
          updatedAt: true
        }
      })
    ]);

    const normalizedFlows = flows.map((flow) => ({
      id: flow.id,
      prompt: flow.prompt,
      status: flow.status,
      progress: flow.progress,
      predictedBurn: flow.predictedBurn,
      requiredSignatures: flow.requiredSignatures,
      parentFlowId: flow.parentFlowId,
      updatedAt: flow.updatedAt,
      tasks: flow.tasks.map((task) => ({
        id: task.id,
        flowId: task.flowId,
        agentId: task.agentId,
        prompt: task.prompt,
        status: task.status,
        isPausedForInput: task.isPausedForInput,
        humanInterventionReason: task.humanInterventionReason,
        blueprintOrder: readBlueprintOrder(task.executionTrace),
        createdAt: task.createdAt,
        updatedAt: task.updatedAt
      }))
    }));

    const allTasks = normalizedFlows.flatMap((flow) => flow.tasks);
    const aiPersonnel = personnel
      .filter((item) => item.type === "AI")
      .map((item) => ({ id: item.id, role: item.role }));
    const suggestions = buildSuggestions({
      tasks: allTasks,
      pendingApprovals,
      aiPersonnel
    });

    const layout = asRecord(layoutEntry?.value);
    const layoutNodes = normalizeLayoutNodes(layout.nodes);

    const queuedTasks = allTasks.filter((task) => task.status === TaskStatus.QUEUED).length;
    const runningTasks = allTasks.filter((task) => task.status === TaskStatus.RUNNING).length;
    const blockedTasks = allTasks.filter(
      (task) =>
        task.status === TaskStatus.PAUSED ||
        task.status === TaskStatus.FAILED ||
        task.status === TaskStatus.ABORTED ||
        task.isPausedForInput
    ).length;

    return NextResponse.json({
      ok: true,
      snapshot: {
        generatedAt: new Date().toISOString(),
        metrics: {
          workforceTotal: personnel.length,
          humans: personnel.filter((item) => item.type === "HUMAN").length,
          agents: personnel.filter((item) => item.type === "AI").length,
          activeFlows: normalizedFlows.filter((flow) => flow.status === "ACTIVE").length,
          queuedTasks,
          runningTasks,
          blockedTasks,
          pendingApprovals: pendingApprovals.length
        },
        workforce: personnel,
        flows: normalizedFlows,
        approvals: pendingApprovals,
        delegations,
        locks,
        suggestions,
        layout: {
          updatedAt: layoutEntry?.updatedAt ?? null,
          nodes: layoutNodes
        }
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Failed to load blueprint snapshot."
      },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        layout?: {
          nodes?: unknown;
        };
      }
    | null;

  const orgId = body?.orgId?.trim() ?? "";
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

  const nodes = normalizeLayoutNodes(body?.layout?.nodes);
  const layoutValue = {
    version: 1,
    updatedAt: new Date().toISOString(),
    updatedBy: access.actor.userId,
    nodes
  } as unknown as Prisma.InputJsonValue;

  try {
    const existing = await prisma.memoryEntry.findFirst({
      where: {
        orgId,
        tier: MemoryTier.ORG,
        key: BLUEPRINT_LAYOUT_KEY,
        redactedAt: null
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true }
    });

    if (existing) {
      await prisma.memoryEntry.update({
        where: { id: existing.id },
        data: {
          value: layoutValue
        }
      });
    } else {
      await prisma.memoryEntry.create({
        data: {
          orgId,
          tier: MemoryTier.ORG,
          key: BLUEPRINT_LAYOUT_KEY,
          value: layoutValue
        }
      });
    }

    return NextResponse.json({
      ok: true,
      layout: layoutValue
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Failed to save blueprint layout."
      },
      { status: 500 }
    );
  }
}
