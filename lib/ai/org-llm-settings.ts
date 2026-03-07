import "server-only";

import type { Prisma } from "@prisma/client";
import { MemoryTier } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { decryptBrainKey, encryptBrainKey, type EncryptedSecret } from "@/lib/security/crypto";

export type OrgLlmMode = "BYOK" | "PLATFORM_MANAGED";
export type OrgServicePlan = "STARTER" | "GROWTH" | "ENTERPRISE";

const SETTINGS_KEY = "org.settings.llm";

interface SerializedOrgLlmSettings {
  mode: OrgLlmMode;
  provider: string;
  model: string;
  fallbackProvider: string;
  fallbackModel: string;
  servicePlan: OrgServicePlan;
  serviceMarkupPct: number;
  organizationApiKeyEncrypted?: EncryptedSecret;
  organizationApiKeysEncrypted?: Record<string, EncryptedSecret>;
  updatedAt: string;
}

export interface OrgLlmSettings {
  mode: OrgLlmMode;
  provider: string;
  model: string;
  fallbackProvider: string;
  fallbackModel: string;
  servicePlan: OrgServicePlan;
  serviceMarkupPct: number;
  hasOrganizationApiKey: boolean;
  configuredApiKeyProviders: string[];
  updatedAt: string | null;
}

export interface OrgLlmRuntimeSettings extends OrgLlmSettings {
  organizationApiKey: string | null;
  organizationApiKeys: Record<string, string>;
}

interface OrgLlmUpdateInput {
  orgId: string;
  mode: OrgLlmMode;
  provider: string;
  model: string;
  fallbackProvider: string;
  fallbackModel: string;
  servicePlan: OrgServicePlan;
  serviceMarkupPct: number;
  organizationApiKey?: string;
  providerApiKeys?: Record<string, string>;
}

type MemoryEntryClient = Pick<Prisma.TransactionClient, "memoryEntry"> | typeof prisma;

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeMode(value: unknown): OrgLlmMode {
  return value === "PLATFORM_MANAGED" ? "PLATFORM_MANAGED" : "BYOK";
}

function normalizePlan(value: unknown): OrgServicePlan {
  if (value === "GROWTH") return "GROWTH";
  if (value === "ENTERPRISE") return "ENTERPRISE";
  return "STARTER";
}

function normalizeProvider(value: unknown, fallback: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : fallback;
}

function normalizeModel(value: unknown, fallback: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : fallback;
}

function normalizeMarkup(value: unknown, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(200, Math.max(0, Number(value.toFixed(3))));
}

function normalizeProviderKey(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "";
  if (normalized.includes("anthropic") || normalized.includes("claude")) return "anthropic";
  if (normalized.includes("gemini") || normalized.includes("google") || normalized.includes("vertex")) {
    return "gemini";
  }
  if (normalized.includes("openai") || normalized.includes("gpt")) return "openai";
  return normalized.replace(/[^a-z0-9_-]/g, "");
}

function parseEncryptedSecret(value: unknown): EncryptedSecret | null {
  const record = asRecord(value);
  const cipherText = typeof record.cipherText === "string" ? record.cipherText : null;
  const iv = typeof record.iv === "string" ? record.iv : null;
  const authTag = typeof record.authTag === "string" ? record.authTag : null;
  const keyVersion =
    typeof record.keyVersion === "number" && Number.isFinite(record.keyVersion)
      ? Math.floor(record.keyVersion)
      : null;

  if (!cipherText || !iv || !authTag || !keyVersion) {
    return null;
  }

  return { cipherText, iv, authTag, keyVersion };
}

function parseEncryptedSecretMap(value: unknown) {
  const record = asRecord(value);
  const output: Record<string, EncryptedSecret> = {};

  for (const [rawProvider, rawPayload] of Object.entries(record)) {
    const provider = normalizeProviderKey(rawProvider);
    if (!provider) {
      continue;
    }
    const parsed = parseEncryptedSecret(rawPayload);
    if (parsed) {
      output[provider] = parsed;
    }
  }

  return output;
}

export function defaultServiceMarkupForPlan(plan: OrgServicePlan) {
  if (plan === "ENTERPRISE") return 12;
  if (plan === "GROWTH") return 18;
  return 25;
}

function parseSerialized(value: unknown): SerializedOrgLlmSettings {
  const record = asRecord(value);
  const mode = normalizeMode(record.mode);
  const servicePlan = normalizePlan(record.servicePlan);

  return {
    mode,
    provider: normalizeProvider(record.provider, "OpenAI"),
    model: normalizeModel(record.model, "gpt-4o-mini"),
    fallbackProvider: normalizeProvider(record.fallbackProvider, "Gemini"),
    fallbackModel: normalizeModel(record.fallbackModel, "gemini-2.5-flash"),
    servicePlan,
    serviceMarkupPct: normalizeMarkup(
      record.serviceMarkupPct,
      defaultServiceMarkupForPlan(servicePlan)
    ),
    organizationApiKeyEncrypted: parseEncryptedSecret(record.organizationApiKeyEncrypted) ?? undefined,
    organizationApiKeysEncrypted: parseEncryptedSecretMap(record.organizationApiKeysEncrypted),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date(0).toISOString()
  };
}

