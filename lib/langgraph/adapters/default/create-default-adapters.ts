import "server-only";

import { createHash, randomUUID } from "node:crypto";

import {
  AgentRole,
  AgentStatus,
  FlowStatus,
  HubFileType,
  MemoryTier,
  PersonnelStatus,
  PersonnelType,
  type Prisma
} from "@prisma/client";

import type {
  ApprovalRequestResult,
  DurableTaskSnapshot,
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
import { markAgentMemoriesRetrieved, searchAgentMemory } from "@/lib/agent/memory";
import { executeAgentTool } from "@/lib/agent/tools/execute";
import { prisma } from "@/lib/db/prisma";
import { ensureCompanyDataFile } from "@/lib/hub/organization-hub";
import { composioAllowlistedToolkits } from "@/lib/integrations/composio/service";
import { emitOrchestrationEvent } from "@/lib/orchestration/event-log";
import { runCompletionBarrier } from "@/lib/orchestration/completion-barrier";
import {
  assertTaskStateTransition,
  toCanonicalTaskState,
  toTaskStatusFromCanonical
} from "@/lib/orchestration/task-state-machine";
import type {
  PersistedTaskSchema,
  PersistedToolReceipt
} from "@/lib/orchestration/task-schema";
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

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function hashJson(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function normalizeDateIso(value?: string) {
  const parsed = value ? new Date(value) : new Date();
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

function normalizeTaskStateForStorage(state: PersistedTaskSchema["state"]) {
  return state;
}

function parseTaskIdFromReceiptKey(input: { runId: string; key: string }) {
  const prefix = `orchestration.tool-receipt.${input.runId}.`;
  if (!input.key.startsWith(prefix)) return "";
  const suffix = input.key.slice(prefix.length);
  const separatorIndex = suffix.indexOf(".");
  if (separatorIndex <= 0) return "";
  return suffix.slice(0, separatorIndex).trim();
}

async function resolveDbTaskIdForNormalizedTask(input: {
  orgId: string;
  runId: string;
  normalizedTaskId: string;
}) {
  const normalizedTaskId = input.normalizedTaskId.trim();
  if (!normalizedTaskId) return null;
  const row = await prisma.task.findFirst({
    where: {
      flowId: input.runId,
      flow: {
        orgId: input.orgId
      },
      executionTrace: {
        path: ["normalizedTask", "task_id"],
        equals: normalizedTaskId
      }
    },
    select: {
      id: true
    }
  });
  return row?.id ?? null;
}

function receiptMemoryKey(input: { runId: string; taskId: string; toolCallId: string }) {
  return `orchestration.tool-receipt.${input.runId}.${input.taskId}.${input.toolCallId}`;
}

function receiptIdemKey(input: { orgId: string; idempotencyKey: string }) {
  return `orchestration.tool-receipt.idem.${input.orgId}.${input.idempotencyKey}`;
}

function normalizeToolReceipts(value: unknown): PersistedToolReceipt[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      const record = asRecord(row);
      const tool_call_id = typeof record.tool_call_id === "string" ? record.tool_call_id.trim() : "";
      if (!tool_call_id) return null;
      return {
        tool_call_id,
        provider_request_id:
          typeof record.provider_request_id === "string"
            ? record.provider_request_id
            : `provider-${tool_call_id}`,
        status: typeof record.status === "string" ? record.status : "unknown",
        started_at: normalizeDateIso(typeof record.started_at === "string" ? record.started_at : undefined),
        ended_at: normalizeDateIso(typeof record.ended_at === "string" ? record.ended_at : undefined),
        normalized_output_hash:
          typeof record.normalized_output_hash === "string"
            ? record.normalized_output_hash
            : hashJson(record)
      } satisfies PersistedToolReceipt;
    })
    .filter((item): item is PersistedToolReceipt => Boolean(item));
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
  sourceRunId?: string;
  sourceTaskId: string;
  category: string;
  title: string;
  content: string;
  role?: string;
  idempotencyKey?: string;
}): Promise<HubEntryResult> {
  const sourceTaskId = input.sourceTaskId.trim();
  if (!sourceTaskId) {
    throw new Error("publishHubEntry requires sourceTaskId.");
  }
  const idempotencyKey =
    input.idempotencyKey?.trim() ||
    `hub:${input.graphRunId}:${sourceTaskId}:${input.category}:${hashJson(input.title)}`;
  const existing = await prisma.file.findFirst({
    where: {
      orgId: input.orgId,
      type: HubFileType.OUTPUT,
      metadata: {
        path: ["idempotencyKey"],
        equals: idempotencyKey
      }
    },
    select: { id: true }
  });
  if (existing) {
    return {
      entryId: existing.id,
      category: input.category
    };
  }

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
        sourceFlowId: input.sourceRunId ?? input.graphRunId,
        teamType: input.teamType,
        sourceTaskId,
        idempotencyKey,
        role: input.role ?? null,
        content: input.content
      } as unknown as Prisma.InputJsonValue
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
  await markAgentMemoriesRetrieved(hits.map((item) => item.memory.id)).catch(() => undefined);

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
    data: result.data,
    receipts: normalizeToolReceipts(
      Array.isArray((result as Record<string, unknown>).receipts)
        ? (result as Record<string, unknown>).receipts
        : []
    )
  };
}

