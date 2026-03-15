export const dynamic = "force-dynamic";

import { randomUUID } from "node:crypto";

import {
  FlowStatus,
  LogType,
  PersonnelStatus,
  type Prisma,
  SpendEventType,
  TaskStatus
} from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { featureFlags } from "@/lib/config/feature-flags";
import { prisma } from "@/lib/db/prisma";
import {
  detectRunawaySignal,
  recordPassivePolicy,
  recordPassiveSpend
} from "@/lib/enterprise/passive";
import {
  getOrgOrchestrationPipelineSettings,
  resolveOrchestrationPipelineEffectivePolicy
} from "@/lib/agent/orchestration/pipeline-policy";
import {
  ensureMainAgentProfile,
  resolveOrgExecutionMode
} from "@/lib/agent/orchestration/runtime";
import { linkFlowToDirection, updateDirection } from "@/lib/direction/directions";
import {
  composioAllowlistedToolkits,
  inferRequestedToolkits
} from "@/lib/integrations/composio/service";
import { publishInngestEvent } from "@/lib/inngest/publish";
import { getPlan } from "@/lib/plans/plans";
import { publishRealtimeEvent } from "@/lib/realtime/publish";
import {
  listOrgPermissionRequests,
  type PermissionRequestRecord
} from "@/lib/requests/permission-requests";
import { emitOrchestrationEvent } from "@/lib/orchestration/event-log";
import { buildInternalApiHeaders } from "@/lib/security/internal-api";
import { requireOrgAccess } from "@/lib/security/org-access";

interface LaunchFlowRequest {
  orgId?: string;
  prompt?: string;
  directionId?: string;
  planId?: string;
  fallbackPlanId?: string;
  planWorkflows?: unknown;
  planPathway?: unknown;
  executionMode?: "ECO" | "BALANCED" | "TURBO";
  swarmDensity?: number;
  predictedBurn?: number;
  requiredSignatures?: number;
  approvalUserIds?: string[];
  requestedToolkits?: string[];
  permissionRequestIds?: string[];
}

interface LaunchPlanTaskInput {
  title: string;
  ownerRole?: string;
  dependsOn?: string[];
  subtasks: string[];
  tools: string[];
}

interface LaunchPlanWorkflowInput {
  title: string;
  goal: string;
  ownerRole?: string;
  tasks: LaunchPlanTaskInput[];
}

type LaunchPathwayExecutionMode = "HUMAN" | "AGENT" | "HYBRID";

interface LaunchPlanPathwayStepInput {
  stepId: string;
  line: number;
  workflowTitle: string;
  taskTitle: string;
  ownerRole: string;
  executionMode: LaunchPathwayExecutionMode;
  trigger: string;
  dueWindow: string;
  dependsOn: string[];
}

interface LaunchTaskPlanStep {
  prompt: string;
  isPlanningStep: boolean;
  workflowTitle?: string;
  taskTitle?: string;
  ownerRole?: string;
  executionMode?: LaunchPathwayExecutionMode;
  trigger?: string;
  dueWindow?: string;
  dependsOn: string[];
  toolkits: string[];
}

interface PlanPolicySummary {
  objective: string;
  organizationFitSummary: string;
  deliverableCount: number;
  milestoneCount: number;
  resourcePlanCount: number;
  approvalCheckpointCount: number;
  workflowCount: number;
  taskCount: number;
  workflowToolCoverageCount: number;
  detailScore: number;
}

const MIN_DETAILED_PLAN_DELIVERABLES = 2;
const MIN_DETAILED_PLAN_MILESTONES = 2;
const MIN_DETAILED_PLAN_WORKFLOWS = 2;
const MIN_DETAILED_PLAN_TASKS_PER_WORKFLOW = 2;

function asPositiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : null;
}

function compactText(input: string) {
  return input.replace(/\s+/g, " ").trim();
}

function parseRequestedToolkits(value: unknown) {
  const allowed = new Set(composioAllowlistedToolkits());
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  const parsed = value
    .map((item) => (typeof item === "string" ? item.trim().toLowerCase() : ""))
    .filter((item) => item.length > 0 && allowed.has(item));

  return [...new Set(parsed)];
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function normalizeTextList(value: unknown, limit: number) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }
  return value
    .map((item) => compactText(typeof item === "string" ? item : ""))
    .filter(Boolean)
    .slice(0, limit);
}

function parseStringList(value: unknown, limit: number) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  const normalized = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);

  return [...new Set(normalized)].slice(0, limit);
}

async function validateOrgMemberUserIds(input: {
  orgId: string;
  userIds: string[];
}) {
  const uniqueUserIds = [...new Set(input.userIds.map((id) => id.trim()).filter(Boolean))];
  if (uniqueUserIds.length === 0) {
    return {
      validUserIds: [] as string[],
      invalidUserIds: [] as string[]
    };
  }

  const members = await prisma.orgMember.findMany({
    where: {
      orgId: input.orgId,
      userId: {
        in: uniqueUserIds
      }
    },
    select: {
      userId: true
    }
  });

  const memberUserIds = new Set(members.map((member) => member.userId));
  const validUserIds = uniqueUserIds.filter((id) => memberUserIds.has(id));
  const invalidUserIds = uniqueUserIds.filter((id) => !memberUserIds.has(id));

  return {
    validUserIds,
    invalidUserIds
  };
}

function normalizeDirectionKey(value: string) {
  return compactText(value).toLowerCase();
}

function formatIdSnippet(ids: string[], limit = 3) {
  const head = ids.slice(0, limit);
  return head.join(", ");
}

function parsePlanWorkflows(value: unknown): LaunchPlanWorkflowInput[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      const workflow = asRecord(item);
      const title = compactText(typeof workflow.title === "string" ? workflow.title : "Workflow");
      const goal = compactText(typeof workflow.goal === "string" ? workflow.goal : "");
      const ownerRole = compactText(
        typeof workflow.ownerRole === "string" ? workflow.ownerRole : ""
      );
      const rawTasks = Array.isArray(workflow.tasks) ? workflow.tasks : [];
      const tasks = rawTasks
        .map((rawTask) => {
          const task = asRecord(rawTask);
          const taskTitle = compactText(typeof task.title === "string" ? task.title : "Task");
          const taskOwnerRole = compactText(
            typeof task.ownerRole === "string" ? task.ownerRole : ""
          );
          const dependsOn = normalizeTextList(task.dependsOn, 10);
          const subtasks = normalizeTextList(task.subtasks, 6);
          const tools = parseRequestedToolkits(task.tools);
          return {
            title: taskTitle,
            ownerRole: taskOwnerRole || undefined,
            dependsOn,
            subtasks,
            tools
          };
        })
        .filter((task) => task.title.length > 0)
        .slice(0, 16);

      return {
        title,
        goal,
        ownerRole: ownerRole || undefined,
        tasks
      };
    })
    .filter((workflow) => workflow.tasks.length > 0)
    .slice(0, 10);
}

