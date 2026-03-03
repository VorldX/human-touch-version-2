import "server-only";

import { PolicyDecision, Prisma, SpendEventType } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { featureFlags } from "@/lib/config/feature-flags";

type PrismaLike = Pick<Prisma.TransactionClient, "policyLog" | "spendEvent">;

function resolveClient(client?: PrismaLike) {
  return client ?? prisma;
}

export interface PassivePolicyInput {
  orgId: string;
  subjectType: string;
  subjectId: string;
  decision?: PolicyDecision;
  riskScore?: number;
  reason?: string;
  meta?: Prisma.InputJsonValue;
}

export async function recordPassivePolicy(
  input: PassivePolicyInput,
  client?: PrismaLike
) {
  if (!featureFlags.policyEnginePassive) {
    return null;
  }

  const db = resolveClient(client);
  return db.policyLog.create({
    data: {
      orgId: input.orgId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      decision: input.decision ?? PolicyDecision.ALLOW,
      riskScore: input.riskScore ?? 0,
      reason: input.reason ?? null,
      meta: input.meta ?? Prisma.JsonNull
    }
  });
}

export interface PassiveSpendInput {
  orgId: string;
  amount: Prisma.Decimal | number | string;
  type: SpendEventType;
  flowId?: string;
  taskId?: string;
  meta?: Prisma.InputJsonValue;
}

export async function recordPassiveSpend(input: PassiveSpendInput, client?: PrismaLike) {
  if (!featureFlags.costGuardianPassive) {
    return null;
  }

  const db = resolveClient(client);
  return db.spendEvent.create({
    data: {
      orgId: input.orgId,
      flowId: input.flowId ?? null,
      taskId: input.taskId ?? null,
      amount: new Prisma.Decimal(input.amount),
      type: input.type,
      meta: input.meta ?? Prisma.JsonNull
    }
  });
}

export function detectRunawaySignal(
  predictedBurn: number,
  monthlyBtuCap: number
) {
  if (monthlyBtuCap <= 0) {
    return predictedBurn > 150000;
  }

  const ratio = predictedBurn / monthlyBtuCap;
  return ratio >= 0.9;
}

export function computeDynamicAgentPrice(input: {
  baseRate: number;
  autonomyScore: number;
  pricingModel?: string | null;
}) {
  const safeAutonomy = Math.min(1, Math.max(0, input.autonomyScore || 0));
  const autonomyModifier = 1.2 - safeAutonomy * 0.5;
  const modelModifier =
    input.pricingModel === "OUTCOME"
      ? 1.15
      : input.pricingModel === "SUBSCRIPTION"
        ? 0.92
        : 1;

  return Number((input.baseRate * autonomyModifier * modelModifier).toFixed(4));
}

