import "server-only";

import { createHash } from "node:crypto";

import { type Personnel } from "@prisma/client";

import { buildOrganizationMainAgentPrompt } from "@/lib/agent/prompts/organizationMain";
import { decryptBrainKey } from "@/lib/security/crypto";

type ProviderKind = "openai" | "anthropic" | "gemini";
type ApiSource = "agent" | "organization" | "platform" | "none";
type RuntimeMode = "BYOK" | "PLATFORM_MANAGED";
type RuntimePlan = "STARTER" | "GROWTH" | "ENTERPRISE";

export interface AgentContextBlock {
  id: string;
  name: string;
  content: string;
  amnesiaProtected: boolean;
}

export interface AgentExecutionInput {
  taskId: string;
  flowId: string;
  prompt: string;
  agent: Pick<
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
  contextBlocks: AgentContextBlock[];
  organizationRuntime?: {
    mode?: RuntimeMode;
    provider?: string;
    model?: string;
    fallbackProvider?: string;
    fallbackModel?: string;
    servicePlan?: RuntimePlan;
    serviceMarkupPct?: number;
    organizationApiKey?: string | null;
    organizationApiKeys?: Record<string, string> | null;
  };
  modelPreference?: {
    provider?: string;
    model?: string;
  };
  systemPromptOverride?: string;
  userPromptOverride?: string;
  maxOutputTokens?: number;
}

export interface AgentExecutionResult {
  ok: boolean;
  outputText?: string;
  trace: Record<string, unknown>;
  usedProvider?: string;
  usedModel?: string;
  apiSource?: ApiSource;
  tokenUsage?: TokenUsage;
  billing?: AgentBilling;
  fallbackUsed: boolean;
  error?: string;
}

interface BrainSettings {
  provider: ProviderKind;
  model: string;
  apiKey: string | null;
  apiSource: ApiSource;
}

interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface ProviderResult {
  text: string;
  usage: TokenUsage;
  stopReason: string | null;
  truncated: boolean;
  retryCount: number;
  effectiveMaxOutputTokens: number;
}

interface AgentBilling {
  mode: RuntimeMode;
  plan: RuntimePlan;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  baseCostUsd: number;
  serviceFeeUsd: number;
  totalCostUsd: number;
}

const DEFAULT_MAX_OUTPUT_TOKENS = 900;
const MIN_MAX_OUTPUT_TOKENS = 120;
const MAX_MAX_OUTPUT_TOKENS = 4096;
const DEFAULT_MAX_CONTEXT_BLOCKS = 10;
const DEFAULT_MAX_CONTEXT_TOTAL_CHARS = 12_000;
const DEFAULT_MAX_CONTEXT_BLOCK_CHARS = 1_800;
const DEFAULT_PROMPT_MAX_TOKENS = 2_400;
const DEFAULT_PROMPT_MAX_CHARS = 14_000;
const DEFAULT_MAX_INFLIGHT = 6;
const DEFAULT_ACQUIRE_TIMEOUT_MS = 6_000;

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

const MAX_CONTEXT_BLOCKS = parsePositiveEnvInt(
  "AGENT_CONTEXT_MAX_BLOCKS",
  DEFAULT_MAX_CONTEXT_BLOCKS
);
const MAX_CONTEXT_TOTAL_CHARS = parsePositiveEnvInt(
  "AGENT_CONTEXT_MAX_TOTAL_CHARS",
  DEFAULT_MAX_CONTEXT_TOTAL_CHARS
);
const MAX_CONTEXT_BLOCK_CHARS = parsePositiveEnvInt(
  "AGENT_CONTEXT_MAX_BLOCK_CHARS",
  DEFAULT_MAX_CONTEXT_BLOCK_CHARS
);
const MAX_PROMPT_TOKENS = parsePositiveEnvInt(
  "SWARM_MAX_PROMPT_TOKENS",
  DEFAULT_PROMPT_MAX_TOKENS
);
const MAX_PROMPT_CHARS = parsePositiveEnvInt(
  "SWARM_MAX_PROMPT_CHARS",
  DEFAULT_PROMPT_MAX_CHARS
);
const SWARM_CONCISE_MODE = parseBooleanEnv("SWARM_CONCISE_MODE", true);
const SWARM_ALWAYS_INCLUDE_TIME_CONTEXT = parseBooleanEnv(
  "SWARM_ALWAYS_INCLUDE_TIME_CONTEXT",
  false
);
const SWARM_MAX_INFLIGHT = parsePositiveEnvInt("SWARM_MAX_INFLIGHT", DEFAULT_MAX_INFLIGHT);
const SWARM_ACQUIRE_TIMEOUT_MS = parsePositiveEnvInt(
  "SWARM_ACQUIRE_TIMEOUT_MS",
  DEFAULT_ACQUIRE_TIMEOUT_MS
);
const GLOBAL_MAX_OUTPUT_TOKENS = parsePositiveEnvInt(
  "SWARM_GLOBAL_MAX_OUTPUT_TOKENS",
  1200
);
const SWARM_RETRY_TRUNCATED_ONCE = parseBooleanEnv("SWARM_RETRY_TRUNCATED_ONCE", true);

let inflightCalls = 0;
const inflightQueue: Array<() => void> = [];

function normalizeProvider(value: string | undefined): ProviderKind {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized.includes("anthropic") || normalized.includes("claude")) {
    return "anthropic";
  }
  if (
    normalized.includes("gemini") ||
    normalized.includes("google") ||
    normalized.includes("vertex")
  ) {
    return "gemini";
  }
  return "openai";
}