function normalizePathwayExecutionMode(value: unknown): LaunchPathwayExecutionMode {
  const normalized =
    typeof value === "string" ? value.trim().toUpperCase() : "";
  if (normalized === "HUMAN") return "HUMAN";
  if (normalized === "AGENT") return "AGENT";
  return "HYBRID";
}

function parsePlanPathway(value: unknown): LaunchPlanPathwayStepInput[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index) => {
      const step = asRecord(item);
      const workflowTitle = compactText(
        typeof step.workflowTitle === "string" ? step.workflowTitle : ""
      );
      const taskTitle = compactText(
        typeof step.taskTitle === "string" ? step.taskTitle : ""
      );
      if (!workflowTitle || !taskTitle) {
        return null;
      }
      const ownerRole = compactText(
        typeof step.ownerRole === "string" ? step.ownerRole : "EMPLOYEE"
      );
      const parsedLine = Number(step.line);
      const line =
        Number.isFinite(parsedLine) && parsedLine > 0
          ? Math.floor(parsedLine)
          : index + 1;
      return {
        stepId:
          compactText(typeof step.stepId === "string" ? step.stepId : "") ||
          `pathway-step-${line}`,
        line,
        workflowTitle,
        taskTitle,
        ownerRole: ownerRole || "EMPLOYEE",
        executionMode: normalizePathwayExecutionMode(step.executionMode),
        trigger:
          compactText(typeof step.trigger === "string" ? step.trigger : "") ||
          (line === 1 ? "Immediate after plan approval" : "After previous step completion"),
        dueWindow:
          compactText(typeof step.dueWindow === "string" ? step.dueWindow : "") ||
          "Execution window",
        dependsOn: normalizeTextList(step.dependsOn, 10)
      } satisfies LaunchPlanPathwayStepInput;
    })
    .filter((item): item is LaunchPlanPathwayStepInput => Boolean(item))
    .sort((a, b) => a.line - b.line)
    .slice(0, 120);
}

function summarizePlanForPolicy(value: unknown): PlanPolicySummary {
  const record = asRecord(value);
  const workflows = Array.isArray(record.workflows) ? record.workflows : [];
  const objective = compactText(typeof record.objective === "string" ? record.objective : "");
  const organizationFitSummary = compactText(
    typeof record.organizationFitSummary === "string" ? record.organizationFitSummary : ""
  );
  const deliverableCount = Array.isArray(record.deliverables) ? record.deliverables.length : 0;
  const milestoneCount = Array.isArray(record.milestones) ? record.milestones.length : 0;
  const resourcePlanCount = Array.isArray(record.resourcePlan) ? record.resourcePlan.length : 0;
  const approvalCheckpointCount = Array.isArray(record.approvalCheckpoints)
    ? record.approvalCheckpoints.length
    : 0;
  const detailScore =
    typeof record.detailScore === "number" && Number.isFinite(record.detailScore)
      ? Math.max(0, Math.min(100, Math.floor(record.detailScore)))
      : 0;

  let taskCount = 0;
  let workflowToolCoverageCount = 0;
  for (const workflowRaw of workflows) {
    const workflow = asRecord(workflowRaw);
    const workflowTools = normalizeTextList(workflow.tools, 16);
    const tasks = Array.isArray(workflow.tasks) ? workflow.tasks : [];
    taskCount += tasks.length;
    const taskToolCount = tasks.reduce((sum, taskRaw) => {
      const task = asRecord(taskRaw);
      return sum + normalizeTextList(task.tools, 16).length;
    }, 0);
    if (workflowTools.length > 0 || taskToolCount > 0) {
      workflowToolCoverageCount += 1;
    }
  }

  return {
    objective,
    organizationFitSummary,
    deliverableCount,
    milestoneCount,
    resourcePlanCount,
    approvalCheckpointCount,
    workflowCount: workflows.length,
    taskCount,
    workflowToolCoverageCount,
    detailScore
  };
}

function splitDirectionIntoTasks(direction: string, swarmDensity: number) {
  const normalized = direction.replace(/\r\n/g, "\n").trim();
  const recipientEmailMatch = normalized.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const recipientEmail = recipientEmailMatch?.[0]?.trim() ?? "";
  const hasMeetingCreateIntent =
    /\b(set up|setup|schedule|book|arrange|create|plan)\b[\s\S]{0,80}\b(meeting|call|invite|invitation|session)\b/i.test(
      normalized
    ) ||
    /\b(meeting|call|invite|invitation|session)\b[\s\S]{0,80}\b(set up|setup|schedule|book|arrange|create|plan)\b/i.test(
      normalized
    );
  const hasMeetingShareIntent =
    /\b(send|share|mail|email)\b/i.test(normalized) &&
    /\b(details?|invite|invitation|link|meeting)\b/i.test(normalized);
  if (hasMeetingCreateIntent && hasMeetingShareIntent && recipientEmail) {
    return [
      "Set up the meeting first and capture the meeting link, code, and schedule details.",
      `Send meeting details to ${recipientEmail} with the generated meeting link and key context.`
    ];
  }

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const bulletLike = lines
    .map((line) => line.replace(/^[-*•]\s+/, "").replace(/^\d+[\).\-\s]+/, "").trim())
    .filter((line) => line.length > 0);

  const sentenceLike =
    bulletLike.length > 0
      ? bulletLike
      : normalized
          .split(/(?<=[.!?])\s+/)
          .map((line) => compactText(line))
          .filter((line) => line.length > 0);

  const taskBudget = Math.min(12, Math.max(2, Math.ceil(Math.max(1, swarmDensity) / 10)));
  const sliced = sentenceLike.slice(0, taskBudget);
  const unique = [...new Set(sliced.map((line) => compactText(line)))].filter(Boolean);

  if (unique.length === 0) {
    return [compactText(direction)];
  }

  if (unique.length === 1) {
    return [unique[0]];
  }

  return unique;
}

function formatToolkitMarker(toolkits: string[]) {
  return `toolkits: ${toolkits.length > 0 ? toolkits.join(",") : "none"}`;
}

function collectPlanWorkflowToolkits(workflows: LaunchPlanWorkflowInput[]) {
  const toolkits = new Set<string>();
  for (const workflow of workflows) {
    for (const task of workflow.tasks) {
      for (const toolkit of task.tools) {
        if (toolkit) {
          toolkits.add(toolkit);
        }
      }
    }
  }
  return [...toolkits];
}

