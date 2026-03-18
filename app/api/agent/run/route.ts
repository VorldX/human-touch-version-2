export const dynamic = "force-dynamic";

import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { executeSwarmAgent } from "@/lib/ai/swarm-runtime";
import { getOrgLlmRuntime } from "@/lib/ai/org-llm-settings";
import {
  runAgentEngine,
  type ActiveDraft,
  type AgentRunResponse
} from "@/lib/agent/run/engine";
import { executeAgentTool } from "@/lib/agent/tools/execute";
import { buildEmailWriterPrompt, parseEmailWriterOutput } from "@/lib/agent/prompts/emailWriter";
import {
  buildGmailPlannerPrompt,
  parseGmailPlannerOutput,
  type GmailPlannerOutput
} from "@/lib/agent/prompts/gmailPlanner";
import { prisma } from "@/lib/db/prisma";
import { registerSessionActivity } from "@/lib/dna/phase2";

type RunBody = {
  prompt?: string;
  input?: Record<string, unknown>;
  confirm?: boolean;
  orgId?: string;
  runId?: string;
} | null;

interface WorkflowStepMetric {
  step: string;
  agent: string;
  purpose: "intent_planning" | "draft_generation" | "tool_execution";
  provider: string | null;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  tools_passed: number;
  latency_ms: number;
  retries: number;
  fallback_used: boolean;
  cost_usd: number | null;
}

interface TokenBurnMapEntry {
  agent_name: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  tools_passed: number;
  purpose: string;
  latency_ms: number;
  cost_usd: number | null;
}

interface WorkflowTelemetry {
  workflow_id: string;
  workflow: string;
  duration_ms: number;
  model_calls: number;
  tool_calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  total_cost_usd: number;
  retry_count: number;
  fallback_count: number;
  token_burn_map: TokenBurnMapEntry[];
}

interface ActorRunGuardBucket {
  windowStart: number;
  count: number;
  inflight: number;
  lastSeen: number;
}

const actorRunGuards = new Map<string, ActorRunGuardBucket>();
// Process-local guard for single-node stability; promote to shared store for multi-instance deployments.

interface AgentRunSessionState {
  runId: string;
  orgId: string;
  userId: string;
  activeDraft: ActiveDraft | null;
  turn: number;
  updatedAt: number;
}

const agentRunSessions = new Map<string, AgentRunSessionState>();
const actorActiveRunIds = new Map<string, string>();
const RUN_SESSION_TTL_MS = 1000 * 60 * 60 * 6;

function parsePositiveEnvInt(name: string, fallback: number, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw) || raw <= 0) {
    return fallback;
  }
  const normalized = Math.floor(raw);
  return Math.min(max, Math.max(min, normalized));
}

