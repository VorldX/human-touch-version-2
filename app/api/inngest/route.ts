import { createHash } from "node:crypto";

import {
  FlowStatus,
  HubFileType,
  LogType,
  PersonnelStatus,
  Prisma,
  SpendEventType,
  TaskStatus
} from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { createDeterministicEmbedding, toPgVectorLiteral } from "@/lib/ai/embeddings";
import { executeSwarmAgent, type AgentContextBlock } from "@/lib/ai/swarm-runtime";
import { getOrgLlmRuntime } from "@/lib/ai/org-llm-settings";
import { featureFlags } from "@/lib/config/feature-flags";
import { prisma } from "@/lib/db/prisma";
import { recordPassivePolicy, recordPassiveSpend } from "@/lib/enterprise/passive";
import { readLocalUploadByUrl, toPreviewText } from "@/lib/hub/storage";
import { getToolsForAgent, inferRequestedToolkits } from "@/lib/integrations/composio/service";
import { publishRealtimeEvent } from "@/lib/realtime/publish";
import { createJoltProofStub } from "@/lib/security/crypto";
import { buildInternalApiHeaders, resolveInternalApiKey } from "@/lib/security/internal-api";

interface InboundEvent {
  name?: string;
  data?: Record<string, unknown>;
}

interface EventHandleResult {
  ok: boolean;
  ignored?: boolean;
  reason?: string;
  error?: string;
  [key: string]: unknown;
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

interface HubLockSnapshot {
  lockId: string;
  fileId: string;
  fileName: string;
  lockOwnerTaskId: string | null;
  lockOwnerAgent: string | null;
  acquiredAt: Date;
}

class HubLockConflictError extends Error {
  readonly conflicts: HubLockSnapshot[];

  constructor(conflicts: HubLockSnapshot[]) {
    super("Hub file lock conflict.");
    this.conflicts = conflicts;
  }
}

async function acquireTaskFileLocks(input: {
  orgId: string;
  taskId: string;
  agentId?: string | null;
  fileIds: string[];
}) {
  const uniqueFileIds = [...new Set(input.fileIds.map((id) => id.trim()).filter(Boolean))];
  if (uniqueFileIds.length === 0) {
    return { ok: true as const, conflicts: [] as HubLockSnapshot[] };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const conflicts: HubLockSnapshot[] = [];
      const acquiredFileNames: string[] = [];

      for (const fileId of uniqueFileIds) {
        // Keep lock checking deterministic and race-safe within one transaction.
        // eslint-disable-next-line no-await-in-loop
        const activeLock = await tx.hubFileLock.findFirst({
          where: {
            orgId: input.orgId,
            fileId,
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
          orderBy: { acquiredAt: "asc" }
        });

        if (activeLock && activeLock.taskId !== input.taskId) {
          conflicts.push({
            lockId: activeLock.id,
            fileId: activeLock.fileId,
            fileName: activeLock.file.name,
            lockOwnerTaskId: activeLock.taskId ?? null,
            lockOwnerAgent: activeLock.agent?.name ?? null,
            acquiredAt: activeLock.acquiredAt
          });
          continue;
        }

        if (!activeLock) {
          // eslint-disable-next-line no-await-in-loop
          const file = await tx.file.findUnique({
            where: { id: fileId },
            select: {
              id: true,
              name: true
            }
          });

          if (!file) {
            continue;
          }

          // eslint-disable-next-line no-await-in-loop
          await tx.hubFileLock.create({
            data: {
              orgId: input.orgId,
              fileId: file.id,
              taskId: input.taskId,
              agentId: input.agentId ?? null,
              reason: "Task execution lock."
            }
          });

          acquiredFileNames.push(file.name);
        }
      }

      if (conflicts.length > 0) {
        throw new HubLockConflictError(conflicts);
      }

      if (acquiredFileNames.length > 0) {
        await tx.log.create({
          data: {
            orgId: input.orgId,
            type: LogType.EXE,
            actor: "HUB_LOCK",
            message: `Task ${input.taskId} acquired file lock(s): ${acquiredFileNames.join(", ")}.`
          }
        });
      }
    });

    return { ok: true as const, conflicts: [] as HubLockSnapshot[] };
  } catch (error) {
    if (error instanceof HubLockConflictError) {
      return { ok: false as const, conflicts: error.conflicts };
    }
    throw error;
  }
}

async function releaseTaskFileLocks(input: {
  orgId: string;
  taskId: string;
  reason: string;
  tx?: Prisma.TransactionClient | typeof prisma;
}) {
  const db = input.tx ?? prisma;
  const released = await db.hubFileLock.updateMany({
    where: {
      orgId: input.orgId,
      taskId: input.taskId,
      releasedAt: null
    },
    data: {
      releasedAt: new Date()
    }
  });

  if (released.count > 0) {
    await db.log.create({
      data: {
        orgId: input.orgId,
        type: LogType.EXE,
        actor: "HUB_LOCK",
        message: `${input.reason} Released ${released.count} file lock(s) for task ${input.taskId}.`
      }
    });
  }

  return released.count;
}

interface TaskContextResolution {
  contextBlocks: AgentContextBlock[];
  missingFiles: string[];
  amnesiaProofs: string[];
  resolvedRequiredFileIds: string[];
  fileRefs: Array<{
    id: string;
    name: string;
    type: HubFileType;
    amnesiaProtected: boolean;
    source: string;
  }>;
}