async function createApprovalRequest(input: {
  orgId: string;
  reason: string;
  metadata: Record<string, unknown>;
  idempotencyKey: string;
  runId: string;
  taskId: string;
  policyHash: string;
}): Promise<ApprovalRequestResult> {
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey) {
    throw new Error("createApprovalRequest requires idempotencyKey.");
  }
  const dbTaskId = await resolveDbTaskIdForNormalizedTask({
    orgId: input.orgId,
    runId: input.runId,
    normalizedTaskId: input.taskId
  });

  const existing = await prisma.approvalCheckpoint.findFirst({
    where: {
      orgId: input.orgId,
      metadata: {
        path: ["idempotencyKey"],
        equals: idempotencyKey
      }
    },
    select: {
      id: true,
      status: true
    }
  });
  if (existing) {
    const status =
      existing.status === "PENDING" ||
      existing.status === "APPROVED" ||
      existing.status === "REJECTED" ||
      existing.status === "EXPIRED"
        ? existing.status
        : "PENDING";
    return {
      checkpointId: existing.id,
      status,
      idempotencyKey
    };
  }

  const checkpoint = await prisma.approvalCheckpoint.create({
    data: {
      orgId: input.orgId,
      reason: input.reason,
      status: "PENDING",
      flowId: input.runId,
      taskId: dbTaskId,
      metadata: {
        ...input.metadata,
        idempotencyKey,
        runId: input.runId,
        taskId: dbTaskId,
        normalizedTaskId: input.taskId,
        policyHash: input.policyHash
      } as Prisma.InputJsonValue
    },
    select: {
      id: true,
      status: true
    }
  });

  return {
    checkpointId: checkpoint.id,
    status: checkpoint.status === "PENDING" ? "PENDING" : "APPROVED",
    idempotencyKey
  };
}

async function ensureDurableRun(input: {
  orgId: string;
  userId: string;
  graphRunId: string;
  prompt: string;
}) {
  const mappingKey = `langgraph.run.flow.${input.graphRunId}`;
  const existingMapping = await prisma.memoryEntry.findFirst({
    where: {
      orgId: input.orgId,
      tier: MemoryTier.WORKING,
      key: mappingKey,
      redactedAt: null
    },
    orderBy: { createdAt: "desc" },
    select: {
      value: true
    }
  });
  const mappedRunId = (() => {
    const value = asRecord(existingMapping?.value);
    return typeof value.runId === "string" ? value.runId.trim() : "";
  })();
  if (mappedRunId) {
    const existing = await prisma.flow.findUnique({
      where: { id: mappedRunId },
      select: { id: true, orgId: true }
    });
    if (existing && existing.orgId === input.orgId) {
      return { runId: existing.id };
    }
  }

  const created = await prisma.flow.create({
    data: {
      orgId: input.orgId,
      prompt: input.prompt,
      status: FlowStatus.ACTIVE,
      progress: 0,
      predictedBurn: 0,
      requiredSignatures: 1
    },
    select: { id: true }
  });
  await prisma.memoryEntry.create({
    data: {
      orgId: input.orgId,
      flowId: created.id,
      tier: MemoryTier.WORKING,
      key: mappingKey,
      value: {
        runId: created.id,
        userId: input.userId,
        graphRunId: input.graphRunId,
        createdAt: new Date().toISOString()
      } as Prisma.InputJsonValue
    }
  });
  return { runId: created.id };
}

