import "server-only";

import {
  AgentDecisionType,
  AgentRole,
  AgentStatus,
  OrgExecutionMode,
  PersonnelStatus,
  PersonnelType,
  Prisma
} from "@prisma/client";

import { prisma } from "@/lib/db/prisma";

function parseRoleFromText(value: string | null | undefined): AgentRole {
  const role = value?.toLowerCase() ?? "";
  if (/\bmanager\b/.test(role)) return AgentRole.MANAGER;
  if (/\bworker\b/.test(role)) return AgentRole.WORKER;
  if (/\bmain\b|\bboss\b|\borchestrator\b/.test(role)) return AgentRole.MAIN;
  return AgentRole.WORKER;
}

function roleLabel(role: AgentRole) {
  if (role === AgentRole.MAIN) return "Main Agent";
  if (role === AgentRole.MANAGER) return "Manager Agent";
  return "Worker Agent";
}

function normalizeTools(tools: string[]) {
  return [...new Set(tools.map((tool) => tool.trim().toLowerCase()).filter(Boolean))];
}

function personnelMatchesRole(role: AgentRole, value: string) {
  const text = value.toLowerCase();
  if (role === AgentRole.MAIN) {
    return /\bmain\b|\bboss\b|\borchestrator\b/.test(text);
  }
  if (role === AgentRole.MANAGER) {
    return /\bmanager\b|\blead\b|\bstrategist\b|\borchestrator\b/.test(text);
  }
  return !/\bmain\b|\bboss\b/.test(text);
}

export async function resolveOrgExecutionMode(orgId: string) {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { executionMode: true }
  });
  return org?.executionMode ?? OrgExecutionMode.BALANCED;
}

export async function ensureMainAgentProfile(input: {
  orgId: string;
  flowId: string;
  missionGoal: string;
}) {
  const mainPersonnel =
    (await prisma.personnel.findFirst({
      where: {
        orgId: input.orgId,
        type: PersonnelType.AI,
        role: { contains: "Main", mode: "insensitive" },
        status: { not: PersonnelStatus.DISABLED }
      },
      select: {
        id: true,
        name: true,
        role: true
      }
    })) ??
    (await prisma.personnel.findFirst({
      where: {
        orgId: input.orgId,
        type: PersonnelType.AI,
        role: { contains: "Boss", mode: "insensitive" },
        status: { not: PersonnelStatus.DISABLED }
      },
      select: {
        id: true,
        name: true,
        role: true
      }
    })) ??
    (await prisma.personnel.findFirst({
      where: {
        orgId: input.orgId,
        type: PersonnelType.AI,
        status: { not: PersonnelStatus.DISABLED }
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        role: true
      }
    }));

  const existing = await prisma.agent.findFirst({
    where: {
      orgId: input.orgId,
      missionFlowId: input.flowId,
      role: AgentRole.MAIN
    },
    orderBy: { createdAt: "asc" }
  });
  if (existing) return existing;

  return prisma.agent.create({
    data: {
      orgId: input.orgId,
      missionFlowId: input.flowId,
      role: AgentRole.MAIN,
      status: AgentStatus.ACTIVE,
      name: mainPersonnel?.name ?? "Main Agent",
      goal: input.missionGoal,
      ...(mainPersonnel ? { personnelId: mainPersonnel.id } : {}),
      instructions: {
        role: "Main orchestrator",
        behavior: "Decide execute-self vs delegation using policy and budget."
      } as Prisma.InputJsonValue
    }
  });
}