function toPublicSettings(serialized: SerializedOrgLlmSettings): OrgLlmSettings {
  const configuredProviders = new Set<string>();
  const legacyProvider = normalizeProviderKey(serialized.provider);
  if (serialized.organizationApiKeyEncrypted && legacyProvider) {
    configuredProviders.add(legacyProvider);
  }
  for (const provider of Object.keys(serialized.organizationApiKeysEncrypted ?? {})) {
    configuredProviders.add(provider);
  }

  return {
    mode: serialized.mode,
    provider: serialized.provider,
    model: serialized.model,
    fallbackProvider: serialized.fallbackProvider,
    fallbackModel: serialized.fallbackModel,
    servicePlan: serialized.servicePlan,
    serviceMarkupPct: serialized.serviceMarkupPct,
    hasOrganizationApiKey: configuredProviders.size > 0,
    configuredApiKeyProviders: [...configuredProviders].sort(),
    updatedAt: serialized.updatedAt || null
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

export async function getOrgLlmSettings(orgId: string, client?: MemoryEntryClient): Promise<OrgLlmSettings> {
  const entry = await readSettingsEntry(orgId, client);
  const parsed = parseSerialized(entry?.value);
  return toPublicSettings(parsed);
}

export async function getOrgLlmRuntime(orgId: string): Promise<OrgLlmRuntimeSettings> {
  const entry = await readSettingsEntry(orgId);
  const parsed = parseSerialized(entry?.value);
  const organizationApiKeys: Record<string, string> = {};

  let organizationApiKey: string | null = null;
  if (parsed.organizationApiKeyEncrypted) {
    try {
      organizationApiKey = decryptBrainKey(parsed.organizationApiKeyEncrypted);
    } catch {
      organizationApiKey = null;
    }
  }

  for (const [provider, encrypted] of Object.entries(parsed.organizationApiKeysEncrypted ?? {})) {
    try {
      organizationApiKeys[provider] = decryptBrainKey(encrypted);
    } catch {
      // Ignore invalid encrypted provider key entries.
    }
  }

  const primaryProvider = normalizeProviderKey(parsed.provider);
  if (!organizationApiKey && primaryProvider && organizationApiKeys[primaryProvider]) {
    organizationApiKey = organizationApiKeys[primaryProvider];
  }
  if (!organizationApiKey) {
    organizationApiKey = Object.values(organizationApiKeys)[0] ?? null;
  }

  return {
    ...toPublicSettings(parsed),
    organizationApiKey,
    organizationApiKeys
  };
}

export async function upsertOrgLlmSettings(
  input: OrgLlmUpdateInput,
  client?: MemoryEntryClient
) {
  const db = client ?? prisma;
  const existing = await readSettingsEntry(input.orgId, client);
  const previous = parseSerialized(existing?.value);

  const normalizedMode = normalizeMode(input.mode);
  const normalizedPlan = normalizePlan(input.servicePlan);
  const organizationApiKey = input.organizationApiKey?.trim();
  const previousProviderKeys = { ...(previous.organizationApiKeysEncrypted ?? {}) };

  const nextEncrypted =
    organizationApiKey !== undefined
      ? organizationApiKey.length > 0
        ? encryptBrainKey(organizationApiKey)
        : undefined
      : previous.organizationApiKeyEncrypted;

  if (input.providerApiKeys && typeof input.providerApiKeys === "object") {
    for (const [rawProvider, rawApiKey] of Object.entries(input.providerApiKeys)) {
      const provider = normalizeProviderKey(rawProvider);
      if (!provider) {
        continue;
      }

      const value = typeof rawApiKey === "string" ? rawApiKey.trim() : "";
      if (value.length === 0) {
        delete previousProviderKeys[provider];
        continue;
      }

      previousProviderKeys[provider] = encryptBrainKey(value);
    }
  }

  const nextProviderKeys =
    Object.keys(previousProviderKeys).length > 0 ? previousProviderKeys : undefined;

  const serialized: SerializedOrgLlmSettings = {
    mode: normalizedMode,
    provider: normalizeProvider(input.provider, "OpenAI"),
    model: normalizeModel(input.model, "gpt-4o-mini"),
    fallbackProvider: normalizeProvider(input.fallbackProvider, "Gemini"),
    fallbackModel: normalizeModel(input.fallbackModel, "gemini-2.5-flash"),
    servicePlan: normalizedPlan,
    serviceMarkupPct: normalizeMarkup(
      input.serviceMarkupPct,
      defaultServiceMarkupForPlan(normalizedPlan)
    ),
    ...(nextEncrypted ? { organizationApiKeyEncrypted: nextEncrypted } : {}),
    ...(nextProviderKeys ? { organizationApiKeysEncrypted: nextProviderKeys } : {}),
    updatedAt: new Date().toISOString()
  };

  if (existing) {
    const updated = await db.memoryEntry.update({
      where: { id: existing.id },
      data: {
        value: serialized as unknown as Prisma.InputJsonValue
      }
    });
    return { entry: updated, settings: toPublicSettings(serialized) };
  }

  const created = await db.memoryEntry.create({
    data: {
      orgId: input.orgId,
      tier: MemoryTier.ORG,
      key: SETTINGS_KEY,
      value: serialized as unknown as Prisma.InputJsonValue
    }
  });

  return { entry: created, settings: toPublicSettings(serialized) };
}