async function persistDurableTasks(input: {
  orgId: string;
  runId: string;
  tasks: PersistedTaskSchema[];
}): Promise<DurableTaskSnapshot[]> {
  for (const task of input.tasks) {
    const existing = await prisma.task.findFirst({
      where: {
        flowId: input.runId,
        executionTrace: {
          path: ["normalizedTask", "task_id"],
          equals: task.task_id
        }
      },
      select: {
        id: true,
        prompt: true,
        status: true,
        isPausedForInput: true,
        executionTrace: true
      }
    });

    if (!existing) {
      await prisma.task.create({
        data: {
          flowId: input.runId,
          prompt: task.objective,
          status: toTaskStatusFromCanonical(task.state),
          isPausedForInput: task.state === "BLOCKED",
          requiredFiles: task.inputs
            .filter((item) => item.ref_type === "hub_file" && typeof item.ref_id === "string")
            .map((item) => item.ref_id as string),
          executionTrace: toInputJsonValue({
            normalizedTask: {
              ...task,
              state: normalizeTaskStateForStorage(task.state)
            }
          })
        }
      });
    }
  }

  return readDurableTaskSnapshots({
    orgId: input.orgId,
    runId: input.runId
  });
}

async function readDurableTaskSnapshots(input: {
  orgId: string;
  runId: string;
}): Promise<DurableTaskSnapshot[]> {
  const tasks = await prisma.task.findMany({
    where: {
      flowId: input.runId,
      flow: {
        orgId: input.orgId
      }
    },
    select: {
      id: true,
      prompt: true,
      status: true,
      isPausedForInput: true,
      executionTrace: true
    },
    orderBy: { createdAt: "asc" }
  });

  const outputs = await prisma.file.findMany({
    where: {
      orgId: input.orgId,
      type: HubFileType.OUTPUT,
      metadata: {
        path: ["sourceFlowId"],
        equals: input.runId
      }
    },
    orderBy: {
      updatedAt: "desc"
    },
    select: {
      id: true,
      metadata: true
    }
  });
  const outputByTaskId = new Map<string, { fileId: string; payload: Record<string, unknown> | null }>();
  for (const file of outputs) {
    const meta = asRecord(file.metadata);
    const sourceTaskId = typeof meta.sourceTaskId === "string" ? meta.sourceTaskId.trim() : "";
    if (!sourceTaskId || outputByTaskId.has(sourceTaskId)) continue;
    const payloadFromMeta =
      typeof meta.outputPayload === "object" && meta.outputPayload && !Array.isArray(meta.outputPayload)
        ? (meta.outputPayload as Record<string, unknown>)
        : typeof meta.content === "string"
          ? { content: meta.content }
          : null;
    outputByTaskId.set(sourceTaskId, {
      fileId: file.id,
      payload: payloadFromMeta
    });
  }

  const receipts = await prisma.memoryEntry.findMany({
    where: {
      orgId: input.orgId,
      flowId: input.runId,
      tier: MemoryTier.WORKING,
      key: {
        startsWith: `orchestration.tool-receipt.${input.runId}.`
      },
      redactedAt: null
    },
    orderBy: { createdAt: "asc" },
    select: {
      key: true,
      value: true
    }
  });
  const receiptsByTaskId = new Map<string, PersistedToolReceipt[]>();
  for (const row of receipts) {
    const taskId = parseTaskIdFromReceiptKey({
      runId: input.runId,
      key: row.key
    });
    if (!taskId) continue;
    const receipt = asRecord(row.value).receipt;
    const list = receiptsByTaskId.get(taskId) ?? [];
    list.push(...normalizeToolReceipts(receipt ? [receipt] : []));
    receiptsByTaskId.set(taskId, list);
  }

  return tasks.map((task) => {
    const trace = asRecord(task.executionTrace);
    const normalizedTask = asRecord(trace.normalizedTask);
    const taskKey =
      typeof normalizedTask.task_id === "string" && normalizedTask.task_id.trim().length > 0
        ? normalizedTask.task_id
        : task.id;
    const state = toCanonicalTaskState({
      taskStatus: task.status,
      isPausedForInput: task.isPausedForInput,
      traceState: normalizedTask.state
    });
    const attemptsRaw = normalizedTask.attempts;
    const attempts =
      typeof attemptsRaw === "number" && Number.isFinite(attemptsRaw)
        ? Math.max(0, Math.floor(attemptsRaw))
        : 0;
    const traceOutputPayload =
      typeof normalizedTask.outputPayload === "object" &&
      normalizedTask.outputPayload &&
      !Array.isArray(normalizedTask.outputPayload)
        ? (normalizedTask.outputPayload as Record<string, unknown>)
        : null;
    const traceOutputFileId =
      typeof normalizedTask.outputFileId === "string" ? normalizedTask.outputFileId : null;
    const output = outputByTaskId.get(taskKey) ?? {
      fileId: traceOutputFileId,
      payload: traceOutputPayload
    };
    return {
      taskId: taskKey,
      state,
      attempts,
      objective:
        typeof normalizedTask.objective === "string" && normalizedTask.objective.trim().length > 0
          ? normalizedTask.objective
          : task.prompt,
      output: {
        outputFileId: output.fileId,
        payload: output.payload
      },
      toolReceipts: receiptsByTaskId.get(taskKey) ?? [],
      waived: normalizedTask.waived === true
    } satisfies DurableTaskSnapshot;
  });
}

