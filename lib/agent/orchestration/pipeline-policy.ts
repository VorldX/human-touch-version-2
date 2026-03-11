import "server-only";

import { randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";
import { MemoryTier } from "@prisma/client";

import { featureFlags } from "@/lib/config/feature-flags";
import { prisma } from "@/lib/db/prisma";
import {
  defaultOrchestrationPipelineRules,
  resolveOrchestrationPipelineEffectivePolicy as resolveSharedOrchestrationPipelineEffectivePolicy,
  type OrchestrationPipelineEffectivePolicy,
  type OrchestrationPipelineMode,
  type OrchestrationPipelineRule,
  type OrchestrationPipelineRuleType,
  type OrchestrationPipelineSettings
} from "@/lib/agent/orchestration/pipeline-policy-shared";

export type {
  OrchestrationPipelineEffectivePolicy,
  OrchestrationPipelineMode,
  OrchestrationPipelineRule,
  OrchestrationPipelineRuleType,
  OrchestrationPipelineSettings
} from "@/lib/agent/orchestration/pipeline-policy-shared";

const SETTINGS_KEY = "org.settings.orchestration.pipeline.v1";

type MemoryEntryClient = Pick<Prisma.TransactionClient, "memoryEntry"> | typeof prisma;

interface StoredOrchestrationPipelineSettings {
  mode: OrchestrationPipelineMode;
  rules: OrchestrationPipelineRule[];
  updatedAt: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeMode(value: unknown): OrchestrationPipelineMode {
  if (value === "AUDIT") return "AUDIT";
  if (value === "ENFORCE") return "ENFORCE";
  return "OFF";
}

function normalizeRuleType(value: unknown): OrchestrationPipelineRuleType | null {
  if (value === "REQUIRE_PLAN_BEFORE_EXECUTION") return "REQUIRE_PLAN_BEFORE_EXECUTION";
  if (value === "REQUIRE_PLAN_WORKFLOWS") return "REQUIRE_PLAN_WORKFLOWS";
  if (value === "BLOCK_DIRECT_WORKFLOW_LAUNCH") return "BLOCK_DIRECT_WORKFLOW_LAUNCH";
  if (value === "FREEZE_EXECUTION_TO_APPROVED_PLAN") return "FREEZE_EXECUTION_TO_APPROVED_PLAN";
  if (value === "REQUIRE_DETAILED_PLAN") return "REQUIRE_DETAILED_PLAN";
  if (value === "REQUIRE_MULTI_WORKFLOW_DECOMPOSITION") {
    return "REQUIRE_MULTI_WORKFLOW_DECOMPOSITION";
  }
  if (value === "ENFORCE_SPECIALIST_TOOL_ASSIGNMENT") {
    return "ENFORCE_SPECIALIST_TOOL_ASSIGNMENT";
  }
  return null;
}

function toPriority(value: unknown, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.min(999, Math.floor(value)));
}

function normalizeRules(value: unknown) {
  if (!Array.isArray(value)) {
    return defaultOrchestrationPipelineRules();
  }

  const normalized: OrchestrationPipelineRule[] = [];
  const usedIds = new Set<string>();
  const fallbackRules = defaultOrchestrationPipelineRules();

  for (let index = 0; index < value.length && normalized.length < 64; index += 1) {
    const row = asRecord(value[index]);
    const type = normalizeRuleType(row.type);
    if (!type) {
      continue;
    }

    const incomingId = typeof row.id === "string" ? row.id.trim() : "";
    const id = incomingId || `rule-${type.toLowerCase()}-${index + 1}`;
    if (!id || usedIds.has(id)) {
      continue;
    }

    const fallback = fallbackRules.find((item) => item.type === type);
    const nameRaw = typeof row.name === "string" ? row.name.trim() : "";
    normalized.push({
      id,
      name: nameRaw || fallback?.name || type,
      type,
      enabled: typeof row.enabled === "boolean" ? row.enabled : fallback?.enabled ?? true,
      priority: toPriority(row.priority, fallback?.priority ?? (index + 1) * 10)
    });
    usedIds.add(id);
  }

  if (normalized.length === 0) {
    return defaultOrchestrationPipelineRules();
  }

  for (const fallback of fallbackRules) {
    if (normalized.some((item) => item.type === fallback.type)) {
      continue;
    }
    normalized.push({
      ...fallback,
      id: `${fallback.id}-${randomUUID().slice(0, 6)}`
    });
  }

  return normalized
    .sort((left, right) => left.priority - right.priority)
    .map((rule, index) => ({
      ...rule,
      priority: toPriority(rule.priority, (index + 1) * 10)
    }));
}

function parseStored(value: unknown): StoredOrchestrationPipelineSettings {
  const record = asRecord(value);
  return {
    mode: normalizeMode(record.mode),
    rules: normalizeRules(record.rules),
    updatedAt:
      typeof record.updatedAt === "string" && record.updatedAt.trim().length > 0
        ? record.updatedAt
        : ""
  };
}

function toPublicSettings(value: StoredOrchestrationPipelineSettings): OrchestrationPipelineSettings {
  return {
    mode: value.mode,
    rules: value.rules,
    updatedAt: value.updatedAt || null
  };
}

async function readSettingsEntry(orgId: string, client?: MemoryEntryClient) {
  const db = client ?? prisma;
  return db.memoryEntry.findFirst({
    where: {
      orgId,
      tier: MemoryTier.ORG,
      key: SETTINGS_KEY,
      redactedAt: null
    },
    orderBy: {
      updatedAt: "desc"
    }
  });
}

export function resolveOrchestrationPipelineEffectivePolicy(
  settings: OrchestrationPipelineSettings,
  strictFeatureEnabled = featureFlags.strictOrchestrationPipeline
): OrchestrationPipelineEffectivePolicy {
  return resolveSharedOrchestrationPipelineEffectivePolicy(settings, strictFeatureEnabled);
}

export async function getOrgOrchestrationPipelineSettings(
  orgId: string,
  client?: MemoryEntryClient
): Promise<OrchestrationPipelineSettings> {
  const entry = await readSettingsEntry(orgId, client);
  const parsed = parseStored(entry?.value);
  return toPublicSettings(parsed);
}

export async function upsertOrgOrchestrationPipelineSettings(
  input: {
    orgId: string;
    mode: OrchestrationPipelineMode;
    rules: OrchestrationPipelineRule[];
  },
  client?: MemoryEntryClient
) {
  const db = client ?? prisma;
  const existing = await readSettingsEntry(input.orgId, client);
  const serialized: StoredOrchestrationPipelineSettings = {
    mode: normalizeMode(input.mode),
    rules: normalizeRules(input.rules),
    updatedAt: new Date().toISOString()
  };

  if (existing) {
    const updated = await db.memoryEntry.update({
      where: { id: existing.id },
      data: {
        value: serialized as unknown as Prisma.InputJsonValue
      }
    });
    return {
      entry: updated,
      settings: toPublicSettings(serialized)
    };
  }

  const created = await db.memoryEntry.create({
    data: {
      orgId: input.orgId,
      tier: MemoryTier.ORG,
      key: SETTINGS_KEY,
      value: serialized as unknown as Prisma.InputJsonValue
    }
  });

  return {
    entry: created,
    settings: toPublicSettings(serialized)
  };
}
