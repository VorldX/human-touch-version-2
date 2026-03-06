import "server-only";

import type { OrgExecutionMode } from "@prisma/client";

import type { AgentContextBlock } from "@/lib/ai/swarm-runtime";
import { prisma } from "@/lib/db/prisma";
import {
  getDirection,
  listDirectionFlowLinksByFlow
} from "@/lib/direction/directions";
import { ensureCompanyDataFile } from "@/lib/hub/organization-hub";
import { listPlans } from "@/lib/plans/plans";

import type {
  AgentBudgetSnapshot,
  AgentContextPack
} from "@/lib/agent/orchestration/types";
import {
  retrieveRelevantDnaFiles,
  retrieveRelevantMemoryEntries
} from "@/lib/agent/orchestration/rag-retriever";

function compact(input: string) {
  return input.replace(/\s+/g, " ").trim();
}

function determineLimits(mode: OrgExecutionMode) {
  if (mode === "ECO") {
    return {
      memoryLimit: 4,
      dnaLimit: 2,
      priorRunLimit: 2
    };
  }
  if (mode === "TURBO") {
    return {
      memoryLimit: 10,
      dnaLimit: 5,
      priorRunLimit: 6
    };
  }
  return {
    memoryLimit: 7,
    dnaLimit: 3,
    priorRunLimit: 4
  };
}