async function markDurableTaskState(input: {
  orgId: string;
  runId: string;
  taskId: string;
  nextState: PersistedTaskSchema["state"];
  attempts?: number;
  outputFileId?: string | null;
  outputPayload?: Record<string, unknown> | null;
  waived?: boolean;
}): Promise<DurableTaskSnapshot | null> {
  const task = await prisma.task.findFirst({
    where: {
      flowId: input.runId,
      flow: {
        orgId: input.orgId
      },
      executionTrace: {
        path: ["normalizedTask", "task_id"],
        equals: input.taskId
      }
    },
    select: {
      id: true,
      prompt: true,
      status: true,
      isPausedForInput: true,
      executionTrace: true
    }
  });
  if (!task) {
    return null;
  }

  const trace = asRecord(task.executionTrace);
  const normalizedTask = asRecord(trace.normalizedTask);
  const currentState = toCanonicalTaskState({
    taskStatus: task.status,
    isPausedForInput: task.isPausedForInput,
    traceState: normalizedTask.state
  });
  assertTaskStateTransition(currentState, input.nextState);
  const nextAttempts =
    typeof input.attempts === "number" && Number.isFinite(input.attempts)
      ? Math.max(0, Math.floor(input.attempts))
      : typeof normalizedTask.attempts === "number" && Number.isFinite(normalizedTask.attempts)
        ? Math.max(0, Math.floor(normalizedTask.attempts))
        : 0;
  const updatedTrace = toInputJsonValue({
    ...trace,
    normalizedTask: {
      ...normalizedTask,
      task_id: input.taskId,
      objective: typeof normalizedTask.objective === "string" ? normalizedTask.objective : task.prompt,
      state: input.nextState,
      attempts: nextAttempts,
      updated_at: new Date().toISOString(),
      ...(input.waived !== undefined ? { waived: input.waived } : {}),
      ...(input.outputFileId !== undefined ? { outputFileId: input.outputFileId } : {}),
      ...(input.outputPayload !== undefined ? { outputPayload: input.outputPayload } : {})
    }
  });

  await prisma.task.update({
    where: { id: task.id },
    data: {
      status: toTaskStatusFromCanonical(input.nextState),
      isPausedForInput: input.nextState === "BLOCKED",
      humanInterventionReason:
        input.nextState === "BLOCKED" ? "Blocked pending approval or dependency." : null,
      executionTrace: updatedTrace
    }
  });

  const snapshots = await readDurableTaskSnapshots({
    orgId: input.orgId,
    runId: input.runId
  });
  return snapshots.find((item) => item.taskId === input.taskId) ?? null;
}

