import "server-only";

import { MemoryTier, type Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";

const ORG_CREDITS_KEY = "org.billing.credits";

export interface OrgCreditsWallet {
  balanceCredits: number;
  lowBalanceThreshold: number;
  autoRechargeEnabled: boolean;
  updatedAt: string | null;
}

interface SerializedOrgCreditsWallet {
  balanceCredits: number;
  lowBalanceThreshold: number;
  autoRechargeEnabled: boolean;
  updatedAt: string;
}

interface OrgCreditsUpdateInput {
  orgId: string;
  rechargeCredits?: number;
  lowBalanceThreshold?: number;
  autoRechargeEnabled?: boolean;
}

type MemoryEntryClient = Pick<Prisma.TransactionClient, "memoryEntry"> | typeof prisma;

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeNumber(value: unknown, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Number(value.toFixed(4));
}

function parseSerialized(value: unknown): SerializedOrgCreditsWallet {
  const record = asRecord(value);

  return {
    balanceCredits: Math.max(0, normalizeNumber(record.balanceCredits, 0)),
    lowBalanceThreshold: Math.max(0, normalizeNumber(record.lowBalanceThreshold, 1000)),
    autoRechargeEnabled: Boolean(record.autoRechargeEnabled),
    updatedAt:
      typeof record.updatedAt === "string" && record.updatedAt.trim().length > 0
        ? record.updatedAt
        : new Date(0).toISOString()
  };
}

function toPublicWallet(value: SerializedOrgCreditsWallet): OrgCreditsWallet {
  return {
    balanceCredits: value.balanceCredits,
    lowBalanceThreshold: value.lowBalanceThreshold,
    autoRechargeEnabled: value.autoRechargeEnabled,
    updatedAt: value.updatedAt || null
  };
}

async function readCreditsEntry(orgId: string, client?: MemoryEntryClient) {
  const db = client ?? prisma;
  return db.memoryEntry.findFirst({
    where: {
      orgId,
      tier: MemoryTier.ORG,
      key: ORG_CREDITS_KEY,
      redactedAt: null
    },
    orderBy: {
      updatedAt: "desc"
    }
  });
}

export async function getOrgCreditsWallet(
  orgId: string,
  client?: MemoryEntryClient
): Promise<OrgCreditsWallet> {
  const entry = await readCreditsEntry(orgId, client);
  const parsed = parseSerialized(entry?.value);
  return toPublicWallet(parsed);
}

export async function upsertOrgCreditsWallet(
  input: OrgCreditsUpdateInput,
  client?: MemoryEntryClient
): Promise<OrgCreditsWallet> {
  const db = client ?? prisma;
  const existing = await readCreditsEntry(input.orgId, client);
  const previous = parseSerialized(existing?.value);

  const rechargeCredits =
    typeof input.rechargeCredits === "number" && Number.isFinite(input.rechargeCredits)
      ? Math.max(0, input.rechargeCredits)
      : 0;

  const next: SerializedOrgCreditsWallet = {
    balanceCredits: Math.max(0, Number((previous.balanceCredits + rechargeCredits).toFixed(4))),
    lowBalanceThreshold:
      typeof input.lowBalanceThreshold === "number" && Number.isFinite(input.lowBalanceThreshold)
        ? Math.max(0, Number(input.lowBalanceThreshold.toFixed(4)))
        : previous.lowBalanceThreshold,
    autoRechargeEnabled:
      typeof input.autoRechargeEnabled === "boolean"
        ? input.autoRechargeEnabled
        : previous.autoRechargeEnabled,
    updatedAt: new Date().toISOString()
  };

  if (existing) {
    await db.memoryEntry.update({
      where: { id: existing.id },
      data: {
        value: next as unknown as Prisma.InputJsonValue
      }
    });
  } else {
    await db.memoryEntry.create({
      data: {
        orgId: input.orgId,
        tier: MemoryTier.ORG,
        key: ORG_CREDITS_KEY,
        value: next as unknown as Prisma.InputJsonValue
      }
    });
  }

  return toPublicWallet(next);
}