export async function buildAgentContextPack(input: {
  orgId: string;
  flowId: string;
  taskId: string;
  prompt: string;
  mode: OrgExecutionMode;
  agentId?: string | null;
  parentRunId?: string | null;
  requiredToolkits: string[];
  budgetSnapshot: AgentBudgetSnapshot;
}): Promise<AgentContextPack> {
  const limits = determineLimits(input.mode);
  const [org, flow, task, companyData] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: input.orgId },
      select: {
        id: true,
        name: true,
        description: true,
        executionMode: true,
        monthlyBudget: true,
        currentSpend: true
      }
    }),
    prisma.flow.findUnique({
      where: { id: input.flowId },
      select: {
        id: true,
        prompt: true,
        status: true,
        progress: true
      }
    }),
    prisma.task.findUnique({
      where: { id: input.taskId },
      select: {
        id: true,
        prompt: true,
        requiredFiles: true,
        status: true
      }
    }),
    ensureCompanyDataFile(input.orgId).catch(() => null)
  ]);

  const directionLinks = await listDirectionFlowLinksByFlow(input.orgId, input.flowId);
  const direction = directionLinks[0]?.directionId
    ? await getDirection(input.orgId, directionLinks[0].directionId)
    : null;
  const plans = await listPlans(input.orgId);
  const planForDirection =
    direction?.id
      ? plans.find((plan) => plan.directionId === direction.id) ?? null
      : null;

  const [memoryEntries, dnaFiles, priorRuns, parentRun] = await Promise.all([
    retrieveRelevantMemoryEntries({
      orgId: input.orgId,
      prompt: input.prompt,
      flowId: input.flowId,
      taskId: input.taskId,
      agentId: input.agentId ?? null,
      limit: limits.memoryLimit
    }),
    retrieveRelevantDnaFiles({
      orgId: input.orgId,
      prompt: input.prompt,
      limit: limits.dnaLimit
    }),
    prisma.agentRun.findMany({
      where: {
        orgId: input.orgId,
        flowId: input.flowId
      },
      orderBy: { startedAt: "desc" },
      take: limits.priorRunLimit,
      select: {
        id: true,
        decisionType: true,
        decisionReason: true,
        status: true,
        startedAt: true,
        completedAt: true
      }
    }),
    input.parentRunId
      ? prisma.agentRun.findUnique({
          where: { id: input.parentRunId },
          select: {
            id: true,
            contextPack: true,
            decisionType: true,
            decisionReason: true
          }
        })
      : Promise.resolve(null)
  ]);

  const blocks: AgentContextBlock[] = [];

  if (org) {
    blocks.push({
      id: `org:${org.id}`,
      name: "Organization Profile",
      amnesiaProtected: false,
      content: compact(
        JSON.stringify(
          {
            name: org.name,
            description: org.description ?? "",
            executionMode: org.executionMode,
            monthlyBudgetUsd: Number(org.monthlyBudget),
            currentSpendUsd: Number(org.currentSpend)
          },
          null,
          2
        )
      )
    });
  }

  if (companyData?.content) {
    blocks.push({
      id: `hub:company-data:${companyData.file.id}`,
      name: "Hub Company Data",
      amnesiaProtected: false,
      content: companyData.content.slice(0, input.mode === "TURBO" ? 3200 : 1800)
    });
  }

  if (direction) {
    blocks.push({
      id: `direction:${direction.id}`,
      name: "Direction",
      amnesiaProtected: false,
      content: compact(
        JSON.stringify(
          {
            title: direction.title,
            summary: direction.summary,
            direction: direction.direction,
            status: direction.status,
            tags: direction.tags
          },
          null,
          2
        )
      )
    });
  }

  if (planForDirection) {
    blocks.push({
      id: `plan:${planForDirection.id}`,
      name: "Execution Plan",
      amnesiaProtected: false,
      content: compact(
        JSON.stringify(
          {
            summary: planForDirection.summary,
            humanPlan: planForDirection.humanPlan,
            primaryPlan: planForDirection.primaryPlan,
            fallbackPlan: planForDirection.fallbackPlan
          },
          null,
          2
        )
      )
    });
  }

  if (flow) {
    blocks.push({
      id: `flow:${flow.id}`,
      name: "Mission State",
      amnesiaProtected: false,
      content: compact(
        JSON.stringify(
          {
            prompt: flow.prompt,
            status: flow.status,
            progress: flow.progress
          },
          null,
          2
        )
      )
    });
  }

  if (task) {
    blocks.push({
      id: `task:${task.id}`,
      name: "Current Task",
      amnesiaProtected: false,
      content: compact(
        JSON.stringify(
          {
            prompt: task.prompt,
            status: task.status,
            requiredFiles: task.requiredFiles
          },
          null,
          2
        )
      )
    });
  }

  if (input.requiredToolkits.length > 0) {
    blocks.push({
      id: `tools:${input.taskId}`,
      name: "Tool Requirements",
      amnesiaProtected: false,
      content: `Required toolkits: ${input.requiredToolkits.join(", ")}`
    });
  }

  if (parentRun?.contextPack) {
    blocks.push({
      id: `inherit:${parentRun.id}`,
      name: "Inherited Parent Context",
      amnesiaProtected: false,
      content: compact(JSON.stringify(parentRun.contextPack).slice(0, 2200))
    });
  }

  if (memoryEntries.length > 0) {
    blocks.push({
      id: `memory:${input.taskId}`,
      name: "Relevant Memory",
      amnesiaProtected: false,
      content: compact(
        JSON.stringify(
          memoryEntries.map((entry) => ({
            id: entry.id,
            key: entry.key,
            tier: entry.tier,
            value: entry.value
          })),
          null,
          2
        ).slice(0, input.mode === "TURBO" ? 4200 : 2600)
      )
    });
  }

  for (const dna of dnaFiles) {
    blocks.push({
      id: `dna:${dna.id}`,
      name: `DNA ${dna.name}`,
      amnesiaProtected: dna.amnesiaProtected,
      content: dna.preview
    });
  }

  if (priorRuns.length > 0) {
    blocks.push({
      id: `runs:${input.flowId}`,
      name: "Prior Execution Signals",
      amnesiaProtected: false,
      content: compact(
        JSON.stringify(
          priorRuns.map((run) => ({
            id: run.id,
            status: run.status,
            decisionType: run.decisionType,
            decisionReason: run.decisionReason,
            startedAt: run.startedAt,
            completedAt: run.completedAt
          })),
          null,
          2
        ).slice(0, 1800)
      )
    });
  }

  const summary = compact(
    [
      org ? `${org.name} (${org.executionMode})` : "Organization context",
      direction ? `Direction: ${direction.title}` : "No linked direction",
      planForDirection ? `Plan: ${planForDirection.title}` : "No linked plan",
      `Task: ${input.taskId}`,
      `Mode: ${input.mode}`,
      `Budget remaining: ${input.budgetSnapshot.remainingBudgetUsd.toFixed(2)} USD`
    ].join(" | ")
  );

  return {
    summary,
    blocks,
    memoryHighlights: memoryEntries.map((entry) => ({
      id: entry.id,
      key: entry.key,
      tier: entry.tier,
      score: entry.score
    })),
    dnaHighlights: dnaFiles.map((dna) => ({
      id: dna.id,
      name: dna.name,
      score: dna.score,
      amnesiaProtected: dna.amnesiaProtected
    })),
    executionMode: input.mode,
    budgetSnapshot: input.budgetSnapshot
  };
}