function buildTaskPlan(
  prompt: string,
  swarmDensity: number,
  planWorkflows: LaunchPlanWorkflowInput[],
  pathway: LaunchPlanPathwayStepInput[]
): LaunchTaskPlanStep[] {
  if (planWorkflows.length > 0) {
    const mission = compactText(prompt);
    const workflowToolkits = collectPlanWorkflowToolkits(planWorkflows);
    const missionToolkits = [
      ...new Set([...inferRequestedToolkits(mission), ...workflowToolkits])
    ];
    const planStep: LaunchTaskPlanStep = {
      prompt: `Main Agent planning phase: execute approved direction workflows, dependencies, and tool constraints. Mission: ${mission} | ${formatToolkitMarker(missionToolkits)}`,
      isPlanningStep: true,
      dependsOn: [],
      toolkits: missionToolkits
    };

    const workflowByTitle = new Map(
      planWorkflows.map((workflow) => [workflow.title.trim().toLowerCase(), workflow] as const)
    );
    const fallbackPathway: LaunchPlanPathwayStepInput[] = planWorkflows.flatMap(
      (workflow, workflowIndex) =>
        workflow.tasks.map((task, taskIndex) => ({
          stepId: `wf-${workflowIndex + 1}-task-${taskIndex + 1}`,
          line: workflowIndex * 100 + taskIndex + 1,
          workflowTitle: workflow.title,
          taskTitle: task.title,
          ownerRole: task.ownerRole || workflow.ownerRole || "EMPLOYEE",
          executionMode: "HYBRID",
          trigger:
            workflowIndex === 0 && taskIndex === 0
              ? "Immediate after plan approval"
              : "After previous step completion",
          dueWindow: "Execution window",
          dependsOn: task.dependsOn ?? []
        }))
    );
    const pathwaySteps = pathway.length > 0 ? pathway : fallbackPathway;
    const executionSteps: LaunchTaskPlanStep[] = [];

    for (const pathwayStep of pathwaySteps) {
      const workflow = workflowByTitle.get(pathwayStep.workflowTitle.trim().toLowerCase());
      const matchingTask = workflow?.tasks.find(
        (task) => task.title.trim().toLowerCase() === pathwayStep.taskTitle.trim().toLowerCase()
      );
      const details = [
        pathwayStep.workflowTitle ? `Workflow: ${pathwayStep.workflowTitle}` : "",
        workflow?.goal ? `Goal: ${workflow.goal}` : "",
        `Task: ${pathwayStep.taskTitle}`,
        matchingTask?.subtasks && matchingTask.subtasks.length > 0
          ? `Subtasks: ${matchingTask.subtasks.join(" | ")}`
          : "",
        pathwayStep.trigger ? `Trigger: ${pathwayStep.trigger}` : "",
        pathwayStep.dueWindow ? `Window: ${pathwayStep.dueWindow}` : "",
        pathwayStep.ownerRole ? `Owner: ${pathwayStep.ownerRole}` : ""
      ]
        .filter(Boolean)
        .join(" | ");
      const toolkits =
        matchingTask?.tools && matchingTask.tools.length > 0
          ? matchingTask.tools
          : inferRequestedToolkits(
              `${pathwayStep.workflowTitle} ${pathwayStep.taskTitle} ${details}`
            );

      executionSteps.push({
        prompt: `${details} | ${formatToolkitMarker(toolkits)}`,
        isPlanningStep: false,
        workflowTitle: pathwayStep.workflowTitle,
        taskTitle: pathwayStep.taskTitle,
        ownerRole:
          pathwayStep.ownerRole ||
          matchingTask?.ownerRole ||
          workflow?.ownerRole ||
          undefined,
        executionMode: pathwayStep.executionMode,
        trigger: pathwayStep.trigger,
        dueWindow: pathwayStep.dueWindow,
        dependsOn:
          pathwayStep.dependsOn.length > 0
            ? pathwayStep.dependsOn
            : matchingTask?.dependsOn ?? [],
        toolkits
      });
    }

    const cappedSteps = executionSteps.slice(0, Math.min(24, Math.max(3, swarmDensity + 2)));
    return [planStep, ...cappedSteps];
  }

  const mission = compactText(prompt);
  const missionToolkits = inferRequestedToolkits(mission);
  const planStep: LaunchTaskPlanStep = {
    prompt: `Main Agent planning phase: break this mission into ordered subtasks, dependencies, and required toolkit access before execution. Mission: ${mission} | ${formatToolkitMarker(missionToolkits)}`,
    isPlanningStep: true,
    dependsOn: [],
    toolkits: missionToolkits
  };
  const executionSteps = splitDirectionIntoTasks(prompt, swarmDensity);

  return [
    planStep,
    ...executionSteps.map((step, index) => {
      const inferredStepToolkits = inferRequestedToolkits(step);
      const stepToolkits =
        inferredStepToolkits.length > 0 ? inferredStepToolkits : missionToolkits;
      return {
        prompt: `Execution step ${index + 1}: ${step} | ${formatToolkitMarker(stepToolkits)}`,
        isPlanningStep: false,
        dependsOn: [],
        toolkits: stepToolkits
      } satisfies LaunchTaskPlanStep;
    })
  ];
}

function scoreAgentRoleAffinity(
  agent: { role: string; name?: string | null; expertise?: string | null },
  ownerRole: string | undefined
) {
  if (!ownerRole || !ownerRole.trim()) return 0;
  const normalizedOwnerRole = ownerRole.toLowerCase();
  const agentText = `${agent.role} ${agent.name ?? ""} ${agent.expertise ?? ""}`.toLowerCase();
  if (agentText.includes(normalizedOwnerRole)) {
    return 3;
  }
  const ownerTokens = normalizedOwnerRole
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 3);
  return ownerTokens.reduce((score, token) => (agentText.includes(token) ? score + 1 : score), 0);
}

function pickAgentForStep(input: {
  step: LaunchTaskPlanStep;
  index: number;
  mainAgent: { id: string; role: string; name: string | null; expertise: string | null } | null;
  activeAgents: Array<{ id: string; role: string; name: string | null; expertise: string | null }>;
  assignmentPool: Array<{ id: string; role: string; name: string | null; expertise: string | null }>;
}) {
  const { step, index, mainAgent, activeAgents, assignmentPool } = input;

  if (step.isPlanningStep) {
    return mainAgent;
  }

  const roleHint = step.ownerRole?.trim().toLowerCase() ?? "";
  if (mainAgent && /\b(main|boss|orchestrator)\b/.test(roleHint)) {
    return mainAgent;
  }

  const roleCandidates = activeAgents
    .map((agent) => ({
      agent,
      score: scoreAgentRoleAffinity(agent, step.ownerRole)
    }))
    .sort((left, right) => right.score - left.score);
  if (roleCandidates[0] && roleCandidates[0].score > 0) {
    return roleCandidates[0].agent;
  }

  const specialtyHints = inferTaskSpecialtyHints(step.prompt);
  const specialistPool =
    mainAgent && index > 0
      ? activeAgents.filter((agent) => agent.id !== mainAgent.id)
      : activeAgents;
  const specialistCandidate =
    specialtyHints.length > 0
      ? specialistPool
          .map((agent) => ({
            agent,
            score: scoreAgentSpecialty(agent, specialtyHints)
          }))
          .sort((a, b) => b.score - a.score)[0]
      : null;
  if (specialistCandidate && specialistCandidate.score > 0) {
    return specialistCandidate.agent;
  }

  if (assignmentPool.length > 0) {
    return assignmentPool[index % assignmentPool.length];
  }
  return null;
}