function fallbackModel(provider: ProviderKind): string {
  if (provider === "anthropic") return "claude-3-5-sonnet-20241022";
  if (provider === "gemini") return "gemini-2.5-flash";
  return "gpt-4o-mini";
}

function parseBrainConfig(config: unknown): { provider: ProviderKind; model: string } {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    const provider = normalizeProvider(undefined);
    return { provider, model: fallbackModel(provider) };
  }

  const raw = config as Record<string, unknown>;
  const provider = normalizeProvider(typeof raw.provider === "string" ? raw.provider : undefined);
  const rawModel = typeof raw.model === "string" ? raw.model.trim() : "";
  const genericModelToken = /^(openai|anthropic|claude|gemini|google)$/i.test(rawModel);
  const model =
    rawModel.length > 0 && !genericModelToken ? rawModel : fallbackModel(provider);

  return { provider, model };
}

function normalizeRuntimeMode(value: unknown): RuntimeMode {
  return value === "PLATFORM_MANAGED" ? "PLATFORM_MANAGED" : "BYOK";
}

function normalizeRuntimePlan(value: unknown): RuntimePlan {
  if (value === "GROWTH") return "GROWTH";
  if (value === "ENTERPRISE") return "ENTERPRISE";
  return "STARTER";
}

function defaultServiceMarkup(plan: RuntimePlan) {
  if (plan === "ENTERPRISE") return 12;
  if (plan === "GROWTH") return 18;
  return 25;
}

function estimateTokensFromText(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

function clampTextForPrompt(value: string, maxChars: number) {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  const head = normalized.slice(0, Math.max(0, maxChars - 40)).trimEnd();
  const omitted = Math.max(0, normalized.length - head.length);
  return `${head}\n[TRUNCATED ${omitted} chars]`;
}

function sanitizeContextBlocks(blocks: AgentContextBlock[]) {
  const normalized: AgentContextBlock[] = [];
  const seenIds = new Set<string>();

  for (const block of blocks) {
    const id = block.id?.trim() || `context-${normalized.length + 1}`;
    if (seenIds.has(id)) {
      continue;
    }
    seenIds.add(id);

    const content = clampTextForPrompt(block.content ?? "", MAX_CONTEXT_BLOCK_CHARS);
    if (!content) {
      continue;
    }

    normalized.push({
      id,
      name: block.name?.trim() || "Context",
      amnesiaProtected: Boolean(block.amnesiaProtected),
      content
    });
    if (normalized.length >= MAX_CONTEXT_BLOCKS) {
      break;
    }
  }

  const selected: AgentContextBlock[] = [];
  let usedChars = 0;

  for (const block of normalized) {
    const remaining = MAX_CONTEXT_TOTAL_CHARS - usedChars;
    if (remaining <= 0) {
      break;
    }
    const nextContent =
      block.content.length <= remaining
        ? block.content
        : clampTextForPrompt(block.content, Math.max(80, remaining));
    if (!nextContent) {
      break;
    }
    selected.push({
      ...block,
      content: nextContent
    });
    usedChars += nextContent.length;
  }

  const omittedBlocks = Math.max(0, blocks.length - selected.length);
  if (omittedBlocks > 0) {
    const note = `Additional context omitted for token budget: ${omittedBlocks} block(s).`;
    if (usedChars + note.length <= MAX_CONTEXT_TOTAL_CHARS) {
      selected.push({
        id: "context-budget-note",
        name: "Context Budget Note",
        amnesiaProtected: false,
        content: note
      });
    }
  }

  return selected;
}

function resolveMaxOutputTokens(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return Math.min(DEFAULT_MAX_OUTPUT_TOKENS, GLOBAL_MAX_OUTPUT_TOKENS);
  }
  return Math.max(
    MIN_MAX_OUTPUT_TOKENS,
    Math.min(MAX_MAX_OUTPUT_TOKENS, GLOBAL_MAX_OUTPUT_TOKENS, Math.floor(value))
  );
}

function normalizeUsage(input: Partial<TokenUsage> | null | undefined, fallbackText = ""): TokenUsage {
  const promptTokens =
    typeof input?.promptTokens === "number" && Number.isFinite(input.promptTokens)
      ? Math.max(1, Math.floor(input.promptTokens))
      : estimateTokensFromText(fallbackText);
  const completionTokens =
    typeof input?.completionTokens === "number" && Number.isFinite(input.completionTokens)
      ? Math.max(1, Math.floor(input.completionTokens))
      : estimateTokensFromText(fallbackText);
  const totalTokens =
    typeof input?.totalTokens === "number" && Number.isFinite(input.totalTokens)
      ? Math.max(1, Math.floor(input.totalTokens))
      : promptTokens + completionTokens;

  return { promptTokens, completionTokens, totalTokens };
}

function inferTokenRates(provider: ProviderKind, model: string) {
  const normalizedModel = model.toLowerCase();

  if (provider === "openai") {
    if (normalizedModel.includes("gpt-4o-mini")) {
      return { inputPerMillionUsd: 0.6, outputPerMillionUsd: 2.4 };
    }
    if (normalizedModel.includes("gpt-4.1-mini")) {
      return { inputPerMillionUsd: 0.8, outputPerMillionUsd: 3.2 };
    }
    return { inputPerMillionUsd: 5, outputPerMillionUsd: 15 };
  }

  if (provider === "anthropic") {
    return { inputPerMillionUsd: 3, outputPerMillionUsd: 15 };
  }

  return { inputPerMillionUsd: 1.25, outputPerMillionUsd: 5 };
}