export async function ensureLogicalAgentForPersonnel(input: {
  orgId: string;
  flowId: string;
  personnelId?: string | null;
  defaultRole?: AgentRole;
  missionGoal?: string;
}) {
  if (!input.personnelId) {
    return null;
  }

  const existing = await prisma.agent.findFirst({
    where: {
      orgId: input.orgId,
      missionFlowId: input.flowId,
      personnelId: input.personnelId
    },
    orderBy: { createdAt: "asc" }
  });
  if (existing) return existing;

  const personnel = await prisma.personnel.findUnique({
    where: { id: input.personnelId },
    select: {
      id: true,
      name: true,
      role: true
    }
  });
  if (!personnel) {
    return null;
  }

  return prisma.agent.create({
    data: {
      orgId: input.orgId,
      missionFlowId: input.flowId,
      personnelId: personnel.id,
      role: input.defaultRole ?? parseRoleFromText(personnel.role),
      status: AgentStatus.ACTIVE,
      name: personnel.name,
      goal: input.missionGoal ?? null
    }
  });
}

export async function resolveOrCreateTaskAgentProfile(input: {
  orgId: string;
  flowId: string;
  taskPrompt: string;
  personnelId?: string | null;
}) {
  const primary =
    (await ensureLogicalAgentForPersonnel({
      orgId: input.orgId,
      flowId: input.flowId,
      personnelId: input.personnelId ?? null
    })) ??
    (await ensureMainAgentProfile({
      orgId: input.orgId,
      flowId: input.flowId,
      missionGoal: input.taskPrompt
    }));

  return primary;
}