function inferTaskSpecialtyHints(prompt: string) {
  const lower = prompt.toLowerCase();
  const hints = new Set<string>();

  if (/\b(marketing|campaign|content|growth|seo|social)\b/.test(lower)) hints.add("marketing");
  if (/\b(sales|prospect|crm|pipeline|outreach)\b/.test(lower)) hints.add("sales");
  if (/\b(support|helpdesk|ticket|customer)\b/.test(lower)) hints.add("support");
  if (/\b(email|gmail|inbox|mail)\b/.test(lower)) hints.add("email");
  if (/\b(meeting|calendar|schedule|zoom|google meet|gmeet)\b/.test(lower)) hints.add("calendar");
  if (/\b(engineering|developer|code|repo|github|deploy)\b/.test(lower)) hints.add("engineering");
  if (/\b(finance|invoice|billing|budget|expense)\b/.test(lower)) hints.add("finance");

  for (const toolkit of inferRequestedToolkits(prompt)) {
    hints.add(toolkit);
  }

  return [...hints];
}

function scoreAgentSpecialty(agent: { role: string; name?: string | null; expertise?: string | null }, hints: string[]) {
  if (hints.length === 0) return 0;
  const text = `${agent.role} ${agent.name ?? ""} ${agent.expertise ?? ""}`.toLowerCase();
  let score = 0;
  for (const hint of hints) {
    const mapped =
      hint === "googlemeet"
        ? ["googlemeet", "meet", "meeting"]
        : hint === "googlecalendar"
          ? ["googlecalendar", "calendar", "schedule"]
          : hint === "gmail"
            ? ["gmail", "email", "mail"]
            : [hint];
    if (mapped.some((item) => text.includes(item))) {
      score += 1;
    }
  }
  return score;
}