async function resolveTaskContext(orgId: string, requiredFiles: string[]): Promise<TaskContextResolution> {
  const requested = requiredFiles
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const requestedRefs = new Set(requested);

  const files =
    requested.length > 0
      ? await prisma.file.findMany({
          where: {
            orgId,
            OR: [{ id: { in: requested } }, { url: { in: requested } }]
          },
          orderBy: { updatedAt: "desc" }
        })
      : await prisma.file.findMany({
          where: {
            orgId,
            type: {
              in: [HubFileType.INPUT, HubFileType.DNA]
            }
          },
          orderBy: { updatedAt: "desc" },
          take: 3
        });

  const foundRefs = new Set<string>();
  for (const file of files) {
    foundRefs.add(file.id);
    foundRefs.add(file.url);
  }

  const missingFiles = requested.filter((item) => !foundRefs.has(item));
  const contextBlocks: AgentContextBlock[] = [];
  const amnesiaProofs: string[] = [];
  const fileRefs: TaskContextResolution["fileRefs"] = [];
  const resolvedRequiredFileIds = new Set<string>();

  for (const file of files) {
    if (requestedRefs.has(file.id) || requestedRefs.has(file.url)) {
      resolvedRequiredFileIds.add(file.id);
    }

    fileRefs.push({
      id: file.id,
      name: file.name,
      type: file.type,
      amnesiaProtected: file.isAmnesiaProtected,
      source: file.url
    });

    if (file.isAmnesiaProtected) {
      const digest = createHash("sha256")
        .update(`${file.id}|${file.url}|${file.size.toString()}`)
        .digest("hex");
      const proof = await createJoltProofStub({
        taskId: file.id,
        digest,
        policy: "amnesia-zero-retention"
      });
      amnesiaProofs.push(proof);
      contextBlocks.push({
        id: file.id,
        name: file.name,
        amnesiaProtected: true,
        content: `Amnesia protected file ${file.name}. digest=${digest}. Do not persist raw content.`
      });
      continue;
    }

    let sourceText = "";
    const localBytes = await readLocalUploadByUrl(file.url);
    if (localBytes) {
      sourceText = toPreviewText(localBytes, 6000);
    } else if (/^https?:\/\//.test(file.url)) {
      try {
        const response = await fetch(file.url, { cache: "no-store" });
        sourceText = (await response.text()).slice(0, 6000);
      } catch {
        sourceText = "";
      }
    }

    contextBlocks.push({
      id: file.id,
      name: file.name,
      amnesiaProtected: false,
      content: sourceText || `File available at ${file.url}.`
    });
  }

  return {
    contextBlocks,
    missingFiles,
    amnesiaProofs,
    resolvedRequiredFileIds: [...resolvedRequiredFileIds],
    fileRefs
  };
}

function parseRequestedToolkitsFromTrace(trace: unknown) {
  if (!trace || typeof trace !== "object" || Array.isArray(trace)) {
    return [] as string[];
  }
  const record = trace as Record<string, unknown>;
  if (!Array.isArray(record.requestedToolkits)) {
    return [] as string[];
  }
  return [...new Set(record.requestedToolkits
    .map((item) => (typeof item === "string" ? item.trim().toLowerCase() : ""))
    .filter(Boolean))];
}

interface AgentToolActionRequest {
  toolkit: string;
  action: string;
  arguments: Record<string, unknown>;
}

interface ToolActionExecutionSuccess {
  ok: true;
  toolkit: string;
  action: string;
  toolSlug: string;
  data: Record<string, unknown>;
  logId: string | null;
  attempts: number;
}

interface ToolActionExecutionFailure {
  ok: false;
  attempts: number;
  error: {
    code: string;
    message: string;
    toolkit: string;
    action: string;
    connectUrl?: string;
    retryable?: boolean;
  };
}

type ToolActionExecutionResult = ToolActionExecutionSuccess | ToolActionExecutionFailure;

function inferAgentToolAction(prompt: string, requestedToolkits: string[]): AgentToolActionRequest | null {
  const normalized = prompt.toLowerCase();
  const gmailRequested = requestedToolkits.includes("gmail");
  if (!gmailRequested) {
    return null;
  }

  // MVP behavior: if task mentions inbox/email fetch semantics, call Gmail fetch.
  const asksForMailboxRead = /gmail|email|inbox/.test(normalized);
  const asksForList = /list|latest|recent|last|show|fetch|check|read/.test(normalized);
  if (!asksForMailboxRead || !asksForList) {
    return null;
  }

  const limitMatch = normalized.match(/(?:last|latest|recent)\s+(\d{1,2})/i);
  const parsedLimit = limitMatch?.[1] ? Number.parseInt(limitMatch[1], 10) : 5;
  const limit =
    Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 25) : 5;

  return {
    toolkit: "gmail",
    action: "LIST_RECENT_EMAILS",
    arguments: {
      limit
    }
  };
}

function resolveAgentExecutionKey() {
  return resolveInternalApiKey();
}

async function resolveExecutionUserId(orgId: string, preferredUserId?: string | null) {
  if (preferredUserId) {
    const membership = await prisma.orgMember.findFirst({
      where: {
        orgId,
        userId: preferredUserId
      },
      select: {
        userId: true
      }
    });
    if (membership?.userId) {
      return membership.userId;
    }
  }

  const fallback = await prisma.orgMember.findFirst({
    where: { orgId },
    orderBy: {
      createdAt: "asc"
    },
    select: {
      userId: true
    }
  });

  return fallback?.userId ?? null;
}

function buildVirtualMainAgent(orgId: string) {
  return {
    id: `main-agent-proxy:${orgId}`,
    name: "Main Agent",
    role: "Main Orchestrator",
    brainConfig: {},
    fallbackBrainConfig: {},
    brainKeyEnc: null,
    brainKeyIv: null,
    brainKeyAuthTag: null,
    brainKeyKeyVer: null,
    fallbackBrainKeyEnc: null,
    fallbackBrainKeyIv: null,
    fallbackBrainKeyAuthTag: null,
    fallbackBrainKeyKeyVer: null
  };
}

