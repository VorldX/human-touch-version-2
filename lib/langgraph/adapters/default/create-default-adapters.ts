import "server-only";

import { randomUUID } from "node:crypto";

import {
  AgentRole,
  AgentStatus,
  HubFileType,
  PersonnelStatus,
  PersonnelType,
  type Prisma
} from "@prisma/client";

import type {
  ApprovalRequestResult,
  HubContextResult,
  HubEntryResult,
  OrganizationGraphAdapters,
  ToolExecutionResult
} from "../contracts.ts";
import type {
  CreatedAgentSpec,
  ExistingSquadMember,
  SharedKnowledgeRef,
  SquadWriteResult
} from "../../state.ts";
import { searchAgentMemory } from "@/lib/agent/memory";
import { executeAgentTool } from "@/lib/agent/tools/execute";
import { prisma } from "@/lib/db/prisma";
import { ensureCompanyDataFile } from "@/lib/hub/organization-hub";
import { composioAllowlistedToolkits } from "@/lib/integrations/composio/service";
import { executeThroughExistingToolPath } from "../tool-execution-bridge.ts";

function mapRoleToAgentRole(role: string): AgentRole {
  const normalized = role.toLowerCase();
  if (/\b(main|boss|orchestrator)\b/.test(normalized)) return AgentRole.MAIN;
  if (/\b(lead|manager|strategist|head)\b/.test(normalized)) return AgentRole.MANAGER;
  return AgentRole.WORKER;
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

async function loadOrganizationContext(input: { orgId: string; userId: string }) {
  const org = await prisma.organization.findUnique({
    where: { id: input.orgId },
    select: { id: true, name: true }
  });
  if (!org) {
    throw new Error("Organization not found.");
  }

  const manager =
    (await prisma.personnel.findFirst({
      where: {
        orgId: input.orgId,
        type: PersonnelType.AI,
        status: { not: PersonnelStatus.DISABLED },
        role: { contains: "Main", mode: "insensitive" }
      },
      select: { name: true },
      orderBy: { updatedAt: "desc" }
    })) ??
    (await prisma.personnel.findFirst({
      where: {
        orgId: input.orgId,
        type: PersonnelType.AI,
        status: { not: PersonnelStatus.DISABLED },
        role: { contains: "Boss", mode: "insensitive" }
      },
      select: { name: true },
      orderBy: { updatedAt: "desc" }
    }));

  return {
    orgId: org.id,
    orgName: org.name,
    workspaceId: org.id,
    managerName: manager?.name ?? "Swarm",
    availableToolkits: composioAllowlistedToolkits()
  };
}

async function loadExistingSquad(input: { orgId: string }): Promise<ExistingSquadMember[]> {
  const members = await prisma.personnel.findMany({
    where: { orgId: input.orgId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      role: true,
      type: true,
      status: true,
      assignedOAuthIds: true
    }
  });

  return members.map((member) => ({
    personnelId: member.id,
    name: member.name,
    role: member.role,
    type: member.type === PersonnelType.AI ? "AI" : "HUMAN",
    status: member.status,
    assignedOAuthIds: member.assignedOAuthIds
  }));
}

async function upsertAgentProfile(input: {
  orgId: string;
  personnelId: string;
  graphRunId: string;
  mission: string;
  spec: CreatedAgentSpec;
}) {
  const existing = await prisma.agent.findFirst({
    where: {
      orgId: input.orgId,
      personnelId: input.personnelId,
      metadata: {
        path: ["creationSource"],
        equals: "langgraph_team_bootstrap"
      }
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      metadata: true
    }
  });

  const metadata = {
    ...(existing ? asRecord(existing.metadata) : {}),
    ...input.spec.metadata,
    graphRunId: input.graphRunId,
    updatedAt: new Date().toISOString()
  } satisfies Prisma.InputJsonValue;

  if (existing) {
    const updated = await prisma.agent.update({
      where: { id: existing.id },
      data: {
        name: input.spec.name,
        goal: input.mission,
        role: mapRoleToAgentRole(input.spec.role),
        status: AgentStatus.ACTIVE,
        allowedTools: input.spec.toolkits,
        metadata
      },
      select: { id: true }
    });
    return updated.id;
  }

  const created = await prisma.agent.create({
    data: {
      orgId: input.orgId,
      personnelId: input.personnelId,
      role: mapRoleToAgentRole(input.spec.role),
      status: AgentStatus.ACTIVE,
      name: input.spec.name,
      goal: input.mission,
      allowedTools: input.spec.toolkits,
      instructions: {
        prompt: input.spec.prompt,
        responsibilities: input.spec.responsibilities
      } as Prisma.InputJsonValue,
      metadata
    },
    select: { id: true }
  });

  return created.id;
}

async function persistSquadAgents(input: {
  orgId: string;
  userId: string;
  teamType: string;
  graphRunId: string;
  mission: string;
  agents: CreatedAgentSpec[];
  reuseExistingAgents: boolean;
}): Promise<SquadWriteResult[]> {
  const results: SquadWriteResult[] = [];

  for (const spec of input.agents) {
    try {
      const existing =
        input.reuseExistingAgents
          ? await prisma.personnel.findFirst({
              where: {
                orgId: input.orgId,
                type: PersonnelType.AI,
                role: {
                  equals: spec.role,
                  mode: "insensitive"
                }
              },
              select: { id: true, name: true }
            })
          : null;

      const personnel = existing
        ? existing
        : await prisma.personnel.create({
            data: {
              orgId: input.orgId,
              type: PersonnelType.AI,
              name: spec.name,
              role: spec.role,
              expertise: spec.description,
              status: PersonnelStatus.IDLE,
              autonomyScore: 0.65
            },
            select: { id: true, name: true }
          });

      const agentId = await upsertAgentProfile({
        orgId: input.orgId,
        personnelId: personnel.id,
        graphRunId: input.graphRunId,
        mission: input.mission,
        spec
      });

      results.push({
        role: spec.role,
        personnelId: personnel.id,
        agentId,
        status: existing ? "reused" : "created"
      });
    } catch (error) {
      results.push({
        role: spec.role,
        personnelId: null,
        agentId: null,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown squad persistence error."
      });
    }
  }

  return results;
}

function buildHubUrl(input: { orgId: string; teamType: string; category: string }) {
  return `memory://org/${input.orgId}/team/${input.teamType}/${input.category}/${Date.now()}`;
}

async function initializeOrReuseHubContext(input: {
  orgId: string;
  teamType: string;
  mission: string;
  graphRunId: string;
}): Promise<HubContextResult> {
  await ensureCompanyDataFile(input.orgId);

  const recentOutputs = await prisma.file.findMany({
    where: {
      orgId: input.orgId,
      type: HubFileType.OUTPUT
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      id: true,
      metadata: true
    }
  });

  const missionEntry = recentOutputs.find((file) => {
    const metadata = asRecord(file.metadata);
    return (
      metadata.creationSource === "langgraph_team_bootstrap" &&
      metadata.teamType === input.teamType &&
      metadata.hubCategory === "mission"
    );
  });

  if (missionEntry) {
    return {
      workspaceId: input.orgId,
      existed: true,
      missionEntryId: missionEntry.id
    };
  }

  const created = await prisma.file.create({
    data: {
      orgId: input.orgId,
      name: `${input.teamType} team mission`,
      type: HubFileType.OUTPUT,
      size: BigInt(Buffer.byteLength(input.mission, "utf8")),
      url: buildHubUrl({
        orgId: input.orgId,
        teamType: input.teamType,
        category: "mission"
      }),
      health: 100,
      metadata: {
        hubScope: "ORGANIZATIONAL",
        hubCategory: "mission",
        creationSource: "langgraph_team_bootstrap",
        graphRunId: input.graphRunId,
        teamType: input.teamType,
        content: input.mission
      } as Prisma.InputJsonValue
    },
    select: { id: true }
  });

  return {
    workspaceId: input.orgId,
    existed: false,
    missionEntryId: created.id
  };
}

async function publishHubEntry(input: {
  orgId: string;
  teamType: string;
  graphRunId: string;
  category: string;
  title: string;
  content: string;
  role?: string;
}): Promise<HubEntryResult> {
  const created = await prisma.file.create({
    data: {
      orgId: input.orgId,
      name: input.title,
      type: HubFileType.OUTPUT,
      size: BigInt(Buffer.byteLength(input.content, "utf8")),
      url: buildHubUrl({
        orgId: input.orgId,
        teamType: input.teamType,
        category: input.category
      }),
      health: 100,
      metadata: {
        hubScope: "ORGANIZATIONAL",
        hubCategory: input.category,
        creationSource: "langgraph_team_bootstrap",
        graphRunId: input.graphRunId,
        teamType: input.teamType,
        role: input.role ?? null,
        content: input.content
      } as Prisma.InputJsonValue
    },
    select: { id: true }
  });

  return {
    entryId: created.id,
    category: input.category
  };
}

async function searchSharedKnowledge(input: {
  orgId: string;
  userId: string;
  query: string;
  limit: number;
}): Promise<SharedKnowledgeRef[]> {
  const hits = await searchAgentMemory({
    orgId: input.orgId,
    query: input.query,
    topK: Math.max(1, input.limit),
    filters: {
      userId: input.userId,
      includeShared: true,
      includePrivate: false
    }
  }).catch(() => []);

  return hits.map((item) => ({
    id: item.memory.id,
    source: item.memory.source,
    title: item.memory.summary || "Memory reference",
    summary: item.memory.content.slice(0, 360),
    score: item.score
  }));
}

async function executeToolRequest(input: {
  orgId: string;
  userId: string;
  request: {
    toolkit: string;
    action: string;
    arguments: Record<string, unknown>;
  };
}): Promise<ToolExecutionResult> {
  const result = await executeThroughExistingToolPath({
    orgId: input.orgId,
    userId: input.userId,
    toolkit: input.request.toolkit,
    action: input.request.action,
    arguments: input.request.arguments,
    taskId: `langgraph-${randomUUID().slice(0, 8)}`
  }, {
    executeFn: executeAgentTool
  });

  if (!result.ok) {
    return {
      ok: false,
      toolkit: input.request.toolkit,
      action: input.request.action,
      error: {
        code: result.error.code,
        message: result.error.message,
        retryable: result.error.retryable
      }
    };
  }

  return {
    ok: true,
    toolkit: result.toolkit,
    action: result.action,
    toolSlug: result.toolSlug,
    data: result.data
  };
}

async function createApprovalRequest(input: {
  orgId: string;
  reason: string;
  metadata: Record<string, unknown>;
}): Promise<ApprovalRequestResult> {
  const checkpoint = await prisma.approvalCheckpoint.create({
    data: {
      orgId: input.orgId,
      reason: input.reason,
      status: "PENDING",
      metadata: input.metadata as Prisma.InputJsonValue
    },
    select: {
      id: true,
      status: true
    }
  });

  return {
    checkpointId: checkpoint.id,
    status: checkpoint.status === "PENDING" ? "PENDING" : "APPROVED"
  };
}

async function logGraphEvent(input: {
  orgId: string;
  graphRunId: string;
  traceId: string;
  stage: string;
  latencyMs: number;
  message: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await prisma.log.create({
      data: {
        orgId: input.orgId,
        type: "EXE",
        actor: "LANGGRAPH_ORGANIZATION",
        message: `${input.message} graphRunId=${input.graphRunId}; traceId=${input.traceId}; stage=${input.stage}; latencyMs=${input.latencyMs}; metadata=${JSON.stringify(input.metadata ?? {})}`
      }
    });
  } catch {
    // Observability is best-effort.
  }
}

export function createDefaultOrganizationGraphAdapters(): OrganizationGraphAdapters {
  return {
    loadOrganizationContext,
    loadExistingSquad,
    persistSquadAgents,
    initializeOrReuseHubContext,
    publishHubEntry,
    searchSharedKnowledge,
    executeToolRequest,
    createApprovalRequest,
    logGraphEvent
  };
}
