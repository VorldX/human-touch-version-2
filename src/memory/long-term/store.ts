import "server-only";

import {
  AgentMemoryType,
  AgentMemoryVisibility,
  MemoryTier,
  Prisma
} from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import type {
  OrchestratorReview,
  OrchestratorTaskResult,
  OrchestratorWorkflowPlan
} from "@/src/orchestrator/types";

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

export async function persistWorkflowPlanMemory(input: {
  orgId: string;
  workflowId: string;
  requestId: string;
  prompt: string;
  plan: OrchestratorWorkflowPlan;
}) {
  await prisma.memoryEntry.create({
    data: {
      orgId: input.orgId,
      tier: MemoryTier.WORKING,
      key: `orchestrator.plan.${input.workflowId}`,
      value: toJson({
        requestId: input.requestId,
        prompt: input.prompt,
        plan: input.plan
      }),
      ttlSeconds: 24 * 60 * 60,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
    }
  });
}

export async function persistWorkflowReviewMemory(input: {
  orgId: string;
  workflowId: string;
  requestId: string;
  prompt: string;
  review: OrchestratorReview;
  taskResults: OrchestratorTaskResult[];
}) {
  const summary = `${input.review.summary} Score=${input.review.score}; Completed=${input.review.completedTasks}/${input.review.totalTasks}.`;
  await prisma.$transaction([
    prisma.memoryEntry.create({
      data: {
        orgId: input.orgId,
        tier: MemoryTier.ORG,
        key: `orchestrator.review.${input.workflowId}`,
        value: toJson({
          requestId: input.requestId,
          prompt: input.prompt,
          review: input.review,
          taskResults: input.taskResults
        })
      }
    }),
    prisma.agentMemory.create({
      data: {
        orgId: input.orgId,
        content: summary,
        summary: input.review.summary.slice(0, 280),
        memoryType: AgentMemoryType.SEMANTIC,
        visibility: AgentMemoryVisibility.SHARED,
        source: "inngest_orchestrator_review",
        tags: ["orchestrator", "review", input.workflowId],
        contentHash: input.workflowId
      }
    })
  ]);
}

