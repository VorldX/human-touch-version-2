import "server-only";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";

import type { AgentBudgetSnapshot, AgentExecutionMode } from "@/lib/agent/orchestration/types";

function asNumber(value: Prisma.Decimal | number | string | null | undefined) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getAgentBudgetSnapshot(input: {
  orgId: string;
  flowId?: string | null;
}): Promise<AgentBudgetSnapshot> {
  const org = await prisma.organization.findUnique({
    where: { id: input.orgId },
    select: {
      monthlyBudget: true,
      currentSpend: true,
      monthlyBtuCap: true,
      currentBtuBurn: true
    }
  });

  if (!org) {
    return {
      monthlyBudgetUsd: 0,
      currentSpendUsd: 0,
      remainingBudgetUsd: 0,
      monthlyBtuCap: 0,
      currentBtuBurn: 0,
      remainingBtu: 0,
      flowPredictedBurn: 0
    };
  }

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const spendAggregate = await prisma.spendEvent.aggregate({
    where: {
      orgId: input.orgId,
      timestamp: { gte: monthStart }
    },
    _sum: {
      amount: true
    }
  });

  const flow =
    input.flowId && input.flowId.trim().length > 0
      ? await prisma.flow.findUnique({
          where: { id: input.flowId },
          select: { predictedBurn: true }
        })
      : null;

  const monthlyBudgetUsd = Math.max(0, asNumber(org.monthlyBudget));
  const knownCurrentSpendUsd = Math.max(0, asNumber(org.currentSpend));
  const observedSpendUsd = Math.max(0, asNumber(spendAggregate._sum.amount));
  const currentSpendUsd = Math.max(knownCurrentSpendUsd, observedSpendUsd);
  const remainingBudgetUsd = Math.max(0, monthlyBudgetUsd - currentSpendUsd);

  const monthlyBtuCap = Math.max(0, org.monthlyBtuCap || 0);
  const currentBtuBurn = Math.max(0, org.currentBtuBurn || 0);
  const remainingBtu = Math.max(0, monthlyBtuCap - currentBtuBurn);

  return {
    monthlyBudgetUsd,
    currentSpendUsd,
    remainingBudgetUsd,
    monthlyBtuCap,
    currentBtuBurn,
    remainingBtu,
    flowPredictedBurn: flow?.predictedBurn ?? 0
  };
}

function modeMultiplier(mode: AgentExecutionMode) {
  if (mode === "ECO") return 0.8;
  if (mode === "TURBO") return 1.2;
  return 1;
}

export function estimateTaskExecutionCostUsd(input: {
  prompt: string;
  contextCharCount: number;
  requiredToolkits: string[];
  complexityScore: number;
  mode: AgentExecutionMode;
}) {
  const promptChars = Math.max(0, input.prompt.trim().length);
  const contextChars = Math.max(0, input.contextCharCount);
  const toolkitCount = Math.max(0, input.requiredToolkits.length);
  const complexity = Math.min(1, Math.max(0, input.complexityScore));

  const base =
    0.018 +
    (promptChars / 3800) * 0.024 +
    (contextChars / 7000) * 0.028 +
    toolkitCount * 0.012 +
    complexity * 0.03;

  return Number((base * modeMultiplier(input.mode)).toFixed(4));
}

export function estimateDelegationOverheadUsd(mode: AgentExecutionMode) {
  if (mode === "ECO") return 0.012;
  if (mode === "TURBO") return 0.03;
  return 0.02;
}

export function canAfford(input: {
  budget: AgentBudgetSnapshot;
  estimatedCostUsd: number;
}) {
  return input.budget.remainingBudgetUsd >= Math.max(0, input.estimatedCostUsd);
}