export async function listReusableChildAgents(input: {
  orgId: string;
  flowId: string;
  parentAgentId: string;
  role: AgentRole;
  requestedToolkits?: string[];
}) {
  const requestedToolkits = normalizeTools(input.requestedToolkits ?? []);

  return prisma.agent.findMany({
    where: {
      orgId: input.orgId,
      missionFlowId: input.flowId,
      parentAgentId: input.parentAgentId,
      role: input.role,
      status: AgentStatus.ACTIVE,
      ...(requestedToolkits.length > 0
        ? {
            OR: [
              { allowedTools: { hasEvery: requestedToolkits } },
              { allowedTools: { isEmpty: true } }
            ]
          }
        : {})
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: 5
  });
}

export async function pickDelegationPersonnelCandidate(input: {
  orgId: string;
  role: AgentRole;
  excludePersonnelId?: string | null;
}) {
  const candidates = await prisma.personnel.findMany({
    where: {
      orgId: input.orgId,
      type: PersonnelType.AI,
      status: { not: PersonnelStatus.DISABLED },
      ...(input.excludePersonnelId ? { id: { not: input.excludePersonnelId } } : {})
    },
    orderBy: [{ autonomyScore: "desc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      role: true
    },
    take: 25
  });

  const matched = candidates.find((candidate) => personnelMatchesRole(input.role, candidate.role));
  if (matched) {
    return matched.id;
  }

  const fallback =
    input.role === AgentRole.MAIN
      ? candidates.find((candidate) => personnelMatchesRole(AgentRole.MAIN, candidate.role))
      : candidates.find((candidate) => !personnelMatchesRole(AgentRole.MAIN, candidate.role));

  return fallback?.id ?? null;
}

export async function createChildAgent(input: {
  orgId: string;
  flowId: string;
  parentAgentId: string;
  personnelId?: string | null;
  createdByRunId?: string | null;
  role: AgentRole;
  goal: string;
  allowedTools: string[];
  budgetScope: {
    maxUsd: number;
  };
  executionMode: OrgExecutionMode;
}) {
  return prisma.agent.create({
    data: {
      orgId: input.orgId,
      missionFlowId: input.flowId,
      parentAgentId: input.parentAgentId,
      personnelId: input.personnelId ?? null,
      createdByRunId: input.createdByRunId ?? null,
      role: input.role,
      status: AgentStatus.ACTIVE,
      name: `${roleLabel(input.role)} ${new Date().toISOString().slice(11, 19)}`,
      goal: input.goal,
      allowedTools: normalizeTools(input.allowedTools),
      budgetScope: {
        maxUsd: Number(input.budgetScope.maxUsd.toFixed(4)),
        executionMode: input.executionMode
      } as Prisma.InputJsonValue,
      instructions: {
        role: input.role,
        constraints: [
          "Child agent must stay within inherited budget and permissions.",
          "Request human approval when policy, tools, or confidence blocks execution."
        ]
      } as Prisma.InputJsonValue
    }
  });
}

export async function createAgentRun(input: {
  orgId: string;
  agentId: string;
  flowId: string;
  taskId: string;
  parentRunId?: string | null;
  goal: string;
  prompt: string;
  contextPack: Prisma.InputJsonValue;
  decisionType: AgentDecisionType;
  decisionReason: string;
  executionMode: OrgExecutionMode;
  budgetBefore: number;
  estimatedCostUsd: number;
}) {
  return prisma.agentRun.create({
    data: {
      orgId: input.orgId,
      agentId: input.agentId,
      flowId: input.flowId,
      taskId: input.taskId,
      parentRunId: input.parentRunId ?? null,
      status: AgentStatus.ACTIVE,
      goal: input.goal,
      prompt: input.prompt,
      contextPack: input.contextPack,
      decisionType: input.decisionType,
      decisionReason: input.decisionReason,
      executionMode: input.executionMode,
      budgetBefore: new Prisma.Decimal(input.budgetBefore),
      estimatedCost: new Prisma.Decimal(input.estimatedCostUsd)
    }
  });
}

export async function finalizeAgentRun(input: {
  runId: string;
  status: AgentStatus;
  actualCostUsd?: number | null;
  budgetAfter?: number | null;
  modelProvider?: string | null;
  modelName?: string | null;
  tokenInput?: number | null;
  tokenOutput?: number | null;
  metadata?: Prisma.InputJsonValue;
}) {
  return prisma.agentRun.update({
    where: { id: input.runId },
    data: {
      status: input.status,
      completedAt: new Date(),
      ...(typeof input.actualCostUsd === "number"
        ? { actualCost: new Prisma.Decimal(Math.max(0, input.actualCostUsd)) }
        : {}),
      ...(typeof input.budgetAfter === "number"
        ? { budgetAfter: new Prisma.Decimal(Math.max(0, input.budgetAfter)) }
        : {}),
      ...(input.modelProvider ? { modelProvider: input.modelProvider } : {}),
      ...(input.modelName ? { modelName: input.modelName } : {}),
      ...(typeof input.tokenInput === "number" ? { tokenInput: input.tokenInput } : {}),
      ...(typeof input.tokenOutput === "number" ? { tokenOutput: input.tokenOutput } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {})
    }
  });
}

export async function recordDelegation(input: {
  orgId: string;
  flowId: string;
  taskId: string;
  fromAgentId: string;
  toAgentId: string;
  fromRunId?: string | null;
  toRunId?: string | null;
  decisionType: AgentDecisionType;
  reason: string;
  metadata?: Prisma.InputJsonValue;
}) {
  return prisma.agentDelegation.create({
    data: {
      orgId: input.orgId,
      flowId: input.flowId,
      taskId: input.taskId,
      fromAgentId: input.fromAgentId,
      toAgentId: input.toAgentId,
      fromRunId: input.fromRunId ?? null,
      toRunId: input.toRunId ?? null,
      decisionType: input.decisionType,
      reason: input.reason,
      metadata: input.metadata ?? Prisma.JsonNull
    }
  });
}

export async function createApprovalCheckpoint(input: {
  orgId: string;
  flowId: string;
  taskId: string;
  agentId: string;
  agentRunId?: string | null;
  reason: string;
  approvalPolicy?: Prisma.InputJsonValue;
  metadata?: Prisma.InputJsonValue;
}) {
  return prisma.approvalCheckpoint.create({
    data: {
      orgId: input.orgId,
      flowId: input.flowId,
      taskId: input.taskId,
      agentId: input.agentId,
      agentRunId: input.agentRunId ?? null,
      reason: input.reason,
      approvalPolicy: input.approvalPolicy ?? Prisma.JsonNull,
      metadata: input.metadata ?? Prisma.JsonNull
    }
  });
}