async function upsertToolReceipt(input: {
  orgId: string;
  runId: string;
  taskId: string;
  receipt: PersistedToolReceipt;
  idempotencyKey: string;
}): Promise<PersistedToolReceipt> {
  const normalized = normalizeToolReceipts([input.receipt])[0];
  if (!normalized) {
    throw new Error("Invalid tool receipt.");
  }

  const idem = receiptIdemKey({
    orgId: input.orgId,
    idempotencyKey: input.idempotencyKey
  });
  const existingIdem = await prisma.memoryEntry.findFirst({
    where: {
      orgId: input.orgId,
      tier: MemoryTier.WORKING,
      key: idem,
      redactedAt: null
    },
    select: { id: true }
  });
  if (!existingIdem) {
    await prisma.memoryEntry.createMany({
      data: [
        {
          orgId: input.orgId,
          flowId: input.runId,
          taskId: null,
          tier: MemoryTier.WORKING,
          key: idem,
          value: {
            idempotencyKey: input.idempotencyKey
          } as Prisma.InputJsonValue
        },
        {
          orgId: input.orgId,
          flowId: input.runId,
          taskId: null,
          tier: MemoryTier.WORKING,
          key: receiptMemoryKey({
            runId: input.runId,
            taskId: input.taskId,
            toolCallId: normalized.tool_call_id
          }),
          value: toInputJsonValue({
            receipt: normalized
          })
        }
      ]
    });
  }

  return normalized;
}

async function verifyTaskReceipts(input: {
  orgId: string;
  runId: string;
  taskId: string;
}) {
  const task = await prisma.task.findFirst({
    where: {
      flowId: input.runId,
      flow: {
        orgId: input.orgId
      },
      executionTrace: {
        path: ["normalizedTask", "task_id"],
        equals: input.taskId
      }
    },
    select: {
      executionTrace: true
    }
  });
  if (!task) {
    return {
      ok: false,
      missingToolCallIds: [input.taskId],
      receipts: [] as PersistedToolReceipt[]
    };
  }
  const trace = asRecord(task.executionTrace);
  const normalizedTask = asRecord(trace.normalizedTask);
  const toolPlan = Array.isArray(normalizedTask.tool_plan) ? normalizedTask.tool_plan : [];
  const requiredCalls = toolPlan.map((row) => {
    const item = asRecord(row);
    const toolkit = typeof item.toolkit === "string" ? item.toolkit.trim().toLowerCase() : "internal";
    const action = typeof item.action === "string" ? item.action.trim().toUpperCase() : "TASK_EXECUTION";
    return `internal-${input.taskId}-${toolkit}:${action}`;
  });

  const rows = await prisma.memoryEntry.findMany({
    where: {
      orgId: input.orgId,
      flowId: input.runId,
      tier: MemoryTier.WORKING,
      key: {
        startsWith: `orchestration.tool-receipt.${input.runId}.${input.taskId}.`
      },
      redactedAt: null
    },
    orderBy: { createdAt: "asc" },
    select: {
      value: true
    }
  });
  const receipts = rows.flatMap((row) => normalizeToolReceipts([asRecord(row.value).receipt]));
  const present = new Set(receipts.map((receipt) => receipt.tool_call_id));
  const missingToolCallIds = requiredCalls.filter((required) => {
    const looseMatch = [...present].some((candidate) => candidate.includes(required.split("-").slice(2).join("-")));
    return !present.has(required) && !looseMatch;
  });

  return {
    ok: missingToolCallIds.length === 0 && receipts.length > 0,
    missingToolCallIds,
    receipts
  };
}

async function appendOrchestrationEvent(input: {
  orgId: string;
  runId: string;
  taskId: string;
  attempt: number;
  agentId: string;
  eventType: Parameters<typeof emitOrchestrationEvent>[0]["eventType"];
  idempotencyKey?: string;
  payload?: Record<string, unknown>;
}) {
  await emitOrchestrationEvent({
    orgId: input.orgId,
    runId: input.runId,
    taskId: input.taskId,
    attempt: input.attempt,
    agentId: input.agentId,
    eventType: input.eventType,
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    ...(input.payload ? { payload: input.payload } : {})
  });
}

async function runCompletionBarrierAdapter(input: { orgId: string; runId: string }) {
  const barrier = await runCompletionBarrier(input);
  const snapshots = await readDurableTaskSnapshots(input);
  return {
    ok: barrier.ok,
    blockingTaskIds: barrier.blockingTaskIds,
    report: snapshots
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
    ensureDurableRun,
    persistDurableTasks,
    readDurableTaskSnapshots,
    markDurableTaskState,
    upsertToolReceipt,
    verifyTaskReceipts,
    appendOrchestrationEvent,
    runCompletionBarrier: runCompletionBarrierAdapter,
    logGraphEvent
  };
}