function computeBilling(
  provider: ProviderKind,
  model: string,
  usage: TokenUsage,
  organizationRuntime?: AgentExecutionInput["organizationRuntime"]
): AgentBilling {
  const mode = normalizeRuntimeMode(organizationRuntime?.mode);
  const plan = normalizeRuntimePlan(organizationRuntime?.servicePlan);
  const { inputPerMillionUsd, outputPerMillionUsd } = inferTokenRates(provider, model);

  const baseCostUsd =
    (usage.promptTokens / 1_000_000) * inputPerMillionUsd +
    (usage.completionTokens / 1_000_000) * outputPerMillionUsd;

  const normalizedMarkup =
    typeof organizationRuntime?.serviceMarkupPct === "number" &&
    Number.isFinite(organizationRuntime.serviceMarkupPct)
      ? Math.min(200, Math.max(0, organizationRuntime.serviceMarkupPct))
      : defaultServiceMarkup(plan);

  const serviceFeeUsd = mode === "PLATFORM_MANAGED" ? baseCostUsd * (normalizedMarkup / 100) : 0;
  const totalCostUsd = baseCostUsd + serviceFeeUsd;

  return {
    mode,
    plan,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    baseCostUsd: Number(baseCostUsd.toFixed(6)),
    serviceFeeUsd: Number(serviceFeeUsd.toFixed(6)),
    totalCostUsd: Number(totalCostUsd.toFixed(6))
  };
}

function resolvePlatformApiKey(provider: ProviderKind) {
  const normalizeApiKey = (value: string | undefined) => {
    const trimmed = value?.trim() ?? "";
    if (!trimmed || /^replace_with_/i.test(trimmed)) {
      return null;
    }
    return trimmed;
  };

  if (provider === "anthropic") {
    return (
      normalizeApiKey(process.env.PLATFORM_ANTHROPIC_API_KEY) ??
      normalizeApiKey(process.env.ANTHROPIC_API_KEY) ??
      null
    );
  }

  if (provider === "gemini") {
    return (
      normalizeApiKey(process.env.PLATFORM_GEMINI_API_KEY) ??
      normalizeApiKey(process.env.GEMINI_API_KEY) ??
      null
    );
  }

  return (
    normalizeApiKey(process.env.PLATFORM_OPENAI_API_KEY) ??
    normalizeApiKey(process.env.OPENAI_API_KEY) ??
    null
  );
}

function resolveKeyForProvider(
  provider: ProviderKind,
  agentApiKey: string | null,
  organizationRuntime?: AgentExecutionInput["organizationRuntime"]
): { apiKey: string | null; apiSource: ApiSource } {
  const normalizeApiKey = (value: string | null | undefined) => {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (!trimmed || /^replace_with_/i.test(trimmed)) {
      return null;
    }
    return trimmed;
  };

  const normalizedAgentKey = normalizeApiKey(agentApiKey);
  if (normalizedAgentKey) {
    return { apiKey: normalizedAgentKey, apiSource: "agent" };
  }

  const orgApiKeys =
    organizationRuntime?.organizationApiKeys &&
    typeof organizationRuntime.organizationApiKeys === "object"
      ? organizationRuntime.organizationApiKeys
      : null;
  const providerScopedKeyRaw =
    orgApiKeys && typeof orgApiKeys[provider] === "string"
      ? orgApiKeys[provider]?.trim()
      : "";
  const providerScopedKey = normalizeApiKey(providerScopedKeyRaw);
  if (providerScopedKey) {
    return { apiKey: providerScopedKey, apiSource: "organization" };
  }

  const orgApiKey = normalizeApiKey(organizationRuntime?.organizationApiKey ?? null);
  if (orgApiKey) {
    return { apiKey: orgApiKey, apiSource: "organization" };
  }

  const runtimeMode = normalizeRuntimeMode(organizationRuntime?.mode);
  if (runtimeMode === "PLATFORM_MANAGED") {
    const platformKey = resolvePlatformApiKey(provider);
    if (platformKey) {
      return { apiKey: platformKey, apiSource: "platform" };
    }
  }

  // Backward-compatible fallback for older orgs that do not yet define runtime mode.
  if (!organizationRuntime?.mode) {
    const platformKey = resolvePlatformApiKey(provider);
    if (platformKey) {
      return { apiKey: platformKey, apiSource: "platform" };
    }
  }

  return { apiKey: null, apiSource: "none" };
}

function safeDecryptKey(
  enc: string | null,
  iv: string | null,
  authTag: string | null,
  keyVersion: number | null
) {
  if (!enc || !iv || !authTag) {
    return null;
  }

  try {
    return decryptBrainKey({
      cipherText: enc,
      iv,
      authTag,
      keyVersion: keyVersion ?? 1
    });
  } catch {
    return null;
  }
}

function isMainOrchestratorRole(agentRole: string) {
  const normalized = agentRole.trim().toLowerCase();
  return normalized.includes("orchestrator") || normalized.includes("main");
}

function buildMainOrchestratorCriticalRules() {
  return SWARM_CONCISE_MODE
    ? [
        "Main orchestrator rules:",
        "1) Include required toolkits in plan (`toolkits:`).",
        "2) If toolkit is not connected, stop and request Human Touch.",
        "3) Never claim external execution without tool evidence.",
        "4) For action tasks, provide exact fields (recipient, subject, body).",
        "5) If missing evidence, mark `Not executed`."
      ].join("\n")
    : [
        "CRITICAL RULES (MAIN ORCHESTRATOR):",
        "1) Determine required platform/toolkit before execution and explicitly include `toolkits: ...` in your plan.",
        "2) Connection gate is mandatory: if a required toolkit is not connected, stop and request Human Touch to connect it.",
        "3) Never report external execution as complete unless tool execution evidence is present in context.",
        "4) For action tasks, provide exact execution fields (for email: recipient, subject, body) without ambiguity.",
        "5) If a step fails, return root cause plus immediate retry/fallback path instead of silent continuation.",
        "6) If evidence is missing, explicitly mark outcome as `Not executed` instead of implying completion."
      ].join("\n");
}