async function executeTaskById(
  taskId: string,
  orgId: string,
  orchestratorUserIdHint?: string | null,
  origin?: string
): Promise<EventHandleResult> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      flow: {
        select: {
          id: true,
          orgId: true
        }
      },
      agent: {
        select: {
          id: true,
          name: true,
          role: true,
          brainConfig: true,
          fallbackBrainConfig: true,
          brainKeyEnc: true,
          brainKeyIv: true,
          brainKeyAuthTag: true,
          brainKeyKeyVer: true,
          fallbackBrainKeyEnc: true,
          fallbackBrainKeyIv: true,
          fallbackBrainKeyAuthTag: true,
          fallbackBrainKeyKeyVer: true
        }
      }
    }
  });

  if (!task || task.flow.orgId !== orgId) {
    return { ok: false, error: "Task not found for org." };
  }

  if (
    task.status === TaskStatus.COMPLETED ||
    task.status === TaskStatus.FAILED ||
    task.status === TaskStatus.ABORTED
  ) {
    return { ok: true, ignored: true, reason: "Task is already terminal." };
  }

  let agent = task.agent;
  if (!agent) {
    agent =
      (await prisma.personnel.findFirst({
        where: {
          orgId,
          type: "AI",
          role: { contains: "Main", mode: "insensitive" },
          status: { not: PersonnelStatus.DISABLED }
        },
        select: {
          id: true,
          name: true,
          role: true,
          brainConfig: true,
          fallbackBrainConfig: true,
          brainKeyEnc: true,
          brainKeyIv: true,
          brainKeyAuthTag: true,
          brainKeyKeyVer: true,
          fallbackBrainKeyEnc: true,
          fallbackBrainKeyIv: true,
          fallbackBrainKeyAuthTag: true,
          fallbackBrainKeyKeyVer: true
        }
      })) ??
      (await prisma.personnel.findFirst({
        where: {
          orgId,
          type: "AI",
          role: { contains: "Boss", mode: "insensitive" },
          status: { not: PersonnelStatus.DISABLED }
        },
        select: {
          id: true,
          name: true,
          role: true,
          brainConfig: true,
          fallbackBrainConfig: true,
          brainKeyEnc: true,
          brainKeyIv: true,
          brainKeyAuthTag: true,
          brainKeyKeyVer: true,
          fallbackBrainKeyEnc: true,
          fallbackBrainKeyIv: true,
          fallbackBrainKeyAuthTag: true,
          fallbackBrainKeyKeyVer: true
        }
      })) ??
      (await prisma.personnel.findFirst({
        where: {
          orgId,
          type: "AI",
          status: { not: PersonnelStatus.DISABLED }
        },
        orderBy: {
          updatedAt: "desc"
        },
        select: {
          id: true,
          name: true,
          role: true,
          brainConfig: true,
          fallbackBrainConfig: true,
          brainKeyEnc: true,
          brainKeyIv: true,
          brainKeyAuthTag: true,
          brainKeyKeyVer: true,
          fallbackBrainKeyEnc: true,
          fallbackBrainKeyIv: true,
          fallbackBrainKeyAuthTag: true,
          fallbackBrainKeyKeyVer: true
        }
      }));

    if (agent) {
      await prisma.task.update({
        where: { id: task.id },
        data: { agentId: agent.id }
      });
    }
  }

  if (!agent) {
    agent = buildVirtualMainAgent(orgId);
    await prisma.log.create({
      data: {
        orgId,
        type: LogType.SYS,
        actor: "MAIN_AGENT_ORCHESTRATOR",
        message: `Task ${task.id} executing in Main Agent fallback mode because no active AI personnel were available.`
      }
    });
  }

  const context = await resolveTaskContext(orgId, task.requiredFiles);
  if (context.missingFiles.length > 0) {
    return handleEvent({
      name: "vorldx/task.paused",
      data: {
        orgId,
        taskId: task.id,
        reason: `Missing required files: ${context.missingFiles.join(", ")}`
      }
    }, origin);
  }

  let traceRecord = asRecord(task.executionTrace);
  const traceToolkits = parseRequestedToolkitsFromTrace(task.executionTrace);
  const promptToolkits = inferRequestedToolkits(task.prompt);
  const requestedToolkits = [...new Set([...traceToolkits, ...promptToolkits])];

  const hasToolAccessLedger = Boolean(asRecord(traceRecord.toolAccessLedger).requestedAt);
  if (requestedToolkits.length > 0 && !hasToolAccessLedger) {
    const toolAccessLedger = {
      requestedAt: new Date().toISOString(),
      requestedToolkits,
      action: "TASK_EXECUTION"
    };
    traceRecord = {
      ...traceRecord,
      requestedToolkits,
      toolAccessLedger
    };

    await prisma.$transaction(async (tx) => {
      await tx.task.update({
        where: { id: task.id },
        data: {
          executionTrace: toInputJsonValue(traceRecord)
        }
      });

      await tx.log.create({
        data: {
          orgId,
          type: LogType.NET,
          actor: "TOOL_ACCESS_LEDGER",
          message: `Task ${task.id} requested toolkit access: ${requestedToolkits.join(", ")}.`
        }
      });

      await recordPassivePolicy(
        {
          orgId,
          subjectType: "TOOL_ACCESS_REQUEST",
          subjectId: task.id,
          riskScore: 0.22,
          reason: "Task requested external integration toolkit access.",
          meta: toInputJsonValue({
            flowId: task.flowId,
            action: "TASK_EXECUTION",
            requestedToolkits
          })
        },
        tx
      );
    });
  }

  const traceInitiatedByUserId =
    typeof traceRecord.initiatedByUserId === "string" ? traceRecord.initiatedByUserId.trim() : "";
  const executionUserId = await resolveExecutionUserId(
    orgId,
    orchestratorUserIdHint || traceInitiatedByUserId || null
  );

  let toolBindings: Array<{
    toolkit: string;
    slug: string;
    name: string;
    description: string;
  }> = [];
  if (requestedToolkits.length > 0 && !executionUserId) {
    const integrationError = {
      code: "INTEGRATION_NOT_CONNECTED" as const,
      toolkit: requestedToolkits[0],
      action: "TASK_EXECUTION"
    };
    return handleEvent({
      name: "vorldx/task.paused",
      data: {
        orgId,
        taskId: task.id,
        reason: `Tool integration "${requestedToolkits[0]}" is required before this task can continue.`,
        integrationError,
        executionTrace: {
          requestedToolkits,
          integrationError
        }
      }
    }, origin);
  }

  if (requestedToolkits.length > 0 && executionUserId) {
    try {
      const toolsForAgent = await getToolsForAgent({
        userId: executionUserId,
        orgId,
        requestedToolkits,
        action: "TASK_EXECUTION"
      });

      if (!toolsForAgent.ok && toolsForAgent.error) {
        return handleEvent({
          name: "vorldx/task.paused",
          data: {
            orgId,
            taskId: task.id,
            reason: `Tool integration "${toolsForAgent.error.toolkit}" is not connected.`,
            integrationError: toolsForAgent.error,
            executionTrace: {
              requestedToolkits,
              integrationError: toolsForAgent.error
            }
          }
        }, origin);
      }

      toolBindings = toolsForAgent.bindings;
    } catch (error) {
      const toolkit = requestedToolkits[0] ?? "unknown";
      return handleEvent({
        name: "vorldx/task.paused",
        data: {
          orgId,
          taskId: task.id,
          reason: "Tool integrations are temporarily unavailable. Please retry shortly.",
          integrationError: {
            code: "INTEGRATION_NOT_CONNECTED",
            toolkit,
            action: "TASK_EXECUTION"
          },
          executionTrace: {
            requestedToolkits,
            integrationFailure:
              error instanceof Error ? error.message : "Integration resolver unavailable."
          }
        }
      }, origin);
    }
  }

  const inferredToolAction = inferAgentToolAction(task.prompt, requestedToolkits);
  let toolActionExecution: ToolActionExecutionResult | null = null;

  if (inferredToolAction && executionUserId && origin) {
    try {
      const internalKey = resolveAgentExecutionKey();
      const executeResponse = await fetch(`${origin}/api/agent/tools/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildInternalApiHeaders(),
          ...(internalKey ? { "x-agent-exec-key": internalKey } : {})
        },
        body: JSON.stringify({
          orgId,
          userId: executionUserId,
          toolkit: inferredToolAction.toolkit,
          action: inferredToolAction.action,
          arguments: inferredToolAction.arguments,
          taskId: task.id
        }),
        cache: "no-store"
      });

      const executePayload = (await executeResponse.json().catch(() => null)) as
        | {
            ok?: boolean;
            result?: ToolActionExecutionResult;
            error?: {
              code?: string;
              message?: string;
              toolkit?: string;
              action?: string;
              connectUrl?: string;
            };
            attempts?: number;
          }
        | null;

      if (!executeResponse.ok || !executePayload?.ok || !executePayload.result) {
        const integrationError =
          executePayload?.error?.code === "INTEGRATION_NOT_CONNECTED"
            ? {
                code: "INTEGRATION_NOT_CONNECTED" as const,
                toolkit: executePayload.error.toolkit || inferredToolAction.toolkit,
                action: executePayload.error.action || inferredToolAction.action,
                ...(executePayload.error.connectUrl
                  ? { connectUrl: executePayload.error.connectUrl }
                  : {})
              }
            : null;

        if (integrationError) {
          return handleEvent({
            name: "vorldx/task.paused",
            data: {
              orgId,
              taskId: task.id,
              reason: `Tool integration "${integrationError.toolkit}" is not connected.`,
              integrationError,
              executionTrace: {
                requestedToolkits,
                integrationError
              }
            }
          }, origin);
        }

        toolActionExecution = {
          ok: false,
          attempts: executePayload?.attempts ?? 1,
          error: {
            code: executePayload?.error?.code || "TOOLS_UNAVAILABLE",
            message: executePayload?.error?.message || "Tool execution endpoint failed.",
            toolkit: inferredToolAction.toolkit,
            action: inferredToolAction.action
          }
        };
      } else {
        toolActionExecution = executePayload.result;
      }
    } catch (error) {
      toolActionExecution = {
        ok: false,
        attempts: 1,
        error: {
          code: "TOOLS_UNAVAILABLE",
          message: error instanceof Error ? error.message : "Tool execution endpoint failed.",
          toolkit: inferredToolAction.toolkit,
          action: inferredToolAction.action
        }
      };
    }
  }

  const lockResult = await acquireTaskFileLocks({
    orgId,
    taskId: task.id,
    agentId: agent.id,
    fileIds: context.resolvedRequiredFileIds
  });

  if (!lockResult.ok) {
    const blocking = lockResult.conflicts[0];
    const blockedReason = blocking
      ? `Required file "${blocking.fileName}" is locked by ${blocking.lockOwnerAgent ?? "another agent"}${blocking.lockOwnerTaskId ? ` (task ${blocking.lockOwnerTaskId})` : ""}.`
      : "Required file lock is currently held by another task.";

    return handleEvent({
      name: "vorldx/task.paused",
      data: {
        orgId,
        taskId: task.id,
        reason: blockedReason
      }
    }, origin);
  }

  await prisma.$transaction(async (tx) => {
    await tx.task.update({
      where: { id: task.id },
      data: {
        status: TaskStatus.RUNNING,
        isPausedForInput: false,
        humanInterventionReason: null
      }
    });

    await tx.flow.update({
      where: { id: task.flowId },
      data: {
        status: FlowStatus.ACTIVE
      }
    });

    await tx.log.create({
      data: {
        orgId,
        type: LogType.EXE,
        actor: "SWARM_RUNTIME",
        message: `Task ${task.id} executing on agent ${agent.name} (${agent.role}).`
      }
    });

    if (context.amnesiaProofs.length > 0) {
      await tx.log.create({
        data: {
          orgId,
          type: LogType.SCRUB,
          actor: "AMNESIA_PROTOCOL",
          message: `Task ${task.id} consumed ${context.amnesiaProofs.length} amnesia-protected context files.`
        }
      });
    }
  });

  await publishRealtimeEvent({
    orgId,
    event: "task.resumed",
    payload: {
      taskId: task.id,
      flowId: task.flowId
    }
  });

  await publishRealtimeEvent({
    orgId,
    event: "flow.updated",
    payload: {
      flowId: task.flowId,
      status: FlowStatus.ACTIVE
    }
  });

  const integrationContextBlocks =
    toolBindings.length > 0
      ? [
          {
            id: "composio-tool-bindings",
            name: "Connected Tool Bindings",
            amnesiaProtected: false,
            content: JSON.stringify(toolBindings.slice(0, 80))
          }
        ]
      : [];

  const toolActionSuccess = toolActionExecution?.ok
    ? (toolActionExecution as ToolActionExecutionSuccess)
    : null;
  const toolActionFailure = toolActionExecution && !toolActionExecution.ok
    ? (toolActionExecution as ToolActionExecutionFailure)
    : null;

  const toolActionContextBlocks =
    toolActionSuccess
      ? [
          {
            id: "composio-tool-action-result",
            name: "Executed Tool Result",
            amnesiaProtected: false,
            content: JSON.stringify(
              {
                toolkit: toolActionSuccess.toolkit,
                action: toolActionSuccess.action,
                toolSlug: toolActionSuccess.toolSlug,
                data: toolActionSuccess.data
              },
              null,
              2
            )
          }
        ]
      : [];

  const toolActionErrorContextBlocks =
    toolActionFailure
      ? [
          {
            id: "composio-tool-action-error",
            name: "Tool Action Error",
            amnesiaProtected: false,
            content: JSON.stringify(toolActionFailure.error)
          }
        ]
      : [];

  const execution = await executeSwarmAgent({
    taskId: task.id,
    flowId: task.flowId,
    prompt: task.prompt,
    agent,
    contextBlocks: [
      ...context.contextBlocks,
      ...integrationContextBlocks,
      ...toolActionContextBlocks,
      ...toolActionErrorContextBlocks
    ],
    organizationRuntime: await getOrgLlmRuntime(orgId)
  });

  const executionTrace = {
    ...execution.trace,
    contextFiles: context.fileRefs,
    amnesiaProofs: context.amnesiaProofs,
    requestedFiles: task.requiredFiles,
    requestedToolkits,
    toolActionExecution,
    toolBindings: toolBindings.map((item) => ({
      toolkit: item.toolkit,
      slug: item.slug
    }))
  };

  if (!execution.ok) {
    const errorText = execution.error ?? "Agent execution failed.";
    const requiresHumanTouch = /missing|invalid|unauthorized|forbidden|not found|quota|model|401|403|404|429/i.test(
      errorText.toLowerCase()
    );
    if (requiresHumanTouch) {
      return handleEvent({
        name: "vorldx/task.paused",
        data: {
          orgId,
          taskId: task.id,
          reason: `Agent configuration requires Human Touch: ${errorText}`
        }
      }, origin);
    }

    return handleEvent({
      name: "vorldx/task.failed",
      data: {
        orgId,
        taskId: task.id,
        error: errorText,
        executionTrace
      }
    }, origin);
  }

  let outputFileId: string | null = null;
  const outputText = execution.outputText?.trim() ?? "";
  if (outputText.length > 0) {
    const outputFile = await prisma.file.create({
      data: {
        orgId,
        name: `task-${task.id.slice(0, 8)}-output.txt`,
        type: HubFileType.OUTPUT,
        size: BigInt(Buffer.byteLength(outputText, "utf8")),
        url: `memory://flow/${task.flowId}/task/${task.id}`,
        health: 100,
        metadata: toInputJsonValue({
          sourceTaskId: task.id,
          sourceFlowId: task.flowId,
          provider: execution.usedProvider,
          model: execution.usedModel,
          apiSource: execution.apiSource,
          tokenUsage: execution.tokenUsage ?? null,
          billing: execution.billing ?? null,
          outputPreview: outputText.slice(0, 4000)
        })
      }
    });
    outputFileId = outputFile.id;
  }

  const verifiableProof =
    context.amnesiaProofs.length > 0
      ? await createJoltProofStub({
          taskId: task.id,
          digest: createHash("sha256")
            .update(`${task.id}|${outputText}|${context.amnesiaProofs.join("|")}`)
            .digest("hex"),
          policy: "amnesia-zero-retention"
        })
      : null;

  return handleEvent({
    name: "vorldx/task.completed",
    data: {
      orgId,
      taskId: task.id,
      executionTrace: {
        ...executionTrace,
        outputFileId,
        outputPreview: outputText.slice(0, 1200)
      },
      verifiableProof
    }
  }, origin);
}