function parseBooleanEnv(name: string, fallback: boolean) {
  const raw = process.env[name];
  if (typeof raw !== "string") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

const AGENT_RUN_TIMEOUT_MS = parsePositiveEnvInt("AGENT_RUN_TIMEOUT_MS", 20_000, 1_000, 120_000);
const AGENT_RUN_RATE_LIMIT_WINDOW_MS = parsePositiveEnvInt(
  "AGENT_RUN_RATE_LIMIT_WINDOW_MS",
  60_000,
  10_000,
  600_000
);
const AGENT_RUN_RATE_LIMIT_MAX = parsePositiveEnvInt("AGENT_RUN_RATE_LIMIT_MAX", 20, 1, 1_000);
const AGENT_RUN_MAX_INFLIGHT_PER_ACTOR = parsePositiveEnvInt(
  "AGENT_RUN_MAX_INFLIGHT_PER_ACTOR",
  2,
  1,
  20
);
const AGENT_RUN_PLANNER_MAX_OUTPUT_TOKENS = parsePositiveEnvInt(
  "AGENT_RUN_PLANNER_MAX_OUTPUT_TOKENS",
  180,
  80,
  512
);
const AGENT_RUN_WRITER_MAX_OUTPUT_TOKENS = parsePositiveEnvInt(
  "AGENT_RUN_WRITER_MAX_OUTPUT_TOKENS",
  260,
  120,
  700
);
const AGENT_RUN_EXPOSE_METRICS = parseBooleanEnv("AGENT_RUN_EXPOSE_METRICS", true);

class RequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Agent run request exceeded ${timeoutMs} ms.`);
    this.name = "RequestTimeoutError";
  }
}

function cleanupActorRunGuards(now: number) {
  const staleThreshold = AGENT_RUN_RATE_LIMIT_WINDOW_MS * 3;
  for (const [key, value] of actorRunGuards.entries()) {
    if (now - value.lastSeen > staleThreshold && value.inflight <= 0) {
      actorRunGuards.delete(key);
    }
  }
}

function acquireActorRunGuard(key: string) {
  const now = Date.now();
  cleanupActorRunGuards(now);
  const bucket = actorRunGuards.get(key) ?? {
    windowStart: now,
    count: 0,
    inflight: 0,
    lastSeen: now
  };

  if (now - bucket.windowStart >= AGENT_RUN_RATE_LIMIT_WINDOW_MS) {
    bucket.windowStart = now;
    bucket.count = 0;
  }

  if (bucket.count >= AGENT_RUN_RATE_LIMIT_MAX) {
    const retryAfterMs = Math.max(1_000, AGENT_RUN_RATE_LIMIT_WINDOW_MS - (now - bucket.windowStart));
    return {
      ok: false as const,
      status: 429,
      code: "RATE_LIMITED",
      message: "Too many requests. Please retry shortly.",
      retryAfterSeconds: Math.ceil(retryAfterMs / 1_000)
    };
  }

  if (bucket.inflight >= AGENT_RUN_MAX_INFLIGHT_PER_ACTOR) {
    return {
      ok: false as const,
      status: 429,
      code: "CONCURRENCY_LIMITED",
      message: "Another run is already in progress. Please retry shortly."
    };
  }

  bucket.count += 1;
  bucket.inflight += 1;
  bucket.lastSeen = now;
  actorRunGuards.set(key, bucket);

  return {
    ok: true as const
  };
}

function releaseActorRunGuard(key: string) {
  const bucket = actorRunGuards.get(key);
  if (!bucket) return;
  bucket.inflight = Math.max(0, bucket.inflight - 1);
  bucket.lastSeen = Date.now();
  if (bucket.inflight === 0 && bucket.count === 0) {
    actorRunGuards.delete(key);
    return;
  }
  actorRunGuards.set(key, bucket);
}

function runSessionKey(input: { orgId: string; userId: string; runId: string }) {
  return `${input.orgId}:${input.userId}:${input.runId}`;
}

function actorSessionKey(input: { orgId: string; userId: string }) {
  return `${input.orgId}:${input.userId}`;
}

function cleanupRunSessions(now: number) {
  for (const [key, session] of agentRunSessions.entries()) {
    if (now - session.updatedAt > RUN_SESSION_TTL_MS) {
      agentRunSessions.delete(key);
      const actorKey = actorSessionKey({ orgId: session.orgId, userId: session.userId });
      if (actorActiveRunIds.get(actorKey) === session.runId) {
        actorActiveRunIds.delete(actorKey);
      }
    }
  }
}

function loadRunSession(input: {
  orgId: string;
  userId: string;
  requestedRunId?: string;
}) {
  cleanupRunSessions(Date.now());
  const actorKey = actorSessionKey({ orgId: input.orgId, userId: input.userId });
  const runId = input.requestedRunId?.trim() || actorActiveRunIds.get(actorKey) || "";
  if (!runId) {
    return null;
  }
  const key = runSessionKey({ orgId: input.orgId, userId: input.userId, runId });
  const session = agentRunSessions.get(key);
  if (!session) {
    return null;
  }
  if (Date.now() - session.updatedAt > RUN_SESSION_TTL_MS) {
    agentRunSessions.delete(key);
    if (actorActiveRunIds.get(actorKey) === runId) {
      actorActiveRunIds.delete(actorKey);
    }
    return null;
  }
  return session;
}

function saveRunSession(session: AgentRunSessionState) {
  const key = runSessionKey({
    orgId: session.orgId,
    userId: session.userId,
    runId: session.runId
  });
  agentRunSessions.set(key, { ...session, updatedAt: Date.now() });
  actorActiveRunIds.set(
    actorSessionKey({ orgId: session.orgId, userId: session.userId }),
    session.runId
  );
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new RequestTimeoutError(timeoutMs)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function buildWorkflowTelemetry(input: {
  workflowId: string;
  steps: WorkflowStepMetric[];
  startedAt: number;
}): WorkflowTelemetry {
  const steps = input.steps;
  const promptTokens = steps.reduce((sum, step) => sum + step.input_tokens, 0);
  const completionTokens = steps.reduce((sum, step) => sum + step.output_tokens, 0);
  const totalTokens = steps.reduce((sum, step) => sum + step.total_tokens, 0);
  const totalCostUsd = steps.reduce((sum, step) => sum + (step.cost_usd ?? 0), 0);
  const retryCount = steps.reduce((sum, step) => sum + Math.max(0, step.retries), 0);
  const fallbackCount = steps.filter((step) => step.fallback_used).length;

  const tokenBurnMap = steps.map((step) => ({
    agent_name: step.agent,
    model: step.model ?? "none",
    input_tokens: step.input_tokens,
    output_tokens: step.output_tokens,
    tools_passed: step.tools_passed,
    purpose: step.purpose,
    latency_ms: step.latency_ms,
    cost_usd: step.cost_usd
  }));

  return {
    workflow_id: input.workflowId,
    workflow: "agent_run_gmail",
    duration_ms: Date.now() - input.startedAt,
    model_calls: steps.filter((step) => step.total_tokens > 0).length,
    tool_calls: steps.filter((step) => step.purpose === "tool_execution").length,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    total_cost_usd: Number(totalCostUsd.toFixed(6)),
    retry_count: retryCount,
    fallback_count: fallbackCount,
    token_burn_map: tokenBurnMap
  };
}

async function writeWorkflowTelemetryLog(orgId: string, telemetry: WorkflowTelemetry) {
  try {
    await prisma.log.create({
      data: {
        orgId,
        type: "EXE",
        actor: "AGENT_RUN_METRICS",
        message: `workflowId=${telemetry.workflow_id}; workflow=${telemetry.workflow}; durationMs=${telemetry.duration_ms}; modelCalls=${telemetry.model_calls}; toolCalls=${telemetry.tool_calls}; promptTokens=${telemetry.prompt_tokens}; completionTokens=${telemetry.completion_tokens}; totalTokens=${telemetry.total_tokens}; retryCount=${telemetry.retry_count}; fallbackCount=${telemetry.fallback_count}; totalCostUsd=${telemetry.total_cost_usd}`
      }
    });
  } catch {
    // Observability is best-effort only.
  }
}

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

const plannerAgentSelect = {
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

async function resolveLlmAgent(orgId: string) {
  const selected =
    (await prisma.personnel.findFirst({
      where: {
        orgId,
        type: "AI",
        role: { contains: "Main", mode: "insensitive" },
        status: { not: "DISABLED" }
      },
      select: plannerAgentSelect
    })) ??
    (await prisma.personnel.findFirst({
      where: {
        orgId,
        type: "AI",
        role: { contains: "Boss", mode: "insensitive" },
        status: { not: "DISABLED" }
      },
      select: plannerAgentSelect
    })) ??
    (await prisma.personnel.findFirst({
      where: {
        orgId,
        type: "AI",
        status: { not: "DISABLED" }
      },
      orderBy: { updatedAt: "desc" },
      select: plannerAgentSelect
    }));

  if (selected) {
    return selected;
  }

  return {
    id: "agent-run-proxy",
    name: "Main Agent",
    role: "Gmail Planner",
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

async function runJsonTask(input: {
  orgId: string;
  taskKind: "planner" | "writer";
  systemPrompt: string;
  userPrompt: string;
  maxOutputTokens?: number;
}) {
  const maxOutputTokens =
    input.maxOutputTokens ??
    (input.taskKind === "planner"
      ? AGENT_RUN_PLANNER_MAX_OUTPUT_TOKENS
      : AGENT_RUN_WRITER_MAX_OUTPUT_TOKENS);
  const startedAt = Date.now();
  const organizationRuntime = await getOrgLlmRuntime(input.orgId);
  const agent = await resolveLlmAgent(input.orgId);
  const execution = await executeSwarmAgent({
    taskId: `agent-run-${input.taskKind}-${randomUUID().slice(0, 8)}`,
    flowId: "agent-run",
    prompt: input.userPrompt,
    agent,
    contextBlocks: [],
    organizationRuntime,
    systemPromptOverride: input.systemPrompt,
    userPromptOverride: input.userPrompt,
    maxOutputTokens
  });

  if (!execution.ok || !execution.outputText?.trim()) {
    throw new Error(execution.error || `LLM ${input.taskKind} call failed.`);
  }

  const promptTokens =
    typeof execution.tokenUsage?.promptTokens === "number" ? execution.tokenUsage.promptTokens : 0;
  const completionTokens =
    typeof execution.tokenUsage?.completionTokens === "number"
      ? execution.tokenUsage.completionTokens
      : 0;
  const totalTokens =
    typeof execution.tokenUsage?.totalTokens === "number" ? execution.tokenUsage.totalTokens : 0;
  const costUsd =
    typeof execution.billing?.totalCostUsd === "number" ? execution.billing.totalCostUsd : null;

  return {
    output: execution.outputText.trim(),
    usedProvider: execution.usedProvider ?? null,
    usedModel: execution.usedModel ?? null,
    promptTokens,
    completionTokens,
    totalTokens,
    costUsd,
    latencyMs: Date.now() - startedAt,
    retries: execution.fallbackUsed ? 1 : 0,
    fallbackUsed: execution.fallbackUsed
  };
}

async function resolveRunActor(request: NextRequest, body: RunBody) {
  const sessionUserId = request.headers.get("x-user-id")?.trim() || "";
  const userEmail = request.headers.get("x-user-email")?.trim().toLowerCase() || "";

  if (!sessionUserId || !userEmail) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          status: "error",
          assistant_message: "Authentication headers are required.",
          error: {
            code: "UNAUTHENTICATED",
            message: "x-user-id and x-user-email headers are required."
          }
        },
        { status: 401 }
      )
    };
  }

  const bodyInput = asRecord(body?.input);
  const requestedOrgId =
    asText(request.nextUrl.searchParams.get("orgId")) ||
    asText(body?.orgId) ||
    asText(bodyInput.orgId);

  const user = await prisma.user.findFirst({
    where: {
      id: sessionUserId,
      email: userEmail
    },
    select: {
      id: true,
      email: true,
      activeOrgId: true,
      orgMemberships: {
        select: {
          orgId: true
        }
      }
    }
  });

  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          status: "error",
          assistant_message: "You do not have access to this organization.",
          error: {
            code: "FORBIDDEN",
            message: "User not found."
          }
        },
        { status: 403 }
      )
    };
  }

  const membershipOrgIds = new Set(user.orgMemberships.map((item) => item.orgId));
  let orgId = "";
  if (requestedOrgId && membershipOrgIds.has(requestedOrgId)) {
    orgId = requestedOrgId;
  } else if (user.activeOrgId && membershipOrgIds.has(user.activeOrgId)) {
    orgId = user.activeOrgId;
  } else if (user.orgMemberships[0]?.orgId) {
    orgId = user.orgMemberships[0].orgId;
  }

  if (!orgId) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          status: "error",
          assistant_message: "You do not have access to this organization.",
          error: {
            code: "FORBIDDEN",
            message: "No organization membership found."
          }
        },
        { status: 403 }
      )
    };
  }

  return {
    ok: true as const,
    actor: {
      orgId,
      userId: user.id,
      userEmail: user.email,
      sessionUserId
    }
  };
}

function statusCodeForResponse(response: AgentRunResponse) {
  if (response.status !== "error") return 200;
  if (response.error?.code === "INVALID_REQUEST") return 400;
  if (response.error?.code === "UNAUTHENTICATED") return 401;
  if (response.error?.code === "FORBIDDEN") return 403;
  if (response.error?.code === "INTEGRATION_NOT_CONNECTED") return 409;
  if (response.error?.code === "INVALID_TOOL_ACTION") return 400;
  return 502;
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const workflowId = randomUUID().slice(0, 12);
  let guardKey: string | null = null;

  try {
    const body = (await request.json().catch(() => null)) as RunBody;
    const actorResult = await resolveRunActor(request, body);
    if (!actorResult.ok) {
      return actorResult.response;
    }

    const prompt = asText(body?.prompt);
    const providedInput = asRecord(body?.input);
    const confirm = body?.confirm === true;
    const requestedRunId = asText(body?.runId);
    const workflowSteps: WorkflowStepMetric[] = [];
    const loadedSession = loadRunSession({
      orgId: actorResult.actor.orgId,
      userId: actorResult.actor.userId,
      ...(requestedRunId ? { requestedRunId } : {})
    });
    const runId = loadedSession?.runId || requestedRunId || `run_${randomUUID().slice(0, 12)}`;
    const runTurn = (loadedSession?.turn ?? 0) + 1;
    const sessionDraft = loadedSession?.activeDraft ?? null;
    const phase2SessionId = `agent-run:${actorResult.actor.orgId}:${actorResult.actor.userId}:${runId}`;
    void registerSessionActivity({
      tenantId: actorResult.actor.orgId,
      userId: actorResult.actor.userId,
      sessionId: phase2SessionId
    }).catch((error) => {
      console.warn("[agent-run] phase2 session activity tracking failed", error);
    });

    const runGuardKey = `${actorResult.actor.orgId}:${actorResult.actor.userId}`;
    const guardResult = acquireActorRunGuard(runGuardKey);
    if (!guardResult.ok) {
      return NextResponse.json(
        {
          status: "error",
          assistant_message: guardResult.message,
          error: {
            code: guardResult.code,
            message: guardResult.message
          }
        },
        {
          status: guardResult.status,
          ...(typeof guardResult.retryAfterSeconds === "number"
            ? { headers: { "Retry-After": String(guardResult.retryAfterSeconds) } }
            : {})
        }
      );
    }
    guardKey = runGuardKey;

    const response = await withTimeout(
      runAgentEngine(
        {
          prompt,
          input: providedInput,
          confirm,
          activeDraft: sessionDraft,
          turn: runTurn
        },
        {
          plan: async ({ prompt: rawPrompt, providedInput: rawInput, activeDraft }) => {
            const prompts = buildGmailPlannerPrompt({
              prompt: rawPrompt,
              providedInput: rawInput,
              activeDraft: activeDraft ?? null
            });
            const plannerCall = await runJsonTask({
              orgId: actorResult.actor.orgId,
              taskKind: "planner",
              systemPrompt: prompts.systemPrompt,
              userPrompt: prompts.userPrompt,
              maxOutputTokens: AGENT_RUN_PLANNER_MAX_OUTPUT_TOKENS
            });
            workflowSteps.push({
              step: "planner",
              agent: "main-agent-planner",
              purpose: "intent_planning",
              provider: plannerCall.usedProvider,
              model: plannerCall.usedModel,
              input_tokens: plannerCall.promptTokens,
              output_tokens: plannerCall.completionTokens,
              total_tokens: plannerCall.totalTokens,
              tools_passed: 0,
              latency_ms: plannerCall.latencyMs,
              retries: plannerCall.retries,
              fallback_used: plannerCall.fallbackUsed,
              cost_usd: plannerCall.costUsd
            });

            const parsed = parseGmailPlannerOutput(plannerCall.output);
            if (!parsed) {
              throw new Error("Planner produced invalid JSON.");
            }
            return parsed as GmailPlannerOutput;
          },
          writeEmail: async ({
            prompt: rawPrompt,
            recipientEmail,
            recipientName,
            extraContext,
            activeDraft
          }) => {
            const prompts = buildEmailWriterPrompt({
              userPrompt: rawPrompt,
              recipientEmail,
              ...(recipientName ? { recipientName } : {}),
              ...(extraContext ? { extraContext } : {}),
              activeDraft: activeDraft ?? null
            });
            const writerCall = await runJsonTask({
              orgId: actorResult.actor.orgId,
              taskKind: "writer",
              systemPrompt: prompts.systemPrompt,
              userPrompt: prompts.userPrompt,
              maxOutputTokens: AGENT_RUN_WRITER_MAX_OUTPUT_TOKENS
            });
            workflowSteps.push({
              step: "writer",
              agent: "main-agent-writer",
              purpose: "draft_generation",
              provider: writerCall.usedProvider,
              model: writerCall.usedModel,
              input_tokens: writerCall.promptTokens,
              output_tokens: writerCall.completionTokens,
              total_tokens: writerCall.totalTokens,
              tools_passed: 0,
              latency_ms: writerCall.latencyMs,
              retries: writerCall.retries,
              fallback_used: writerCall.fallbackUsed,
              cost_usd: writerCall.costUsd
            });

            const parsed = parseEmailWriterOutput(writerCall.output);
            if (!parsed) {
              throw new Error("Email writer produced invalid JSON.");
            }
            return parsed;
          },
          executeGmailAction: async ({ action, arguments: actionArgs }) => {
            const toolStartedAt = Date.now();
            const toolResult = await executeAgentTool({
              orgId: actorResult.actor.orgId,
              userId: actorResult.actor.userId,
              toolkit: "gmail",
              action,
              arguments: actionArgs
            });

            workflowSteps.push({
              step: `tool:${action}`,
              agent: "gmail-tool-executor",
              purpose: "tool_execution",
              provider: null,
              model: null,
              input_tokens: 0,
              output_tokens: 0,
              total_tokens: 0,
              tools_passed: 1,
              latency_ms: Date.now() - toolStartedAt,
              retries: Math.max(0, toolResult.attempts - 1),
              fallback_used: false,
              cost_usd: null
            });

            return toolResult;
          },
          logAction: async ({ type, meta }) => {
            await prisma.log.create({
              data: {
                orgId: actorResult.actor.orgId,
                type: "EXE",
                actor: "AGENT_RUN",
                message: `type=${type}; meta=${JSON.stringify(meta ?? {})}`
              }
            });
          }
        }
      ),
      AGENT_RUN_TIMEOUT_MS
    );

    const nextActiveDraft =
      Object.prototype.hasOwnProperty.call(response, "activeDraft")
        ? (response.activeDraft ?? null)
        : sessionDraft;
    saveRunSession({
      runId,
      orgId: actorResult.actor.orgId,
      userId: actorResult.actor.userId,
      activeDraft: nextActiveDraft,
      turn: runTurn,
      updatedAt: Date.now()
    });

    const telemetry = buildWorkflowTelemetry({
      workflowId,
      steps: workflowSteps,
      startedAt
    });
    await writeWorkflowTelemetryLog(actorResult.actor.orgId, telemetry);

    const { activeDraft: _activeDraftIgnored, ...responseWithoutDraft } = response;
    const responsePayload = AGENT_RUN_EXPOSE_METRICS
      ? {
          ...responseWithoutDraft,
          runId,
          workflow_metrics: telemetry,
          token_burn_map: telemetry.token_burn_map
        }
      : {
          ...responseWithoutDraft,
          runId
        };

    return NextResponse.json(responsePayload, { status: statusCodeForResponse(response) });
  } catch (error) {
    if (error instanceof RequestTimeoutError) {
      return NextResponse.json(
        {
          status: "error",
          assistant_message: "The request timed out. Please retry.",
          error: {
            code: "REQUEST_TIMEOUT",
            message: error.message
          }
        },
        { status: 504 }
      );
    }

    console.error("[api/agent/run][POST] unexpected error", error);
    return NextResponse.json(
      {
        status: "error",
        assistant_message: "Main Agent run failed.",
        error: {
          code: "INTERNAL_ERROR",
          message: "Unexpected server error during agent run."
        }
      },
      { status: 500 }
    );
  } finally {
    if (guardKey) {
      releaseActorRunGuard(guardKey);
    }
  }
}
