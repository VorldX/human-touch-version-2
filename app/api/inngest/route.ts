import { createHash } from "node:crypto";

import {
  AgentDecisionType,
  AgentStatus,
  FlowStatus,
  HubFileType,
  LogType,
  Personnel,
  PersonnelStatus,
  Prisma,
  SpendEventType,
  TaskStatus
} from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { createDeterministicEmbedding, toPgVectorLiteral } from "@/lib/ai/embeddings";
import {
  estimateDelegationOverheadUsd,
  estimateTaskExecutionCostUsd,
  getAgentBudgetSnapshot
} from "@/lib/agent/orchestration/budget";
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

function normalizeToolkitList(value: string[]) {
  return [...new Set(value.map((item) => item.trim().toLowerCase()).filter(Boolean))];
}

function parseTaskStage(value: string) {
  const upper = value.toUpperCase();
  if (upper === "PLANNING") return "PLANNING" as const;
  if (upper === "EXECUTION") return "EXECUTION" as const;
  return "GENERAL" as const;
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

interface ToolInferenceResult {
  action: AgentToolActionRequest | null;
  reason?: string;
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

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractFirstEmail(value: string) {
  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0]?.trim() ?? "";
}

function extractLabeledValue(prompt: string, labels: string[]) {
  const labelsPattern = labels.map((label) => escapeRegex(label)).join("|");
  const pattern = new RegExp(
    `(?:\\*{1,2})?(?:${labelsPattern})(?:\\*{1,2})?\\s*[:\\-]\\s*(.+)`,
    "i"
  );
  const line = prompt
    .split(/\r?\n/g)
    .map((item) => item.trim())
    .find((item) => pattern.test(item));
  if (!line) {
    return "";
  }

  const match = line.match(pattern);
  if (!match?.[1]) {
    return "";
  }

  return match[1].trim().replace(/^["'`]+|["'`]+$/g, "").trim();
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

function extractDurationMinutes(prompt: string) {
  const labeled = extractLabeledValue(prompt, ["duration", "length"]);
  const candidate = labeled || prompt;
  const match = candidate.match(/(\d{1,3})\s*(minutes?|mins?|hours?|hrs?)/i);
  if (!match?.[1]) {
    return null;
  }

  const amount = Number.parseInt(match[1], 10);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const unit = (match[2] ?? "").toLowerCase();
  if (unit.startsWith("hour") || unit.startsWith("hr")) {
    return Math.min(8 * 60, amount * 60);
  }
  return Math.min(24 * 60, amount);
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
  const candidates = toolBindings.filter((binding) => requestedToolkits.includes(binding.toolkit));
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

  const gmailRequested = requestedToolkits.includes("gmail");
  if (!gmailRequested) {
    return inferReadOnlyGenericToolAction(prompt, requestedToolkits, toolBindings);
  }

  const hasMailContext = /gmail|email|mail|inbox/.test(normalized);
  const sendIntent =
    /\b(send|compose)\b/.test(normalized) && /\b(?:email|mail)\b/.test(normalized);
  if (hasMailContext && sendIntent) {
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
  }

  // MVP behavior: if task mentions inbox/email fetch semantics, call Gmail fetch.
  const asksForMailboxRead = /gmail|email|inbox/.test(normalized);
  const asksForList = /list|latest|recent|last|show|fetch|check|read/.test(normalized);
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
  const heuristic = inferAgentToolActionHeuristic(
    input.prompt,
    input.requestedToolkits,
    input.toolBindings
  );
  if (heuristic) {
    return { action: heuristic };
  }

  const candidateBindings = input.toolBindings.filter(
    (binding) =>
      input.requestedToolkits.length === 0 || input.requestedToolkits.includes(binding.toolkit)
  );
  if (candidateBindings.length === 0) {
    return { action: null };
  }

  try {
    const runtime = await getOrgLlmRuntime(input.orgId);
    const actionCatalog = candidateBindings.slice(0, 80).map((binding) => ({
      toolkit: binding.toolkit,
      action: binding.slug.toUpperCase(),
      name: binding.name,
      description: binding.description
    }));

    const execution = await executeSwarmAgent({
      taskId: `tool-router-${Date.now()}`,
      flowId: "tool-router",
      prompt: input.prompt,
      agent: input.runtimeAgent,
      contextBlocks: [],
      organizationRuntime: runtime,
      systemPromptOverride: [
        "You are a deterministic tool-action router for the workflow engine.",
        "Select exactly one best tool action from the provided catalog if tool execution is needed now.",
        "Never invent tool actions. Only use action values from the catalog.",
        "Return strict JSON only, no markdown, no commentary.",
        "Response schema:",
        '{"mode":"EXECUTE","toolkit":"<slug>","action":"<ACTION_SLUG>","arguments":{},"reason":"..."}',
        '{"mode":"HUMAN_INPUT","reason":"...","missing":["field1","field2"]}',
        '{"mode":"NONE","reason":"..."}',
        "If prompt lacks required parameters for a write/destructive action, return HUMAN_INPUT.",
        "Prefer least-risk action that still satisfies the request."
      ].join("\n"),
      userPromptOverride: [
        `Task prompt:\n${input.prompt}`,
        "",
        `Requested toolkits: ${input.requestedToolkits.join(", ") || "none"}`,
        "",
        "Action catalog (JSON):",
        JSON.stringify(actionCatalog)
      ].join("\n")
    });

    if (!execution.ok || !execution.outputText) {
      return { action: null };
    }

    const parsed = parseJsonObjectFromText(execution.outputText);
    if (!parsed) {
      return { action: null };
    }

    const mode = asString(parsed.mode).toUpperCase();
    if (mode === "NONE") {
      return { action: null };
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
        reason: missing.length > 0 ? `${reason} Missing: ${missing.join(", ")}` : reason
      };
    }

    if (mode !== "EXECUTE") {
      return { action: null };
    }

    const toolkit = asString(parsed.toolkit).toLowerCase();
    const action = asString(parsed.action).toUpperCase();
    if (!toolkit || !action) {
      return { action: null };
    }

    const binding = candidateBindings.find(
      (item) => item.toolkit === toolkit && item.slug.toUpperCase() === action
    );
    if (!binding) {
      return { action: null };
    }

    if (isDestructiveToolAction(action, binding) && !hasExplicitDestructiveIntent(input.prompt)) {
      return {
        action: null,
        reason: `Action ${action} is destructive. Explicit user confirmation is required before execution.`
      };
    }

    return {
      action: {
        toolkit,
        action,
        arguments: normalizeToolArguments(parsed.arguments)
      }
    };
  } catch {
    return { action: null };
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

  let toolBindings: AgentToolBindingSummary[] = [];
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
      excludePersonnelId: logicalAgent.personnelId
    });

    activeLogicalAgent = await createChildAgent({
      orgId,
      flowId: task.flowId,
      parentAgentId: logicalAgent.id,
      personnelId: delegatedPersonnelId,
      role: policyDecision.targetRole,
      goal: `Delegated task: ${task.prompt}`.slice(0, 1400),
      allowedTools: requestedToolkits,
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
        executionMode: contextPack.executionMode
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
      budgetSnapshot: contextPack.budgetSnapshot
    }),
    decisionType: effectiveDecision.decision,
    decisionReason: effectiveDecision.reason,
    executionMode,
    budgetBefore: budgetSnapshot.remainingBudgetUsd,
    estimatedCostUsd: effectiveDecision.estimatedCostUsd
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

  if (
    effectiveDecision.decision === AgentDecisionType.HALT_BUDGET ||
    effectiveDecision.decision === AgentDecisionType.HALT_POLICY ||
    effectiveDecision.decision === AgentDecisionType.ASK_HUMAN
  ) {
    const reason =
      effectiveDecision.decision === AgentDecisionType.HALT_BUDGET
        ? `Budget policy halted execution: ${effectiveDecision.reason}`
        : effectiveDecision.reason;

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
        requestedToolkits
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
    agent: runtimeAgent,
    contextBlocks: [
      ...context.contextBlocks,
      ...contextPack.blocks,
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
    inferredToolAction,
    toolInferenceReason: inferredToolPlan.reason ?? null,
    toolActionExecution,
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
      memoryHighlights: contextPack.memoryHighlights,
      dnaHighlights: contextPack.dnaHighlights,
      sharedBrainFromMain: sharedBrain.inherited,
      sharedBrainSourceAgentId: sharedBrain.sourceAgentId
    }
  };

  if (!execution.ok) {
    const errorText = execution.error ?? "Agent execution failed.";
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