async function handleEvent(event: InboundEvent, origin?: string): Promise<EventHandleResult> {
  const name = asString(event.name);
  const data = event.data ?? {};

  if (!name) {
    return { ok: true, ignored: true, reason: "missing event name" };
  }

  if (name === "vorldx/flow.launched" || name === "vorldx/flow.rewindForked") {
    const orgId = asString(data.orgId);
    const flowId =
      asString(data.flowId) ||
      asString(data.branchFlowId) ||
      asString(data.targetFlowId);
    const initiatedByUserId = asString(data.initiatedByUserId) || null;

    if (!orgId || !flowId) {
      return {
        ok: false,
        error: `${name} requires orgId and flowId/branchFlowId.`
      };
    }

    const queuedTasks = await prisma.task.findMany({
      where: {
        flowId,
        status: {
          in: [TaskStatus.QUEUED, TaskStatus.RUNNING]
        }
      },
      orderBy: {
        createdAt: "asc"
      },
      select: { id: true }
    });

    for (const queuedTask of queuedTasks) {
      // Sequential execution keeps task ordering deterministic for the same flow.
      // eslint-disable-next-line no-await-in-loop
      await executeTaskById(queuedTask.id, orgId, initiatedByUserId, origin);
    }

    return { ok: true, queued: queuedTasks.length };
  }

  if (name === "vorldx/task.paused") {
    const taskId = asString(data.taskId);
    const orgId = asString(data.orgId);
    const reason = asString(data.reason) || "Human Touch required.";
    const integrationErrorRaw =
      data.integrationError && typeof data.integrationError === "object"
        ? (data.integrationError as Record<string, unknown>)
        : null;
    const integrationError =
      integrationErrorRaw && asString(integrationErrorRaw.code) === "INTEGRATION_NOT_CONNECTED"
        ? {
            code: "INTEGRATION_NOT_CONNECTED" as const,
            toolkit: asString(integrationErrorRaw.toolkit),
            action: asString(integrationErrorRaw.action),
            ...(asString(integrationErrorRaw.connectUrl)
              ? { connectUrl: asString(integrationErrorRaw.connectUrl) }
              : {})
          }
        : null;
    const incomingExecutionTrace =
      data.executionTrace && typeof data.executionTrace === "object"
        ? asRecord(data.executionTrace)
        : null;

    if (!taskId || !orgId) {
      return { ok: false, error: "task.paused requires taskId and orgId." };
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { flow: { select: { id: true, orgId: true } } }
    });

    if (!task || task.flow.orgId !== orgId) {
      return { ok: false, error: "task.paused target not found for org." };
    }

    await prisma.$transaction(async (tx) => {
      await releaseTaskFileLocks({
        orgId,
        taskId,
        reason: "Task paused.",
        tx
      });

      await tx.task.update({
        where: { id: taskId },
        data: {
          status: TaskStatus.PAUSED,
          isPausedForInput: true,
          humanInterventionReason: reason,
          ...(integrationError || incomingExecutionTrace
            ? {
                executionTrace: toInputJsonValue({
                  ...asRecord(task.executionTrace),
                  ...(incomingExecutionTrace ?? {}),
                  ...(integrationError ? { integrationError } : {})
                })
              }
            : {})
        }
      });

      await tx.flow.update({
        where: { id: task.flowId },
        data: {
          status: FlowStatus.PAUSED
        }
      });

      await tx.log.create({
        data: {
          orgId,
          type: LogType.EXE,
          actor: "INNGEST",
          message: `Task ${taskId} paused by durable worker: ${reason}`
        }
      });
    });

    await publishRealtimeEvent({
      orgId,
      event: "task.paused",
      payload: {
        taskId,
        flowId: task.flowId,
        reason,
        ...(integrationError ? { integrationError } : {})
      }
    });

    await publishRealtimeEvent({
      orgId,
      event: "flow.updated",
      payload: {
        flowId: task.flowId,
        status: FlowStatus.PAUSED
      }
    });

    return { ok: true, ...(integrationError ? { integrationError } : {}) };
  }

  if (name === "vorldx/task.resumed") {
    const taskId = asString(data.taskId);
    const orgId = asString(data.orgId);

    if (!taskId || !orgId) {
      return { ok: false, error: "task.resumed requires taskId and orgId." };
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { flow: { select: { id: true, orgId: true } } }
    });

    if (!task || task.flow.orgId !== orgId) {
      return { ok: false, error: "task.resumed target not found for org." };
    }

    await prisma.$transaction(async (tx) => {
      await tx.task.update({
        where: { id: taskId },
        data: {
          status: TaskStatus.RUNNING,
          isPausedForInput: false,
          humanInterventionReason: null
        }
      });

      await tx.flow.update({
        where: { id: task.flowId },
        data: {
          status: FlowStatus.ACTIVE
        }
      });

      await tx.log.create({
        data: {
          orgId,
          type: LogType.EXE,
          actor: "INNGEST",
          message: `Task ${taskId} resumed by durable worker.`
        }
      });
    });

    await publishRealtimeEvent({
      orgId,
      event: "task.resumed",
      payload: {
        taskId,
        flowId: task.flowId
      }
    });

    await publishRealtimeEvent({
      orgId,
      event: "flow.updated",
      payload: {
        flowId: task.flowId,
        status: FlowStatus.ACTIVE
      }
    });

    const resumedTrace = asRecord(task.executionTrace);
    const executionResult = await executeTaskById(
      taskId,
      orgId,
      typeof resumedTrace.initiatedByUserId === "string" ? resumedTrace.initiatedByUserId : null,
      origin
    );
    return { ok: true, executionResult };
  }

  if (name === "vorldx/task.completed") {
    const taskId = asString(data.taskId);
    const orgId = asString(data.orgId);
    const executionTrace =
      data.executionTrace && typeof data.executionTrace === "object"
        ? (data.executionTrace as Record<string, unknown>)
        : null;
    const verifiableProof = asString(data.verifiableProof) || null;

    if (!taskId || !orgId) {
      return { ok: false, error: "task.completed requires taskId and orgId." };
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { flow: { select: { id: true, orgId: true } } }
    });

    if (!task || task.flow.orgId !== orgId) {
      return { ok: false, error: "task.completed target not found for org." };
    }

    await prisma.$transaction(async (tx) => {
      await releaseTaskFileLocks({
        orgId,
        taskId,
        reason: "Task completed.",
        tx
      });

      await tx.task.update({
        where: { id: taskId },
        data: {
          status: TaskStatus.COMPLETED,
          isPausedForInput: false,
          humanInterventionReason: null,
          ...(executionTrace
            ? {
                executionTrace: executionTrace as unknown as object
              }
            : {}),
          ...(verifiableProof
            ? {
                verifiableProof
              }
            : {})
        }
      });

      const flowTasks = await tx.task.findMany({
        where: { flowId: task.flowId },
        select: { status: true }
      });

      const total = flowTasks.length || 1;
      const completed = flowTasks.filter((item) => item.status === TaskStatus.COMPLETED).length;
      const hasFailed = flowTasks.some((item) => item.status === TaskStatus.FAILED);
      const hasRunning = flowTasks.some(
        (item) => item.status === TaskStatus.RUNNING || item.status === TaskStatus.PAUSED
      );

      await tx.flow.update({
        where: { id: task.flowId },
        data: {
          progress: Math.min(100, Math.round((completed / total) * 100)),
          status: hasFailed
            ? FlowStatus.FAILED
            : completed === total
              ? FlowStatus.COMPLETED
              : hasRunning
                ? FlowStatus.ACTIVE
                : FlowStatus.QUEUED
        }
      });

      await tx.log.create({
        data: {
          orgId,
          type: LogType.EXE,
          actor: "INNGEST",
          message: `Task ${taskId} marked completed.`
        }
      });

      const billingRecord =
        executionTrace?.billing && typeof executionTrace.billing === "object"
          ? (executionTrace.billing as Record<string, unknown>)
          : null;
      const tokenUsageRecord =
        executionTrace?.tokenUsage && typeof executionTrace.tokenUsage === "object"
          ? (executionTrace.tokenUsage as Record<string, unknown>)
          : null;
      const billedCostUsd =
        typeof billingRecord?.totalCostUsd === "number" && Number.isFinite(billingRecord.totalCostUsd)
          ? Math.max(0, billingRecord.totalCostUsd)
          : null;
      const fallbackUsageCost =
        typeof tokenUsageRecord?.totalTokens === "number" && Number.isFinite(tokenUsageRecord.totalTokens)
          ? Math.max(0, tokenUsageRecord.totalTokens / 1_000_000)
          : null;

      await recordPassiveSpend(
        {
          orgId,
          flowId: task.flowId,
          taskId: task.id,
          amount: billedCostUsd ?? fallbackUsageCost ?? 1,
          type: SpendEventType.ACTUAL_BURN,
          meta: toInputJsonValue({
            source: "inngest.task.completed",
            tokenUsage: tokenUsageRecord ?? null,
            billing: billingRecord ?? null
          })
        },
        tx
      );
    });

    await publishRealtimeEvent({
      orgId,
      event: "task.completed",
      payload: {
        taskId,
        flowId: task.flowId
      }
    });

    await publishRealtimeEvent({
      orgId,
      event: "flow.updated",
      payload: {
        flowId: task.flowId
      }
    });

    return { ok: true };
  }

  if (name === "vorldx/task.failed") {
    const taskId = asString(data.taskId);
    const orgId = asString(data.orgId);
    const error = asString(data.error) || "Unknown worker failure.";
    const executionTrace =
      data.executionTrace && typeof data.executionTrace === "object"
        ? (data.executionTrace as Record<string, unknown>)
        : null;

    if (!taskId || !orgId) {
      return { ok: false, error: "task.failed requires taskId and orgId." };
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { flow: { select: { id: true, orgId: true } } }
    });

    if (!task || task.flow.orgId !== orgId) {
      return { ok: false, error: "task.failed target not found for org." };
    }

    await prisma.$transaction(async (tx) => {
      await releaseTaskFileLocks({
        orgId,
        taskId,
        reason: "Task failed.",
        tx
      });

      await tx.task.update({
        where: { id: taskId },
        data: {
          status: TaskStatus.FAILED,
          isPausedForInput: false,
          humanInterventionReason: error,
          ...(executionTrace
            ? {
                executionTrace: executionTrace as unknown as object
              }
            : {})
        }
      });

      await tx.flow.update({
        where: { id: task.flowId },
        data: {
          status: FlowStatus.FAILED
        }
      });

      await tx.log.create({
        data: {
          orgId,
          type: LogType.EXE,
          actor: "INNGEST",
          message: `Task ${taskId} failed: ${error}`
        }
      });
    });

    await publishRealtimeEvent({
      orgId,
      event: "task.failed",
      payload: {
        taskId,
        flowId: task.flowId,
        error
      }
    });

    await publishRealtimeEvent({
      orgId,
      event: "flow.updated",
      payload: {
        flowId: task.flowId,
        status: FlowStatus.FAILED
      }
    });

    return { ok: true };
  }

  if (name === "vorldx/flow.progress") {
    const flowId = asString(data.flowId);
    const orgId = asString(data.orgId);
    const progress = asNumber(data.progress);

    if (!flowId || !orgId || progress === null) {
      return { ok: false, error: "flow.progress requires flowId, orgId, and progress." };
    }

    await prisma.flow.updateMany({
      where: {
        id: flowId,
        orgId
      },
      data: {
        progress: Math.max(0, Math.min(100, progress)),
        status: FlowStatus.ACTIVE
      }
    });

    await publishRealtimeEvent({
      orgId,
      event: "flow.progress",
      payload: {
        flowId,
        progress: Math.max(0, Math.min(100, progress))
      }
    });

    return { ok: true };
  }

  if (name === "vorldx/dna.ingest") {
    const fileId = asString(data.fileId);
    const orgId = asString(data.orgId);

    if (!fileId || !orgId) {
      return { ok: false, error: "dna.ingest requires fileId and orgId." };
    }

    const file = await prisma.file.findUnique({
      where: { id: fileId }
    });

    if (!file || file.orgId !== orgId) {
      return { ok: false, error: "dna.ingest target not found for org." };
    }

    if (file.type !== HubFileType.DNA) {
      return { ok: false, error: "dna.ingest can only process DNA files." };
    }

    const metadata =
      file.metadata && typeof file.metadata === "object"
        ? (file.metadata as Record<string, unknown>)
        : {};

    await prisma.file.update({
      where: { id: fileId },
      data: {
        metadata: {
          ...metadata,
          ingestStatus: "processing",
          ingestStartedAt: new Date().toISOString()
        }
      }
    });

    let sourceText = "";
    const localBytes = await readLocalUploadByUrl(file.url);
    if (localBytes) {
      sourceText = toPreviewText(localBytes, 12000);
    } else if (typeof metadata.rawText === "string") {
      sourceText = metadata.rawText.slice(0, 12000);
    } else if (/^https?:\/\//.test(file.url)) {
      try {
        const response = await fetch(file.url, { cache: "no-store" });
        sourceText = (await response.text()).slice(0, 12000);
      } catch {
        sourceText = "";
      }
    }

    const stableSource = sourceText || `${file.name}|${file.url}|${file.size.toString()}`;
    const embedding = createDeterministicEmbedding(stableSource, 1536);
    const vectorLiteral = toPgVectorLiteral(embedding);
    const digest = createHash("sha256").update(stableSource).digest("hex");

    const amnesiaProof = file.isAmnesiaProtected
      ? await createJoltProofStub({
          taskId: file.id,
          digest,
          policy: "amnesia-zero-retention"
        })
      : null;

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'UPDATE "File" SET embedding = $1::vector WHERE id = $2',
        vectorLiteral,
        file.id
      );

      await tx.file.update({
        where: { id: file.id },
        data: {
          metadata: {
            ...metadata,
            ingestStatus: "completed",
            embeddingDigest: digest,
            embeddedAt: new Date().toISOString(),
            amnesiaProof
          }
        }
      });

      await tx.log.create({
        data: {
          orgId,
          type: LogType.DNA,
          actor: "INNGEST",
          message: `DNA embedding completed for file ${file.id}.`
        }
      });

      if (file.isAmnesiaProtected && amnesiaProof) {
        await tx.log.create({
          data: {
            orgId,
            type: LogType.SCRUB,
            actor: "AMNESIA_PROTOCOL",
            message: `DNA ingest amnesia wipe verified for file ${file.id}. Proof=${amnesiaProof}`
          }
        });
      }

      if (featureFlags.memoryGovernance) {
        await tx.memoryEntry.create({
          data: {
            orgId,
            tier: "ORG",
            key: `dna.ingest.${file.id}`,
            value: {
              fileId: file.id,
              digest,
              dimensions: 1536,
              amnesiaProtected: file.isAmnesiaProtected
            },
            ttlSeconds: 86400,
            expiresAt: new Date(Date.now() + 86400_000),
            redactedAt: file.isAmnesiaProtected ? new Date() : null
          }
        });
      }

      await recordPassivePolicy(
        {
          orgId,
          subjectType: "DNA_INGEST",
          subjectId: file.id,
          riskScore: file.isAmnesiaProtected ? 0.18 : 0.08,
          reason: "Passive policy observation for DNA embedding.",
          meta: {
            amnesiaProtected: file.isAmnesiaProtected,
            digest
          }
        },
        tx
      );

      await recordPassiveSpend(
        {
          orgId,
          amount: 0.35,
          type: SpendEventType.ACTUAL_BURN,
          meta: {
            source: "inngest.dna.ingest",
            fileId: file.id,
            dimensions: 1536
          }
        },
        tx
      );
    });

    await publishRealtimeEvent({
      orgId,
      event: "dna.ingest.completed",
      payload: {
        fileId: file.id,
        amnesiaProtected: file.isAmnesiaProtected
      }
    });

    return { ok: true };
  }

  return { ok: true, ignored: true, reason: `unsupported event: ${name}` };
}