function buildSystemPrompt(agentName: string, agentRole: string) {
  if (isMainOrchestratorRole(agentRole)) {
    return [
      buildOrganizationMainAgentPrompt({
        orgName: "the organization",
        mode: "execution",
        contextAvailable: true
      }),
      "",
      buildMainOrchestratorCriticalRules()
    ].join("\n");
  }

  const base = SWARM_CONCISE_MODE
    ? [
        `You are ${agentName} (${agentRole}).`,
        "Use only provided context and tool evidence.",
        "Never invent IDs, links, numbers, tool outputs, or completion claims.",
        "If information is missing, say `Unknown based on current context` and request what is missing.",
        "Return concise actionable output."
      ]
    : [
        `You are ${agentName}, acting as ${agentRole} in VorldX Swarm.`,
        "Follow Human Touch philosophy: be precise, cite assumptions, and avoid unsafe leaps.",
        "Never fabricate facts, IDs, links, numbers, tool outputs, or completion status.",
        "If certainty is low, say `Unknown based on current context` and ask for the missing evidence.",
        "If data is missing, explicitly state what is missing and request Human Touch intervention.",
        "Return concise actionable output."
      ];

  return base.join("\n");
}

function buildUserPrompt(prompt: string, contextBlocks: AgentContextBlock[]) {
  if (contextBlocks.length === 0) {
    return `Task:\n${prompt}\n\nContext:\nnone`;
  }

  const contextText = contextBlocks
    .map((item, index) => {
      if (item.amnesiaProtected) {
        return `[${index + 1}] ${item.name} (${item.id}): amnesia protected; metadata only.`;
      }
      return `[${index + 1}] ${item.name} (${item.id}):\n${item.content}`;
    })
    .join("\n\n");

  return [`Task:`, prompt, "", "Context:", contextText].join("\n");
}

function buildTimeAwarenessContext(reference: Date) {
  const utcIso = reference.toISOString();
  const unixSeconds = Math.floor(reference.getTime() / 1000);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const localDisplay = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(reference);

  return [
    "TIME AWARENESS:",
    `Current UTC time: ${utcIso}`,
    `Current server local time (${timezone}): ${localDisplay}`,
    `Unix timestamp (seconds): ${unixSeconds}`,
    "Resolve relative dates (today/tomorrow/yesterday/next week) against current UTC time above and respond with concrete dates when relevant."
  ].join("\n");
}

const TIME_AWARENESS_TRIGGER =
  /\b(today|tomorrow|yesterday|next week|this week|date|time|timezone|calendar|meeting|deadline|schedule|quarter|month|year)\b/i;

function shouldInjectTimeAwareness(input: {
  prompt: string;
  systemPrompt: string;
  userPrompt: string;
}) {
  if (SWARM_ALWAYS_INCLUDE_TIME_CONTEXT) {
    return true;
  }
  return TIME_AWARENESS_TRIGGER.test(
    `${input.prompt}\n${input.systemPrompt}\n${input.userPrompt}`
  );
}

function truncatePromptByTokenBudget(value: string, maxTokens: number) {
  const maxChars = Math.max(120, maxTokens * 4);
  if (value.length <= maxChars) {
    return value;
  }
  const trimmed = value.slice(0, Math.max(0, maxChars - 32)).trimEnd();
  const omitted = Math.max(0, value.length - trimmed.length);
  return `${trimmed}\n[TRUNCATED ${omitted} chars for prompt budget]`;
}

function applyPromptBudget(systemPrompt: string, userPrompt: string) {
  const systemTrimmed = truncatePromptByTokenBudget(systemPrompt, Math.ceil(MAX_PROMPT_TOKENS * 0.45));
  const systemTokens = estimateTokensFromText(systemTrimmed);

  const remainingForUser = Math.max(
    180,
    Math.min(
      MAX_PROMPT_TOKENS - systemTokens,
      Math.floor((MAX_PROMPT_CHARS - systemTrimmed.length) / 4)
    )
  );
  const userTrimmed = truncatePromptByTokenBudget(userPrompt, remainingForUser);
  const userTokens = estimateTokensFromText(userTrimmed);

  return {
    systemPrompt: systemTrimmed,
    userPrompt: userTrimmed,
    estimatedPromptTokens: systemTokens + userTokens,
    estimatedSystemTokens: systemTokens,
    estimatedUserTokens: userTokens
  };
}

async function acquireLlmSlot() {
  if (SWARM_MAX_INFLIGHT <= 1) {
    return;
  }
  if (inflightCalls < SWARM_MAX_INFLIGHT) {
    inflightCalls += 1;
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let queued: (() => void) | null = null;
    const timer = setTimeout(() => {
      if (queued) {
        const index = inflightQueue.indexOf(queued);
        if (index >= 0) {
          inflightQueue.splice(index, 1);
        }
      }
      reject(new Error("LLM concurrency queue timed out."));
    }, SWARM_ACQUIRE_TIMEOUT_MS);

    queued = () => {
      clearTimeout(timer);
      inflightCalls += 1;
      resolve();
    };

    inflightQueue.push(queued);
  });
}

function releaseLlmSlot() {
  if (SWARM_MAX_INFLIGHT <= 1) {
    return;
  }
  inflightCalls = Math.max(0, inflightCalls - 1);
  const next = inflightQueue.shift();
  if (next) {
    next();
  }
}