export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("orgId")?.trim();
  const limitInput = request.nextUrl.searchParams.get("limit");
  const parsedLimit = limitInput ? Number.parseInt(limitInput, 10) : 40;
  const limit =
    Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 40;

  if (!orgId) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId query param is required."
      },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  try {
    const flows = await prisma.flow.findMany({
      where: { orgId },
      orderBy: { updatedAt: "desc" },
      take: limit,
      include: {
        tasks: {
          select: {
            status: true,
            isPausedForInput: true
          }
        }
      }
    });

    const data = flows.map((flow) => {
      const counts = {
        queued: 0,
        running: 0,
        paused: 0,
        completed: 0,
        failed: 0,
        aborted: 0
      };

      for (const task of flow.tasks) {
        if (task.status === TaskStatus.QUEUED) counts.queued += 1;
        if (task.status === TaskStatus.RUNNING) counts.running += 1;
        if (task.status === TaskStatus.PAUSED) counts.paused += 1;
        if (task.status === TaskStatus.COMPLETED) counts.completed += 1;
        if (task.status === TaskStatus.FAILED) counts.failed += 1;
        if (task.status === TaskStatus.ABORTED) counts.aborted += 1;
      }

      return {
        id: flow.id,
        orgId: flow.orgId,
        prompt: flow.prompt,
        status: flow.status,
        progress: flow.progress,
        predictedBurn: flow.predictedBurn,
        requiredSignatures: flow.requiredSignatures,
        parentFlowId: flow.parentFlowId,
        createdAt: flow.createdAt,
        updatedAt: flow.updatedAt,
        humanTouchRequired: flow.tasks.some((task) => task.isPausedForInput),
        taskCounts: {
          ...counts,
          total: flow.tasks.length
        }
      };
    });

    return NextResponse.json({
      ok: true,
      flows: data
    });
  } catch (error) {
    console.error("[api/flows][GET] unexpected error", error);
    return NextResponse.json(
      {
        ok: false,
        message: "Failed to load flows."
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  let body: LaunchFlowRequest;
  try {
    body = (await request.json()) as LaunchFlowRequest;
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message: "Invalid JSON payload."
      },
      { status: 400 }
    );
  }

  const orgId = body.orgId?.trim();
  const prompt = body.prompt?.trim();
  const directionId = body.directionId?.trim();
  const planId = body.planId?.trim();
  const fallbackPlanId = body.fallbackPlanId?.trim();
  const swarmDensity = asPositiveInt(body.swarmDensity);
  const predictedBurn = asPositiveInt(body.predictedBurn);
  const requiredSignatures = asPositiveInt(body.requiredSignatures);
  const requestedApprovalUserIds = parseStringList(body.approvalUserIds, 32);
  const providedRequestedToolkits = parseRequestedToolkits(body.requestedToolkits);
  const providedPermissionRequestIds = parseStringList(body.permissionRequestIds, 64);
  const parsedPlanWorkflows = parsePlanWorkflows(body.planWorkflows);
  const parsedPlanPathway = parsePlanPathway(body.planPathway);

  if (!orgId || !prompt || !swarmDensity || !predictedBurn || !requiredSignatures) {
    return NextResponse.json(
      {
        ok: false,
        message: "Missing required mission launch fields."
      },
        { status: 400 }
      );
  }

  const access = await requireOrgAccess({ request, orgId, allowInternal: true });
  if (!access.ok) {
    return access.response;
  }

  try {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, monthlyBtuCap: true }
    });

    if (!org) {
      return NextResponse.json(
        {
          ok: false,
          message: "Organization not found."
        },
        { status: 404 }
      );
    }
    const pipelineSettings = await getOrgOrchestrationPipelineSettings(orgId);
    const pipelinePolicy = resolveOrchestrationPipelineEffectivePolicy(pipelineSettings);
    const launchPlanRecord = planId ? await getPlan(orgId, planId) : null;
    const launchPlanSummary = launchPlanRecord
      ? summarizePlanForPolicy(launchPlanRecord.primaryPlan)
      : null;

    if (pipelinePolicy.enforcePlanBeforeExecution && !planId) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Strict orchestration pipeline requires an approved plan before execution launch."
        },
        { status: 412 }
      );
    }

    if (pipelinePolicy.requireDetailedPlan && !planId) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Strict orchestration pipeline requires a detailed approved plan before execution launch."
        },
        { status: 412 }
      );
    }

    if (pipelinePolicy.enforcePlanBeforeExecution && planId && !launchPlanRecord) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Strict orchestration pipeline requires a valid approved plan record before launch."
        },
        { status: 412 }
      );
    }

    if (pipelinePolicy.requireDetailedPlan && planId && !launchPlanRecord) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Strict orchestration pipeline requires a valid detailed plan snapshot before launch."
        },
        { status: 412 }
      );
    }

    if (
      pipelinePolicy.enforcePlanBeforeExecution &&
      launchPlanRecord &&
      launchPlanRecord.status !== "ACTIVE"
    ) {
      return NextResponse.json(
        {
          ok: false,
          message: `Strict orchestration pipeline blocks launch because plan ${launchPlanRecord.id} is ${launchPlanRecord.status}.`
        },
        { status: 412 }
      );
    }

    if (pipelinePolicy.requireDetailedPlan && launchPlanSummary) {
      const minimumTaskCount =
        Math.max(
          MIN_DETAILED_PLAN_WORKFLOWS,
          launchPlanSummary.workflowCount
        ) * MIN_DETAILED_PLAN_TASKS_PER_WORKFLOW;
      const detailedPlanMissingReasons: string[] = [];
      if (!launchPlanSummary.objective) detailedPlanMissingReasons.push("objective");
      if (!launchPlanSummary.organizationFitSummary) {
        detailedPlanMissingReasons.push("organizationFitSummary");
      }
      if (launchPlanSummary.deliverableCount < MIN_DETAILED_PLAN_DELIVERABLES) {
        detailedPlanMissingReasons.push("deliverables");
      }
      if (launchPlanSummary.milestoneCount < MIN_DETAILED_PLAN_MILESTONES) {
        detailedPlanMissingReasons.push("milestones");
      }
      if (launchPlanSummary.resourcePlanCount < 1) detailedPlanMissingReasons.push("resourcePlan");
      if (launchPlanSummary.approvalCheckpointCount < 1) {
        detailedPlanMissingReasons.push("approvalCheckpoints");
      }
      if (launchPlanSummary.workflowCount < MIN_DETAILED_PLAN_WORKFLOWS) {
        detailedPlanMissingReasons.push("workflows");
      }
      if (launchPlanSummary.taskCount < minimumTaskCount) {
        detailedPlanMissingReasons.push("workflow task depth");
      }
      if (launchPlanSummary.workflowToolCoverageCount < 1) {
        detailedPlanMissingReasons.push("tool mapping");
      }
      if (launchPlanSummary.detailScore < 60) {
        detailedPlanMissingReasons.push("detailScore");
      }
      if (detailedPlanMissingReasons.length > 0) {
        return NextResponse.json(
          {
            ok: false,
            message: `Strict orchestration pipeline blocked launch: detailed plan is incomplete (${detailedPlanMissingReasons.join(", ")}).`
          },
          { status: 412 }
        );
      }
    }

    if (pipelinePolicy.requireMultiWorkflowDecomposition) {
      if (parsedPlanWorkflows.length < MIN_DETAILED_PLAN_WORKFLOWS) {
        return NextResponse.json(
          {
            ok: false,
            message:
              "Strict orchestration pipeline requires multi-workflow decomposition in launch payload."
          },
          { status: 412 }
        );
      }
      if (launchPlanSummary && launchPlanSummary.workflowCount < MIN_DETAILED_PLAN_WORKFLOWS) {
        return NextResponse.json(
          {
            ok: false,
            message:
              "Strict orchestration pipeline blocked launch: approved plan does not include enough workflows."
          },
          { status: 412 }
        );
      }
    }

    if (pipelinePolicy.requirePlanWorkflows && parsedPlanWorkflows.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Strict orchestration pipeline requires workflow breakdown from the approved plan before execution."
        },
        { status: 412 }
      );
    }

    const launchActorUserId = access.actor.userId;
    const nonInternalRequestedApprovers = requestedApprovalUserIds.filter(
      (userId) => userId !== launchActorUserId
    );
    if (!access.actor.isInternal && nonInternalRequestedApprovers.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Cross-user approvals cannot be supplied at launch time. Additional signatures must be captured by each approver."
        },
        { status: 403 }
      );
    }

    let capturedApprovalUserIds: string[] = [];
    if (access.actor.isInternal) {
      if (requestedApprovalUserIds.length === 0) {
        return NextResponse.json(
          {
            ok: false,
            message:
              "Internal launches must provide explicit approvalUserIds. approvalsProvided is not accepted."
          },
          { status: 412 }
        );
      }
      const validated = await validateOrgMemberUserIds({
        orgId,
        userIds: requestedApprovalUserIds
      });
      if (validated.invalidUserIds.length > 0) {
        return NextResponse.json(
          {
            ok: false,
            message: `Unknown approver user ids: ${formatIdSnippet(validated.invalidUserIds)}.`
          },
          { status: 412 }
        );
      }
      capturedApprovalUserIds = validated.validUserIds;
    } else {
      capturedApprovalUserIds = [launchActorUserId];
    }

    const approvalsCaptured = capturedApprovalUserIds.length;
    const launchReady = approvalsCaptured >= requiredSignatures;
    const orgExecutionMode = await resolveOrgExecutionMode(orgId);

    let scopedPermissionRequests: PermissionRequestRecord[] = [];
    const permissionRequestCounts = {
      total: 0,
      approved: 0,
      pending: 0,
      rejected: 0,
      cancelled: 0
    };
    const shouldResolvePermissionRequests =
      Boolean(planId) || Boolean(directionId) || providedPermissionRequestIds.length > 0;

    if (shouldResolvePermissionRequests) {
      const allPermissionRequests = await listOrgPermissionRequests(orgId);
      const permissionRequestsById = new Map(
        allPermissionRequests.map((item) => [item.id, item] as const)
      );
      if (providedPermissionRequestIds.length > 0) {
        const unknownProvidedIds = providedPermissionRequestIds.filter(
          (id) => !permissionRequestsById.has(id)
        );
        if (unknownProvidedIds.length > 0) {
          return NextResponse.json(
            {
              ok: false,
              message: `Launch blocked: unknown permission request ids in payload (${formatIdSnippet(unknownProvidedIds)}).`
            },
            { status: 412 }
          );
        }
      }

      if (planId) {
        scopedPermissionRequests = allPermissionRequests.filter(
          (item) => item.planId === planId
        );

        if (scopedPermissionRequests.length === 0) {
          const planRecord = launchPlanRecord ?? (await getPlan(orgId, planId));
          const normalizedPlanDirection = planRecord?.direction
            ? normalizeDirectionKey(planRecord.direction)
            : "";
          if (normalizedPlanDirection) {
            scopedPermissionRequests = allPermissionRequests.filter(
              (item) =>
                !item.planId &&
                normalizeDirectionKey(item.direction) === normalizedPlanDirection
            );
          }
        }
      } else if (directionId) {
        scopedPermissionRequests = allPermissionRequests.filter(
          (item) => item.directionId === directionId
        );
      } else {
        scopedPermissionRequests = providedPermissionRequestIds
          .map((id) => permissionRequestsById.get(id))
          .filter((item): item is PermissionRequestRecord => Boolean(item));
      }

      if (providedPermissionRequestIds.length > 0 && scopedPermissionRequests.length > 0) {
        const providedIds = new Set(providedPermissionRequestIds);
        const missingScopedIds = scopedPermissionRequests
          .filter((item) => !providedIds.has(item.id))
          .map((item) => item.id);

        if (missingScopedIds.length > 0) {
          return NextResponse.json(
            {
              ok: false,
              message: `Launch blocked: approval payload is stale. Missing permission request ids: ${formatIdSnippet(missingScopedIds)}.`
            },
            { status: 412 }
          );
        }
      }

      if (scopedPermissionRequests.length > 0) {
        const pending = scopedPermissionRequests
          .filter((item) => item.status === "PENDING")
          .map((item) => item.id);
        if (pending.length > 0) {
          return NextResponse.json(
            {
              ok: false,
              message: `Launch blocked: ${pending.length} permission request(s) still pending approval (${formatIdSnippet(pending)}).`
            },
            { status: 412 }
          );
        }

        const rejected = scopedPermissionRequests
          .filter((item) => item.status === "REJECTED")
          .map((item) => item.id);
        if (rejected.length > 0) {
          return NextResponse.json(
            {
              ok: false,
              message: `Launch blocked: ${rejected.length} permission request(s) rejected (${formatIdSnippet(rejected)}). Revise plan or regenerate direction.`
            },
            { status: 409 }
          );
        }

        const cancelled = scopedPermissionRequests
          .filter((item) => item.status === "CANCELLED")
          .map((item) => item.id);
        if (cancelled.length > 0) {
          return NextResponse.json(
            {
              ok: false,
              message: `Launch blocked: ${cancelled.length} permission request(s) were cancelled (${formatIdSnippet(cancelled)}). Regenerate plan approvals before launch.`
            },
            { status: 409 }
          );
        }
      }

      permissionRequestCounts.total = scopedPermissionRequests.length;
      for (const item of scopedPermissionRequests) {
        if (item.status === "APPROVED") permissionRequestCounts.approved += 1;
        if (item.status === "PENDING") permissionRequestCounts.pending += 1;
        if (item.status === "REJECTED") permissionRequestCounts.rejected += 1;
        if (item.status === "CANCELLED") permissionRequestCounts.cancelled += 1;
      }
    }

    const activeAgents = await prisma.personnel.findMany({
      where: {
        orgId,
        type: "AI",
        status: {
          not: PersonnelStatus.DISABLED
        }
      },
      orderBy: [{ autonomyScore: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        role: true,
        name: true,
        expertise: true
      }
    });

    const mainAgent =
      activeAgents.find((agent) => /main/i.test(agent.role)) ??
      activeAgents.find((agent) => /boss/i.test(agent.role)) ??
      activeAgents[0] ??
      null;
    const assignmentPool = mainAgent
      ? [mainAgent, ...activeAgents.filter((agent) => agent.id !== mainAgent.id)]
      : [];
    const fallbackToMainOnly = assignmentPool.length === 0;
    const taskPlanSteps = buildTaskPlan(
      prompt,
      swarmDensity,
      parsedPlanWorkflows,
      parsedPlanPathway
    );
    const promptInferredToolkits = inferRequestedToolkits(prompt);
    const planInferredToolkits = collectPlanWorkflowToolkits(parsedPlanWorkflows);
    const subTaskInferredToolkits = taskPlanSteps.flatMap((step) =>
      step.toolkits.length > 0 ? step.toolkits : inferRequestedToolkits(step.prompt)
    );
    const requestedToolkits = [
      ...new Set([
        ...providedRequestedToolkits,
        ...planInferredToolkits,
        ...promptInferredToolkits,
        ...subTaskInferredToolkits
      ])
    ];

    if (pipelinePolicy.enforceSpecialistToolAssignment) {
      const specialistGaps: Array<{ step: number; hints: string[] }> = [];
      for (let index = 1; index < taskPlanSteps.length; index += 1) {
        const step = taskPlanSteps[index];
        const specialtyHints = inferTaskSpecialtyHints(step.prompt);
        const toolkitHints =
          step.toolkits.length > 0 ? step.toolkits : inferRequestedToolkits(step.prompt);
        const hints = [...new Set([...specialtyHints, ...toolkitHints])];
        if (hints.length === 0) {
          continue;
        }

        const specialistPool = mainAgent
          ? activeAgents.filter((agent) => agent.id !== mainAgent.id)
          : activeAgents;
        const bestCandidate = specialistPool
          .map((agent) => scoreAgentSpecialty(agent, hints))
          .sort((left, right) => right - left)[0];
        if (!bestCandidate || bestCandidate <= 0) {
          specialistGaps.push({
            step: index + 1,
            hints: hints.slice(0, 4)
          });
        }
      }
      if (specialistGaps.length > 0) {
        const firstGap = specialistGaps[0];
        return NextResponse.json(
          {
            ok: false,
            message: `Strict orchestration pipeline blocked launch: no specialist agent available for step ${firstGap.step} (${firstGap.hints.join(", ")}).`
          },
          { status: 412 }
        );
      }
    }

    const runawaySignal = detectRunawaySignal(predictedBurn, org.monthlyBtuCap);

    const initiatedByUserId = access.actor.userId;

    const flow = await prisma.$transaction(async (tx) => {
      const created = await tx.flow.create({
        data: {
          orgId,
          prompt,
          status: launchReady ? FlowStatus.QUEUED : FlowStatus.DRAFT,
          progress: 0,
          predictedBurn,
          requiredSignatures
        }
      });

      if (capturedApprovalUserIds.length > 0) {
        await tx.flowApproval.createMany({
          data: capturedApprovalUserIds.map((userId) => ({
            flowId: created.id,
            userId
          })),
          skipDuplicates: true
        });
      }

      const normalizedRunId = `r_${created.id}`;
      for (let index = 0; index < taskPlanSteps.length; index += 1) {
        const step = taskPlanSteps[index];
        const stepPrompt = step.prompt;
        const assignedAgent = pickAgentForStep({
          step,
          index,
          mainAgent,
          activeAgents,
          assignmentPool
        });
        const stepRequestedToolkits =
          step.toolkits.length > 0 ? step.toolkits : inferRequestedToolkits(stepPrompt);
        const taskRequestedToolkits =
          stepRequestedToolkits.length > 0
            ? stepRequestedToolkits
            : step.isPlanningStep
              ? requestedToolkits
              : promptInferredToolkits;
        const normalizedTaskId = `t_${randomUUID().slice(0, 10)}`;
        const nowIso = new Date().toISOString();
        const normalizedTask = {
          task_id: normalizedTaskId,
          run_id: normalizedRunId,
          owner_agent_id: assignedAgent?.id ?? "unassigned-agent",
          objective: stepPrompt,
          inputs: [] as Array<{ ref_type: "hub_file" | "inline"; ref_id?: string; value?: unknown }>,
          expected_outputs: [{ name: "result", type: "json" as const }],
          success_criteria: [
            "Output committed in Hub with sourceTaskId",
            "At least one tool receipt verified"
          ],
          tool_plan:
            taskRequestedToolkits.length > 0
              ? taskRequestedToolkits.map((toolkit) => ({
                  toolkit,
                  action: "TASK_EXECUTION"
                }))
              : [{ toolkit: "internal", action: "GENERATE_OUTPUT" }],
          approval_policy: {
            required: false,
            policy_id: "policy.default"
          },
          retry_policy: {
            max_attempts: 3,
            backoff_sec: 15
          },
          timeout_sec: 600,
          priority: step.isPlanningStep ? "high" : "normal",
          state: "PENDING",
          attempts: 0,
          created_at: nowIso,
          updated_at: nowIso
        };
        // eslint-disable-next-line no-await-in-loop
        const createdTask = await tx.task.create({
          data: {
            flowId: created.id,
            agentId: assignedAgent?.id ?? null,
            prompt: stepPrompt,
            status: TaskStatus.QUEUED,
            requiredFiles: [],
            isPausedForInput: false,
            executionTrace: toInputJsonValue({
              requestedToolkits: taskRequestedToolkits,
              initiatedByUserId,
              normalizedTask,
              pathway: {
                workflowTitle: step.workflowTitle ?? null,
                taskTitle: step.taskTitle ?? null,
                ownerRole: step.ownerRole ?? null,
                executionMode: step.executionMode ?? null,
                trigger: step.trigger ?? null,
                dueWindow: step.dueWindow ?? null,
                dependsOn: step.dependsOn
              },
              orchestrator: {
                mode: fallbackToMainOnly ? "MAIN_AGENT_ONLY" : "MULTI_AGENT",
                stage: step.isPlanningStep ? "PLANNING" : "EXECUTION",
                stepIndex: index + 1,
                totalSteps: taskPlanSteps.length,
                strictPipelineMode: pipelineSettings.mode,
                strictRules: {
                  requireDetailedPlan: pipelinePolicy.requireDetailedPlan,
                  requireMultiWorkflowDecomposition:
                    pipelinePolicy.requireMultiWorkflowDecomposition,
                  enforceSpecialistToolAssignment:
                    pipelinePolicy.enforceSpecialistToolAssignment
                },
                planId: planId ?? null,
                planLock: pipelinePolicy.freezeExecutionToApprovedPlan
                  ? {
                      enabled: true,
                      planId: planId ?? null,
                      planUpdatedAt: launchPlanRecord?.updatedAt ?? null
                    }
                  : {
                      enabled: false
                    }
              }
            })
          }
        });
        // eslint-disable-next-line no-await-in-loop
        await emitOrchestrationEvent({
          orgId,
          runId: created.id,
          taskId: normalizedTaskId,
          attempt: 1,
          agentId: assignedAgent?.id ?? "unassigned-agent",
          eventType: "TASK_ASSIGNED",
          idempotencyKey: `${created.id}:${normalizedTaskId}:1:TASK_ASSIGNED`,
          payload: {
            dbTaskId: createdTask.id,
            objective: stepPrompt
          },
          tx
        });
      }

      await tx.log.create({
        data: {
          orgId,
          type: LogType.EXE,
          actor: "CONTROL_DECK",
          message: `Flow ${created.id} ${
            launchReady ? "queued" : "created in draft"
          }. Burn=${predictedBurn}, signatures=${requiredSignatures}, approvalsCaptured=${approvalsCaptured}, mode=${
            fallbackToMainOnly ? "MAIN_AGENT_ONLY" : "MULTI_AGENT"
          }, planWorkflows=${parsedPlanWorkflows.length}, planPathway=${parsedPlanPathway.length}, permissionRequests=${permissionRequestCounts.total}/${permissionRequestCounts.approved}, strictPipeline=${pipelineSettings.mode}, detailedPlanRule=${pipelinePolicy.requireDetailedPlan}, multiWorkflowRule=${pipelinePolicy.requireMultiWorkflowDecomposition}, specialistRule=${pipelinePolicy.enforceSpecialistToolAssignment}.`
        }
      });

      if (fallbackToMainOnly) {
        await tx.log.create({
          data: {
            orgId,
            type: LogType.SYS,
            actor: "MAIN_AGENT_ORCHESTRATOR",
            message: `No active AI squad available. Flow ${created.id} will execute sequentially in Main Agent fallback mode.`
          }
        });
      }

      if (runawaySignal && featureFlags.costGuardianPassive) {
        await tx.log.create({
          data: {
            orgId,
            type: LogType.SYS,
            actor: "COST_GUARDIAN",
            message: `Passive runaway signal detected for flow ${created.id}. Burn=${predictedBurn}, cap=${org.monthlyBtuCap}.`
          }
        });
      }

      await recordPassiveSpend(
        {
          orgId,
          flowId: created.id,
          amount: predictedBurn,
          type: runawaySignal ? SpendEventType.RUNAWAY_SIGNAL : SpendEventType.PREDICTED_BURN,
          meta: {
            source: "control.launch",
            requiredSignatures,
            approvalsCaptured,
            swarmDensity,
            taskCount: taskPlanSteps.length,
            requestedToolkits,
            initiatedByUserId,
            launchReady,
            executionMode: fallbackToMainOnly ? "MAIN_AGENT_ONLY" : "MULTI_AGENT",
            planWorkflowCount: parsedPlanWorkflows.length,
            planPathwayCount: parsedPlanPathway.length,
            permissionRequestCount: permissionRequestCounts.total,
            approvedPermissionRequestCount: permissionRequestCounts.approved
          }
        },
        tx
      );

      await recordPassivePolicy(
        {
          orgId,
          subjectType: "FLOW_LAUNCH",
          subjectId: created.id,
          riskScore: runawaySignal ? 0.82 : predictedBurn >= 75000 ? 0.42 : 0.15,
          reason: runawaySignal
            ? "Predicted burn approaches/exceeds monthly BTU cap in passive mode."
            : "Flow launch observed in passive policy mode.",
          meta: {
            predictedBurn,
            monthlyBtuCap: org.monthlyBtuCap,
            requiredSignatures,
            approvalsCaptured,
            taskCount: taskPlanSteps.length,
            requestedToolkits,
            initiatedByUserId,
            launchReady,
            executionMode: fallbackToMainOnly ? "MAIN_AGENT_ONLY" : "MULTI_AGENT",
            planWorkflowCount: parsedPlanWorkflows.length,
            planPathwayCount: parsedPlanPathway.length,
            permissionRequestCount: permissionRequestCounts.total,
            approvedPermissionRequestCount: permissionRequestCounts.approved
          }
        },
        tx
      );

      if (directionId) {
        await linkFlowToDirection(orgId, directionId, created.id, tx);
        await tx.log.create({
          data: {
            orgId,
            type: LogType.USER,
            actor: "DIRECTION_RUNTIME",
            message: `Flow ${created.id} linked to direction ${directionId}.`
          }
        });
      }

      if (planId) {
        await tx.memoryEntry.create({
          data: {
            orgId,
            tier: "ORG",
            key: `plan.flow.${planId}.${created.id}`,
            value: {
              planId,
              flowId: created.id,
              directionId: directionId ?? null,
              fallbackPlanId: fallbackPlanId ?? null,
              linkedAt: new Date().toISOString()
            }
          }
        });
      }

      return created;
    });

    await ensureMainAgentProfile({
      orgId,
      flowId: flow.id,
      missionGoal: prompt
    });

    if (directionId) {
      await updateDirection(orgId, directionId, {
        lastExecutedAt: new Date().toISOString()
      });
    }

    let publish: { ok: boolean; message?: string } = { ok: true };
    let localKickWarning: string | undefined;
    if (launchReady) {
      publish = await publishInngestEvent("vorldx/flow.launched", {
        flowId: flow.id,
        orgId,
        prompt,
        swarmDensity,
        predictedBurn,
        requiredSignatures,
        taskCount: taskPlanSteps.length,
        requestedToolkits,
        initiatedByUserId,
        executionMode: fallbackToMainOnly ? "MAIN_AGENT_ONLY" : "MULTI_AGENT",
        orgExecutionMode,
        planWorkflowCount: parsedPlanWorkflows.length,
        planPathwayCount: parsedPlanPathway.length,
        permissionRequestCount: permissionRequestCounts.total,
        approvedPermissionRequestCount: permissionRequestCounts.approved,
        strictPipelineMode: pipelineSettings.mode
      });

      try {
        const response = await fetch(`${request.nextUrl.origin}/api/inngest`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            ...buildInternalApiHeaders()
          },
          body: JSON.stringify([
            {
              name: "vorldx/flow.launched",
              data: {
                flowId: flow.id,
                orgId,
                prompt,
                swarmDensity,
                predictedBurn,
                requiredSignatures,
                taskCount: taskPlanSteps.length,
                requestedToolkits,
                initiatedByUserId,
                executionMode: fallbackToMainOnly ? "MAIN_AGENT_ONLY" : "MULTI_AGENT",
                orgExecutionMode,
                planWorkflowCount: parsedPlanWorkflows.length,
                planPathwayCount: parsedPlanPathway.length,
                permissionRequestCount: permissionRequestCounts.total,
                approvedPermissionRequestCount: permissionRequestCounts.approved,
                strictPipelineMode: pipelineSettings.mode
              }
            }
          ]),
          cache: "no-store"
        });

        if (!response.ok) {
          const detail = await response.text();
          localKickWarning = `Local worker kick failed (${response.status}): ${detail.slice(0, 140)}`;
        }
      } catch (error) {
        localKickWarning = error instanceof Error ? error.message : "Local worker kick failed.";
      }

      if (!publish.ok) {
        await prisma.log.create({
          data: {
            orgId,
            type: LogType.NET,
            actor: "INNGEST_PUBLISHER",
            message: `Flow ${flow.id} queued but Inngest publish failed: ${publish.message}`
          }
        });
      } else {
        await prisma.log.create({
          data: {
            orgId,
            type: LogType.NET,
            actor: "INNGEST_PUBLISHER",
            message: `Flow ${flow.id} launch event published to Inngest.`
          }
        });
      }
    }

    await publishRealtimeEvent({
      orgId,
      event: "flow.created",
      payload: {
        flowId: flow.id,
        status: flow.status,
        predictedBurn: flow.predictedBurn,
        requiredSignatures: flow.requiredSignatures,
        approvalsProvided: approvalsCaptured,
        launchReady,
        permissionRequestCount: permissionRequestCounts.total,
        approvedPermissionRequestCount: permissionRequestCounts.approved
      }
    });

    await publishRealtimeEvent({
      orgId,
      event: "signature.captured",
      payload: {
        flowId: flow.id,
        requiredSignatures: flow.requiredSignatures,
        approvalsProvided: approvalsCaptured,
        userId: access.actor.userId
      }
    });

    await publishRealtimeEvent({
      orgId,
      event: "signature.updated",
      payload: {
        flowId: flow.id,
        requiredSignatures: flow.requiredSignatures,
        approvalsProvided: approvalsCaptured,
        launchReady,
        permissionRequestCount: permissionRequestCounts.total,
        approvedPermissionRequestCount: permissionRequestCounts.approved
      }
    });

    return NextResponse.json(
      {
        ok: true,
        flow: {
          id: flow.id,
          status: flow.status,
          predictedBurn: flow.predictedBurn,
          requiredSignatures: flow.requiredSignatures,
          approvalsCaptured,
          ...(directionId ? { directionId } : {}),
          ...(planId ? { planId } : {}),
          ...(fallbackPlanId ? { fallbackPlanId } : {}),
          taskCount: taskPlanSteps.length,
          planWorkflowCount: parsedPlanWorkflows.length,
          planPathwayCount: parsedPlanPathway.length,
          permissionRequestCount: permissionRequestCounts.total,
          approvedPermissionRequestCount: permissionRequestCounts.approved,
          executionMode: fallbackToMainOnly ? "MAIN_AGENT_ONLY" : "MULTI_AGENT",
          orgExecutionMode,
          strictPipelineMode: pipelineSettings.mode
        },
        warning: [
          launchReady
            ? undefined
            : `Flow is waiting for additional signatures (${approvalsCaptured}/${requiredSignatures}).`,
          publish.ok ? undefined : publish.message,
          localKickWarning
        ]
          .filter(Boolean)
          .join(" | ") || undefined
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[api/flows][POST] unexpected error", error);
    return NextResponse.json(
      {
        ok: false,
        message: "Failed to launch workflow."
      },
      { status: 500 }
    );
  }
}