async function processRequest(request: NextRequest) {
  let payload: unknown = null;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      {
        ok: true,
        message: "Inngest endpoint is online.",
        ignored: true,
        reason: "no payload"
      },
      { status: 202 }
    );
  }

  const events: InboundEvent[] = Array.isArray(payload)
    ? payload.map((item) => {
        const value = item as Record<string, unknown>;
        return {
          name: asString(value.name || (value.event as Record<string, unknown> | undefined)?.name),
          data:
            (value.data as Record<string, unknown> | undefined) ||
            ((value.event as Record<string, unknown> | undefined)?.data as Record<
              string,
              unknown
            > | undefined) ||
            {}
        };
      })
    : [
        (() => {
          const value = payload as Record<string, unknown>;
          return {
            name: asString(value.name || (value.event as Record<string, unknown> | undefined)?.name),
            data:
              (value.data as Record<string, unknown> | undefined) ||
              ((value.event as Record<string, unknown> | undefined)?.data as Record<
                string,
                unknown
              > | undefined) ||
              {}
          };
        })()
      ];

  const results = [];
  for (const event of events) {
    // Sequential handling is intentional to preserve event order.
    // eslint-disable-next-line no-await-in-loop
    const result = await handleEvent(event, request.nextUrl.origin);
    results.push({
      name: event.name ?? "unknown",
      ...result
    });
  }

  return NextResponse.json(
    {
      ok: true,
      processed: results.length,
      results
    },
    { status: 202 }
  );
}

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      message: "Inngest endpoint is online and event mutation handlers are active."
    },
    { status: 200 }
  );
}

export async function POST(request: NextRequest) {
  return processRequest(request);
}

export async function PUT(request: NextRequest) {
  return processRequest(request);
}
