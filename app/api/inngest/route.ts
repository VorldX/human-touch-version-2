export const dynamic = "force-dynamic";

import { createHash } from "node:crypto";

import {
  AgentDecisionType,
  AgentStatus,
  FlowStatus,
  HubFileType,
  LogType,
  MemoryTier,
  Personnel,
  PersonnelStatus,
  Prisma,
  SpendEventType,
  TaskStatus
} from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { createDeterministicEmbedding, toPgVectorLiteral } from "@/lib/ai/embeddings";
import {
  persistMemoryCandidate,
  persistSemanticFactsFromText,
  summarizeAndArchiveAgentMemory,
  upsertAgentMemory
} from "@/lib/agent/memory";
import {
  estimateDelegationOverheadUsd,
  estimateTaskExecutionCostUsd,
  getAgentBudgetSnapshot
} from "@/lib/agent/orchestration/budget";
import {
  buildMeetingDetailsEmailTemplate,
  buildMeetingNotificationTemplate,
  extractDurationMinutes as extractMeetingDurationMinutes,
  extractFirstEmail as extractPromptEmail,
  extractFirstPhoneNumber as extractPromptPhoneNumber,
  extractLabeledValue as extractPromptLabelValue,
  parseMeetingIntent,
  shouldSendMeetingDetailsEmail as shouldSendMeetingDetailsEmailDeterministic,
  shouldSendMeetingNotification as shouldSendMeetingNotificationDeterministic
} from "@/lib/agent/orchestration/meeting-workflow";
import {
  filterToolCatalogForPrompt,
  inferDeterministicHumanInputReason,
  shouldBypassLlmToolRouter
} from "@/lib/agent/orchestration/tool-router";
import { inferUnverifiedExternalActionClaim } from "@/lib/agent/hallucination-guard";
import { assessTaskComplexity } from "@/lib/agent/orchestration/complexity";
import { buildAgentContextPack } from "@/lib/agent/orchestration/context-compiler";
import { decideDelegation } from "@/lib/agent/orchestration/delegation-policy";
import {
  createAgentRun,
  createApprovalCheckpoint,
  createChildAgent,
  finalizeAgentRun,
  listReusableChildAgents,
  pickDelegationPersonnelCandidate,
  recordDelegation,
  resolveOrCreateTaskAgentProfile,
  resolveOrgExecutionMode
} from "@/lib/agent/orchestration/runtime";
import { executeSwarmAgent, type AgentContextBlock } from "@/lib/ai/swarm-runtime";
import { getOrgLlmRuntime } from "@/lib/ai/org-llm-settings";
import { featureFlags } from "@/lib/config/feature-flags";
import { prisma } from "@/lib/db/prisma";
import { recordPassivePolicy, recordPassiveSpend } from "@/lib/enterprise/passive";
import { readLocalUploadByUrl, toPreviewText } from "@/lib/hub/storage";
import { getToolsForAgent, inferRequestedToolkits } from "@/lib/integrations/composio/service";
import { publishRealtimeEvent } from "@/lib/realtime/publish";
import { createJoltProofStub } from "@/lib/security/crypto";
import {
  buildInternalApiHeaders,
  hasValidInternalApiKey,
  resolveInternalApiKey
} from "@/lib/security/internal-api";

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

type RuntimeAgentProfile = Pick<
  Personnel,
  | "id"
  | "name"
  | "role"
  | "brainConfig"
  | "fallbackBrainConfig"
  | "brainKeyEnc"
  | "brainKeyIv"
  | "brainKeyAuthTag"
  | "brainKeyKeyVer"
  | "fallbackBrainKeyEnc"
  | "fallbackBrainKeyIv"
  | "fallbackBrainKeyAuthTag"
  | "fallbackBrainKeyKeyVer"
>;

const ALLOWED_INTERNAL_EVENTS = new Set([
  "vorldx/flow.launched",
  "vorldx/flow.rewindForked",
  "vorldx/task.paused",
  "vorldx/task.resumed",
  "vorldx/task.completed",
  "vorldx/task.failed",
  "vorldx/flow.progress",
  "vorldx/dna.ingest"
]);

function parsePositiveEnvInt(name: string, fallback: number) {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw) || raw <= 0) {
    return fallback;
  }
  return Math.floor(raw);
}

function parseBooleanEnv(name: string, fallback: boolean) {
  const raw = process.env[name];
  if (typeof raw !== "string") {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

const TASK_CONTEXT_PREVIEW_CHARS = parsePositiveEnvInt(
  "TASK_CONTEXT_PREVIEW_CHARS",
  2800
);
const TASK_CONTEXT_FALLBACK_FILE_COUNT = parsePositiveEnvInt(
  "TASK_CONTEXT_FALLBACK_FILE_COUNT",
  1
);
const TOOL_ACTION_CATALOG_LIMIT = parsePositiveEnvInt("TOOL_ACTION_CATALOG_LIMIT", 14);
const TOOL_BINDING_CONTEXT_LIMIT = parsePositiveEnvInt("TOOL_BINDING_CONTEXT_LIMIT", 12);
const TOOL_RESULT_CONTEXT_MAX_CHARS = parsePositiveEnvInt(
  "TOOL_RESULT_CONTEXT_MAX_CHARS",
  1600
);
const TOOL_ROUTER_MAX_OUTPUT_TOKENS = parsePositiveEnvInt("TOOL_ROUTER_MAX_OUTPUT_TOKENS", 120);
const TOOL_ROUTER_ENABLE_LLM = parseBooleanEnv("TOOL_ROUTER_ENABLE_LLM", true);
const INTERNAL_FETCH_TIMEOUT_MS = parsePositiveEnvInt("INTERNAL_FETCH_TIMEOUT_MS", 20_000);
const TOOL_EXECUTION_USER_CANDIDATE_LIMIT = parsePositiveEnvInt(
  "TOOL_EXECUTION_USER_CANDIDATE_LIMIT",
  3
);
const DNA_MEMORY_CHUNK_MAX_CHARS = parsePositiveEnvInt("DNA_MEMORY_CHUNK_MAX_CHARS", 900);
const DNA_MEMORY_CHUNK_OVERLAP_CHARS = parsePositiveEnvInt("DNA_MEMORY_CHUNK_OVERLAP_CHARS", 120);
const DNA_MEMORY_CHUNK_MAX_ITEMS = parsePositiveEnvInt("DNA_MEMORY_CHUNK_MAX_ITEMS", 24);

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

function truncateText(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}

function splitIntoMemoryChunks(input: {
  text: string;
  maxChars?: number;
  overlapChars?: number;
  maxChunks?: number;
}) {
  const text = input.text.replace(/\r/g, "").trim();
  if (!text) {
    return [] as string[];
  }

  const maxChars = Math.max(260, input.maxChars ?? DNA_MEMORY_CHUNK_MAX_CHARS);
  const overlapChars = Math.max(0, Math.min(maxChars - 80, input.overlapChars ?? DNA_MEMORY_CHUNK_OVERLAP_CHARS));
  const maxChunks = Math.max(1, input.maxChunks ?? DNA_MEMORY_CHUNK_MAX_ITEMS);
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length && chunks.length < maxChunks) {
    let end = Math.min(text.length, start + maxChars);
    if (end < text.length) {
      const window = text.slice(start, end);
      const preferredBreaks = [
        window.lastIndexOf("\n\n"),
        window.lastIndexOf("\n"),
        window.lastIndexOf(". "),
        window.lastIndexOf(" ")
      ].filter((value) => value >= Math.floor(maxChars * 0.55));
      if (preferredBreaks.length > 0) {
        end = start + Math.max(...preferredBreaks) + 1;
      }
    }

    const chunk = text.slice(start, end).trim();
    if (chunk.length >= 80 || chunks.length === 0) {
      chunks.push(chunk);
    }

    if (end >= text.length) {
      break;
    }

    const nextStart = Math.max(start + 1, end - overlapChars);
    if (nextStart <= start) {
      break;
    }
    start = nextStart;
  }

  return chunks;
}

function sanitizeToolValueForContext(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    return truncateText(value, 320);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    if (depth >= 4) {
      return `[array(${value.length}) omitted]`;
    }
    return value
      .slice(0, 8)
      .map((item) => sanitizeToolValueForContext(item, depth + 1));
  }
  if (typeof value === "object") {
    if (depth >= 4) {
      return "[object omitted]";
    }
    const record = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [key, current] of Object.entries(record)) {
      const normalizedKey = key.trim();
      if (!normalizedKey) continue;
      const lower = normalizedKey.toLowerCase();
      if (
        lower === "raw" ||
        lower === "payload" ||
        lower === "parts" ||
        lower === "headers" ||
        lower === "mime" ||
        lower === "attachments"
      ) {
        continue;
      }
      output[normalizedKey] = sanitizeToolValueForContext(current, depth + 1);
      if (Object.keys(output).length >= 20) {
        break;
      }
    }
    return output;
  }
  return String(value);
}