async function invokeProviderGuarded(
  settings: BrainSettings,
  system: string,
  userPrompt: string,
  maxOutputTokens: number
) {
  // Process-local guard only; distributed limiting should be handled at queue/worker layer.
  await acquireLlmSlot();
  try {
    return await invokeProvider(settings, system, userPrompt, maxOutputTokens);
  } finally {
    releaseLlmSlot();
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 45_000) {
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

function normalizeOutputContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (!item || typeof item !== "object") return "";
        const raw = item as Record<string, unknown>;
        if (typeof raw.text === "string") return raw.text;
        if (typeof raw.content === "string") return raw.content;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function normalizeStopReason(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function isTruncatedStopReason(stopReason: string | null) {
  if (!stopReason) {
    return false;
  }
  return (
    stopReason === "length" ||
    stopReason === "max_tokens" ||
    stopReason === "max_output_tokens" ||
    stopReason === "token_limit"
  );
}

function looksAbruptlyCut(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return true;
  }
  if (/[.!?`'"]$/.test(trimmed)) {
    return false;
  }
  if (/[,:;\-(]$/.test(trimmed)) {
    return true;
  }
  const words = trimmed.split(/\s+/g).filter(Boolean);
  if (words.length <= 3) {
    return true;
  }
  const tail = words.slice(-2).join(" ").toLowerCase();
  if (
    /\b(and|or|to|for|with|from|as|because|if|then|that|which|who|while|when|where)$/.test(
      tail
    )
  ) {
    return true;
  }
  return words.length <= 8;
}

function resolveRetryMaxOutputTokens(current: number) {
  const hardCeiling = Math.min(MAX_MAX_OUTPUT_TOKENS, GLOBAL_MAX_OUTPUT_TOKENS);
  if (current >= hardCeiling) {
    return current;
  }
  return Math.max(
    current + 80,
    Math.min(hardCeiling, Math.floor(current * 1.6))
  );
}

async function invokeProviderWithCompletenessRetry(
  settings: BrainSettings,
  system: string,
  userPrompt: string,
  maxOutputTokens: number
) {
  const first = await invokeProviderGuarded(
    settings,
    system,
    userPrompt,
    maxOutputTokens
  );
  const firstNeedsRetry =
    SWARM_RETRY_TRUNCATED_ONCE &&
    maxOutputTokens < Math.min(MAX_MAX_OUTPUT_TOKENS, GLOBAL_MAX_OUTPUT_TOKENS) &&
    (first.truncated || looksAbruptlyCut(first.text));

  if (!firstNeedsRetry) {
    return first;
  }

  const retryMaxOutputTokens = resolveRetryMaxOutputTokens(maxOutputTokens);
  if (retryMaxOutputTokens <= maxOutputTokens) {
    return {
      ...first,
      retryCount: 1
    };
  }

  try {
    const retried = await invokeProviderGuarded(
      settings,
      system,
      userPrompt,
      retryMaxOutputTokens
    );
    return {
      ...retried,
      retryCount: 1,
      effectiveMaxOutputTokens: retryMaxOutputTokens
    };
  } catch {
    return {
      ...first,
      retryCount: 1
    };
  }
}

async function callOpenAI(
  model: string,
  apiKey: string,
  system: string,
  userPrompt: string,
  maxOutputTokens: number
): Promise<ProviderResult> {
  const response = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: maxOutputTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userPrompt }
      ]
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI ${response.status}: ${detail.slice(0, 200)}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const first = choices[0] as Record<string, unknown> | undefined;
  const message = (first?.message as Record<string, unknown> | undefined) ?? {};
  const stopReason = normalizeStopReason(first?.finish_reason);
  const content = normalizeOutputContent(message.content);
  if (!content) {
    throw new Error("OpenAI returned an empty response.");
  }

  const usageRaw =
    payload.usage && typeof payload.usage === "object"
      ? (payload.usage as Record<string, unknown>)
      : null;
  const usage = normalizeUsage(
    usageRaw
      ? {
          promptTokens:
            typeof usageRaw.prompt_tokens === "number" ? usageRaw.prompt_tokens : undefined,
          completionTokens:
            typeof usageRaw.completion_tokens === "number"
              ? usageRaw.completion_tokens
              : undefined,
          totalTokens: typeof usageRaw.total_tokens === "number" ? usageRaw.total_tokens : undefined
        }
      : null,
    `${system}\n${userPrompt}\n${content}`
  );

  return {
    text: content,
    usage,
    stopReason,
    truncated: isTruncatedStopReason(stopReason),
    retryCount: 0,
    effectiveMaxOutputTokens: maxOutputTokens
  };
}

async function callAnthropic(
  model: string,
  apiKey: string,
  system: string,
  userPrompt: string,
  maxOutputTokens: number
): Promise<ProviderResult> {
  const response = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: maxOutputTokens,
      temperature: 0.2,
      system,
      messages: [
        {
          role: "user",
          content: userPrompt
        }
      ]
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Anthropic ${response.status}: ${detail.slice(0, 200)}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const stopReason = normalizeStopReason(payload.stop_reason);
  const content = normalizeOutputContent(payload.content);
  if (!content) {
    throw new Error("Anthropic returned an empty response.");
  }

  const usageRaw =
    payload.usage && typeof payload.usage === "object"
      ? (payload.usage as Record<string, unknown>)
      : null;
  const usage = normalizeUsage(
    usageRaw
      ? {
          promptTokens:
            typeof usageRaw.input_tokens === "number" ? usageRaw.input_tokens : undefined,
          completionTokens:
            typeof usageRaw.output_tokens === "number" ? usageRaw.output_tokens : undefined,
          totalTokens:
            typeof usageRaw.input_tokens === "number" &&
            typeof usageRaw.output_tokens === "number"
              ? usageRaw.input_tokens + usageRaw.output_tokens
              : undefined
        }
      : null,
    `${system}\n${userPrompt}\n${content}`
  );

  return {
    text: content,
    usage,
    stopReason,
    truncated: isTruncatedStopReason(stopReason),
    retryCount: 0,
    effectiveMaxOutputTokens: maxOutputTokens
  };
}

async function callGemini(
  model: string,
  apiKey: string,
  system: string,
  userPrompt: string,
  maxOutputTokens: number
): Promise<ProviderResult> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `${system}\n\n${userPrompt}`
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens
      }
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini ${response.status}: ${detail.slice(0, 200)}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const first = candidates[0] as Record<string, unknown> | undefined;
  const stopReason = normalizeStopReason(first?.finishReason ?? first?.finish_reason);
  const content = (first?.content as Record<string, unknown> | undefined) ?? {};
  const parts = Array.isArray(content.parts) ? content.parts : [];
  const text = parts
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const raw = part as Record<string, unknown>;
      return typeof raw.text === "string" ? raw.text : "";
    })
    .filter(Boolean)
    .join("\n");

  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }

  const usageRaw =
    payload.usageMetadata && typeof payload.usageMetadata === "object"
      ? (payload.usageMetadata as Record<string, unknown>)
      : null;
  const usage = normalizeUsage(
    usageRaw
      ? {
          promptTokens:
            typeof usageRaw.promptTokenCount === "number" ? usageRaw.promptTokenCount : undefined,
          completionTokens:
            typeof usageRaw.candidatesTokenCount === "number"
              ? usageRaw.candidatesTokenCount
              : undefined,
          totalTokens:
            typeof usageRaw.totalTokenCount === "number" ? usageRaw.totalTokenCount : undefined
        }
      : null,
    `${system}\n${userPrompt}\n${text}`
  );

  return {
    text,
    usage,
    stopReason,
    truncated: isTruncatedStopReason(stopReason),
    retryCount: 0,
    effectiveMaxOutputTokens: maxOutputTokens
  };
}

async function invokeProvider(
  settings: BrainSettings,
  system: string,
  userPrompt: string,
  maxOutputTokens: number
): Promise<ProviderResult> {
  if (!settings.apiKey) {
    throw new Error("Agent API key is not configured.");
  }

  if (settings.provider === "anthropic") {
    return callAnthropic(settings.model, settings.apiKey, system, userPrompt, maxOutputTokens);
  }

  if (settings.provider === "gemini") {
    return callGemini(settings.model, settings.apiKey, system, userPrompt, maxOutputTokens);
  }

  return callOpenAI(settings.model, settings.apiKey, system, userPrompt, maxOutputTokens);
}

function resolvePrimarySettings(input: AgentExecutionInput): BrainSettings {
  const { agent, organizationRuntime, modelPreference } = input;

  const preferredProvider = normalizeProvider(modelPreference?.provider);
  const preferredModel =
    typeof modelPreference?.model === "string" ? modelPreference.model.trim() : "";

  const config = parseBrainConfig(agent.brainConfig);
  const orgProvider = normalizeProvider(organizationRuntime?.provider);
  const orgModel =
    typeof organizationRuntime?.model === "string" ? organizationRuntime.model.trim() : "";
  const provider = preferredProvider || orgProvider || config.provider;
  const model =
    preferredModel ||
    orgModel ||
    config.model ||
    fallbackModel(provider);

  const apiKey = safeDecryptKey(
    agent.brainKeyEnc,
    agent.brainKeyIv,
    agent.brainKeyAuthTag,
    agent.brainKeyKeyVer ?? 1
  );
  const resolvedKey = resolveKeyForProvider(provider, apiKey, organizationRuntime);

  return {
    provider,
    model,
    apiKey: resolvedKey.apiKey,
    apiSource: resolvedKey.apiSource
  };
}

function resolveFallbackSettings(input: AgentExecutionInput): BrainSettings | null {
  const { agent, organizationRuntime } = input;

  const config = parseBrainConfig(agent.fallbackBrainConfig);
  const orgProvider = normalizeProvider(organizationRuntime?.fallbackProvider);
  const orgModel =
    typeof organizationRuntime?.fallbackModel === "string"
      ? organizationRuntime.fallbackModel.trim()
      : "";
  const provider = orgProvider || config.provider;
  const model = orgModel || config.model || fallbackModel(provider);
  const apiKey = safeDecryptKey(
    agent.fallbackBrainKeyEnc,
    agent.fallbackBrainKeyIv,
    agent.fallbackBrainKeyAuthTag,
    agent.fallbackBrainKeyKeyVer ?? 1
  );
  const resolvedKey = resolveKeyForProvider(provider, apiKey, organizationRuntime);

  if (!resolvedKey.apiKey) {
    return null;
  }

  return {
    provider,
    model,
    apiKey: resolvedKey.apiKey,
    apiSource: resolvedKey.apiSource
  };
}

function resolveEmergencyFallbackSettings(
  input: AgentExecutionInput,
  attemptedProviders: ProviderKind[]
): BrainSettings | null {
  const runtime = input.organizationRuntime;
  const candidates: ProviderKind[] = ["gemini", "anthropic", "openai"];

  for (const provider of candidates) {
    if (attemptedProviders.includes(provider)) {
      continue;
    }

    const resolvedKey = resolveKeyForProvider(provider, null, runtime);
    if (!resolvedKey.apiKey) {
      continue;
    }

    return {
      provider,
      model: fallbackModel(provider),
      apiKey: resolvedKey.apiKey,
      apiSource: resolvedKey.apiSource
    };
  }

  return null;
}

export async function executeSwarmAgent(input: AgentExecutionInput): Promise<AgentExecutionResult> {
  const startedAt = Date.now();
  const now = new Date();
  const maxOutputTokens = resolveMaxOutputTokens(input.maxOutputTokens);
  const contextBlocks = sanitizeContextBlocks(input.contextBlocks);
  const systemBase =
    typeof input.systemPromptOverride === "string" && input.systemPromptOverride.trim().length > 0
      ? input.systemPromptOverride.trim()
      : buildSystemPrompt(input.agent.name, input.agent.role);
  const rawUserPrompt =
    typeof input.userPromptOverride === "string" && input.userPromptOverride.trim().length > 0
      ? input.userPromptOverride.trim()
      : buildUserPrompt(input.prompt, contextBlocks);
  const timeAwarenessInjected = shouldInjectTimeAwareness({
    prompt: input.prompt,
    systemPrompt: systemBase,
    userPrompt: rawUserPrompt
  });
  const rawSystem = timeAwarenessInjected
    ? [systemBase, buildTimeAwarenessContext(now)].join("\n\n")
    : systemBase;
  const promptBudgeted = applyPromptBudget(rawSystem, rawUserPrompt);
  const system = promptBudgeted.systemPrompt;
  const userPrompt = promptBudgeted.userPrompt;
  const primary = resolvePrimarySettings(input);
  const fallback = resolveFallbackSettings(input);
  const preferredProviderRaw =
    typeof input.modelPreference?.provider === "string"
      ? input.modelPreference.provider.trim()
      : "";
  const pinnedProvider = preferredProviderRaw
    ? normalizeProvider(preferredProviderRaw)
    : null;
  const contextDigest = createHash("sha256")
    .update(
      contextBlocks
        .map((block) => `${block.id}|${block.name}|${block.amnesiaProtected}|${block.content}`)
        .join("||")
    )
    .digest("hex");

  if (!primary.apiKey) {
    let candidateFallback =
      fallback ?? resolveEmergencyFallbackSettings(input, [primary.provider]);

    // Respect pinned provider selection from UI/model preference.
    if (pinnedProvider && candidateFallback && candidateFallback.provider !== pinnedProvider) {
      candidateFallback = null;
    }

    if (!candidateFallback) {
      return {
        ok: false,
        fallbackUsed: false,
        error: "Primary brain key is missing or invalid for this agent.",
        trace: {
          taskId: input.taskId,
          flowId: input.flowId,
          agentId: input.agent.id,
          provider: primary.provider,
          model: primary.model,
          apiSource: primary.apiSource,
          contextDigest,
          estimatedPromptTokens: promptBudgeted.estimatedPromptTokens,
          estimatedSystemTokens: promptBudgeted.estimatedSystemTokens,
          estimatedUserTokens: promptBudgeted.estimatedUserTokens,
          timeAwarenessInjected,
          maxOutputTokens
        }
      };
    }

    try {
      const providerResult = await invokeProviderWithCompletenessRetry(
        candidateFallback,
        system,
        userPrompt,
        maxOutputTokens
      );
      const outputText = providerResult.text;
      const billing = computeBilling(
        candidateFallback.provider,
        candidateFallback.model,
        providerResult.usage,
        input.organizationRuntime
      );

      return {
        ok: true,
        outputText,
        usedProvider: candidateFallback.provider,
        usedModel: candidateFallback.model,
        apiSource: candidateFallback.apiSource,
        tokenUsage: providerResult.usage,
        billing,
        fallbackUsed: true,
        trace: {
          taskId: input.taskId,
          flowId: input.flowId,
          agentId: input.agent.id,
          provider: candidateFallback.provider,
          model: candidateFallback.model,
          apiSource: candidateFallback.apiSource,
          fallbackUsed: true,
          fallbackSource: fallback ? "configured" : "emergency",
          fallbackReason: "primary_api_key_missing",
          contextCount: contextBlocks.length,
          contextDigest,
          estimatedPromptTokens: promptBudgeted.estimatedPromptTokens,
          estimatedSystemTokens: promptBudgeted.estimatedSystemTokens,
          estimatedUserTokens: promptBudgeted.estimatedUserTokens,
          timeAwarenessInjected,
          maxOutputTokens,
          effectiveMaxOutputTokens: providerResult.effectiveMaxOutputTokens,
          providerStopReason: providerResult.stopReason,
          outputTruncated: providerResult.truncated,
          truncationRetryCount: providerResult.retryCount,
          tokenUsage: providerResult.usage,
          billing,
          outputPreview: outputText.slice(0, 1200),
          durationMs: Date.now() - startedAt
        }
      };
    } catch (fallbackError) {
      return {
        ok: false,
        fallbackUsed: true,
        error:
          fallbackError instanceof Error
            ? fallbackError.message
            : "Fallback model call failed after primary key resolution failure.",
        trace: {
          taskId: input.taskId,
          flowId: input.flowId,
          agentId: input.agent.id,
          provider: candidateFallback.provider,
          model: candidateFallback.model,
          apiSource: candidateFallback.apiSource,
          fallbackUsed: true,
          fallbackSource: fallback ? "configured" : "emergency",
          fallbackReason: "primary_api_key_missing",
          contextCount: contextBlocks.length,
          contextDigest,
          estimatedPromptTokens: promptBudgeted.estimatedPromptTokens,
          estimatedSystemTokens: promptBudgeted.estimatedSystemTokens,
          estimatedUserTokens: promptBudgeted.estimatedUserTokens,
          timeAwarenessInjected,
          maxOutputTokens,
          error:
            fallbackError instanceof Error
              ? fallbackError.message
              : "Fallback model call failed after primary key resolution failure."
        }
      };
    }
  }

  try {
    const providerResult = await invokeProviderWithCompletenessRetry(
      primary,
      system,
      userPrompt,
      maxOutputTokens
    );
    const outputText = providerResult.text;
    const billing = computeBilling(
      primary.provider,
      primary.model,
      providerResult.usage,
      input.organizationRuntime
    );

    return {
      ok: true,
      outputText,
      usedProvider: primary.provider,
      usedModel: primary.model,
      apiSource: primary.apiSource,
      tokenUsage: providerResult.usage,
      billing,
      fallbackUsed: false,
      trace: {
        taskId: input.taskId,
        flowId: input.flowId,
        agentId: input.agent.id,
        provider: primary.provider,
        model: primary.model,
        apiSource: primary.apiSource,
        fallbackUsed: false,
        contextCount: contextBlocks.length,
        contextDigest,
        estimatedPromptTokens: promptBudgeted.estimatedPromptTokens,
        estimatedSystemTokens: promptBudgeted.estimatedSystemTokens,
        estimatedUserTokens: promptBudgeted.estimatedUserTokens,
        timeAwarenessInjected,
        maxOutputTokens,
        effectiveMaxOutputTokens: providerResult.effectiveMaxOutputTokens,
        providerStopReason: providerResult.stopReason,
        outputTruncated: providerResult.truncated,
        truncationRetryCount: providerResult.retryCount,
        tokenUsage: providerResult.usage,
        billing,
        outputPreview: outputText.slice(0, 1200),
        durationMs: Date.now() - startedAt
      }
    };
  } catch (primaryError) {
    let candidateFallback =
      fallback ?? resolveEmergencyFallbackSettings(input, [primary.provider]);

    // If caller explicitly selected a provider (for example from UI model picker),
    // do not silently switch to another provider on fallback.
    if (pinnedProvider && candidateFallback && candidateFallback.provider !== pinnedProvider) {
      candidateFallback = null;
    }

    if (!candidateFallback) {
      return {
        ok: false,
        fallbackUsed: false,
        error: primaryError instanceof Error ? primaryError.message : "Primary model call failed.",
        trace: {
          taskId: input.taskId,
          flowId: input.flowId,
          agentId: input.agent.id,
          provider: primary.provider,
          model: primary.model,
          apiSource: primary.apiSource,
          fallbackUsed: false,
          contextCount: contextBlocks.length,
          contextDigest,
          estimatedPromptTokens: promptBudgeted.estimatedPromptTokens,
          estimatedSystemTokens: promptBudgeted.estimatedSystemTokens,
          estimatedUserTokens: promptBudgeted.estimatedUserTokens,
          timeAwarenessInjected,
          maxOutputTokens,
          error: primaryError instanceof Error ? primaryError.message : "Primary model call failed."
        }
      };
    }

    try {
      const providerResult = await invokeProviderWithCompletenessRetry(
        candidateFallback,
        system,
        userPrompt,
        maxOutputTokens
      );
      const outputText = providerResult.text;
      const billing = computeBilling(
        candidateFallback.provider,
        candidateFallback.model,
        providerResult.usage,
        input.organizationRuntime
      );

      return {
        ok: true,
        outputText,
        usedProvider: candidateFallback.provider,
        usedModel: candidateFallback.model,
        apiSource: candidateFallback.apiSource,
        tokenUsage: providerResult.usage,
        billing,
        fallbackUsed: true,
        trace: {
          taskId: input.taskId,
          flowId: input.flowId,
          agentId: input.agent.id,
          provider: candidateFallback.provider,
          model: candidateFallback.model,
          apiSource: candidateFallback.apiSource,
          fallbackUsed: true,
          fallbackSource: fallback ? "configured" : "emergency",
          primaryError:
            primaryError instanceof Error ? primaryError.message : "Primary model call failed.",
          contextCount: contextBlocks.length,
          contextDigest,
          estimatedPromptTokens: promptBudgeted.estimatedPromptTokens,
          estimatedSystemTokens: promptBudgeted.estimatedSystemTokens,
          estimatedUserTokens: promptBudgeted.estimatedUserTokens,
          timeAwarenessInjected,
          maxOutputTokens,
          effectiveMaxOutputTokens: providerResult.effectiveMaxOutputTokens,
          providerStopReason: providerResult.stopReason,
          outputTruncated: providerResult.truncated,
          truncationRetryCount: providerResult.retryCount,
          tokenUsage: providerResult.usage,
          billing,
          outputPreview: outputText.slice(0, 1200),
          durationMs: Date.now() - startedAt
        }
      };
    } catch (fallbackError) {
      return {
        ok: false,
        fallbackUsed: true,
        error: fallbackError instanceof Error ? fallbackError.message : "Fallback model call failed.",
        trace: {
          taskId: input.taskId,
          flowId: input.flowId,
          agentId: input.agent.id,
          provider: candidateFallback.provider,
          model: candidateFallback.model,
          fallbackUsed: true,
          fallbackSource: fallback ? "configured" : "emergency",
          primaryError:
            primaryError instanceof Error ? primaryError.message : "Primary model call failed.",
          fallbackError:
            fallbackError instanceof Error ? fallbackError.message : "Fallback model call failed.",
          contextCount: contextBlocks.length,
          contextDigest,
          estimatedPromptTokens: promptBudgeted.estimatedPromptTokens,
          estimatedSystemTokens: promptBudgeted.estimatedSystemTokens,
          estimatedUserTokens: promptBudgeted.estimatedUserTokens,
          timeAwarenessInjected,
          maxOutputTokens,
          durationMs: Date.now() - startedAt
        }
      };
    }
  }
}