function toContextJson(value: unknown, maxChars = TOOL_RESULT_CONTEXT_MAX_CHARS) {
  let text = "";
  try {
    text = JSON.stringify(sanitizeToolValueForContext(value), null, 2);
  } catch {
    text = JSON.stringify({ note: "Unable to serialize full tool payload." }, null, 2);
  }
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 24))}\n... [truncated]`;
}

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

async function persistMemoryCandidateSafe(
  input: Parameters<typeof persistMemoryCandidate>[0]
) {
  try {
    await persistMemoryCandidate(input);
  } catch {
    // Memory persistence is best-effort and must not block task execution.
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = INTERNAL_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store"
    });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeToolkitList(value: string[]) {
  return [...new Set(value.map((item) => item.trim().toLowerCase()).filter(Boolean))];
}

function canonicalToolkitForExecutionLookup(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "googlemeet" || normalized === "gmeet") {
    return "gmeet";
  }
  return normalized;
}

function toolkitExecutionLookupVariants(value: string) {
  const canonical = canonicalToolkitForExecutionLookup(value);
  if (canonical === "gmeet") {
    return ["googlemeet", "gmeet"];
  }
  return [canonical];
}

function toolkitMatchesForExecution(left: string, right: string) {
  return canonicalToolkitForExecutionLookup(left) === canonicalToolkitForExecutionLookup(right);
}

function requestedToolkitIncludesForExecution(requestedToolkits: string[], toolkit: string) {
  return requestedToolkits.some((candidate) => toolkitMatchesForExecution(candidate, toolkit));
}

function parseTaskStage(value: string) {
  const upper = value.toUpperCase();
  if (upper === "PLANNING") return "PLANNING" as const;
  if (upper === "EXECUTION") return "EXECUTION" as const;
  return "GENERAL" as const;
}

interface WorkflowStepBreakdown {
  step: string;
  model: string | null;
  provider: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  retryCount: number;
  fallbackCount: number;
  tool: string | null;
  success: boolean;
}

function summarizeWorkflowBreakdown(workflowId: string, steps: WorkflowStepBreakdown[]) {
  const promptTokens = steps.reduce((sum, step) => sum + Math.max(0, step.promptTokens), 0);
  const completionTokens = steps.reduce(
    (sum, step) => sum + Math.max(0, step.completionTokens),
    0
  );
  const totalTokens = steps.reduce((sum, step) => sum + Math.max(0, step.totalTokens), 0);
  const retryCount = steps.reduce((sum, step) => sum + Math.max(0, step.retryCount), 0);
  const fallbackCount = steps.reduce((sum, step) => sum + Math.max(0, step.fallbackCount), 0);
  return {
    workflowId,
    steps,
    totals: {
      stepCount: steps.length,
      modelCalls: steps.filter((step) => step.totalTokens > 0).length,
      promptTokens,
      completionTokens,
      totalTokens,
      retryCount,
      fallbackCount
    }
  };
}

function parseAgentBudgetLimitUsd(scope: unknown): number | null {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
    return null;
  }

  const value = (scope as Record<string, unknown>).maxUsd;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, value);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }
  }
  return null;
}

function resolveScopeViolations(input: {
  agentName: string;
  allowedTools: string[];
  requestedToolkits: string[];
  estimatedCostUsd: number;
  budgetScope: unknown;
}) {
  const allowedTools = normalizeToolkitList(input.allowedTools);
  const requestedToolkits = normalizeToolkitList(input.requestedToolkits);
  const blockedToolkits =
    allowedTools.length > 0
      ? requestedToolkits.filter((toolkit) => !allowedTools.includes(toolkit))
      : [];
  const budgetLimit = parseAgentBudgetLimitUsd(input.budgetScope);
  const exceedsBudget =
    typeof budgetLimit === "number" ? input.estimatedCostUsd > budgetLimit + 0.0001 : false;

  if (blockedToolkits.length > 0) {
    return {
      violation: `Agent scope blocked tools [${blockedToolkits.join(", ")}] for ${input.agentName}.`,
      budgetLimitUsd: budgetLimit
    };
  }

  if (exceedsBudget && typeof budgetLimit === "number") {
    return {
      violation: `Agent budget scope exceeded for ${input.agentName}: estimated ${input.estimatedCostUsd.toFixed(4)} USD > scope ${budgetLimit.toFixed(4)} USD.`,
      budgetLimitUsd: budgetLimit
    };
  }

  return {
    violation: null,
    budgetLimitUsd: budgetLimit
  };
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
            type: HubFileType.INPUT
          },
          orderBy: { updatedAt: "desc" },
          take: Math.max(1, TASK_CONTEXT_FALLBACK_FILE_COUNT)
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
      sourceText = toPreviewText(localBytes, TASK_CONTEXT_PREVIEW_CHARS);
    } else if (/^https?:\/\//.test(file.url)) {
      try {
        const response = await fetch(file.url, { cache: "no-store" });
        sourceText = (await response.text()).slice(0, TASK_CONTEXT_PREVIEW_CHARS);
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

function toolkitSetSignature(toolkits: string[]) {
  return [...new Set(normalizeToolkitList(toolkits).map(canonicalToolkitForExecutionLookup))]
    .sort()
    .join(",");
}

function resolveTaskRequestedToolkits(input: {
  traceToolkits: string[];
  promptToolkits: string[];
}) {
  const promptToolkits = normalizeToolkitList(input.promptToolkits);
  if (promptToolkits.length > 0) {
    return promptToolkits;
  }
  return normalizeToolkitList(input.traceToolkits);
}

function inferDelegationSpecialty(taskPrompt: string, requestedToolkits: string[]) {
  const lower = taskPrompt.toLowerCase();
  const toolkitLabel = requestedToolkits.length > 0 ? requestedToolkits.join(", ") : "none";

  if (/\b(marketing|campaign|content|growth|seo|social)\b/.test(lower)) {
    return `marketing-operations [toolkits=${toolkitLabel}]`;
  }
  if (/\b(sales|prospect|crm|pipeline|outreach)\b/.test(lower)) {
    return `sales-operations [toolkits=${toolkitLabel}]`;
  }
  if (/\b(meeting|calendar|schedule|zoom|google meet|gmeet)\b/.test(lower)) {
    return `meeting-and-scheduling [toolkits=${toolkitLabel}]`;
  }
  if (/\b(email|gmail|inbox|mailbox)\b/.test(lower)) {
    return `email-operations [toolkits=${toolkitLabel}]`;
  }

  return `task-specialist [toolkits=${toolkitLabel}]`;
}

function buildChildAgentCriticalRules(taskPrompt: string, requestedToolkits: string[]) {
  const toolkitLabel = requestedToolkits.length > 0 ? requestedToolkits.join(", ") : "approved organizational tools";
  return [
    `Execute only delegated scope: ${taskPrompt.slice(0, 260)}.`,
    `Use only these approved toolkits: ${toolkitLabel}.`,
    "Stop and request Human Touch for missing parameters, risky/destructive actions, or policy uncertainty.",
    "Never claim external action completed unless tool output confirms success."
  ];
}

function shouldSendMeetingDetailsEmail(prompt: string) {
  return shouldSendMeetingDetailsEmailDeterministic(prompt);
}

function shouldSendMeetingNotification(prompt: string) {
  return shouldSendMeetingNotificationDeterministic(prompt);
}

function extractMeetingUriFromToolData(data: Record<string, unknown> | null | undefined) {
  if (!data) return "";
  const directUri = asString(data.meetingUri);
  if (directUri) return directUri;
  const nestedUri = asString(asRecord(data.meeting).meetingUri);
  if (nestedUri) return nestedUri;
  return "";
}

function buildMeetingDetailsEmail(input: {
  recipient: string;
  meetingUri: string;
  meetingCode?: string;
  prompt: string;
}) {
  const parsed = parseMeetingIntent(input.prompt);
  return buildMeetingDetailsEmailTemplate({
    recipient: input.recipient,
    meetingUri: input.meetingUri,
    meetingCode: input.meetingCode,
    meetingTopic: parsed.topic,
    durationMinutes: parsed.durationMinutes,
    prompt: input.prompt
  });
}

function extractFirstPhoneNumber(value: string) {
  return extractPromptPhoneNumber(value);
}

function buildMeetingNotification(input: {
  recipientPhone: string;
  meetingUri: string;
  meetingCode?: string;
  prompt: string;
}) {
  const parsed = parseMeetingIntent(input.prompt);
  return buildMeetingNotificationTemplate({
    recipientPhone: input.recipientPhone,
    meetingUri: input.meetingUri,
    meetingCode: input.meetingCode,
    meetingTopic: parsed.topic,
    durationMinutes: parsed.durationMinutes,
    prompt: input.prompt
  });
}

interface AgentToolActionRequest {
  toolkit: string;
  action: string;
  arguments: Record<string, unknown>;
}

interface ToolInferenceResult {
  action: AgentToolActionRequest | null;
  reason?: string;
  metrics?: ToolInferenceMetrics;
}

interface ToolInferenceMetrics {
  mode: "heuristic" | "llm" | "none";
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  costUsd: number | null;
  provider: string | null;
  model: string | null;
  fallbackUsed: boolean;
  catalogSize: number;
}

interface AgentToolBindingSummary {
  toolkit: string;
  slug: string;
  name: string;
  description: string;
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

function toToolCollectionItems(data: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const direct = data[key];
    if (Array.isArray(direct)) {
      return direct.map((item) => asRecord(item));
    }

    if (direct && typeof direct === "object") {
      const record = asRecord(direct);
      for (const nestedKey of [
        "items",
        "results",
        "records",
        "participants",
        "meetings",
        "conferenceRecords"
      ]) {
        const nested = record[nestedKey];
        if (Array.isArray(nested)) {
          return nested.map((item) => asRecord(item));
        }
      }
    }
  }

  return [] as Record<string, unknown>[];
}

function inferToolItemCount(data: Record<string, unknown>) {
  const rawCount = asNumber(data.count) ?? asNumber(data.total) ?? asNumber(data.size);
  if (typeof rawCount === "number") {
    return Math.max(0, Math.floor(rawCount));
  }

  const itemCollections = toToolCollectionItems(data, [
    "items",
    "results",
    "records",
    "meetings",
    "conferenceRecords",
    "participants",
    "emails"
  ]);
  if (itemCollections.length > 0) {
    return itemCollections.length;
  }

  return 0;
}

function normalizeToolDataForModelContext(input: {
  toolkit: string;
  action: string;
  data: Record<string, unknown>;
}) {
  const toolkit = input.toolkit.toLowerCase();
  const action = input.action.toUpperCase();
  const data = asRecord(input.data);

  if (toolkit === "gmail") {
    if (action === "SEND_EMAIL") {
      return {
        to: asString(data.to),
        subject: truncateText(asString(data.subject), 120),
        delivered: data.delivered === true
      };
    }
    if (action === "READ_EMAIL") {
      const email = asRecord(data.email);
      return {
        email: {
          id: asString(email.id),
          from: asString(email.from),
          subject: truncateText(asString(email.subject), 140),
          snippet: truncateText(asString(email.snippet), 220)
        }
      };
    }

    const emails = Array.isArray(data.emails) ? data.emails : [];
    return {
      count: inferToolItemCount(data),
      query: asString(data.query),
      summary: truncateText(asString(data.summary), 320),
      emails: emails.slice(0, 3).map((item) => {
        const email = asRecord(item);
        return {
          id: asString(email.id),
          from: asString(email.from),
          subject: truncateText(asString(email.subject), 120),
          snippet: truncateText(asString(email.snippet), 180)
        };
      })
    };
  }

  if (toolkit === "googlemeet" || toolkit === "zoom") {
    const participants = toToolCollectionItems(data, [
      "participants",
      "attendees",
      "members",
      "participantList"
    ]);
    return {
      meetingUri:
        extractMeetingUriFromToolData(data) ||
        asString(data.join_url) ||
        asString(data.joinUrl),
      meetingCode:
        asString(data.meetingCode) ||
        asString(data.meeting_code) ||
        asString(asRecord(data.meeting).meetingCode),
      count: inferToolItemCount(data),
      participants: participants.slice(0, 5).map((item) => formatParticipantLabel(item))
    };
  }

  return sanitizeToolValueForContext(data);
}

function formatParticipantLabel(item: Record<string, unknown>) {
  const candidate =
    asString(item.displayName) ||
    asString(item.name) ||
    asString(item.email) ||
    asString(item.userEmail) ||
    asString(item.participant) ||
    asString(item.id);
  return candidate || null;
}

function buildDeterministicToolSummary(input: {
  prompt: string;
  primaryToolSuccess: ToolActionExecutionSuccess | null;
  followupToolActionSuccess: ToolActionExecutionSuccess | null;
  notificationToolActionSuccess: ToolActionExecutionSuccess | null;
}) {
  const primary = input.primaryToolSuccess;
  if (!primary) {
    return null;
  }

  const promptLower = input.prompt.toLowerCase();
  const action = primary.action.toUpperCase();
  const toolkit = primary.toolkit.toLowerCase();
  const data = asRecord(primary.data);

  if (toolkit === "gmail" && action === "SEND_EMAIL") {
    const recipient = asString(data.to);
    return recipient ? `Confirmation email sent to ${recipient}.` : "Confirmation email sent.";
  }

  if (toolkit === "gmail") {
    if (action === "SUMMARIZE_EMAILS") {
      const summary = asString(data.summary);
      if (summary) {
        return summary;
      }
      const count = inferToolItemCount(data);
      return `Prepared a summary for ${count} email(s).`;
    }

    if (action === "SEARCH_EMAILS" || action === "LIST_RECENT_EMAILS") {
      const count = inferToolItemCount(data);
      return `Found ${count} email(s).`;
    }

    if (action === "READ_EMAIL") {
      const email = asRecord(data.email);
      const subject = asString(email.subject);
      return subject ? `Email read: ${subject}.` : "Email read.";
    }
  }

  if (toolkit === "googlemeet" || toolkit === "zoom") {
    const meetingUri =
      extractMeetingUriFromToolData(data) ||
      asString(data.join_url) ||
      asString(data.joinUrl) ||
      asString(data.start_url) ||
      asString(data.startUrl);
    const meetingCode =
      asString(data.meetingCode) ||
      asString(data.meeting_code) ||
      asString(asRecord(data.meeting).meetingCode) ||
      asString(asRecord(data.meeting).meeting_code);

    if (/\b(create|schedule|add)\b/.test(action.toLowerCase())) {
      const sentFollowupEmail =
        Boolean(input.followupToolActionSuccess) &&
        input.followupToolActionSuccess?.toolkit.toLowerCase() === "gmail" &&
        input.followupToolActionSuccess?.action.toUpperCase() === "SEND_EMAIL";
      const recipient =
        sentFollowupEmail && input.followupToolActionSuccess
          ? asString(asRecord(input.followupToolActionSuccess.data).to)
          : "";

      const segments = [
        meetingUri ? `Meeting created. Link: ${meetingUri}` : "Meeting created."
      ];
      if (meetingCode) {
        segments.push(`Code: ${meetingCode}.`);
      }
      if (sentFollowupEmail) {
        segments.push(
          recipient ? `Confirmation email sent to ${recipient}.` : "Confirmation email sent."
        );
      }
      const sentNotification =
        Boolean(input.notificationToolActionSuccess) &&
        canonicalToolkitForExecutionLookup(
          input.notificationToolActionSuccess?.toolkit ?? ""
        ) === "whatsapp";
      const notifiedTarget =
        sentNotification && input.notificationToolActionSuccess
          ? asString(
              asRecord(input.notificationToolActionSuccess.data).to ||
                asRecord(input.notificationToolActionSuccess.data).phone_number ||
                asRecord(input.notificationToolActionSuccess.data).recipient_phone
            )
          : "";
      if (sentNotification) {
        segments.push(
          notifiedTarget
            ? `WhatsApp notification sent to ${notifiedTarget}.`
            : "WhatsApp notification sent."
        );
      }
      return segments.join(" ");
    }

    const participantItems = toToolCollectionItems(data, [
      "participants",
      "attendees",
      "members",
      "participantList"
    ]);
    if (participantItems.length > 0 || /\bparticipant\b/.test(action.toLowerCase()) || /\bparticipants?\b/.test(promptLower)) {
      if (participantItems.length === 0) {
        return "No participants were found for this meeting.";
      }
      const labels = participantItems
        .map((item) => formatParticipantLabel(item))
        .filter((value): value is string => Boolean(value))
        .slice(0, 6);
      if (labels.length > 0) {
        return `Found ${participantItems.length} participant(s): ${labels.join(", ")}${participantItems.length > labels.length ? ", ..." : ""}.`;
      }
      return `Found ${participantItems.length} participant(s).`;
    }

    const count = inferToolItemCount(data);
    if (count > 0 || /\b(list|get|fetch|view|search)\b/.test(action.toLowerCase())) {
      return `Retrieved ${count} meeting record(s).`;
    }
  }

  return null;
}

function extractFirstEmail(value: string) {
  return extractPromptEmail(value);
}

function extractLabeledValue(prompt: string, labels: string[]) {
  return extractPromptLabelValue(prompt, labels);
}

function tokenizeToolText(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((item) => item.trim())
    .filter((item) => item.length > 1);
}

function bindingTokenSet(binding: AgentToolBindingSummary) {
  return new Set(tokenizeToolText(`${binding.slug} ${binding.name} ${binding.description}`));
}

function findBindingByKeywordSets(bindings: AgentToolBindingSummary[], keywordSets: string[][]) {
  for (const keywords of keywordSets) {
    const normalizedKeywords = keywords.map((item) => item.trim().toLowerCase()).filter(Boolean);
    if (normalizedKeywords.length === 0) {
      continue;
    }
    const found = bindings.find((binding) => {
      const tokens = bindingTokenSet(binding);
      return normalizedKeywords.every((keyword) => tokens.has(keyword));
    });
    if (found) {
      return found;
    }
  }
  return null;
}

function pickWhatsappSendBinding(bindings: AgentToolBindingSummary[]) {
  const whatsappBindings = bindings.filter(
    (binding) => canonicalToolkitForExecutionLookup(binding.toolkit) === "whatsapp"
  );
  if (whatsappBindings.length === 0) {
    return null;
  }
  return (
    findBindingByKeywordSets(whatsappBindings, [
      ["send", "message"],
      ["whatsapp", "send"],
      ["send", "text"],
      ["message"],
      ["send"]
    ]) ?? whatsappBindings[0]
  );
}

function extractDurationMinutes(prompt: string) {
  return extractMeetingDurationMinutes(prompt);
}

function buildZoomCreateArguments(prompt: string) {
  const topic =
    extractLabeledValue(prompt, ["topic", "title", "subject"]) ||
    prompt.replace(/\s+/g, " ").trim().slice(0, 120);
  const agenda = extractLabeledValue(prompt, ["agenda", "description", "details", "message"]);
  const startTime = extractLabeledValue(prompt, ["start time", "start", "time", "date"]);
  const timezone = extractLabeledValue(prompt, ["timezone", "time zone", "tz"]);
  const duration = extractDurationMinutes(prompt);

  return {
    ...(topic ? { topic } : {}),
    ...(agenda ? { agenda } : {}),
    ...(startTime ? { start_time: startTime } : {}),
    ...(timezone ? { timezone } : {}),
    ...(duration ? { duration } : {})
  };
}

function buildMeetingLookupArguments(prompt: string) {
  const labeledValue =
    extractLabeledValue(prompt, [
      "conference record",
      "conference id",
      "meeting id",
      "meeting code",
      "meeting uri",
      "meeting link",
      "code"
    ]) || "";

  const inlineCode = prompt.match(/\b[a-z]{3}-[a-z]{4}-[a-z]{3}\b/i)?.[0] ?? "";
  const inlineUri = prompt.match(/https?:\/\/meet\.google\.com\/[a-z0-9-]+/i)?.[0] ?? "";
  const candidate = labeledValue || inlineUri || inlineCode;
  if (!candidate) {
    return {};
  }

  const args: Record<string, unknown> = {};
  const meetingUri = candidate.match(/https?:\/\/meet\.google\.com\/[a-z0-9-]+/i)?.[0] ?? "";
  const meetingCode = candidate.match(/\b[a-z]{3}-[a-z]{4}-[a-z]{3}\b/i)?.[0] ?? "";

  if (meetingUri) {
    args.meetingUri = meetingUri;
  }
  if (meetingCode) {
    args.meetingCode = meetingCode.toLowerCase();
  }

  if (!args.meetingUri && !args.meetingCode) {
    args.query = candidate.trim();
  }

  return args;
}

function inferZoomToolAction(prompt: string, toolBindings: AgentToolBindingSummary[]) {
  const normalized = prompt.toLowerCase();
  const zoomBindings = toolBindings.filter((binding) => binding.toolkit === "zoom");
  if (zoomBindings.length === 0) {
    return null;
  }

  const meetingContext = /\b(zoom|meeting|call|webinar)\b/.test(normalized);
  if (!meetingContext) {
    return null;
  }

  const createIntent = /\b(create|schedule|set up|setup|book|arrange|plan)\b/.test(normalized);
  if (createIntent) {
    const createBinding = findBindingByKeywordSets(zoomBindings, [
      ["create", "meeting"],
      ["schedule", "meeting"],
      ["add", "meeting"],
      ["create", "webinar"],
      ["schedule", "webinar"]
    ]);
    if (createBinding) {
      return {
        toolkit: "zoom",
        action: createBinding.slug.toUpperCase(),
        arguments: buildZoomCreateArguments(prompt)
      } satisfies AgentToolActionRequest;
    }
  }

  const listIntent = /\b(list|get|show|fetch|check|view|upcoming|recent)\b/.test(normalized);
  if (listIntent) {
    const listBinding = findBindingByKeywordSets(zoomBindings, [
      ["list", "meeting"],
      ["get", "meeting"],
      ["fetch", "meeting"],
      ["upcoming", "meeting"],
      ["list", "webinar"]
    ]);
    if (listBinding) {
      return {
        toolkit: "zoom",
        action: listBinding.slug.toUpperCase(),
        arguments: {}
      } satisfies AgentToolActionRequest;
    }
  }

  return null;
}

function inferGoogleMeetToolAction(prompt: string, toolBindings: AgentToolBindingSummary[]) {
  const normalized = prompt.toLowerCase();
  const meetBindings = toolBindings.filter((binding) => binding.toolkit === "googlemeet");
  if (meetBindings.length === 0) {
    return null;
  }

  const meetingContext = /\b(google meet|gmeet|meeting|meet|call)\b/.test(normalized);
  if (!meetingContext) {
    return null;
  }

  const createIntent = /\b(create|schedule|set up|setup|book|arrange|plan)\b/.test(normalized);
  if (createIntent) {
    const createBinding = findBindingByKeywordSets(meetBindings, [
      ["create", "meet"],
      ["create", "space"],
      ["create", "meeting"]
    ]);
    if (createBinding) {
      return {
        toolkit: "googlemeet",
        action: createBinding.slug.toUpperCase(),
        arguments: {}
      } satisfies AgentToolActionRequest;
    }
  }

  const listIntent =
    /\b(list|get|show|fetch|check|view|recent|upcoming|find|search)\b/.test(normalized) ||
    /\bparticipants?\b/.test(normalized);
  if (listIntent) {
    const listBinding = findBindingByKeywordSets(meetBindings, [
      ["get", "participants"],
      ["list", "conference", "records"],
      ["get", "conference", "record"],
      ["get", "meet"],
      ["list", "participants"]
    ]);
    if (listBinding) {
      const listArgs = /\bparticipants?\b/.test(normalized)
        ? buildMeetingLookupArguments(prompt)
        : {};
      return {
        toolkit: "googlemeet",
        action: listBinding.slug.toUpperCase(),
        arguments: listArgs
      } satisfies AgentToolActionRequest;
    }
  }

  return null;
}

function inferReadOnlyGenericToolAction(
  prompt: string,
  requestedToolkits: string[],
  toolBindings: AgentToolBindingSummary[]
) {
  const normalizedPrompt = prompt.toLowerCase();
  const readIntent = /\b(list|get|show|fetch|find|search|check|read|view|lookup)\b/.test(
    normalizedPrompt
  );
  if (!readIntent) {
    return null;
  }

  const promptTokens = new Set(tokenizeToolText(prompt));
  const candidates = toolBindings.filter((binding) =>
    requestedToolkitIncludesForExecution(requestedToolkits, binding.toolkit)
  );
  if (candidates.length === 0) {
    return null;
  }

  const readTokens = new Set([
    "list",
    "get",
    "fetch",
    "find",
    "search",
    "read",
    "view",
    "lookup",
    "upcoming",
    "recent"
  ]);
  const destructiveTokens = new Set(["delete", "remove", "cancel", "archive", "revoke", "disconnect"]);

  let best: { binding: AgentToolBindingSummary; score: number } | null = null;
  for (const binding of candidates) {
    const tokens = bindingTokenSet(binding);
    let score = 0;
    for (const token of promptTokens) {
      if (tokens.has(token)) {
        score += 1;
      }
    }
    if ([...readTokens].some((token) => tokens.has(token))) {
      score += 2;
    }
    if ([...destructiveTokens].some((token) => tokens.has(token))) {
      score -= 3;
    }
    if (normalizedPrompt.includes(binding.toolkit)) {
      score += 1;
    }

    if (!best || score > best.score) {
      best = { binding, score };
    }
  }

  if (!best || best.score < 3) {
    return null;
  }

  const query = extractLabeledValue(prompt, ["query", "search", "keyword", "keywords"]);
  return {
    toolkit: best.binding.toolkit,
    action: best.binding.slug.toUpperCase(),
    arguments: query ? { query } : {}
  } satisfies AgentToolActionRequest;
}

function inferAgentToolActionHeuristic(
  prompt: string,
  requestedToolkits: string[],
  toolBindings: AgentToolBindingSummary[]
): AgentToolActionRequest | null {
  const normalized = prompt.toLowerCase();
  const explicitSlug = prompt.match(/\b[A-Z][A-Z0-9_]{6,}\b/g)?.find((token) => {
    const upper = token.toUpperCase();
    return toolBindings.some((binding) => binding.slug.toUpperCase() === upper);
  });
  if (explicitSlug) {
    const matched = toolBindings.find((binding) => binding.slug.toUpperCase() === explicitSlug);
    if (matched) {
      return {
        toolkit: matched.toolkit,
        action: matched.slug.toUpperCase(),
        arguments: {}
      };
    }
  }

  const inferredZoom = inferZoomToolAction(prompt, toolBindings);
  if (inferredZoom) {
    return inferredZoom;
  }

  const inferredGoogleMeet = inferGoogleMeetToolAction(prompt, toolBindings);
  if (inferredGoogleMeet) {
    return inferredGoogleMeet;
  }

  const gmailRequested = requestedToolkits.includes("gmail");
  if (!gmailRequested) {
    return inferReadOnlyGenericToolAction(prompt, requestedToolkits, toolBindings);
  }

  const hasMailContext = /\b(gmail|email|mail|inbox)\b/.test(normalized);
  const sendIntent =
    /\b(send|compose)\b/.test(normalized) && /\b(?:email|mail)\b/.test(normalized);
  if (hasMailContext && sendIntent) {
    const hasMeetingCreateIntent =
      /\b(set up|setup|schedule|book|arrange|create|plan)\b[\s\S]{0,80}\b(meeting|call|invite|invitation|session)\b/i.test(
        normalized
      ) ||
      /\b(meeting|call|invite|invitation|session)\b[\s\S]{0,80}\b(set up|setup|schedule|book|arrange|create|plan)\b/i.test(
        normalized
      );
    const recipientCandidate =
      extractFirstEmail(prompt) || extractLabeledValue(prompt, ["recipient", "to"]);
    const recipient = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientCandidate)
      ? recipientCandidate
      : "";
    const subject = extractLabeledValue(prompt, ["subject", "title"]);
    const body = extractLabeledValue(prompt, ["body", "message", "content"]);

    if (recipient && subject && body) {
      return {
        toolkit: "gmail",
        action: "SEND_EMAIL",
        arguments: {
          to: recipient,
          recipient_email: recipient,
          subject,
          body
        }
      };
    }

    if (recipient && !hasMeetingCreateIntent && shouldSendMeetingDetailsEmail(prompt)) {
      const promptMeetingUri =
        prompt.match(
          /https?:\/\/(?:meet\.google\.com|zoom\.us|teams\.microsoft\.com|calendar\.google\.com)\/[^\s)]+/i
        )?.[0] ?? "";
      const generatedDraft = buildMeetingDetailsEmail({
        recipient,
        meetingUri:
          promptMeetingUri || "Meeting link will be shared after scheduling confirmation.",
        prompt
      });

      return {
        toolkit: "gmail",
        action: "SEND_EMAIL",
        arguments: {
          to: recipient,
          recipient_email: recipient,
          subject: subject || generatedDraft.subject,
          body: body || generatedDraft.body
        }
      };
    }

    // Do not fall back to mailbox-read actions for incomplete send requests.
    // Missing structured send fields should route through HUMAN_INPUT instead.
    return null;
  }

  const whatsappRequested = requestedToolkits.some(
    (toolkit) => canonicalToolkitForExecutionLookup(toolkit) === "whatsapp"
  );
  const whatsappSendIntent =
    /\b(send|share|notify|message|text|ping|alert)\b/.test(normalized) &&
    /\b(whatsapp|notification|message|text|update)\b/.test(normalized);
  if (whatsappRequested && whatsappSendIntent) {
    const sendBinding = pickWhatsappSendBinding(toolBindings);
    if (sendBinding) {
      const recipientPhone = extractFirstPhoneNumber(prompt);
      const messageBody = extractLabeledValue(prompt, ["message", "body", "content", "text"]);
      if (recipientPhone && messageBody) {
        return {
          toolkit: sendBinding.toolkit,
          action: sendBinding.slug.toUpperCase(),
          arguments: {
            to: recipientPhone,
            phone_number: recipientPhone,
            recipient_phone: recipientPhone,
            message: messageBody,
            text: messageBody,
            body: messageBody
          }
        };
      }
    }
    return null;
  }

  // MVP behavior: if task mentions inbox/email fetch semantics, call Gmail fetch.
  const asksForMailboxRead = /\b(gmail|email|inbox)\b/.test(normalized);
  const asksForList = /\b(list|latest|recent|last|show|fetch|check|read)\b/.test(normalized);
  if (!asksForMailboxRead || !asksForList) {
    return inferReadOnlyGenericToolAction(prompt, requestedToolkits, toolBindings);
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

function parseJsonObjectFromText(value: string) {
  const direct = value.trim();
  if (!direct) return null;
  try {
    const parsed = JSON.parse(direct);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // continue to fence extraction
  }

  const fenced = direct.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced) {
    try {
      const parsed = JSON.parse(fenced);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // continue to brace extraction
    }
  }

  const firstBrace = direct.indexOf("{");
  const lastBrace = direct.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = direct.slice(firstBrace, lastBrace + 1);
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }

  return null;
}

function normalizeToolArguments(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }

  const output: Record<string, unknown> = {};
  for (const [key, current] of Object.entries(value)) {
    const normalizedKey = key.trim();
    if (!normalizedKey) continue;
    if (
      current === null ||
      typeof current === "string" ||
      typeof current === "number" ||
      typeof current === "boolean" ||
      Array.isArray(current) ||
      (typeof current === "object" && current !== null)
    ) {
      output[normalizedKey] = current;
    }
  }
  return output;
}

function isDestructiveToolAction(action: string, binding?: AgentToolBindingSummary | null) {
  const text = `${action} ${binding?.name ?? ""} ${binding?.description ?? ""}`.toLowerCase();
  return /\b(delete|remove|revoke|disconnect|cancel|archive|destroy|wipe|terminate)\b/.test(text);
}

function hasExplicitDestructiveIntent(prompt: string) {
  return /\b(delete|remove|revoke|disconnect|cancel|archive|destroy|wipe|terminate)\b/i.test(prompt);
}

async function inferAgentToolAction(
  input: {
    orgId: string;
    prompt: string;
    requestedToolkits: string[];
    toolBindings: AgentToolBindingSummary[];
    runtimeAgent: RuntimeAgentProfile;
  }
): Promise<ToolInferenceResult> {
  const candidateBindings = input.toolBindings.filter(
    (binding) =>
      input.requestedToolkits.length === 0 ||
      requestedToolkitIncludesForExecution(input.requestedToolkits, binding.toolkit)
  );

  const heuristic = inferAgentToolActionHeuristic(
    input.prompt,
    input.requestedToolkits,
    input.toolBindings
  );
  if (heuristic) {
    return {
      action: heuristic,
      metrics: {
        mode: "heuristic",
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        latencyMs: 0,
        costUsd: 0,
        provider: null,
        model: null,
        fallbackUsed: false,
        catalogSize: candidateBindings.length
      }
    };
  }

  const deterministicHumanInputReason = inferDeterministicHumanInputReason({
    prompt: input.prompt,
    requestedToolkits: input.requestedToolkits
  });
  if (deterministicHumanInputReason) {
    return {
      action: null,
      reason: deterministicHumanInputReason,
      metrics: {
        mode: "heuristic",
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        latencyMs: 0,
        costUsd: 0,
        provider: null,
        model: null,
        fallbackUsed: false,
        catalogSize: candidateBindings.length
      }
    };
  }

  if (candidateBindings.length === 0) {
    return {
      action: null,
      metrics: {
        mode: "none",
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        latencyMs: 0,
        costUsd: 0,
        provider: null,
        model: null,
        fallbackUsed: false,
        catalogSize: 0
      }
    };
  }

  const routerBypass = shouldBypassLlmToolRouter({
    prompt: input.prompt,
    requestedToolkits: input.requestedToolkits,
    candidateBindings
  });
  if (routerBypass.bypass) {
    return {
      action: null,
      metrics: {
        mode: "none",
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        latencyMs: 0,
        costUsd: 0,
        provider: null,
        model: null,
        fallbackUsed: false,
        catalogSize: Math.min(candidateBindings.length, Math.max(1, TOOL_ACTION_CATALOG_LIMIT))
      }
    };
  }

  if (!TOOL_ROUTER_ENABLE_LLM) {
    return {
      action: null,
      metrics: {
        mode: "none",
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        latencyMs: 0,
        costUsd: 0,
        provider: null,
        model: null,
        fallbackUsed: false,
        catalogSize: Math.min(candidateBindings.length, Math.max(1, TOOL_ACTION_CATALOG_LIMIT))
      }
    };
  }

  const inferenceStartedAt = Date.now();
  const filteredBindings = filterToolCatalogForPrompt({
    prompt: input.prompt,
    bindings: candidateBindings,
    maxItems: Math.max(1, TOOL_ACTION_CATALOG_LIMIT)
  });
  const actionCatalog = filteredBindings
    .map((binding) => ({
      toolkit: binding.toolkit,
      action: binding.slug.toUpperCase(),
      name: binding.name,
      description: truncateText(binding.description, 160)
    }));

  try {
    const runtime = await getOrgLlmRuntime(input.orgId);

    const execution = await executeSwarmAgent({
      taskId: `tool-router-${Date.now()}`,
      flowId: "tool-router",
      prompt: input.prompt,
      agent: input.runtimeAgent,
      contextBlocks: [],
      organizationRuntime: runtime,
      systemPromptOverride: [
        "Route the prompt to one catalog action or request human input.",
        "Return JSON only.",
        'Schema: {"mode":"EXECUTE|HUMAN_INPUT|NONE","toolkit":"","action":"","arguments":{},"reason":"","missing":[]}',
        "Use only actions from the catalog.",
        "If required params are missing for write/destructive actions, return HUMAN_INPUT."
      ].join("\n"),
      userPromptOverride: [
        `Prompt: ${input.prompt}`,
        `Requested toolkits: ${input.requestedToolkits.join(", ") || "none"}`,
        `Catalog: ${JSON.stringify(actionCatalog)}`,
        "JSON:"
      ].join("\n"),
      maxOutputTokens: TOOL_ROUTER_MAX_OUTPUT_TOKENS
    });
    const metrics: ToolInferenceMetrics = {
      mode: "llm",
      promptTokens: execution.tokenUsage?.promptTokens ?? 0,
      completionTokens: execution.tokenUsage?.completionTokens ?? 0,
      totalTokens: execution.tokenUsage?.totalTokens ?? 0,
      latencyMs:
        typeof execution.trace.durationMs === "number"
          ? execution.trace.durationMs
          : Date.now() - inferenceStartedAt,
      costUsd:
        typeof execution.billing?.totalCostUsd === "number" ? execution.billing.totalCostUsd : 0,
      provider: execution.usedProvider ?? null,
      model: execution.usedModel ?? null,
      fallbackUsed: execution.fallbackUsed,
      catalogSize: actionCatalog.length
    };

    if (!execution.ok || !execution.outputText) {
      return { action: null, metrics };
    }

    const parsed = parseJsonObjectFromText(execution.outputText);
    if (!parsed) {
      return { action: null, metrics };
    }

    const mode = asString(parsed.mode).toUpperCase();
    if (mode === "NONE") {
      return { action: null, metrics };
    }

    if (mode === "HUMAN_INPUT") {
      const missing = Array.isArray(parsed.missing)
        ? parsed.missing
            .map((item) => (typeof item === "string" ? item.trim() : ""))
            .filter(Boolean)
        : [];
      const reason = asString(parsed.reason) || "Tool action needs additional human input.";
      return {
        action: null,
        reason: missing.length > 0 ? `${reason} Missing: ${missing.join(", ")}` : reason,
        metrics
      };
    }

    if (mode !== "EXECUTE") {
      return { action: null, metrics };
    }

    const toolkit = asString(parsed.toolkit).toLowerCase();
    const action = asString(parsed.action).toUpperCase();
    if (!toolkit || !action) {
      return { action: null, metrics };
    }

    const binding = candidateBindings.find(
      (item) =>
        toolkitMatchesForExecution(item.toolkit, toolkit) && item.slug.toUpperCase() === action
    );
    if (!binding) {
      return { action: null, metrics };
    }

    if (isDestructiveToolAction(action, binding) && !hasExplicitDestructiveIntent(input.prompt)) {
      return {
        action: null,
        reason: `Action ${action} is destructive. Explicit user confirmation is required before execution.`,
        metrics
      };
    }

    return {
      action: {
        toolkit: binding.toolkit,
        action,
        arguments: normalizeToolArguments(parsed.arguments)
      },
      metrics
    };
  } catch {
    return {
      action: null,
      metrics: {
        mode: "none",
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        latencyMs: Date.now() - inferenceStartedAt,
        costUsd: 0,
        provider: null,
        model: null,
        fallbackUsed: false,
        catalogSize: actionCatalog.length
      }
    };
  }
}

function cleanHumanInputLine(line: string) {
  return line
    .replace(/^#+\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .trim();
}

function parseHumanInputListItem(line: string) {
  const bullet = line.match(/^(?:[-*]|\u2022)\s+(.+)$/u);
  if (bullet?.[1]) {
    return bullet[1].trim();
  }

  const numbered = line.match(/^\d+\s*[\).:-]\s+(.+)$/);
  if (numbered?.[1]) {
    return numbered[1].trim();
  }

  return null;
}

function collectHumanInputItems(lines: string[], startIndex: number) {
  const items: string[] = [];

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = cleanHumanInputLine(rawLine);
    if (!line) {
      continue;
    }

    if (/^human\s*touch\s*(intervention)?\s*required:?$/i.test(line)) {
      break;
    }

    if (/^(?:missing\s*data|please\s+provide)\b/i.test(line)) {
      continue;
    }

    if (/^[A-Za-z][A-Za-z\s]{0,40}:\s*$/.test(line)) {
      if (items.length > 0) {
        break;
      }
      continue;
    }

    if (/^\*\*.+\*\*$/.test(rawLine) && items.length > 0) {
      break;
    }

    const parsedItem = parseHumanInputListItem(line);
    if (parsedItem) {
      items.push(parsedItem);
      continue;
    }

    if (items.length === 0) {
      items.push(line.replace(/:$/, "").trim());
    } else {
      items[items.length - 1] = `${items[items.length - 1]} ${line}`;
    }
  }

  return items;
}

function inferHumanInputReasonFromOutput(outputText: string) {
  const normalized = outputText.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return null;
  }

  const requiresInputSignal =
    /missing\s*data|human\s*touch\s*(intervention)?\s*required|please\s+provide|input\s+required/i.test(
      normalized
    );
  if (!requiresInputSignal) {
    return null;
  }

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const missingDataIndex = lines.findIndex((line) => /missing\s*data/i.test(line));
  if (missingDataIndex >= 0) {
    const missingItems = collectHumanInputItems(lines, missingDataIndex);
    if (missingItems.length > 0) {
      return `Missing required input: ${missingItems.join(" | ")}`;
    }
  }

  const provideIndex = lines.findIndex((line) => /please\s+provide/i.test(line));
  if (provideIndex >= 0) {
    const provideItems = collectHumanInputItems(lines, provideIndex);
    if (provideItems.length > 0) {
      return `Please provide: ${provideItems.join(" | ")}`;
    }

    const provideLine = cleanHumanInputLine(lines[provideIndex]).replace(
      /^(?:[-*]|\u2022)\s+/u,
      ""
    );
    if (provideLine) {
      return provideLine;
    }
  }

  return "Human Touch required: additional input is needed before task execution can continue.";
}

function resolveAgentExecutionKey() {
  return resolveInternalApiKey();
}

async function listExecutionUserCandidates(input: {
  orgId: string;
  preferredUserId?: string | null;
  requestedToolkits: string[];
}) {
  const memberships = await prisma.orgMember.findMany({
    where: { orgId: input.orgId },
    orderBy: {
      createdAt: "asc"
    },
    select: {
      userId: true,
      createdAt: true
    }
  });

  if (memberships.length === 0) {
    return [] as string[];
  }

  const preferredUserId = asString(input.preferredUserId);
  const requestedToolkits = normalizeToolkitList(input.requestedToolkits);

  if (requestedToolkits.length === 0) {
    const ordered = [...memberships].sort((a, b) => {
      const aPreferred = preferredUserId.length > 0 && a.userId === preferredUserId;
      const bPreferred = preferredUserId.length > 0 && b.userId === preferredUserId;
      if (aPreferred !== bPreferred) {
        return aPreferred ? -1 : 1;
      }
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    return [...new Set(ordered.map((item) => item.userId))];
  }

  const requestedCanonical = [...new Set(requestedToolkits.map(canonicalToolkitForExecutionLookup))];
  const requestedVariants = [
    ...new Set(requestedCanonical.flatMap((toolkit) => toolkitExecutionLookupVariants(toolkit)))
  ];

  const activeConnections = await prisma.userIntegration.findMany({
    where: {
      userId: {
        in: memberships.map((item) => item.userId)
      },
      provider: "composio",
      status: "ACTIVE",
      toolkit: {
        in: requestedVariants
      },
      OR: [{ orgId: input.orgId }, { orgId: null }]
    },
    select: {
      userId: true,
      toolkit: true
    }
  });

  const coverageByUser = new Map<string, Set<string>>();
  for (const connection of activeConnections) {
    const canonicalToolkit = canonicalToolkitForExecutionLookup(connection.toolkit);
    const set = coverageByUser.get(connection.userId) ?? new Set<string>();
    set.add(canonicalToolkit);
    coverageByUser.set(connection.userId, set);
  }

  const requestedCount = requestedCanonical.length;
  const ranked = memberships
    .map((membership) => {
      const coverage = coverageByUser.get(membership.userId)?.size ?? 0;
      const preferred = preferredUserId.length > 0 && membership.userId === preferredUserId;
      return {
        userId: membership.userId,
        createdAt: membership.createdAt,
        coverage,
        preferred,
        fullyCovered: requestedCount > 0 && coverage >= requestedCount
      };
    })
    .sort((a, b) => {
      if (a.fullyCovered !== b.fullyCovered) {
        return a.fullyCovered ? -1 : 1;
      }
      if (a.coverage !== b.coverage) {
        return b.coverage - a.coverage;
      }
      if (a.preferred !== b.preferred) {
        return a.preferred ? -1 : 1;
      }
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

  return [...new Set(ranked.map((item) => item.userId))];
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
  } satisfies RuntimeAgentProfile;
}

const runtimeAgentSelect = {
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
} as const;

async function resolveMainBrainProfile(orgId: string): Promise<RuntimeAgentProfile | null> {
  const primary =
    (await prisma.personnel.findFirst({
      where: {
        orgId,
        type: "AI",
        role: { contains: "Main", mode: "insensitive" },
        status: { not: PersonnelStatus.DISABLED }
      },
      select: runtimeAgentSelect
    })) ??
    (await prisma.personnel.findFirst({
      where: {
        orgId,
        type: "AI",
        role: { contains: "Boss", mode: "insensitive" },
        status: { not: PersonnelStatus.DISABLED }
      },
      select: runtimeAgentSelect
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
      select: runtimeAgentSelect
    }));

  return primary ?? null;
}

function applyMainBrainProfile(
  target: RuntimeAgentProfile,
  mainBrain: RuntimeAgentProfile | null
) {
  if (!mainBrain) {
    return {
      agent: target,
      inherited: false,
      sourceAgentId: null
    };
  }

  return {
    agent: {
      ...target,
      brainConfig: mainBrain.brainConfig,
      fallbackBrainConfig: mainBrain.fallbackBrainConfig,
      brainKeyEnc: mainBrain.brainKeyEnc,
      brainKeyIv: mainBrain.brainKeyIv,
      brainKeyAuthTag: mainBrain.brainKeyAuthTag,
      brainKeyKeyVer: mainBrain.brainKeyKeyVer,
      fallbackBrainKeyEnc: mainBrain.fallbackBrainKeyEnc,
      fallbackBrainKeyIv: mainBrain.fallbackBrainKeyIv,
      fallbackBrainKeyAuthTag: mainBrain.fallbackBrainKeyAuthTag,
      fallbackBrainKeyKeyVer: mainBrain.fallbackBrainKeyKeyVer
    },
    inherited: true,
    sourceAgentId: mainBrain.id
  };
}

function isFlowExecutionBlocked(status: FlowStatus) {
  return (
    status === FlowStatus.PAUSED ||
    status === FlowStatus.FAILED ||
    status === FlowStatus.ABORTED ||
    status === FlowStatus.COMPLETED
  );
}

async function dispatchQueuedTasksForFlow(input: {
  orgId: string;
  flowId: string;
  initiatedByUserId?: string | null;
  origin?: string;
}) {
  let dispatched = 0;

  while (true) {
    const flow = await prisma.flow.findUnique({
      where: { id: input.flowId },
      select: {
        id: true,
        orgId: true,
        status: true
      }
    });

    if (!flow || flow.orgId !== input.orgId) {
      break;
    }

    if (isFlowExecutionBlocked(flow.status)) {
      break;
    }

    const nextTask = await prisma.task.findFirst({
      where: {
        flowId: input.flowId,
        status: TaskStatus.QUEUED
      },
      orderBy: {
        createdAt: "asc"
      },
      select: {
        id: true
      }
    });

    if (!nextTask) {
      break;
    }

    // Sequential execution keeps deterministic ordering and allows a pause gate to stop dispatch.
    // eslint-disable-next-line no-await-in-loop
    const result = await executeTaskById(
      nextTask.id,
      input.orgId,
      input.initiatedByUserId ?? null,
      input.origin
    );
    dispatched += 1;

    if (!result.ok) {
      break;
    }
  }

  return { dispatched };
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
        select: runtimeAgentSelect
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

  if (task.status === TaskStatus.QUEUED) {
    const claim = await prisma.task.updateMany({
      where: {
        id: task.id,
        flowId: task.flowId,
        status: TaskStatus.QUEUED
      },
      data: {
        status: TaskStatus.RUNNING,
        isPausedForInput: false,
        humanInterventionReason: null
      }
    });

    if (claim.count === 0) {
      return {
        ok: true,
        ignored: true,
        reason: "Task execution already claimed by another worker."
      };
    }
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
        select: runtimeAgentSelect
      })) ??
      (await prisma.personnel.findFirst({
        where: {
          orgId,
          type: "AI",
          role: { contains: "Boss", mode: "insensitive" },
          status: { not: PersonnelStatus.DISABLED }
        },
        select: runtimeAgentSelect
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
        select: runtimeAgentSelect
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
  const promptWithoutToolkitMarker = task.prompt.replace(/\|\s*toolkits?\s*:[^\n|]+/gi, " ");
  const semanticPromptToolkits = inferRequestedToolkits(promptWithoutToolkitMarker);
  const promptToolkits =
    semanticPromptToolkits.length > 0
      ? semanticPromptToolkits
      : inferRequestedToolkits(task.prompt);
  const requestedToolkits = resolveTaskRequestedToolkits({
    traceToolkits,
    promptToolkits
  });

  const existingToolAccessLedger = asRecord(traceRecord.toolAccessLedger);
  const hasToolAccessLedger = Boolean(existingToolAccessLedger.requestedAt);
  const existingLedgerToolkits = Array.isArray(existingToolAccessLedger.requestedToolkits)
    ? existingToolAccessLedger.requestedToolkits
        .map((item) => (typeof item === "string" ? item.trim().toLowerCase() : ""))
        .filter(Boolean)
    : [];
  const shouldRefreshToolAccessLedger =
    requestedToolkits.length > 0 &&
    (!hasToolAccessLedger ||
      toolkitSetSignature(existingLedgerToolkits) !== toolkitSetSignature(requestedToolkits));
  if (shouldRefreshToolAccessLedger) {
    const toolAccessLedger = {
      requestedAt: new Date().toISOString(),
      requestedToolkits,
      action: "TASK_EXECUTION",
      source: promptToolkits.length > 0 ? "prompt_inference" : "trace_fallback"
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
  const preferredExecutionUserId = orchestratorUserIdHint || traceInitiatedByUserId || null;
  const executionUserCandidates = await listExecutionUserCandidates({
    orgId,
    preferredUserId: preferredExecutionUserId,
    requestedToolkits
  });
  let executionUserId: string | null = executionUserCandidates[0] ?? null;

  let toolBindings: AgentToolBindingSummary[] = [];
  if (requestedToolkits.length > 0) {
    if (executionUserCandidates.length === 0) {
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

    const executionCandidateWindow = executionUserCandidates.slice(
      0,
      Math.max(1, TOOL_EXECUTION_USER_CANDIDATE_LIMIT)
    );
    let lastIntegrationError: {
      code: "INTEGRATION_NOT_CONNECTED";
      toolkit: string;
      action: string;
      connectUrl?: string;
    } | null = null;
    let lastIntegrationFailure = "";
    let resolvedExecutionUserId: string | null = null;

    for (const candidateUserId of executionCandidateWindow) {
      try {
        const toolsForAgent = await getToolsForAgent({
          userId: candidateUserId,
          orgId,
          requestedToolkits,
          action: "TASK_EXECUTION"
        });

        if (!toolsForAgent.ok && toolsForAgent.error) {
          lastIntegrationError = toolsForAgent.error;
          continue;
        }

        resolvedExecutionUserId = candidateUserId;
        toolBindings = toolsForAgent.bindings;
        break;
      } catch (error) {
        lastIntegrationFailure =
          error instanceof Error ? error.message : "Integration resolver unavailable.";
      }
    }

    executionUserId = resolvedExecutionUserId;
    if (!executionUserId) {
      if (lastIntegrationError) {
        return handleEvent({
          name: "vorldx/task.paused",
          data: {
            orgId,
            taskId: task.id,
            reason: `Tool integration "${lastIntegrationError.toolkit}" is not connected.`,
            integrationError: lastIntegrationError,
            executionTrace: {
              requestedToolkits,
              executionUserCandidates: executionCandidateWindow,
              integrationError: lastIntegrationError
            }
          }
        }, origin);
      }

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
            executionUserCandidates: executionCandidateWindow,
            integrationFailure: lastIntegrationFailure || "Integration resolver unavailable."
          }
        }
      }, origin);
    }
  }

  const executionMode = await resolveOrgExecutionMode(orgId);
  const logicalAgent = await resolveOrCreateTaskAgentProfile({
    orgId,
    flowId: task.flowId,
    taskPrompt: task.prompt,
    personnelId: agent.id.startsWith("main-agent-proxy:") ? null : agent.id
  });
  if (!logicalAgent) {
    return handleEvent({
      name: "vorldx/task.failed",
      data: {
        orgId,
        taskId: task.id,
        error: "Agent runtime profile could not be resolved."
      }
    }, origin);
  }

  const budgetSnapshot = await getAgentBudgetSnapshot({
    orgId,
    flowId: task.flowId
  });
  const complexity = assessTaskComplexity({
    prompt: task.prompt,
    requiredFiles: task.requiredFiles,
    requestedToolkits
  });
  const contextPack = await buildAgentContextPack({
    orgId,
    flowId: task.flowId,
    taskId: task.id,
    prompt: task.prompt,
    mode: executionMode,
    agentId: logicalAgent.id,
    userId: executionUserId,
    parentRunId: asString(asRecord(asRecord(task.executionTrace).agentRuntime).agentRunId) || null,
    requiredToolkits: requestedToolkits,
    budgetSnapshot
  });
  const contextCharCount = [...context.contextBlocks, ...contextPack.blocks].reduce(
    (total, block) => total + block.content.length,
    0
  );
  const estimatedSelfCostUsd = estimateTaskExecutionCostUsd({
    prompt: task.prompt,
    contextCharCount,
    requiredToolkits: requestedToolkits,
    complexityScore: complexity.score,
    mode: executionMode
  });
  const estimatedDelegationCostUsd = Number(
    (estimatedSelfCostUsd + estimateDelegationOverheadUsd(executionMode)).toFixed(4)
  );

  const orchestratorTrace = asRecord(asRecord(task.executionTrace).orchestrator);
  const multiAgentRequested = asString(orchestratorTrace.mode).toUpperCase() === "MULTI_AGENT";
  const taskStage = parseTaskStage(asString(orchestratorTrace.stage));
  const stepIndex = asNumber(orchestratorTrace.stepIndex);
  const totalSteps = asNumber(orchestratorTrace.totalSteps);
  const targetDelegationRole = complexity.score >= 0.78 ? "MANAGER" : "WORKER";

  const reusableChildren = await listReusableChildAgents({
    orgId,
    flowId: task.flowId,
    parentAgentId: logicalAgent.id,
    role: targetDelegationRole,
    requestedToolkits
  });
  const policyDecision = decideDelegation({
    executionMode,
    agentRole: logicalAgent.role,
    budget: budgetSnapshot,
    complexity,
    estimatedSelfCostUsd,
    estimatedDelegationCostUsd,
    requiredToolkits: requestedToolkits,
    missingToolkits: [],
    requiresApproval:
      complexity.riskScore >=
      (executionMode === "ECO" ? 0.9 : executionMode === "TURBO" ? 0.72 : 0.82),
    blockedByPolicy: false,
    availableChildAgents: reusableChildren.length,
    multiAgentRequested,
    taskStage,
    stepIndex,
    totalSteps
  });

  let effectiveDecision = policyDecision;
  let activeLogicalAgent = logicalAgent;
  if (
    policyDecision.decision === AgentDecisionType.DELEGATE_NEW &&
    policyDecision.targetRole
  ) {
    const delegatedPersonnelId = await pickDelegationPersonnelCandidate({
      orgId,
      role: policyDecision.targetRole,
      excludePersonnelId: logicalAgent.personnelId,
      taskPrompt: task.prompt,
      requestedToolkits
    });
    const delegatedSpecialty = inferDelegationSpecialty(task.prompt, requestedToolkits);
    const criticalRules = buildChildAgentCriticalRules(task.prompt, requestedToolkits);

    activeLogicalAgent = await createChildAgent({
      orgId,
      flowId: task.flowId,
      parentAgentId: logicalAgent.id,
      personnelId: delegatedPersonnelId,
      role: policyDecision.targetRole,
      goal: `Delegated task: ${task.prompt}`.slice(0, 1400),
      allowedTools: requestedToolkits,
      specialty: delegatedSpecialty,
      criticalRules,
      budgetScope: {
        maxUsd: Math.max(0.01, Math.min(estimatedDelegationCostUsd, budgetSnapshot.remainingBudgetUsd))
      },
      executionMode
    });

    await recordDelegation({
      orgId,
      flowId: task.flowId,
      taskId: task.id,
      fromAgentId: logicalAgent.id,
      toAgentId: activeLogicalAgent.id,
      decisionType: AgentDecisionType.DELEGATE_NEW,
      reason: policyDecision.reason,
      metadata: toInputJsonValue({
        estimatedDelegationCostUsd,
        complexity,
        delegatedSpecialty
      })
    });

    await publishRealtimeEvent({
      orgId,
      event: "agent.delegated",
      payload: {
        flowId: task.flowId,
        taskId: task.id,
        fromAgentId: logicalAgent.id,
        toAgentId: activeLogicalAgent.id,
        toRole: activeLogicalAgent.role,
        decisionType: AgentDecisionType.DELEGATE_NEW
      }
    });
  } else if (policyDecision.decision === AgentDecisionType.DELEGATE_EXISTING && reusableChildren[0]) {
    activeLogicalAgent = reusableChildren[0];
    await recordDelegation({
      orgId,
      flowId: task.flowId,
      taskId: task.id,
      fromAgentId: logicalAgent.id,
      toAgentId: activeLogicalAgent.id,
      decisionType: AgentDecisionType.DELEGATE_EXISTING,
      reason: policyDecision.reason,
      metadata: toInputJsonValue({
        reusedChildAgentId: activeLogicalAgent.id,
        complexity
      })
    });

    await publishRealtimeEvent({
      orgId,
      event: "agent.delegated",
      payload: {
        flowId: task.flowId,
        taskId: task.id,
        fromAgentId: logicalAgent.id,
        toAgentId: activeLogicalAgent.id,
        toRole: activeLogicalAgent.role,
        decisionType: AgentDecisionType.DELEGATE_EXISTING
      }
    });
  }

  const scopeCheck = resolveScopeViolations({
    agentName: activeLogicalAgent.name,
    allowedTools: activeLogicalAgent.allowedTools,
    requestedToolkits,
    estimatedCostUsd: effectiveDecision.estimatedCostUsd,
    budgetScope: activeLogicalAgent.budgetScope
  });
  if (scopeCheck.violation) {
    effectiveDecision = {
      decision: AgentDecisionType.HALT_POLICY,
      reason: scopeCheck.violation,
      targetRole: null,
      shouldCreateChild: false,
      estimatedCostUsd: effectiveDecision.estimatedCostUsd,
      estimatedDelegationCostUsd: effectiveDecision.estimatedDelegationCostUsd
    };
  }

  const priorRuntimeTrace = asRecord(asRecord(task.executionTrace).agentRuntime);
  const priorRunId = asString(priorRuntimeTrace.agentRunId) || null;
  const createdDelegatorRun = activeLogicalAgent.id !== logicalAgent.id;

  let parentRunId: string | null = priorRunId;
  if (createdDelegatorRun) {
    const parentRun = await createAgentRun({
      orgId,
      agentId: logicalAgent.id,
      flowId: task.flowId,
      taskId: task.id,
      parentRunId: priorRunId,
      goal: logicalAgent.goal ?? task.prompt,
      prompt: task.prompt,
      contextPack: toInputJsonValue({
        summary: contextPack.summary,
        delegatedTo: activeLogicalAgent.id,
        executionMode: contextPack.executionMode,
        contextSelectionTrace: contextPack.selectionTrace ?? null
      }),
      decisionType: effectiveDecision.decision,
      decisionReason: effectiveDecision.reason,
      executionMode,
      budgetBefore: budgetSnapshot.remainingBudgetUsd,
      estimatedCostUsd: effectiveDecision.estimatedDelegationCostUsd
    });
    parentRunId = parentRun.id;
  }

  const agentRun = await createAgentRun({
    orgId,
    agentId: activeLogicalAgent.id,
    flowId: task.flowId,
    taskId: task.id,
    parentRunId,
    goal: activeLogicalAgent.goal ?? task.prompt,
    prompt: task.prompt,
    contextPack: toInputJsonValue({
      summary: contextPack.summary,
      memoryHighlights: contextPack.memoryHighlights,
      dnaHighlights: contextPack.dnaHighlights,
      executionMode: contextPack.executionMode,
      budgetSnapshot: contextPack.budgetSnapshot,
      contextSelectionTrace: contextPack.selectionTrace ?? null
    }),
    decisionType: effectiveDecision.decision,
    decisionReason: effectiveDecision.reason,
    executionMode,
    budgetBefore: budgetSnapshot.remainingBudgetUsd,
    estimatedCostUsd: effectiveDecision.estimatedCostUsd
  });

  await persistMemoryCandidateSafe({
    orgId,
    userId: executionUserId,
    agentId: activeLogicalAgent.id,
    sessionId: task.flowId,
    projectId: task.flowId,
    source: "agent_decision",
    memoryType: "TASK",
    visibility: "SHARED",
    tags: ["decision", effectiveDecision.decision.toLowerCase()],
    importanceHint: 0.72,
    summary: `${effectiveDecision.decision}: ${truncateText(effectiveDecision.reason, 180)}`,
    content: [
      `Task prompt: ${truncateText(task.prompt, 1200)}`,
      `Decision: ${effectiveDecision.decision}`,
      `Reason: ${truncateText(effectiveDecision.reason, 500)}`,
      `Execution mode: ${executionMode}`,
      `Required toolkits: ${requestedToolkits.join(", ") || "none"}`
    ].join("\\n"),
    metadata: toInputJsonValue({
      flowId: task.flowId,
      taskId: task.id,
      agentRunId: agentRun.id,
      estimatedCostUsd: effectiveDecision.estimatedCostUsd,
      estimatedDelegationCostUsd: effectiveDecision.estimatedDelegationCostUsd
    })
  });

  if (createdDelegatorRun && parentRunId) {
    await finalizeAgentRun({
      runId: parentRunId,
      status: AgentStatus.COMPLETED,
      budgetAfter: budgetSnapshot.remainingBudgetUsd,
      metadata: toInputJsonValue({
        delegatedToRunId: agentRun.id,
        delegatedToAgentId: activeLogicalAgent.id
      })
    });

    const pendingDelegation = await prisma.agentDelegation.findFirst({
      where: {
        orgId,
        flowId: task.flowId,
        taskId: task.id,
        fromAgentId: logicalAgent.id,
        toAgentId: activeLogicalAgent.id,
        fromRunId: null,
        toRunId: null
      },
      orderBy: {
        createdAt: "desc"
      },
      select: {
        id: true
      }
    });

    if (pendingDelegation) {
      await prisma.agentDelegation.update({
        where: {
          id: pendingDelegation.id
        },
        data: {
          fromRunId: parentRunId,
          toRunId: agentRun.id,
          status: "dispatched"
        }
      });
    }
  }

  const workflowSteps: WorkflowStepBreakdown[] = [];

  if (
    effectiveDecision.decision === AgentDecisionType.HALT_BUDGET ||
    effectiveDecision.decision === AgentDecisionType.HALT_POLICY ||
    effectiveDecision.decision === AgentDecisionType.ASK_HUMAN
  ) {
    const reason =
      effectiveDecision.decision === AgentDecisionType.HALT_BUDGET
        ? `Budget policy halted execution: ${effectiveDecision.reason}`
        : effectiveDecision.reason;

    await persistMemoryCandidateSafe({
      orgId,
      userId: executionUserId,
      agentId: activeLogicalAgent.id,
      sessionId: task.flowId,
      projectId: task.flowId,
      source: "agent_halt",
      memoryType: "EPISODIC",
      visibility: "SHARED",
      tags: ["halt", effectiveDecision.decision.toLowerCase(), "human_touch"],
      importanceHint: 0.86,
      summary: truncateText(reason, 220),
      content: [
        `Task ${task.id} paused before execution.`,
        `Decision: ${effectiveDecision.decision}`,
        `Reason: ${truncateText(reason, 1000)}`
      ].join("\\n"),
      metadata: toInputJsonValue({
        flowId: task.flowId,
        taskId: task.id,
        agentRunId: agentRun.id,
        policyDecision: effectiveDecision
      })
    });

    await createApprovalCheckpoint({
      orgId,
      flowId: task.flowId,
      taskId: task.id,
      agentId: activeLogicalAgent.id,
      agentRunId: agentRun.id,
      reason,
      approvalPolicy: toInputJsonValue({
        decision: effectiveDecision.decision
      }),
      metadata: toInputJsonValue({
        budgetSnapshot,
        complexity
      })
    });

    await finalizeAgentRun({
      runId: agentRun.id,
      status: AgentStatus.WAITING_HUMAN,
      budgetAfter: budgetSnapshot.remainingBudgetUsd,
      metadata: toInputJsonValue({
        decision: effectiveDecision
      })
    });

    return handleEvent({
      name: "vorldx/task.paused",
      data: {
        orgId,
        taskId: task.id,
        reason,
        executionTrace: {
          policyDecision: effectiveDecision,
          agentRunId: agentRun.id
        }
      }
    }, origin);
  }

  let runtimeAgent = agent;
  if (activeLogicalAgent.personnelId && activeLogicalAgent.personnelId !== task.agentId) {
    const delegatedPersonnel = await prisma.personnel.findUnique({
      where: { id: activeLogicalAgent.personnelId },
      select: runtimeAgentSelect
    });
    if (delegatedPersonnel) {
      runtimeAgent = delegatedPersonnel;
      await prisma.task.update({
        where: { id: task.id },
        data: { agentId: delegatedPersonnel.id }
      });
    }
  }

  const mainBrainProfile = await resolveMainBrainProfile(orgId);
  const sharedBrain = applyMainBrainProfile(runtimeAgent, mainBrainProfile);
  runtimeAgent = sharedBrain.agent;

  const inferredToolPlan = await inferAgentToolAction({
    orgId,
    prompt: task.prompt,
    requestedToolkits,
    toolBindings,
    runtimeAgent
  });
  const inferredToolAction = inferredToolPlan.action;
  let toolActionExecution: ToolActionExecutionResult | null = null;

  if (inferredToolPlan.metrics) {
    try {
      await prisma.log.create({
        data: {
          orgId,
          type: LogType.EXE,
          actor: "TOOL_ROUTER",
          message: `task=${task.id}; mode=${inferredToolPlan.metrics.mode}; tokens=${inferredToolPlan.metrics.totalTokens}; latencyMs=${inferredToolPlan.metrics.latencyMs}; provider=${inferredToolPlan.metrics.provider ?? "none"}; model=${inferredToolPlan.metrics.model ?? "none"}; catalogSize=${inferredToolPlan.metrics.catalogSize}`
        }
      });
    } catch {
      // Router telemetry is best-effort only.
    }

    workflowSteps.push({
      step: "tool_router",
      model: inferredToolPlan.metrics.model,
      provider: inferredToolPlan.metrics.provider,
      promptTokens: inferredToolPlan.metrics.promptTokens,
      completionTokens: inferredToolPlan.metrics.completionTokens,
      totalTokens: inferredToolPlan.metrics.totalTokens,
      latencyMs: inferredToolPlan.metrics.latencyMs,
      retryCount: inferredToolPlan.metrics.fallbackUsed ? 1 : 0,
      fallbackCount: inferredToolPlan.metrics.fallbackUsed ? 1 : 0,
      tool: null,
      success: Boolean(inferredToolAction) || !inferredToolPlan.reason
    });
  }

  if (inferredToolPlan.reason) {
    const reason = inferredToolPlan.reason;
    await createApprovalCheckpoint({
      orgId,
      flowId: task.flowId,
      taskId: task.id,
      agentId: activeLogicalAgent.id,
      agentRunId: agentRun.id,
      reason,
      approvalPolicy: toInputJsonValue({
        decision: AgentDecisionType.ASK_HUMAN
      }),
      metadata: toInputJsonValue({
        requestedToolkits,
        toolInferenceMetrics: inferredToolPlan.metrics ?? null
      })
    });

    await finalizeAgentRun({
      runId: agentRun.id,
      status: AgentStatus.WAITING_HUMAN,
      budgetAfter: budgetSnapshot.remainingBudgetUsd,
      metadata: toInputJsonValue({
        reason
      })
    });

    return handleEvent({
      name: "vorldx/task.paused",
      data: {
        orgId,
        taskId: task.id,
        reason,
        executionTrace: {
          policyDecision: effectiveDecision,
          toolInferenceMetrics: inferredToolPlan.metrics ?? null,
          agentRunId: agentRun.id
        }
      }
    }, origin);
  }

  const scopedAllowedTools = normalizeToolkitList(activeLogicalAgent.allowedTools);
  if (
    inferredToolAction &&
    scopedAllowedTools.length > 0 &&
    !scopedAllowedTools.includes(inferredToolAction.toolkit)
  ) {
    const reason = `Agent scope blocked toolkit "${inferredToolAction.toolkit}" for ${activeLogicalAgent.name}.`;

    await createApprovalCheckpoint({
      orgId,
      flowId: task.flowId,
      taskId: task.id,
      agentId: activeLogicalAgent.id,
      agentRunId: agentRun.id,
      reason,
      approvalPolicy: toInputJsonValue({
        decision: AgentDecisionType.HALT_POLICY
      }),
      metadata: toInputJsonValue({
        requestedToolkits,
        allowedTools: scopedAllowedTools
      })
    });

    await finalizeAgentRun({
      runId: agentRun.id,
      status: AgentStatus.WAITING_HUMAN,
      budgetAfter: budgetSnapshot.remainingBudgetUsd,
      metadata: toInputJsonValue({
        reason,
        blockedToolkit: inferredToolAction.toolkit
      })
    });

    return handleEvent({
      name: "vorldx/task.paused",
      data: {
        orgId,
        taskId: task.id,
        reason,
        executionTrace: {
          policyDecision: effectiveDecision,
          blockedToolkit: inferredToolAction.toolkit,
          agentRunId: agentRun.id
        }
      }
    }, origin);
  }

  const primaryToolStartedAt = inferredToolAction ? Date.now() : 0;
  if (inferredToolAction && executionUserId && origin) {
    try {
      const internalKey = resolveAgentExecutionKey();
      const executeResponse = await fetchWithTimeout(`${origin}/api/agent/tools/execute`, {
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
        })
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

  if (inferredToolAction) {
    workflowSteps.push({
      step: "tool_execute_primary",
      model: null,
      provider: null,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs: primaryToolStartedAt > 0 ? Date.now() - primaryToolStartedAt : 0,
      retryCount:
        toolActionExecution && typeof toolActionExecution.attempts === "number"
          ? Math.max(0, toolActionExecution.attempts - 1)
          : 0,
      fallbackCount: 0,
      tool: `${inferredToolAction.toolkit}:${inferredToolAction.action}`,
      success: toolActionExecution?.ok === true
    });
  }

  let followupToolActionExecution: ToolActionExecutionResult | null = null;
  let notificationToolActionExecution: ToolActionExecutionResult | null = null;
  const primaryToolSuccess = toolActionExecution?.ok
    ? (toolActionExecution as ToolActionExecutionSuccess)
    : null;
  const recipientEmail = extractFirstEmail(task.prompt);
  const recipientPhone = extractFirstPhoneNumber(task.prompt);
  const meetingUri =
    primaryToolSuccess && primaryToolSuccess.toolkit === "googlemeet"
      ? extractMeetingUriFromToolData(primaryToolSuccess.data)
      : "";
  const shouldAttemptMeetingEmail =
    Boolean(
      origin &&
      executionUserId &&
      recipientEmail &&
      shouldSendMeetingDetailsEmail(task.prompt) &&
      requestedToolkitIncludesForExecution(requestedToolkits, "gmail") &&
      primaryToolSuccess &&
      primaryToolSuccess.toolkit === "googlemeet" &&
      primaryToolSuccess.action.includes("CREATE") &&
      meetingUri
    );
  const whatsappBinding = pickWhatsappSendBinding(toolBindings);
  const notificationIntentRequested = Boolean(
    origin &&
    executionUserId &&
    shouldSendMeetingNotification(task.prompt) &&
    requestedToolkitIncludesForExecution(requestedToolkits, "whatsapp") &&
    primaryToolSuccess &&
    primaryToolSuccess.toolkit === "googlemeet" &&
    primaryToolSuccess.action.includes("CREATE") &&
    meetingUri
  );
  const shouldAttemptMeetingNotification = Boolean(
    notificationIntentRequested && recipientPhone && whatsappBinding
  );
  const followupToolStartedAt = shouldAttemptMeetingEmail ? Date.now() : 0;
  const notificationToolStartedAt = shouldAttemptMeetingNotification ? Date.now() : 0;

  if (shouldAttemptMeetingEmail && executionUserId && origin && recipientEmail) {
    const sendMarkerKey = `flow.meeting-email.sent.${task.flowId}.${recipientEmail.toLowerCase()}`;
    const alreadySent = await prisma.memoryEntry.findFirst({
      where: {
        orgId,
        flowId: task.flowId,
        tier: MemoryTier.WORKING,
        key: sendMarkerKey,
        redactedAt: null
      },
      select: { id: true }
    });

    if (!alreadySent) {
      const meetingCode = asString(asRecord(primaryToolSuccess?.data).meetingCode);
      const emailArguments = buildMeetingDetailsEmail({
        recipient: recipientEmail,
        meetingUri,
        ...(meetingCode ? { meetingCode } : {}),
        prompt: task.prompt
      });

      try {
        const internalKey = resolveAgentExecutionKey();
        const executeResponse = await fetchWithTimeout(`${origin}/api/agent/tools/execute`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...buildInternalApiHeaders(),
            ...(internalKey ? { "x-agent-exec-key": internalKey } : {})
          },
          body: JSON.stringify({
            orgId,
            userId: executionUserId,
            toolkit: "gmail",
            action: "SEND_EMAIL",
            arguments: emailArguments,
            taskId: task.id
          })
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
                  toolkit: executePayload.error.toolkit || "gmail",
                  action: executePayload.error.action || "SEND_EMAIL",
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

          followupToolActionExecution = {
            ok: false,
            attempts: executePayload?.attempts ?? 1,
            error: {
              code: executePayload?.error?.code || "TOOLS_UNAVAILABLE",
              message: executePayload?.error?.message || "Follow-up email execution failed.",
              toolkit: "gmail",
              action: "SEND_EMAIL"
            }
          };
        } else {
          followupToolActionExecution = executePayload.result;
          await prisma.memoryEntry.create({
            data: {
              orgId,
              flowId: task.flowId,
              taskId: task.id,
              tier: MemoryTier.WORKING,
              key: sendMarkerKey,
              value: toInputJsonValue({
                sentAt: new Date().toISOString(),
                recipient: recipientEmail,
                meetingUri
              })
            }
          });
        }
      } catch (error) {
        followupToolActionExecution = {
          ok: false,
          attempts: 1,
          error: {
            code: "TOOLS_UNAVAILABLE",
            message: error instanceof Error ? error.message : "Follow-up email execution failed.",
            toolkit: "gmail",
            action: "SEND_EMAIL"
          }
        };
      }
    }
  }

  if (shouldAttemptMeetingEmail) {
    workflowSteps.push({
      step: "tool_execute_followup_email",
      model: null,
      provider: null,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs: followupToolStartedAt > 0 ? Date.now() - followupToolStartedAt : 0,
      retryCount:
        followupToolActionExecution && typeof followupToolActionExecution.attempts === "number"
          ? Math.max(0, followupToolActionExecution.attempts - 1)
          : 0,
      fallbackCount: 0,
      tool: "gmail:SEND_EMAIL",
      success: followupToolActionExecution?.ok === true
    });
  }

  if (followupToolActionExecution && !followupToolActionExecution.ok) {
    const reason = `Meeting details email failed: ${followupToolActionExecution.error.message}`;
    await createApprovalCheckpoint({
      orgId,
      flowId: task.flowId,
      taskId: task.id,
      agentId: activeLogicalAgent.id,
      agentRunId: agentRun.id,
      reason,
      metadata: toInputJsonValue({
        followupToolActionExecution
      })
    });

    await finalizeAgentRun({
      runId: agentRun.id,
      status: AgentStatus.WAITING_HUMAN,
      budgetAfter: budgetSnapshot.remainingBudgetUsd,
      metadata: toInputJsonValue({
        reason,
        followupToolActionExecution
      })
    });

    return handleEvent({
      name: "vorldx/task.paused",
      data: {
        orgId,
        taskId: task.id,
        reason,
        executionTrace: {
          policyDecision: effectiveDecision,
          followupToolActionExecution,
          agentRunId: agentRun.id
        }
      }
    }, origin);
  }

  if (notificationIntentRequested && !recipientPhone) {
    const reason =
      "WhatsApp notification requested but recipient phone is missing. Provide phone number to continue.";
    await createApprovalCheckpoint({
      orgId,
      flowId: task.flowId,
      taskId: task.id,
      agentId: activeLogicalAgent.id,
      agentRunId: agentRun.id,
      reason,
      metadata: toInputJsonValue({
        requestedToolkits,
        requiredField: "recipient_phone"
      })
    });

    await finalizeAgentRun({
      runId: agentRun.id,
      status: AgentStatus.WAITING_HUMAN,
      budgetAfter: budgetSnapshot.remainingBudgetUsd,
      metadata: toInputJsonValue({
        reason,
        requestedToolkits
      })
    });

    return handleEvent({
      name: "vorldx/task.paused",
      data: {
        orgId,
        taskId: task.id,
        reason,
        executionTrace: {
          policyDecision: effectiveDecision,
          missingInput: "recipient_phone",
          agentRunId: agentRun.id
        }
      }
    }, origin);
  }

  if (notificationIntentRequested && !whatsappBinding) {
    return handleEvent({
      name: "vorldx/task.paused",
      data: {
        orgId,
        taskId: task.id,
        reason: 'Tool integration "whatsapp" is not connected.',
        integrationError: {
          code: "INTEGRATION_NOT_CONNECTED",
          toolkit: "whatsapp",
          action: "SEND_MESSAGE"
        },
        executionTrace: {
          requestedToolkits,
          integrationError: {
            code: "INTEGRATION_NOT_CONNECTED",
            toolkit: "whatsapp",
            action: "SEND_MESSAGE"
          }
        }
      }
    }, origin);
  }

  if (shouldAttemptMeetingNotification && executionUserId && origin && recipientPhone && whatsappBinding) {
    const recipientKey = recipientPhone.replace(/[^+\d]/g, "");
    const sendMarkerKey = `flow.meeting-notification.sent.${task.flowId}.${recipientKey}`;
    const alreadySent = await prisma.memoryEntry.findFirst({
      where: {
        orgId,
        flowId: task.flowId,
        tier: MemoryTier.WORKING,
        key: sendMarkerKey,
        redactedAt: null
      },
      select: { id: true }
    });

    if (!alreadySent) {
      const meetingCode = asString(asRecord(primaryToolSuccess?.data).meetingCode);
      const notificationArguments = buildMeetingNotification({
        recipientPhone,
        meetingUri,
        ...(meetingCode ? { meetingCode } : {}),
        prompt: task.prompt
      });

      try {
        const internalKey = resolveAgentExecutionKey();
        const executeResponse = await fetchWithTimeout(`${origin}/api/agent/tools/execute`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...buildInternalApiHeaders(),
            ...(internalKey ? { "x-agent-exec-key": internalKey } : {})
          },
          body: JSON.stringify({
            orgId,
            userId: executionUserId,
            toolkit: whatsappBinding.toolkit,
            action: whatsappBinding.slug.toUpperCase(),
            arguments: {
              ...notificationArguments,
              meeting_uri: meetingUri,
              meeting_link: meetingUri,
              ...(recipientEmail
                ? { recipient_email: recipientEmail, email: recipientEmail }
                : {})
            },
            taskId: task.id
          })
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
                  toolkit: executePayload.error.toolkit || whatsappBinding.toolkit,
                  action: executePayload.error.action || whatsappBinding.slug.toUpperCase(),
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

          notificationToolActionExecution = {
            ok: false,
            attempts: executePayload?.attempts ?? 1,
            error: {
              code: executePayload?.error?.code || "TOOLS_UNAVAILABLE",
              message: executePayload?.error?.message || "Follow-up notification execution failed.",
              toolkit: whatsappBinding.toolkit,
              action: whatsappBinding.slug.toUpperCase()
            }
          };
        } else {
          notificationToolActionExecution = executePayload.result;
          await prisma.memoryEntry.create({
            data: {
              orgId,
              flowId: task.flowId,
              taskId: task.id,
              tier: MemoryTier.WORKING,
              key: sendMarkerKey,
              value: toInputJsonValue({
                sentAt: new Date().toISOString(),
                recipientPhone,
                meetingUri,
                action: whatsappBinding.slug.toUpperCase()
              })
            }
          });
        }
      } catch (error) {
        notificationToolActionExecution = {
          ok: false,
          attempts: 1,
          error: {
            code: "TOOLS_UNAVAILABLE",
            message:
              error instanceof Error
                ? error.message
                : "Follow-up notification execution failed.",
            toolkit: whatsappBinding.toolkit,
            action: whatsappBinding.slug.toUpperCase()
          }
        };
      }
    }
  }

  if (notificationIntentRequested) {
    workflowSteps.push({
      step: "tool_execute_followup_notification",
      model: null,
      provider: null,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs: notificationToolStartedAt > 0 ? Date.now() - notificationToolStartedAt : 0,
      retryCount:
        notificationToolActionExecution && typeof notificationToolActionExecution.attempts === "number"
          ? Math.max(0, notificationToolActionExecution.attempts - 1)
          : 0,
      fallbackCount: 0,
      tool: whatsappBinding
        ? `${whatsappBinding.toolkit}:${whatsappBinding.slug.toUpperCase()}`
        : "whatsapp:SEND_MESSAGE",
      success: notificationToolActionExecution?.ok === true
    });
  }

  if (notificationToolActionExecution && !notificationToolActionExecution.ok) {
    const reason = `Meeting notification failed: ${notificationToolActionExecution.error.message}`;
    await createApprovalCheckpoint({
      orgId,
      flowId: task.flowId,
      taskId: task.id,
      agentId: activeLogicalAgent.id,
      agentRunId: agentRun.id,
      reason,
      metadata: toInputJsonValue({
        notificationToolActionExecution
      })
    });

    await finalizeAgentRun({
      runId: agentRun.id,
      status: AgentStatus.WAITING_HUMAN,
      budgetAfter: budgetSnapshot.remainingBudgetUsd,
      metadata: toInputJsonValue({
        reason,
        notificationToolActionExecution
      })
    });

    return handleEvent({
      name: "vorldx/task.paused",
      data: {
        orgId,
        taskId: task.id,
        reason,
        executionTrace: {
          policyDecision: effectiveDecision,
          notificationToolActionExecution,
          agentRunId: agentRun.id
        }
      }
    }, origin);
  }

  const lockResult = await acquireTaskFileLocks({
    orgId,
    taskId: task.id,
    agentId: runtimeAgent.id,
    fileIds: context.resolvedRequiredFileIds
  });

  if (!lockResult.ok) {
    const blocking = lockResult.conflicts[0];
    const blockedReason = blocking
      ? `Required file "${blocking.fileName}" is locked by ${blocking.lockOwnerAgent ?? "another agent"}${blocking.lockOwnerTaskId ? ` (task ${blocking.lockOwnerTaskId})` : ""}.`
      : "Required file lock is currently held by another task.";

    await finalizeAgentRun({
      runId: agentRun.id,
      status: AgentStatus.BLOCKED,
      budgetAfter: budgetSnapshot.remainingBudgetUsd,
      metadata: toInputJsonValue({
        blockedReason,
        policyDecision: effectiveDecision
      })
    });

    return handleEvent({
      name: "vorldx/task.paused",
      data: {
        orgId,
        taskId: task.id,
        reason: blockedReason,
        executionTrace: {
          policyDecision: effectiveDecision,
          agentRunId: agentRun.id
        }
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
          message: `Task ${task.id} executing on agent ${runtimeAgent.name} (${runtimeAgent.role}) as logical role ${activeLogicalAgent.role}.${sharedBrain.inherited ? ` Brain source: Main Agent (${sharedBrain.sourceAgentId}).` : ""}`
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
      flowId: task.flowId,
      agentId: activeLogicalAgent.id,
      agentRole: activeLogicalAgent.role,
      parentAgentId: activeLogicalAgent.parentAgentId,
      agentRunId: agentRun.id,
      decisionType: effectiveDecision.decision
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
            content: toContextJson(
              toolBindings
                .slice(0, Math.max(1, TOOL_BINDING_CONTEXT_LIMIT))
                .map((binding) => ({
                  toolkit: binding.toolkit,
                  slug: binding.slug,
                  name: binding.name
                })),
              1800
            )
          }
        ]
      : [];

  const toolActionSuccess = toolActionExecution?.ok
    ? (toolActionExecution as ToolActionExecutionSuccess)
    : null;
  const toolActionFailure = toolActionExecution && !toolActionExecution.ok
    ? (toolActionExecution as ToolActionExecutionFailure)
    : null;
  const followupToolActionSuccess = followupToolActionExecution?.ok
    ? (followupToolActionExecution as ToolActionExecutionSuccess)
    : null;
  const followupToolActionFailure = followupToolActionExecution && !followupToolActionExecution.ok
    ? (followupToolActionExecution as ToolActionExecutionFailure)
    : null;
  const notificationToolActionSuccess = notificationToolActionExecution?.ok
    ? (notificationToolActionExecution as ToolActionExecutionSuccess)
    : null;
  const notificationToolActionFailure = notificationToolActionExecution && !notificationToolActionExecution.ok
    ? (notificationToolActionExecution as ToolActionExecutionFailure)
    : null;

  const toolActionContextBlocks =
    toolActionSuccess
      ? [
          {
            id: "composio-tool-action-result",
            name: "Executed Tool Result",
            amnesiaProtected: false,
            content: toContextJson({
              toolkit: toolActionSuccess.toolkit,
              action: toolActionSuccess.action,
              toolSlug: toolActionSuccess.toolSlug,
              data: normalizeToolDataForModelContext({
                toolkit: toolActionSuccess.toolkit,
                action: toolActionSuccess.action,
                data: toolActionSuccess.data
              })
            })
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
            content: toContextJson(toolActionFailure.error, 1400)
          }
        ]
      : [];
  const followupToolActionContextBlocks =
    followupToolActionSuccess
      ? [
          {
            id: "composio-tool-action-followup-result",
            name: "Executed Follow-up Tool Result",
            amnesiaProtected: false,
            content: toContextJson({
              toolkit: followupToolActionSuccess.toolkit,
              action: followupToolActionSuccess.action,
              toolSlug: followupToolActionSuccess.toolSlug,
              data: normalizeToolDataForModelContext({
                toolkit: followupToolActionSuccess.toolkit,
                action: followupToolActionSuccess.action,
                data: followupToolActionSuccess.data
              })
            })
          }
        ]
      : [];
  const followupToolActionErrorContextBlocks =
    followupToolActionFailure
      ? [
          {
            id: "composio-tool-action-followup-error",
            name: "Follow-up Tool Action Error",
            amnesiaProtected: false,
            content: toContextJson(followupToolActionFailure.error, 1400)
          }
        ]
      : [];
  const notificationToolActionContextBlocks =
    notificationToolActionSuccess
      ? [
          {
            id: "composio-tool-action-notification-result",
            name: "Executed Notification Tool Result",
            amnesiaProtected: false,
            content: toContextJson({
              toolkit: notificationToolActionSuccess.toolkit,
              action: notificationToolActionSuccess.action,
              toolSlug: notificationToolActionSuccess.toolSlug,
              data: normalizeToolDataForModelContext({
                toolkit: notificationToolActionSuccess.toolkit,
                action: notificationToolActionSuccess.action,
                data: notificationToolActionSuccess.data
              })
            })
          }
        ]
      : [];
  const notificationToolActionErrorContextBlocks =
    notificationToolActionFailure
      ? [
          {
            id: "composio-tool-action-notification-error",
            name: "Notification Tool Action Error",
            amnesiaProtected: false,
            content: toContextJson(notificationToolActionFailure.error, 1400)
          }
        ]
      : [];

  const taskExecutionMaxOutputTokens =
    executionMode === "ECO" ? 420 : executionMode === "TURBO" ? 900 : 650;
  const deterministicToolSummary = buildDeterministicToolSummary({
    prompt: task.prompt,
    primaryToolSuccess: toolActionSuccess,
    followupToolActionSuccess,
    notificationToolActionSuccess
  });
  const deterministicResponseUsed = Boolean(deterministicToolSummary);

  const execution = deterministicToolSummary
    ? {
        ok: true as const,
        outputText: deterministicToolSummary,
        fallbackUsed: false,
        usedProvider: "deterministic",
        usedModel: "none",
        apiSource: "none" as const,
        tokenUsage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0
        },
        billing: {
          mode: "BYOK" as const,
          plan: "STARTER" as const,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          baseCostUsd: 0,
          serviceFeeUsd: 0,
          totalCostUsd: 0
        },
        trace: {
          mode: "deterministic_tool_short_circuit",
          reason: "tool output already provides final user-facing response",
          toolAction: toolActionSuccess
            ? {
                toolkit: toolActionSuccess.toolkit,
                action: toolActionSuccess.action
              }
            : null,
          followupToolAction: followupToolActionSuccess
            ? {
                toolkit: followupToolActionSuccess.toolkit,
                action: followupToolActionSuccess.action
              }
            : null,
          notificationToolAction: notificationToolActionSuccess
            ? {
                toolkit: notificationToolActionSuccess.toolkit,
                action: notificationToolActionSuccess.action
              }
            : null,
          durationMs: 0
        }
      }
    : await executeSwarmAgent({
        taskId: task.id,
        flowId: task.flowId,
        prompt: task.prompt,
        agent: runtimeAgent,
        contextBlocks: [
          ...context.contextBlocks,
          ...contextPack.blocks,
          ...integrationContextBlocks,
          ...toolActionContextBlocks,
          ...toolActionErrorContextBlocks,
          ...followupToolActionContextBlocks,
          ...followupToolActionErrorContextBlocks,
          ...notificationToolActionContextBlocks,
          ...notificationToolActionErrorContextBlocks
        ],
        organizationRuntime: await getOrgLlmRuntime(orgId),
        maxOutputTokens: taskExecutionMaxOutputTokens
      });
  workflowSteps.push({
    step: deterministicResponseUsed ? "deterministic_tool_response" : "agent_response",
    model: execution.usedModel ?? null,
    provider: execution.usedProvider ?? null,
    promptTokens: execution.tokenUsage?.promptTokens ?? 0,
    completionTokens: execution.tokenUsage?.completionTokens ?? 0,
    totalTokens: execution.tokenUsage?.totalTokens ?? 0,
    latencyMs:
      typeof execution.trace.durationMs === "number" ? execution.trace.durationMs : 0,
    retryCount: execution.fallbackUsed ? 1 : 0,
    fallbackCount: execution.fallbackUsed ? 1 : 0,
    tool: null,
    success: execution.ok
  });
  const workflowTelemetry = summarizeWorkflowBreakdown(agentRun.id, workflowSteps);

  const primaryToolResultNormalized = toolActionSuccess
    ? normalizeToolDataForModelContext({
        toolkit: toolActionSuccess.toolkit,
        action: toolActionSuccess.action,
        data: toolActionSuccess.data
      })
    : null;
  const followupToolResultNormalized = followupToolActionSuccess
    ? normalizeToolDataForModelContext({
        toolkit: followupToolActionSuccess.toolkit,
        action: followupToolActionSuccess.action,
        data: followupToolActionSuccess.data
      })
    : null;
  const notificationToolResultNormalized = notificationToolActionSuccess
    ? normalizeToolDataForModelContext({
        toolkit: notificationToolActionSuccess.toolkit,
        action: notificationToolActionSuccess.action,
        data: notificationToolActionSuccess.data
      })
    : null;

  if (toolActionSuccess && primaryToolResultNormalized) {
    await persistMemoryCandidateSafe({
      orgId,
      userId: executionUserId,
      agentId: activeLogicalAgent.id,
      sessionId: task.flowId,
      projectId: task.flowId,
      source: "tool_result_primary",
      memoryType: "EPISODIC",
      visibility: "SHARED",
      tags: [
        "tool_result",
        toolActionSuccess.toolkit.toLowerCase(),
        toolActionSuccess.action.toLowerCase()
      ],
      importanceHint: 0.74,
      summary: `${toolActionSuccess.toolkit}:${toolActionSuccess.action} completed`,
      content: toContextJson({
        toolkit: toolActionSuccess.toolkit,
        action: toolActionSuccess.action,
        data: primaryToolResultNormalized
      }, 1800),
      metadata: toInputJsonValue({
        flowId: task.flowId,
        taskId: task.id,
        agentRunId: agentRun.id,
        toolSlug: toolActionSuccess.toolSlug
      })
    });
  }

  if (followupToolActionSuccess && followupToolResultNormalized) {
    await persistMemoryCandidateSafe({
      orgId,
      userId: executionUserId,
      agentId: activeLogicalAgent.id,
      sessionId: task.flowId,
      projectId: task.flowId,
      source: "tool_result_followup",
      memoryType: "EPISODIC",
      visibility: "SHARED",
      tags: [
        "tool_result",
        "followup",
        followupToolActionSuccess.toolkit.toLowerCase(),
        followupToolActionSuccess.action.toLowerCase()
      ],
      importanceHint: 0.68,
      summary: `${followupToolActionSuccess.toolkit}:${followupToolActionSuccess.action} completed`,
      content: toContextJson({
        toolkit: followupToolActionSuccess.toolkit,
        action: followupToolActionSuccess.action,
        data: followupToolResultNormalized
      }, 1600),
      metadata: toInputJsonValue({
        flowId: task.flowId,
        taskId: task.id,
        agentRunId: agentRun.id,
        toolSlug: followupToolActionSuccess.toolSlug
      })
    });
  }

  if (notificationToolActionSuccess && notificationToolResultNormalized) {
    await persistMemoryCandidateSafe({
      orgId,
      userId: executionUserId,
      agentId: activeLogicalAgent.id,
      sessionId: task.flowId,
      projectId: task.flowId,
      source: "tool_result_notification",
      memoryType: "EPISODIC",
      visibility: "SHARED",
      tags: [
        "tool_result",
        "notification",
        notificationToolActionSuccess.toolkit.toLowerCase(),
        notificationToolActionSuccess.action.toLowerCase()
      ],
      importanceHint: 0.66,
      summary: `${notificationToolActionSuccess.toolkit}:${notificationToolActionSuccess.action} completed`,
      content: toContextJson(
        {
          toolkit: notificationToolActionSuccess.toolkit,
          action: notificationToolActionSuccess.action,
          data: notificationToolResultNormalized
        },
        1600
      ),
      metadata: toInputJsonValue({
        flowId: task.flowId,
        taskId: task.id,
        agentRunId: agentRun.id,
        toolSlug: notificationToolActionSuccess.toolSlug
      })
    });
  }

  if (toolActionFailure) {
    await persistMemoryCandidateSafe({
      orgId,
      userId: executionUserId,
      agentId: activeLogicalAgent.id,
      sessionId: task.flowId,
      projectId: task.flowId,
      source: "tool_error_primary",
      memoryType: "WORKING",
      visibility: "SHARED",
      tags: [
        "tool_error",
        toolActionFailure.error.toolkit.toLowerCase(),
        toolActionFailure.error.action.toLowerCase()
      ],
      importanceHint: 0.82,
      summary: truncateText(toolActionFailure.error.message, 220),
      content: toContextJson(toolActionFailure.error, 1400),
      metadata: toInputJsonValue({
        flowId: task.flowId,
        taskId: task.id,
        agentRunId: agentRun.id
      })
    });
  }

  if (notificationToolActionFailure) {
    await persistMemoryCandidateSafe({
      orgId,
      userId: executionUserId,
      agentId: activeLogicalAgent.id,
      sessionId: task.flowId,
      projectId: task.flowId,
      source: "tool_error_notification",
      memoryType: "WORKING",
      visibility: "SHARED",
      tags: [
        "tool_error",
        "notification",
        notificationToolActionFailure.error.toolkit.toLowerCase(),
        notificationToolActionFailure.error.action.toLowerCase()
      ],
      importanceHint: 0.78,
      summary: truncateText(notificationToolActionFailure.error.message, 220),
      content: toContextJson(notificationToolActionFailure.error, 1400),
      metadata: toInputJsonValue({
        flowId: task.flowId,
        taskId: task.id,
        agentRunId: agentRun.id
      })
    });
  }

  const executionTrace = {
    ...execution.trace,
    contextFiles: context.fileRefs,
    amnesiaProofs: context.amnesiaProofs,
    requestedFiles: task.requiredFiles,
    requestedToolkits,
    inferredToolAction,
    toolInferenceReason: inferredToolPlan.reason ?? null,
    toolInferenceMetrics: inferredToolPlan.metrics ?? null,
    deterministicToolResponseUsed: deterministicResponseUsed,
    toolActionExecution: sanitizeToolValueForContext(toolActionExecution),
    followupToolActionExecution: sanitizeToolValueForContext(followupToolActionExecution),
    notificationToolActionExecution: sanitizeToolValueForContext(notificationToolActionExecution),
    workflowTelemetry,
    workflowState: {
      request: {
        prompt: task.prompt,
        requestedToolkits
      },
      context: {
        summary: contextPack.summary,
        selectionTrace: contextPack.selectionTrace ?? null
      },
      entities: {
        recipientEmail: recipientEmail || null,
        recipientPhone: recipientPhone || null,
        meetingUri: meetingUri || null
      },
      decisions: {
        delegation: {
          decision: effectiveDecision.decision,
          reason: effectiveDecision.reason,
          targetRole: effectiveDecision.targetRole
        },
        toolRouter: {
          inferredToolAction,
          reason: inferredToolPlan.reason ?? null
        }
      },
      tool_results_raw: {
        primary: sanitizeToolValueForContext(toolActionExecution),
        followup: sanitizeToolValueForContext(followupToolActionExecution),
        notification: sanitizeToolValueForContext(notificationToolActionExecution)
      },
      tool_results_normalized: {
        primary: primaryToolResultNormalized,
        followup: followupToolResultNormalized,
        notification: notificationToolResultNormalized
      },
      agent_outputs: {
        deterministicToolSummary: deterministicToolSummary ?? null
      },
      final_output: execution.ok ? (execution.outputText?.slice(0, 1400) ?? "") : null,
      metadata: {
        taskId: task.id,
        flowId: task.flowId,
        agentRunId: agentRun.id
      }
    },
    toolBindings: toolBindings.map((item) => ({
      toolkit: item.toolkit,
      slug: item.slug
    })),
    agentRuntime: {
      agentRunId: agentRun.id,
      logicalAgentId: activeLogicalAgent.id,
      logicalRole: activeLogicalAgent.role,
      parentAgentId: activeLogicalAgent.parentAgentId,
      decisionType: effectiveDecision.decision,
      decisionReason: effectiveDecision.reason,
      executionMode,
      budgetSnapshot,
      estimatedSelfCostUsd,
      estimatedDelegationCostUsd,
      contextSummary: contextPack.summary,
      contextSelectionTrace: contextPack.selectionTrace ?? null,
      memoryHighlights: contextPack.memoryHighlights,
      dnaHighlights: contextPack.dnaHighlights,
      sharedBrainFromMain: sharedBrain.inherited,
      sharedBrainSourceAgentId: sharedBrain.sourceAgentId
    }
  };

  try {
    await prisma.log.create({
      data: {
        orgId,
        type: LogType.EXE,
        actor: "WORKFLOW_TELEMETRY",
        message: `task=${task.id}; workflowId=${workflowTelemetry.workflowId}; modelCalls=${workflowTelemetry.totals.modelCalls}; totalTokens=${workflowTelemetry.totals.totalTokens}; promptTokens=${workflowTelemetry.totals.promptTokens}; completionTokens=${workflowTelemetry.totals.completionTokens}; retryCount=${workflowTelemetry.totals.retryCount}; fallbackCount=${workflowTelemetry.totals.fallbackCount}`
      }
    });
  } catch {
    // Workflow telemetry logging is best-effort only.
  }

  if (!execution.ok) {
    const errorText = execution.error ?? "Agent execution failed.";
    await persistMemoryCandidateSafe({
      orgId,
      userId: executionUserId,
      agentId: activeLogicalAgent.id,
      sessionId: task.flowId,
      projectId: task.flowId,
      source: "agent_execution_error",
      memoryType: "WORKING",
      visibility: "SHARED",
      tags: ["error", "execution"],
      importanceHint: 0.88,
      summary: truncateText(errorText, 220),
      content: [
        `Task ${task.id} execution failed.`,
        `Error: ${truncateText(errorText, 1200)}`
      ].join("\\n"),
      metadata: toInputJsonValue({
        flowId: task.flowId,
        taskId: task.id,
        agentRunId: agentRun.id
      })
    });

    const requiresHumanTouch = /missing|invalid|unauthorized|forbidden|not found|quota|model|401|403|404|429/i.test(
      errorText.toLowerCase()
    );
    if (requiresHumanTouch) {
      await createApprovalCheckpoint({
        orgId,
        flowId: task.flowId,
        taskId: task.id,
        agentId: activeLogicalAgent.id,
        agentRunId: agentRun.id,
        reason: `Agent configuration requires Human Touch: ${errorText}`,
        metadata: toInputJsonValue({
          executionTrace
        })
      });
      await finalizeAgentRun({
        runId: agentRun.id,
        status: AgentStatus.WAITING_HUMAN,
        budgetAfter: budgetSnapshot.remainingBudgetUsd,
        metadata: toInputJsonValue({
          errorText,
          requiresHumanTouch: true
        })
      });
      return handleEvent({
        name: "vorldx/task.paused",
        data: {
          orgId,
          taskId: task.id,
          reason: `Agent configuration requires Human Touch: ${errorText}`,
          executionTrace
        }
      }, origin);
    }

    await finalizeAgentRun({
      runId: agentRun.id,
      status: AgentStatus.FAILED,
      budgetAfter: budgetSnapshot.remainingBudgetUsd,
      metadata: toInputJsonValue({
        errorText
      })
    });

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

  const outputText = execution.outputText?.trim() ?? "";
  const humanInputReason = inferHumanInputReasonFromOutput(outputText);
  if (humanInputReason) {
    await persistMemoryCandidateSafe({
      orgId,
      userId: executionUserId,
      agentId: activeLogicalAgent.id,
      sessionId: task.flowId,
      projectId: task.flowId,
      source: "human_touch_required",
      memoryType: "EPISODIC",
      visibility: "SHARED",
      tags: ["human_touch", "approval_required"],
      importanceHint: 0.9,
      summary: truncateText(humanInputReason, 220),
      content: [
        `Task ${task.id} requires human input.`,
        `Reason: ${truncateText(humanInputReason, 900)}`,
        `Output preview: ${truncateText(outputText, 600)}`
      ].join("\\n"),
      metadata: toInputJsonValue({
        flowId: task.flowId,
        taskId: task.id,
        agentRunId: agentRun.id
      })
    });

    await createApprovalCheckpoint({
      orgId,
      flowId: task.flowId,
      taskId: task.id,
      agentId: activeLogicalAgent.id,
      agentRunId: agentRun.id,
      reason: humanInputReason,
      metadata: toInputJsonValue({
        outputPreview: outputText.slice(0, 1200)
      })
    });
    await finalizeAgentRun({
      runId: agentRun.id,
      status: AgentStatus.WAITING_HUMAN,
      budgetAfter: budgetSnapshot.remainingBudgetUsd,
      metadata: toInputJsonValue({
        humanInputReason
      })
    });
    return handleEvent({
      name: "vorldx/task.paused",
      data: {
        orgId,
        taskId: task.id,
        reason: humanInputReason,
        executionTrace: {
          ...executionTrace,
          humanInputRequired: true,
          outputPreview: outputText.slice(0, 1200)
        }
      }
    }, origin);
  }

  const unverifiedActionReason = inferUnverifiedExternalActionClaim({
    outputText,
    requestedToolkits,
    inferredToolAction,
    toolActionExecution
  });
  if (unverifiedActionReason) {
    await persistMemoryCandidateSafe({
      orgId,
      userId: executionUserId,
      agentId: activeLogicalAgent.id,
      sessionId: task.flowId,
      projectId: task.flowId,
      source: "hallucination_guard_pause",
      memoryType: "EPISODIC",
      visibility: "SHARED",
      tags: ["hallucination_guard", "human_touch"],
      importanceHint: 0.92,
      summary: truncateText(unverifiedActionReason, 220),
      content: [
        `Task ${task.id} paused by hallucination guard.`,
        `Reason: ${truncateText(unverifiedActionReason, 900)}`,
        `Output preview: ${truncateText(outputText, 600)}`
      ].join("\\n"),
      metadata: toInputJsonValue({
        flowId: task.flowId,
        taskId: task.id,
        agentRunId: agentRun.id,
        requestedToolkits
      })
    });

    await createApprovalCheckpoint({
      orgId,
      flowId: task.flowId,
      taskId: task.id,
      agentId: activeLogicalAgent.id,
      agentRunId: agentRun.id,
      reason: unverifiedActionReason,
      metadata: toInputJsonValue({
        outputPreview: outputText.slice(0, 1200),
        requestedToolkits,
        inferredToolAction,
        toolActionExecution
      })
    });
    await finalizeAgentRun({
      runId: agentRun.id,
      status: AgentStatus.WAITING_HUMAN,
      budgetAfter: budgetSnapshot.remainingBudgetUsd,
      metadata: toInputJsonValue({
        hallucinationGuard: true,
        reason: unverifiedActionReason
      })
    });
    return handleEvent({
      name: "vorldx/task.paused",
      data: {
        orgId,
        taskId: task.id,
        reason: unverifiedActionReason,
        executionTrace: {
          ...executionTrace,
          hallucinationGuard: true,
          outputPreview: outputText.slice(0, 1200)
        }
      }
    }, origin);
  }

  let outputFileId: string | null = null;
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
          sourceAgentRunId: agentRun.id,
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

  if (outputText.length > 0) {
    await prisma.memoryEntry.create({
      data: {
        orgId,
        flowId: task.flowId,
        taskId: task.id,
        agentRunId: agentRun.id,
        tier: "AGENT",
        key: `agent.run.${agentRun.id}.summary`,
        value: toInputJsonValue({
          outputPreview: outputText.slice(0, 1600),
          executionMode,
          decisionType: effectiveDecision.decision,
          sourceTaskId: task.id
        })
      }
    });

    await persistMemoryCandidateSafe({
      orgId,
      userId: executionUserId,
      agentId: activeLogicalAgent.id,
      sessionId: task.flowId,
      projectId: task.flowId,
      source: "final_output",
      memoryType: "EPISODIC",
      visibility: "SHARED",
      tags: [
        "final_output",
        executionMode.toLowerCase(),
        deterministicResponseUsed ? "deterministic" : "llm"
      ],
      importanceHint: 0.86,
      summary: truncateText(outputText, 260),
      content: outputText.slice(0, 4000),
      metadata: toInputJsonValue({
        flowId: task.flowId,
        taskId: task.id,
        agentRunId: agentRun.id,
        outputFileId,
        provider: execution.usedProvider ?? null,
        model: execution.usedModel ?? null,
        tokenUsage: execution.tokenUsage ?? null
      })
    });

    await persistSemanticFactsFromText({
      orgId,
      userId: executionUserId,
      agentId: activeLogicalAgent.id,
      sessionId: task.flowId,
      projectId: task.flowId,
      source: "final_output",
      text: `${task.prompt}\\n${outputText}`
    }).catch(() => []);

    await summarizeAndArchiveAgentMemory({
      orgId,
      sessionId: task.flowId,
      projectId: task.flowId,
      userId: executionUserId,
      agentId: activeLogicalAgent.id
    }).catch(() => null);
  }

  const tokenInput =
    typeof execution.tokenUsage?.promptTokens === "number"
      ? execution.tokenUsage.promptTokens
      : null;
  const tokenOutput =
    typeof execution.tokenUsage?.completionTokens === "number"
      ? execution.tokenUsage.completionTokens
      : null;
  const billedCost =
    typeof execution.billing?.totalCostUsd === "number" ? execution.billing.totalCostUsd : null;
  const fallbackCost =
    typeof execution.tokenUsage?.totalTokens === "number"
      ? execution.tokenUsage.totalTokens / 1_000_000
      : null;
  const actualCost = billedCost ?? fallbackCost ?? estimatedSelfCostUsd;

  await finalizeAgentRun({
    runId: agentRun.id,
    status: AgentStatus.COMPLETED,
    actualCostUsd: actualCost,
    budgetAfter: Math.max(0, budgetSnapshot.remainingBudgetUsd - actualCost),
    modelProvider: execution.usedProvider ?? null,
    modelName: execution.usedModel ?? null,
    tokenInput,
    tokenOutput,
    metadata: toInputJsonValue({
      outputFileId
    })
  });

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

    const dispatch = await dispatchQueuedTasksForFlow({
      orgId,
      flowId,
      initiatedByUserId,
      origin
    });

    return { ok: true, queued: dispatch.dispatched };
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
    const runtimeTrace = incomingExecutionTrace
      ? asRecord(incomingExecutionTrace.agentRuntime)
      : {};
    const agentRunId = asString(runtimeTrace.agentRunId) || asString(incomingExecutionTrace?.agentRunId);
    const logicalAgentId = asString(runtimeTrace.logicalAgentId);
    const logicalRole = asString(runtimeTrace.logicalRole);
    const parentAgentId = asString(runtimeTrace.parentAgentId);
    const decisionType = asString(runtimeTrace.decisionType);

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

      if (agentRunId) {
        await tx.agentRun.updateMany({
          where: {
            id: agentRunId,
            orgId
          },
          data: {
            status: AgentStatus.WAITING_HUMAN,
            completedAt: new Date()
          }
        });
      }

      if (logicalAgentId) {
        await tx.agent.updateMany({
          where: {
            id: logicalAgentId,
            orgId
          },
          data: {
            status: AgentStatus.WAITING_HUMAN
          }
        });
      }

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
        ...(integrationError ? { integrationError } : {}),
        ...(logicalAgentId ? { agentId: logicalAgentId } : {}),
        ...(logicalRole ? { agentRole: logicalRole } : {}),
        ...(parentAgentId ? { parentAgentId } : {}),
        ...(agentRunId ? { agentRunId } : {}),
        ...(decisionType ? { decisionType } : {})
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

    const resumedTrace = asRecord(task.executionTrace);
    const runtimeTrace = asRecord(resumedTrace.agentRuntime);
    const resumedAgentId = asString(runtimeTrace.logicalAgentId);
    const resumedAgentRunId = asString(runtimeTrace.agentRunId);

    let resumeClaimed = false;
    await prisma.$transaction(async (tx) => {
      const taskResumeClaim = await tx.task.updateMany({
        where: {
          id: taskId,
          flowId: task.flowId,
          status: {
            in: [TaskStatus.QUEUED, TaskStatus.PAUSED]
          }
        },
        data: {
          status: TaskStatus.RUNNING,
          isPausedForInput: false,
          humanInterventionReason: null
        }
      });

      resumeClaimed = taskResumeClaim.count > 0;
      if (!resumeClaimed) {
        return;
      }

      await tx.flow.update({
        where: { id: task.flowId },
        data: {
          status: FlowStatus.ACTIVE
        }
      });

      if (resumedAgentId) {
        await tx.agent.updateMany({
          where: {
            id: resumedAgentId,
            orgId
          },
          data: {
            status: AgentStatus.ACTIVE
          }
        });
      }

      if (resumedAgentRunId) {
        await tx.agentRun.updateMany({
          where: {
            id: resumedAgentRunId,
            orgId,
            status: AgentStatus.WAITING_HUMAN
          },
          data: {
            status: AgentStatus.COMPLETED
          }
        });
      }

      await tx.log.create({
        data: {
          orgId,
          type: LogType.EXE,
          actor: "INNGEST",
          message: `Task ${taskId} resumed by durable worker.`
        }
      });
    });

    if (!resumeClaimed) {
      return {
        ok: true,
        ignored: true,
        reason: "task.resumed already processed."
      };
    }

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

    const executionResult = await executeTaskById(
      taskId,
      orgId,
      typeof resumedTrace.initiatedByUserId === "string" ? resumedTrace.initiatedByUserId : null,
      origin
    );
    const dispatch = await dispatchQueuedTasksForFlow({
      orgId,
      flowId: task.flowId,
      initiatedByUserId:
        typeof resumedTrace.initiatedByUserId === "string" ? resumedTrace.initiatedByUserId : null,
      origin
    });
    return { ok: true, executionResult, queued: dispatch.dispatched };
  }

  if (name === "vorldx/task.completed") {
    const taskId = asString(data.taskId);
    const orgId = asString(data.orgId);
    const executionTrace =
      data.executionTrace && typeof data.executionTrace === "object"
        ? (data.executionTrace as Record<string, unknown>)
        : null;
    const verifiableProof = asString(data.verifiableProof) || null;
    const runtimeTrace = executionTrace ? asRecord(executionTrace.agentRuntime) : {};
    const agentRunId = asString(runtimeTrace.agentRunId);
    const logicalAgentId = asString(runtimeTrace.logicalAgentId);
    const logicalRole = asString(runtimeTrace.logicalRole);
    const parentAgentId = asString(runtimeTrace.parentAgentId);
    const decisionType = asString(runtimeTrace.decisionType);

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

      if (agentRunId) {
        await tx.agentRun.updateMany({
          where: {
            id: agentRunId,
            orgId
          },
          data: {
            status: AgentStatus.COMPLETED,
            completedAt: new Date()
          }
        });
      }

      if (logicalAgentId) {
        await tx.agent.updateMany({
          where: {
            id: logicalAgentId,
            orgId
          },
          data: {
            status: AgentStatus.COMPLETED
          }
        });
      }

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
        flowId: task.flowId,
        ...(logicalAgentId ? { agentId: logicalAgentId } : {}),
        ...(logicalRole ? { agentRole: logicalRole } : {}),
        ...(parentAgentId ? { parentAgentId } : {}),
        ...(agentRunId ? { agentRunId } : {}),
        ...(decisionType ? { decisionType } : {})
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
    const runtimeTrace = executionTrace ? asRecord(executionTrace.agentRuntime) : {};
    const agentRunId = asString(runtimeTrace.agentRunId);
    const logicalAgentId = asString(runtimeTrace.logicalAgentId);
    const logicalRole = asString(runtimeTrace.logicalRole);
    const parentAgentId = asString(runtimeTrace.parentAgentId);
    const decisionType = asString(runtimeTrace.decisionType);

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

      if (agentRunId) {
        await tx.agentRun.updateMany({
          where: {
            id: agentRunId,
            orgId
          },
          data: {
            status: AgentStatus.FAILED,
            completedAt: new Date()
          }
        });
      }

      if (logicalAgentId) {
        await tx.agent.updateMany({
          where: {
            id: logicalAgentId,
            orgId
          },
          data: {
            status: AgentStatus.FAILED
          }
        });
      }

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
        error,
        ...(logicalAgentId ? { agentId: logicalAgentId } : {}),
        ...(logicalRole ? { agentRole: logicalRole } : {}),
        ...(parentAgentId ? { parentAgentId } : {}),
        ...(agentRunId ? { agentRunId } : {}),
        ...(decisionType ? { decisionType } : {})
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
    const knowledgeChunks =
      !file.isAmnesiaProtected && sourceText
        ? splitIntoMemoryChunks({
            text: sourceText,
            maxChars: DNA_MEMORY_CHUNK_MAX_CHARS,
            overlapChars: DNA_MEMORY_CHUNK_OVERLAP_CHARS,
            maxChunks: DNA_MEMORY_CHUNK_MAX_ITEMS
          })
        : [];

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

    if (knowledgeChunks.length > 0) {
      const fileTag = `file:${file.id}`;
      try {
        await prisma.agentMemory.updateMany({
          where: {
            orgId,
            source: "dna_chunk",
            archivedAt: null,
            tags: { has: fileTag }
          },
          data: {
            archivedAt: new Date()
          }
        });
      } catch {
        // Best-effort archival; fresh chunk upserts continue.
      }

      for (let index = 0; index < knowledgeChunks.length; index += 1) {
        const chunk = knowledgeChunks[index];
        if (!chunk) continue;
        // eslint-disable-next-line no-await-in-loop
        await upsertAgentMemory({
          orgId,
          content: chunk,
          summary: truncateText(
            `DNA ${file.name} chunk ${index + 1}/${knowledgeChunks.length}`,
            220
          ),
          memoryType: "SEMANTIC",
          visibility: "SHARED",
          source: "dna_chunk",
          tags: ["hub", "dna", "chunk", fileTag],
          metadata: toInputJsonValue({
            fileId: file.id,
            fileName: file.name,
            chunkIndex: index,
            chunkTotal: knowledgeChunks.length,
            embeddingDigest: digest
          }),
          importance: 0.62,
          recency: 1
        }).catch(() => null);
      }
    }

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
  if (!hasValidInternalApiKey(request)) {
    return NextResponse.json(
      {
        ok: false,
        message: "Internal API key is required for durable worker mutations."
      },
      { status: 403 }
    );
  }

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

  const unsupported = events.find((event) => !ALLOWED_INTERNAL_EVENTS.has(asString(event.name)));
  if (unsupported) {
    return NextResponse.json(
      {
        ok: false,
        message: `Unsupported event: ${unsupported.name ?? "unknown"}`
      },
      { status: 400 }
    );
  }

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

