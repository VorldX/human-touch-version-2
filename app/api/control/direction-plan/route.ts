export const dynamic = "force-dynamic";

import { AgentRole, LogType, PersonnelStatus, PersonnelType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { getOrgLlmRuntime } from "@/lib/ai/org-llm-settings";
import { prisma } from "@/lib/db/prisma";
import { createDirection } from "@/lib/direction/directions";
import { runSwarmPlanningGraph } from "@/lib/langgraph/swarm-planning-entry";
import { createPlan } from "@/lib/plans/plans";
import { createPermissionRequests } from "@/lib/requests/permission-requests";
import { requireOrgAccess } from "@/lib/security/org-access";

interface PlanTask {
  title: string;
  description: string;
  ownerRole: string;
  dependsOn: string[];
  subtasks: string[];
  tools: string[];
  expectedOutput: string;
  estimatedMinutes: number;
  requiresApproval: boolean;
  approvalRole: string;
  approvalReason: string;
}

type WorkforceType = "HUMAN" | "AGENT" | "HYBRID";

interface PlanWorkflow {
  title: string;
  goal: string;
  ownerRole: string;
  ownerType: WorkforceType;
  dependencies: string[];
  deliverables: string[];
  tools: string[];
  entryCriteria: string[];
  exitCriteria: string[];
  successMetrics: string[];
  estimatedHours: number;
  tasks: PlanTask[];
}

interface PlanMilestone {
  title: string;
  ownerRole: string;
  dueWindow: string;
  deliverable: string;
  successSignal: string;
}

interface PlanResourceAllocation {
  workforceType: WorkforceType;
  role: string;
  responsibility: string;
  capacityPct: number;
  tools: string[];
}

interface PlanApprovalCheckpoint {
  name: string;
  trigger: string;
  requiredRole: string;
  reason: string;
}

interface PlanDependency {
  fromWorkflow: string;
  toWorkflow: string;
  reason: string;
}

type PathwayExecutionMode = "HUMAN" | "AGENT" | "HYBRID";

interface PlanPathwayStep {
  stepId: string;
  line: number;
  workflowTitle: string;
  taskTitle: string;
  ownerRole: string;
  executionMode: PathwayExecutionMode;
  trigger: string;
  dueWindow: string;
  dependsOn: string[];
}

interface ExecutionPlan {
  objective: string;
  organizationFitSummary: string;
  summary: string;
  deliverables: string[];
  milestones: PlanMilestone[];
  resourcePlan: PlanResourceAllocation[];
  approvalCheckpoints: PlanApprovalCheckpoint[];
  dependencies: PlanDependency[];
  pathway: PlanPathwayStep[];
  workflows: PlanWorkflow[];
  risks: string[];
  successMetrics: string[];
  detailScore: number;
}

interface PermissionHint {
  area: string;
  requestedFromRole: string;
  reason: string;
  workflowTitle: string;
  taskTitle: string;
}

interface AutoSquadTemplate {
  role: string;
  name: string;
  expertise: string;
  autonomyScore: number;
}

interface AutoSquadResult {
  triggered: boolean;
  reason?: string;
  domain?: string;
  requestedRoles: string[];
  created: Array<{
    id: string;
    name: string;
    role: string;
  }>;
}

interface ModelPlanResponse {
  analysis: string;
  directionGiven: string;
  primaryPlan: ExecutionPlan;
  fallbackPlan: ExecutionPlan;
  permissions: PermissionHint[];
}

function mapAutoSquadRoleToAgentRole(role: string): AgentRole {
  const normalized = role.toLowerCase();
  if (/\b(main|boss|orchestrator)\b/.test(normalized)) {
    return AgentRole.MAIN;
  }
  if (/\b(manager|lead|strategist|head)\b/.test(normalized)) {
    return AgentRole.MANAGER;
  }
  return AgentRole.WORKER;
}

function buildAutoSquadAgentInstructions(input: {
  role: string;
  expertise: string;
  direction: string;
}) {
  return {
    prompt: `You are ${input.role}. Execute your assigned scope for this direction: ${input.direction}`,
    responsibilities: [
      `Primary expertise: ${input.expertise}`,
      "Report concise progress updates with blockers and next actions.",
      "Do not claim external execution without tool evidence.",
      "Request approval when policy or sensitive actions require human touch."
    ]
  };
}

const MAX_DIRECTION_CHARS = 1800;
const MAX_HUMAN_PLAN_CHARS = 1800;
const MAX_HISTORY_ITEM_CHARS = 600;
const MAX_HISTORY_TOTAL_CHARS = 2400;

function positiveEnvInt(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

const MAX_PROMPT_COMPANY_CONTEXT_CHARS = positiveEnvInt(
  "DIRECTION_PLAN_SELECTED_CONTEXT_MAX_CHARS",
  1400
);
const MAX_CONTEXT_SELECTOR_CHUNK_CHARS = positiveEnvInt(
  "DIRECTION_CONTEXT_SELECTOR_CHUNK_CHARS",
  420
);
const DIRECTION_PLAN_MAX_OUTPUT_TOKENS = positiveEnvInt(
  "DIRECTION_PLAN_MAX_OUTPUT_TOKENS",
  900
);
const DIRECTION_PLAN_MIN_PRIMARY_WORKFLOWS = positiveEnvInt(
  "DIRECTION_PLAN_MIN_PRIMARY_WORKFLOWS",
  3
);
const DIRECTION_PLAN_MIN_TASKS_PER_WORKFLOW = positiveEnvInt(
  "DIRECTION_PLAN_MIN_TASKS_PER_WORKFLOW",
  2
);
const DIRECTION_PLAN_MIN_DETAIL_SCORE = positiveEnvInt(
  "DIRECTION_PLAN_MIN_DETAIL_SCORE",
  70
);
const DIRECTION_PLAN_MIN_FALLBACK_DETAIL_SCORE = positiveEnvInt(
  "DIRECTION_PLAN_MIN_FALLBACK_DETAIL_SCORE",
  45
);

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function clampText(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}
function safeHistory(value: unknown) {
  if (!Array.isArray(value)) return [] as Array<{ role: string; content: string }>;
  const history = value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const raw = item as Record<string, unknown>;
      const role = cleanText(raw.role).toLowerCase();
      const content = clampText(cleanText(raw.content), MAX_HISTORY_ITEM_CHARS);
      if (!content) return null;
      if (role !== "owner" && role !== "organization") return null;
      return { role, content };
    })
    .filter((item): item is { role: string; content: string } => Boolean(item))
    .slice(-6);

  let totalChars = history.reduce((sum, entry) => sum + entry.content.length, 0);
  while (history.length > 1 && totalChars > MAX_HISTORY_TOTAL_CHARS) {
    const dropped = history.shift();
    totalChars -= dropped?.content.length ?? 0;
  }

  return history;
}

function extractJsonObject(raw: string) {
  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = codeBlockMatch ? codeBlockMatch[1] : raw;
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    return null;
  }

  const jsonText = candidate.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(jsonText) as unknown;
  } catch {
    return null;
  }
}

function normalizeStringList(value: unknown, fallback: string[] = []) {
  if (!Array.isArray(value)) return fallback;
  return value
    .map((item) => cleanText(item))
    .filter((item) => item.length > 0)
    .slice(0, 16);
}

function toBoundedNumber(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function normalizeWorkforceType(value: unknown): WorkforceType {
  const normalized = cleanText(value).toUpperCase();
  if (normalized === "HUMAN") return "HUMAN";
  if (normalized === "AGENT") return "AGENT";
  if (normalized === "HYBRID") return "HYBRID";
  return "HYBRID";
}

function splitDirectionIntoItems(direction: string, limit = 6) {
  const normalized = direction
    .replace(/\r\n/g, "\n")
    .split(/\n|[.?!;]+/g)
    .map((line) => cleanText(line))
    .filter(Boolean);
  return [...new Set(normalized)].slice(0, limit);
}

function inferToolHints(value: string) {
  const lower = value.toLowerCase();
  const hints = new Set<string>();
  if (/\b(gmail|email|mail|inbox)\b/.test(lower)) hints.add("gmail");
  if (/\b(google calendar|calendar|meeting|schedule)\b/.test(lower)) hints.add("googlecalendar");
  if (/\b(google meet|gmeet|meet)\b/.test(lower)) hints.add("googlemeet");
  if (/\b(facebook|fb|meta ads|instagram)\b/.test(lower)) hints.add("facebook");
  if (/\b(slides|presentation|pitch deck|investor deck)\b/.test(lower)) hints.add("googleslides");
  if (/\b(docs|document|proposal)\b/.test(lower)) hints.add("googledocs");
  if (/\b(sheet|spreadsheet|financial model)\b/.test(lower)) hints.add("googlesheets");
  return [...hints];
}

function normalizeMilestone(raw: unknown): PlanMilestone | null {
  const record =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const title = cleanText(record.title);
  if (!title) {
    return null;
  }
  return {
    title,
    ownerRole: cleanText(record.ownerRole) || "EMPLOYEE",
    dueWindow: cleanText(record.dueWindow) || "TBD",
    deliverable: cleanText(record.deliverable) || title,
    successSignal: cleanText(record.successSignal) || "Deliverable accepted by reviewer"
  };
}

function normalizeResourceAllocation(raw: unknown): PlanResourceAllocation | null {
  const record =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const role = cleanText(record.role);
  if (!role) {
    return null;
  }
  return {
    workforceType: normalizeWorkforceType(record.workforceType),
    role,
    responsibility: cleanText(record.responsibility) || "Execution support",
    capacityPct: toBoundedNumber(record.capacityPct, 25, 5, 100),
    tools: normalizeStringList(record.tools, [])
  };
}

function normalizeApprovalCheckpoint(raw: unknown): PlanApprovalCheckpoint | null {
  const record =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const name = cleanText(record.name);
  if (!name) {
    return null;
  }
  return {
    name,
    trigger: cleanText(record.trigger) || "Before execution stage transition",
    requiredRole: cleanText(record.requiredRole) || "ADMIN",
    reason: cleanText(record.reason) || "Ensure direction-plan alignment before launch"
  };
}

function normalizePlanDependency(raw: unknown): PlanDependency | null {
  const record =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const fromWorkflow = cleanText(record.fromWorkflow);
  const toWorkflow = cleanText(record.toWorkflow);
  if (!fromWorkflow || !toWorkflow) {
    return null;
  }
  return {
    fromWorkflow,
    toWorkflow,
    reason: cleanText(record.reason) || "Downstream execution depends on upstream output"
  };
}

function normalizePathwayExecutionMode(value: unknown): PathwayExecutionMode {
  const normalized = cleanText(value).toUpperCase();
  if (normalized === "HUMAN") return "HUMAN";
  if (normalized === "AGENT") return "AGENT";
  return "HYBRID";
}

function inferPathwayExecutionMode(input: {
  ownerRole: string;
  workflowOwnerType?: WorkforceType;
}): PathwayExecutionMode {
  const role = input.ownerRole.toLowerCase();
  if (
    /\b(main[_\s-]?agent|worker|agent|bot|ai|automation|orchestrator)\b/.test(role)
  ) {
    return "AGENT";
  }
  if (
    /\b(founder|admin|employee|manager|lead|director|human)\b/.test(role)
  ) {
    return "HUMAN";
  }
  if (input.workflowOwnerType === "AGENT") return "AGENT";
  if (input.workflowOwnerType === "HUMAN") return "HUMAN";
  return "HYBRID";
}

function normalizePathwayStep(raw: unknown, index: number): PlanPathwayStep | null {
  const record =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const workflowTitle = cleanText(record.workflowTitle);
  const taskTitle = cleanText(record.taskTitle);
  const ownerRole = cleanText(record.ownerRole);
  if (!workflowTitle || !taskTitle) {
    return null;
  }
  return {
    stepId: cleanText(record.stepId) || `pathway-step-${index + 1}`,
    line: toBoundedNumber(record.line, index + 1, 1, 999),
    workflowTitle,
    taskTitle,
    ownerRole: ownerRole || "EMPLOYEE",
    executionMode: normalizePathwayExecutionMode(record.executionMode),
    trigger: cleanText(record.trigger) || (index === 0 ? "Immediate after plan approval" : "After previous step completion"),
    dueWindow: cleanText(record.dueWindow) || "Same execution window",
    dependsOn: normalizeStringList(record.dependsOn, [])
  };
}

function buildDeterministicPathway(plan: ExecutionPlan): PlanPathwayStep[] {
  const steps: PlanPathwayStep[] = [];
  let line = 1;

  for (const workflow of plan.workflows) {
    for (const task of workflow.tasks) {
      const ownerRole = task.ownerRole || workflow.ownerRole || "EMPLOYEE";
      steps.push({
        stepId: `pathway-step-${line}`,
        line,
        workflowTitle: workflow.title,
        taskTitle: task.title,
        ownerRole,
        executionMode: inferPathwayExecutionMode({
          ownerRole,
          workflowOwnerType: workflow.ownerType
        }),
        trigger: line === 1 ? "Immediate after plan approval" : "After previous step completion",
        dueWindow: line === 1 ? "Start window" : "Same execution window",
        dependsOn: task.dependsOn.slice(0, 6)
      });
      line += 1;
    }
  }

  return steps;
}

function ensurePlanPathway(plan: ExecutionPlan) {
  if (plan.pathway.length === 0) {
    plan.pathway = buildDeterministicPathway(plan);
    return;
  }

  const knownStepKeys = new Set(
    plan.pathway.map((step) => `${step.workflowTitle.toLowerCase()}::${step.taskTitle.toLowerCase()}`)
  );
  const missing: PlanPathwayStep[] = [];
  let nextLine = plan.pathway.length + 1;
  for (const workflow of plan.workflows) {
    for (const task of workflow.tasks) {
      const key = `${workflow.title.toLowerCase()}::${task.title.toLowerCase()}`;
      if (knownStepKeys.has(key)) {
        continue;
      }
      const ownerRole = task.ownerRole || workflow.ownerRole || "EMPLOYEE";
      missing.push({
        stepId: `pathway-step-${nextLine}`,
        line: nextLine,
        workflowTitle: workflow.title,
        taskTitle: task.title,
        ownerRole,
        executionMode: inferPathwayExecutionMode({
          ownerRole,
          workflowOwnerType: workflow.ownerType
        }),
        trigger: "After dependency readiness",
        dueWindow: "Execution window",
        dependsOn: task.dependsOn.slice(0, 6)
      });
      nextLine += 1;
    }
  }

  if (missing.length > 0) {
    plan.pathway = [...plan.pathway, ...missing];
  }

  plan.pathway = plan.pathway
    .sort((a, b) => a.line - b.line)
    .map((step, index) => ({
      ...step,
      line: index + 1,
      stepId: step.stepId || `pathway-step-${index + 1}`
    }))
    .slice(0, 120);
}

function normalizeTask(raw: unknown): PlanTask {
  const record =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const subtasks = normalizeStringList(record.subtasks, []);
  const title = cleanText(record.title) || "Task";
  const tools = normalizeStringList(record.tools, []);
  return {
    title,
    description: cleanText(record.description) || title,
    ownerRole: cleanText(record.ownerRole) || "EMPLOYEE",
    dependsOn: normalizeStringList(record.dependsOn, []),
    subtasks,
    tools,
    expectedOutput: cleanText(record.expectedOutput) || subtasks[0] || `Completed output for ${title}`,
    estimatedMinutes: toBoundedNumber(record.estimatedMinutes, 60, 10, 720),
    requiresApproval: Boolean(record.requiresApproval),
    approvalRole: cleanText(record.approvalRole) || "ADMIN",
    approvalReason: cleanText(record.approvalReason)
  };
}

function normalizeWorkflow(raw: unknown): PlanWorkflow {
  const record =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const rawTasks = Array.isArray(record.tasks) ? record.tasks : [];
  const tasks = rawTasks.map((item) => normalizeTask(item)).slice(0, 16);
  const toolTags = normalizeStringList(record.tools, []);
  const inferredTools = tasks.flatMap((task) => task.tools).filter(Boolean);
  return {
    title: cleanText(record.title) || "Workflow",
    goal: cleanText(record.goal) || "",
    ownerRole: cleanText(record.ownerRole) || "EMPLOYEE",
    ownerType: normalizeWorkforceType(record.ownerType),
    dependencies: normalizeStringList(record.dependencies, []),
    deliverables: normalizeStringList(record.deliverables, []),
    tools: [...new Set([...toolTags, ...inferredTools])].slice(0, 16),
    entryCriteria: normalizeStringList(record.entryCriteria, []),
    exitCriteria: normalizeStringList(record.exitCriteria, []),
    successMetrics: normalizeStringList(record.successMetrics, []),
    estimatedHours: toBoundedNumber(record.estimatedHours, 8, 1, 240),
    tasks
  };
}

function normalizePlan(raw: unknown): ExecutionPlan {
  const record =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const rawWorkflows = Array.isArray(record.workflows) ? record.workflows : [];
  const milestones = Array.isArray(record.milestones)
    ? record.milestones
        .map((item) => normalizeMilestone(item))
        .filter((item): item is PlanMilestone => Boolean(item))
        .slice(0, 20)
    : [];
  const resourcePlan = Array.isArray(record.resourcePlan)
    ? record.resourcePlan
        .map((item) => normalizeResourceAllocation(item))
        .filter((item): item is PlanResourceAllocation => Boolean(item))
        .slice(0, 20)
    : [];
  const approvalCheckpoints = Array.isArray(record.approvalCheckpoints)
    ? record.approvalCheckpoints
        .map((item) => normalizeApprovalCheckpoint(item))
        .filter((item): item is PlanApprovalCheckpoint => Boolean(item))
        .slice(0, 20)
    : [];
  const dependencies = Array.isArray(record.dependencies)
    ? record.dependencies
        .map((item) => normalizePlanDependency(item))
        .filter((item): item is PlanDependency => Boolean(item))
        .slice(0, 20)
    : [];
  const pathway = Array.isArray(record.pathway)
    ? record.pathway
        .map((item, index) => normalizePathwayStep(item, index))
        .filter((item): item is PlanPathwayStep => Boolean(item))
        .slice(0, 120)
    : [];
  return {
    objective: cleanText(record.objective),
    organizationFitSummary: cleanText(record.organizationFitSummary),
    summary: cleanText(record.summary),
    deliverables: normalizeStringList(record.deliverables, []),
    milestones,
    resourcePlan,
    approvalCheckpoints,
    dependencies,
    pathway,
    workflows: rawWorkflows.map((item) => normalizeWorkflow(item)).slice(0, 12),
    risks: normalizeStringList(record.risks, []),
    successMetrics: normalizeStringList(record.successMetrics, []),
    detailScore: toBoundedNumber(record.detailScore, 0, 0, 100)
  };
}

function ensureMinimumTasks(workflow: PlanWorkflow, toolkitHints: string[]) {
  const normalized = workflow;
  while (normalized.tasks.length < DIRECTION_PLAN_MIN_TASKS_PER_WORKFLOW) {
    const stepIndex = normalized.tasks.length + 1;
    normalized.tasks.push({
      title: `${normalized.title}: Step ${stepIndex}`,
      description: `Execute step ${stepIndex} for ${normalized.goal || normalized.title}.`,
      ownerRole: normalized.ownerRole || "EMPLOYEE",
      dependsOn: stepIndex > 1 ? [`${normalized.title}: Step ${stepIndex - 1}`] : [],
      subtasks: [
        "Prepare inputs and constraints",
        "Execute output with tool evidence",
        "Record handoff notes"
      ],
      tools: toolkitHints.slice(0, 4),
      expectedOutput: `Step ${stepIndex} artifact ready for next handoff`,
      estimatedMinutes: 75,
      requiresApproval: false,
      approvalRole: "ADMIN",
      approvalReason: ""
    });
  }
  return normalized;
}

function buildDeterministicWorkflowPack(input: { direction: string; fallback: boolean }) {
  const seeds = splitDirectionIntoItems(input.direction, input.fallback ? 4 : 6);
  const toolkitHints = inferToolHints(input.direction);
  const baseTitles = input.fallback
    ? ["Fallback Triage", "Fallback Execution", "Fallback Assurance"]
    : ["Scope Blueprint", "Execution Pods", "Validation & Launch", "Post-Launch Optimization"];
  const workflowTarget = input.fallback ? 2 : DIRECTION_PLAN_MIN_PRIMARY_WORKFLOWS;
  const workflows: PlanWorkflow[] = [];

  for (let index = 0; index < workflowTarget; index += 1) {
    const seed = seeds[index] || input.direction;
    const title = baseTitles[index] || `Workflow ${index + 1}`;
    const tasks: PlanTask[] = [
      {
        title: `${title}: Define execution package`,
        description: `Define scoped package for ${seed}.`,
        ownerRole: index === 0 ? "MAIN_AGENT" : "EMPLOYEE",
        dependsOn: [],
        subtasks: [
          "Capture objective, constraints, and measurable output",
          "Lock tools and handoff ownership",
          "Register dependency notes"
        ],
        tools: toolkitHints.slice(0, 4),
        expectedOutput: "Scoped execution package with ownership mapping",
        estimatedMinutes: 80,
        requiresApproval: index === 0,
        approvalRole: "ADMIN",
        approvalReason: index === 0 ? "Launch readiness and scope lock check." : ""
      },
      {
        title: `${title}: Execute and hand off`,
        description: `Deliver execution artifact for ${seed}.`,
        ownerRole: "EMPLOYEE",
        dependsOn: [`${title}: Define execution package`],
        subtasks: [
          "Run execution tasks in order",
          "Capture evidence and deliverable links",
          "Prepare structured handoff to next workflow"
        ],
        tools: toolkitHints.slice(0, 4),
        expectedOutput: "Deliverable artifact and handoff package",
        estimatedMinutes: 110,
        requiresApproval: input.fallback,
        approvalRole: "ADMIN",
        approvalReason: input.fallback
          ? "Fallback path confirmation required before continuation."
          : ""
      }
    ];

    workflows.push({
      title,
      goal: seed,
      ownerRole: index === 0 ? "MAIN_AGENT" : "EMPLOYEE",
      ownerType: index === 0 ? "AGENT" : "HYBRID",
      dependencies: index > 0 ? [baseTitles[Math.max(0, index - 1)] || `Workflow ${index}`] : [],
      deliverables: [`${title} output package`],
      tools: toolkitHints.slice(0, 6),
      entryCriteria: index === 0 ? ["Direction approved and context loaded"] : ["Previous workflow handoff received"],
      exitCriteria: ["Deliverable reviewed", "Dependencies updated"],
      successMetrics: [
        "Deliverables completed on scope",
        "No unresolved blockers at handoff"
      ],
      estimatedHours: input.fallback ? 8 : 12,
      tasks: ensureMinimumTasks(
        {
          title,
          goal: seed,
          ownerRole: index === 0 ? "MAIN_AGENT" : "EMPLOYEE",
          ownerType: index === 0 ? "AGENT" : "HYBRID",
          dependencies: index > 0 ? [baseTitles[Math.max(0, index - 1)] || `Workflow ${index}`] : [],
          deliverables: [`${title} output package`],
          tools: toolkitHints.slice(0, 6),
          entryCriteria: [],
          exitCriteria: [],
          successMetrics: [],
          estimatedHours: input.fallback ? 8 : 12,
          tasks
        },
        toolkitHints
      ).tasks
    });
  }

  return workflows;
}

function applyPlanFallbackScaffold(plan: ExecutionPlan, direction: string, fallback: boolean) {
  const generatedPack = buildDeterministicWorkflowPack({
    direction,
    fallback
  });
  const minimumWorkflows = fallback ? 2 : DIRECTION_PLAN_MIN_PRIMARY_WORKFLOWS;

  if (plan.workflows.length === 0) {
    plan.workflows = generatedPack;
  } else if (plan.workflows.length < minimumWorkflows) {
    const existingTitles = new Set(plan.workflows.map((workflow) => workflow.title.toLowerCase()));
    for (const candidate of generatedPack) {
      if (plan.workflows.length >= minimumWorkflows) {
        break;
      }
      if (existingTitles.has(candidate.title.toLowerCase())) {
        continue;
      }
      plan.workflows.push(candidate);
      existingTitles.add(candidate.title.toLowerCase());
    }
  }

  const toolkitHints = inferToolHints(direction);
  plan.workflows = plan.workflows
    .slice(0, 12)
    .map((workflow) => ensureMinimumTasks(workflow, toolkitHints));
}

function computePlanDetailScore(plan: ExecutionPlan) {
  let score = 0;
  if (plan.objective.length >= 24) score += 10;
  if (plan.organizationFitSummary.length >= 24) score += 10;
  if (plan.summary.length >= 60) score += 10;
  if (plan.deliverables.length >= 2) score += 8;
  if (plan.milestones.length >= 2) score += 8;
  if (plan.resourcePlan.length >= 2) score += 8;
  if (plan.approvalCheckpoints.length >= 1) score += 6;
  if (plan.dependencies.length >= 1) score += 5;
  if (plan.risks.length >= 2) score += 6;
  if (plan.successMetrics.length >= 3) score += 8;

  const workflowCount = plan.workflows.length;
  if (workflowCount >= DIRECTION_PLAN_MIN_PRIMARY_WORKFLOWS) score += 10;
  const taskCount = plan.workflows.reduce((sum, workflow) => sum + workflow.tasks.length, 0);
  if (taskCount >= workflowCount * DIRECTION_PLAN_MIN_TASKS_PER_WORKFLOW) score += 8;
  const workflowToolCoverage = plan.workflows.filter((workflow) => workflow.tools.length > 0).length;
  if (workflowCount > 0 && workflowToolCoverage >= Math.ceil(workflowCount * 0.5)) score += 3;
  return Math.max(0, Math.min(100, score));
}

function hydratePlanDetailSections(plan: ExecutionPlan, direction: string, fallback: boolean) {
  const fallbackObjective = fallback
    ? `Fallback objective for direction: ${direction}`
    : `Primary objective for direction: ${direction}`;
  if (!plan.objective) {
    plan.objective = clampText(fallbackObjective, 280);
  }
  if (!plan.organizationFitSummary) {
    plan.organizationFitSummary =
      "Plan structure aligned with organization DNA, operating model, and workforce specialization.";
  }
  if (!plan.summary) {
    plan.summary = fallback
      ? "Fallback execution path preserving critical outcomes with risk controls."
      : "Detailed execution blueprint with workforce coordination and measurable delivery gates.";
  }

  if (plan.deliverables.length === 0) {
    plan.deliverables = plan.workflows
      .flatMap((workflow) => workflow.deliverables)
      .filter(Boolean)
      .slice(0, 10);
  }
  if (plan.deliverables.length === 0) {
    plan.deliverables = splitDirectionIntoItems(direction, 4).map(
      (item, index) => `Deliverable ${index + 1}: ${item}`
    );
  }

  if (plan.milestones.length === 0) {
    plan.milestones = plan.workflows.slice(0, 6).map((workflow, index) => ({
      title: `${workflow.title} milestone`,
      ownerRole: workflow.ownerRole || "EMPLOYEE",
      dueWindow: fallback ? `Fallback Window ${index + 1}` : `Execution Window ${index + 1}`,
      deliverable: workflow.deliverables[0] || workflow.goal || workflow.title,
      successSignal: workflow.successMetrics[0] || "Milestone accepted by reviewer"
    }));
  }

  if (plan.resourcePlan.length === 0) {
    plan.resourcePlan = plan.workflows.slice(0, 8).map((workflow) => ({
      workforceType: workflow.ownerType,
      role: workflow.ownerRole || "EMPLOYEE",
      responsibility: workflow.goal || workflow.title,
      capacityPct: 20,
      tools: workflow.tools.slice(0, 6)
    }));
  }

  if (plan.approvalCheckpoints.length === 0) {
    const approvalTasks = plan.workflows.flatMap((workflow) =>
      workflow.tasks
        .filter((task) => task.requiresApproval)
        .map((task) => ({
          name: `${workflow.title}: ${task.title}`,
          trigger: "Before workflow stage promotion",
          requiredRole: task.approvalRole || "ADMIN",
          reason: task.approvalReason || "Critical step approval required."
        }))
    );
    plan.approvalCheckpoints = approvalTasks.slice(0, 8);
  }
  if (plan.approvalCheckpoints.length === 0) {
    plan.approvalCheckpoints = [
      {
        name: fallback ? "Fallback launch approval" : "Execution launch approval",
        trigger: "Before execution begins",
        requiredRole: "ADMIN",
        reason: "Validate final plan quality and risk controls."
      }
    ];
  }

  if (plan.dependencies.length === 0 && plan.workflows.length > 1) {
    plan.dependencies = plan.workflows.slice(1).map((workflow, index) => ({
      fromWorkflow: plan.workflows[index]?.title || `Workflow ${index + 1}`,
      toWorkflow: workflow.title,
      reason: "Sequential dependency from upstream deliverable."
    }));
  }

  if (plan.risks.length === 0) {
    plan.risks = [
      "Execution drift from approved scope",
      "Tool authorization delays",
      "Dependency slippage across squads"
    ];
  }
  if (plan.successMetrics.length === 0) {
    plan.successMetrics = [
      "All deliverables accepted by owner",
      "Milestones closed within planned window",
      "No unresolved critical blockers at launch"
    ];
  }

  for (const workflow of plan.workflows) {
    if (!workflow.ownerRole) {
      workflow.ownerRole = "EMPLOYEE";
    }
    if (workflow.tools.length === 0) {
      const taskTools = workflow.tasks.flatMap((task) => task.tools);
      workflow.tools = taskTools.length > 0 ? [...new Set(taskTools)].slice(0, 6) : ["general-ops"];
    }
    if (workflow.deliverables.length === 0) {
      workflow.deliverables = [workflow.goal || `${workflow.title} completed output`];
    }
    if (workflow.entryCriteria.length === 0) {
      workflow.entryCriteria = ["Required context and dependencies are available"];
    }
    if (workflow.exitCriteria.length === 0) {
      workflow.exitCriteria = ["Deliverable accepted by downstream owner"];
    }
    if (workflow.successMetrics.length === 0) {
      workflow.successMetrics = ["Workflow deliverables completed with quality checks"];
    }
  }

  ensurePlanPathway(plan);
  plan.detailScore = computePlanDetailScore(plan);
}

function normalizePermission(raw: unknown): PermissionHint | null {
  const record =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const reason = cleanText(record.reason);
  if (!reason) {
    return null;
  }
  return {
    area: cleanText(record.area) || "General",
    requestedFromRole: cleanText(record.requestedFromRole) || "ADMIN",
    reason,
    workflowTitle: cleanText(record.workflowTitle),
    taskTitle: cleanText(record.taskTitle)
  };
}

function normalizeRole(value: string): "FOUNDER" | "ADMIN" | "EMPLOYEE" {
  const normalized = value.trim().toUpperCase();
  if (normalized.includes("FOUNDER") || normalized.includes("OWNER")) return "FOUNDER";
  if (normalized.includes("ADMIN") || normalized.includes("LEAD")) return "ADMIN";
  return "EMPLOYEE";
}

function parseModelPlan(rawOutput: string, fallbackDirection: string): ModelPlanResponse {
  const parsed = extractJsonObject(rawOutput);
  const record =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};

  const primaryPlan = normalizePlan(record.primaryPlan);
  const fallbackPlan = normalizePlan(record.fallbackPlan);

  applyPlanFallbackScaffold(primaryPlan, fallbackDirection, false);
  applyPlanFallbackScaffold(fallbackPlan, fallbackDirection, true);
  hydratePlanDetailSections(primaryPlan, fallbackDirection, false);
  hydratePlanDetailSections(fallbackPlan, fallbackDirection, true);

  const permissions = Array.isArray(record.permissions)
    ? record.permissions
        .map((item) => normalizePermission(item))
        .filter((item): item is PermissionHint => Boolean(item))
    : [];

  return {
    analysis: cleanText(record.analysis) || rawOutput.slice(0, 1200),
    directionGiven: cleanText(record.directionGiven) || fallbackDirection,
    primaryPlan,
    fallbackPlan,
    permissions
  };
}

function titleFromDirection(direction: string) {
  const compact = direction.replace(/\s+/g, " ").trim();
  if (!compact) return "Strategic Direction";
  const words = compact.split(" ").slice(0, 8).join(" ");
  return words.length > 96 ? `${words.slice(0, 93)}...` : words;
}

function normalizeToolkitName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

function collectPlanToolkits(plan: ExecutionPlan) {
  const unique = new Set<string>();
  for (const allocation of plan.resourcePlan) {
    for (const tool of allocation.tools) {
      const normalized = normalizeToolkitName(tool);
      if (normalized) {
        unique.add(normalized);
      }
    }
  }
  for (const workflow of plan.workflows) {
    for (const workflowTool of workflow.tools) {
      const normalizedWorkflowTool = normalizeToolkitName(workflowTool);
      if (normalizedWorkflowTool) {
        unique.add(normalizedWorkflowTool);
      }
    }
    for (const task of workflow.tasks) {
      for (const tool of task.tools) {
        const normalized = normalizeToolkitName(tool);
        if (normalized) {
          unique.add(normalized);
        }
      }
    }
  }
  return [...unique];
}

function isSyntheticFallbackTask(task: PlanTask | undefined) {
  if (!task) return false;
  const title = task.title.trim().toLowerCase();
  return (
    title === "translate direction into deliverable milestones" ||
    title === "run conservative fallback execution path" ||
    title.includes("define execution package")
  );
}

function countPlanTasks(plan: ExecutionPlan) {
  return plan.workflows.reduce((sum, workflow) => sum + workflow.tasks.length, 0);
}

function hasPlannerQualityIssues(input: { primaryPlan: ExecutionPlan; fallbackPlan: ExecutionPlan }) {
  const issues: string[] = [];
  const primaryTaskCount = countPlanTasks(input.primaryPlan);
  const fallbackTaskCount = countPlanTasks(input.fallbackPlan);
  const firstPrimaryTask = input.primaryPlan.workflows[0]?.tasks[0];
  const firstFallbackTask = input.fallbackPlan.workflows[0]?.tasks[0];
  const primaryUnderDetailedWorkflowCount = input.primaryPlan.workflows.filter(
    (workflow) => workflow.tasks.length < DIRECTION_PLAN_MIN_TASKS_PER_WORKFLOW
  ).length;
  const fallbackUnderDetailedWorkflowCount = input.fallbackPlan.workflows.filter(
    (workflow) => workflow.tasks.length < DIRECTION_PLAN_MIN_TASKS_PER_WORKFLOW
  ).length;
  const primaryToolCoverage = input.primaryPlan.workflows.filter(
    (workflow) =>
      workflow.tools.length > 0 || workflow.tasks.some((task) => task.tools.length > 0)
  ).length;
  const fallbackToolCoverage = input.fallbackPlan.workflows.filter(
    (workflow) =>
      workflow.tools.length > 0 || workflow.tasks.some((task) => task.tools.length > 0)
  ).length;

  if (
    input.primaryPlan.workflows.length < DIRECTION_PLAN_MIN_PRIMARY_WORKFLOWS ||
    primaryTaskCount <
      input.primaryPlan.workflows.length * DIRECTION_PLAN_MIN_TASKS_PER_WORKFLOW
  ) {
    issues.push("Primary plan is missing structured workflows/tasks.");
  }
  if (primaryUnderDetailedWorkflowCount > 0) {
    issues.push(
      `Primary plan has ${primaryUnderDetailedWorkflowCount} workflow(s) below minimum task depth.`
    );
  }
  if (input.primaryPlan.detailScore < DIRECTION_PLAN_MIN_DETAIL_SCORE) {
    issues.push(
      `Primary plan detail score ${input.primaryPlan.detailScore} is below required ${DIRECTION_PLAN_MIN_DETAIL_SCORE}.`
    );
  }
  if (!input.primaryPlan.objective || !input.primaryPlan.organizationFitSummary) {
    issues.push("Primary plan is missing objective or organization fit summary.");
  }
  if (input.primaryPlan.deliverables.length < 2 || input.primaryPlan.milestones.length < 2) {
    issues.push("Primary plan must include deliverables and milestones.");
  }
  if (input.primaryPlan.resourcePlan.length < 1 || input.primaryPlan.approvalCheckpoints.length < 1) {
    issues.push("Primary plan must include resource plan and approval checkpoints.");
  }
  if (input.primaryPlan.pathway.length < 1) {
    issues.push("Primary plan must include pathway sequencing.");
  }
  if (primaryToolCoverage < Math.max(1, Math.floor(input.primaryPlan.workflows.length / 2))) {
    issues.push("Primary plan tool mapping is insufficient across workflows.");
  }

  if (input.fallbackPlan.workflows.length < 1 || fallbackTaskCount < 1) {
    issues.push("Fallback plan is missing structured workflows/tasks.");
  }
  if (fallbackUnderDetailedWorkflowCount > 0) {
    issues.push(
      `Fallback plan has ${fallbackUnderDetailedWorkflowCount} workflow(s) below minimum task depth.`
    );
  }
  if (input.fallbackPlan.detailScore < DIRECTION_PLAN_MIN_FALLBACK_DETAIL_SCORE) {
    issues.push(
      `Fallback plan detail score ${input.fallbackPlan.detailScore} is below required ${DIRECTION_PLAN_MIN_FALLBACK_DETAIL_SCORE}.`
    );
  }
  if (fallbackToolCoverage < 1) {
    issues.push("Fallback plan must keep at least one workflow with explicit tool mapping.");
  }
  if (input.fallbackPlan.pathway.length < 1) {
    issues.push("Fallback plan must include pathway sequencing.");
  }
  if (
    primaryTaskCount <= 1 &&
    fallbackTaskCount <= 1 &&
    isSyntheticFallbackTask(firstPrimaryTask) &&
    isSyntheticFallbackTask(firstFallbackTask)
  ) {
    issues.push("Planner returned synthetic generic fallback tasks.");
  }

  return issues;
}

function inferAutoSquadTemplates(input: {
  direction: string;
  humanPlan: string;
  history: Array<{ role: string; content: string }>;
}): { triggered: boolean; reason: string; domain: string; templates: AutoSquadTemplate[] } {
  const ownerHistory = input.history
    .filter((entry) => entry.role === "owner")
    .map((entry) => entry.content)
    .join("\n");
  const combined = `${input.direction}\n${input.humanPlan}\n${ownerHistory}`.toLowerCase();

  const hasAgentLikeIntent =
    /\b(ai|a\.i\.|agent|agents|agnt|agnets|age?nts?|agebnts?)\b/.test(combined) ||
    /\b(automation|automate|autonomous)\b/.test(combined);
  const looksLikeHumanHiringOnly =
    /\b(hire|recruit|interview|headcount)\b/.test(combined) && !hasAgentLikeIntent;
  const wantsTeam =
    !looksLikeHumanHiringOnly &&
    /\b(create|build|form|assemble|set up|setup|make|start|launch)\b/.test(combined) &&
    /\b(team|squad)\b/.test(combined) &&
    hasAgentLikeIntent;

  if (!wantsTeam) {
    return {
      triggered: false,
      reason: "No explicit team-creation intent detected.",
      domain: "general",
      templates: []
    };
  }

  if (/\b(marketing|campaign|growth|content|social|seo)\b/.test(combined)) {
    return {
      triggered: true,
      reason: "Marketing team intent detected.",
      domain: "marketing",
      templates: [
        {
          role: "Marketing Strategist Agent",
          name: "Marketing Strategist Agent",
          expertise: "Campaign strategy, audience segmentation, go-to-market planning.",
          autonomyScore: 0.72
        },
        {
          role: "Content Strategy Agent",
          name: "Content Strategy Agent",
          expertise: "Content planning, copywriting, editorial operations.",
          autonomyScore: 0.68
        },
        {
          role: "Campaign Automation Agent",
          name: "Campaign Automation Agent",
          expertise: "Workflow automation, outreach sequencing, lifecycle campaigns.",
          autonomyScore: 0.7
        },
        {
          role: "Lead Research Agent",
          name: "Lead Research Agent",
          expertise: "Lead intelligence, account research, qualification signals.",
          autonomyScore: 0.66
        }
      ]
    };
  }

  return {
    triggered: true,
    reason: "General team intent detected.",
    domain: "general",
    templates: [
      {
        role: "Manager Agent",
        name: "Manager Agent",
        expertise: "Mission decomposition, dependency tracking, delegation control.",
        autonomyScore: 0.7
      },
      {
        role: "Execution Worker Agent",
        name: "Execution Worker Agent",
        expertise: "Task execution, artifact generation, completion reporting.",
        autonomyScore: 0.62
      }
    ]
  };
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        direction?: string;
        history?: unknown;
        humanPlan?: string;
        provider?: string;
        model?: string;
      }
    | null;

  const orgId = cleanText(body?.orgId);
  const direction = clampText(cleanText(body?.direction), MAX_DIRECTION_CHARS);
  const history = safeHistory(body?.history);
  const humanPlan = clampText(cleanText(body?.humanPlan), MAX_HUMAN_PLAN_CHARS);
  const provider = cleanText(body?.provider);
  const model = cleanText(body?.model);

  if (!orgId || !direction) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId and direction are required."
      },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  try {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true }
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

  const [mainAgent, personnel] = await Promise.all([
    prisma.personnel.findFirst({
      where: {
        orgId,
        type: "AI",
        role: {
          contains: "Main",
          mode: "insensitive"
        }
      },
      select: {
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
      }
    }),
    prisma.personnel.findMany({
      where: {
        orgId,
        status: {
          in: [PersonnelStatus.IDLE, PersonnelStatus.ACTIVE, PersonnelStatus.PAUSED]
        }
      },
      select: {
        name: true,
        role: true,
        type: true
      },
      orderBy: {
        updatedAt: "desc"
      },
      take: 25
    })
  ]);

  const personnelSummary = [
    ...new Set(
      personnel
        .slice(0, 12)
        .map((item) => `${item.type}:${item.role}`)
        .filter(Boolean)
    )
  ].join(", ");

  const runtime = await getOrgLlmRuntime(orgId);
  const planningGraphResult = await runSwarmPlanningGraph({
    orgId,
    userId: access.actor.userId,
    orgName: org.name,
    direction,
    humanPlan,
    history,
    personnelSummary,
    mainAgent:
      mainAgent ?? {
        id: "main-agent-proxy",
        name: "Main Agent",
        role: "Planner",
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
      },
    organizationRuntime: runtime,
    provider: provider || undefined,
    model: model || undefined,
    maxSelectedContextChars: MAX_PROMPT_COMPANY_CONTEXT_CHARS,
    maxContextChunkChars: MAX_CONTEXT_SELECTOR_CHUNK_CHARS,
    maxOutputTokens: DIRECTION_PLAN_MAX_OUTPUT_TOKENS
  });

  if (!planningGraphResult.ok || !planningGraphResult.modelOutput) {
    return NextResponse.json(
      {
        ok: false,
        message: planningGraphResult.error ?? "Failed generating plans.",
        planningGraph: {
          graphRunId: planningGraphResult.graphRunId,
          warnings: planningGraphResult.warnings
        }
      },
      { status: 502 }
    );
  }

  const parsed = parseModelPlan(planningGraphResult.modelOutput, direction);
  const qualityIssues = hasPlannerQualityIssues({
    primaryPlan: parsed.primaryPlan,
    fallbackPlan: parsed.fallbackPlan
  });
  if (qualityIssues.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        message: `Planner quality gate failed: ${qualityIssues.join(" | ")}`,
        planningGraph: {
          graphRunId: planningGraphResult.graphRunId,
          warnings: planningGraphResult.warnings,
          qualityIssues
        },
        contextSelection: planningGraphResult.contextSelection
      },
      { status: 502 }
    );
  }
  const requiredToolkits = [
    ...new Set([
      ...collectPlanToolkits(parsed.primaryPlan),
      ...collectPlanToolkits(parsed.fallbackPlan)
    ])
  ];
  const autoSquadInference = inferAutoSquadTemplates({
    direction,
    humanPlan,
    history
  });
  const permissionItemsFromPlans: PermissionHint[] = [];

  for (const workflow of parsed.primaryPlan.workflows) {
    for (const task of workflow.tasks) {
      if (task.requiresApproval && task.approvalReason.trim()) {
        permissionItemsFromPlans.push({
          area: workflow.title || "Primary Plan",
          requestedFromRole: task.approvalRole || "ADMIN",
          reason: task.approvalReason,
          workflowTitle: workflow.title,
          taskTitle: task.title
        });
      }
    }
  }
  for (const workflow of parsed.fallbackPlan.workflows) {
    for (const task of workflow.tasks) {
      if (task.requiresApproval && task.approvalReason.trim()) {
        permissionItemsFromPlans.push({
          area: workflow.title || "Fallback Plan",
          requestedFromRole: task.approvalRole || "ADMIN",
          reason: task.approvalReason,
          workflowTitle: workflow.title,
          taskTitle: task.title
        });
      }
    }
  }

  const dedupedPermissions = [...parsed.permissions, ...permissionItemsFromPlans].reduce<
    PermissionHint[]
  >((acc, item) => {
    const key = `${item.area}|${item.requestedFromRole}|${item.reason}|${item.workflowTitle}|${item.taskTitle}`;
    if (acc.some((existing) => {
      const existingKey = `${existing.area}|${existing.requestedFromRole}|${existing.reason}|${existing.workflowTitle}|${existing.taskTitle}`;
      return existingKey === key;
    })) {
      return acc;
    }
    acc.push(item);
    return acc;
  }, []);

  const directionGiven = parsed.directionGiven || direction;
  const directionTitle = titleFromDirection(directionGiven);

  const persisted = await prisma.$transaction(async (tx) => {
    const autoSquadResult: AutoSquadResult = {
      triggered: autoSquadInference.triggered,
      reason: autoSquadInference.reason,
      domain: autoSquadInference.domain,
      requestedRoles: autoSquadInference.templates.map((item) => item.role),
      created: []
    };

    if (autoSquadInference.triggered && autoSquadInference.templates.length > 0) {
      const existingAiRoles = await tx.personnel.findMany({
        where: {
          orgId,
          type: PersonnelType.AI
        },
        select: {
          id: true,
          role: true
        }
      });
      const existingRoleToPersonnelId = new Map<string, string>();
      for (const item of existingAiRoles) {
        const roleKey = item.role.trim().toLowerCase();
        if (!roleKey || existingRoleToPersonnelId.has(roleKey)) {
          continue;
        }
        existingRoleToPersonnelId.set(roleKey, item.id);
      }

      for (const template of autoSquadInference.templates) {
        const roleKey = template.role.trim().toLowerCase();
        if (!roleKey) {
          continue;
        }

        let personnelIdForRole = existingRoleToPersonnelId.get(roleKey) ?? null;
        if (!personnelIdForRole) {
          // eslint-disable-next-line no-await-in-loop
          const created = await tx.personnel.create({
            data: {
              orgId,
              type: PersonnelType.AI,
              name: template.name,
              role: template.role,
              expertise: template.expertise,
              autonomyScore: template.autonomyScore,
              status: PersonnelStatus.IDLE
            },
            select: {
              id: true,
              name: true,
              role: true
            }
          });
          autoSquadResult.created.push(created);
          personnelIdForRole = created.id;
          existingRoleToPersonnelId.set(roleKey, created.id);
        }

        // Ensure each auto-squad personnel row has an executable Agent profile.
        // eslint-disable-next-line no-await-in-loop
        const existingAgentProfile = await tx.agent.findFirst({
          where: {
            orgId,
            personnelId: personnelIdForRole
          },
          select: {
            id: true
          }
        });
        if (!existingAgentProfile) {
          // eslint-disable-next-line no-await-in-loop
          await tx.agent.create({
            data: {
              orgId,
              personnelId: personnelIdForRole,
              role: mapAutoSquadRoleToAgentRole(template.role),
              name: template.name,
              goal: directionGiven.slice(0, 1200),
              allowedTools: requiredToolkits,
              instructions: buildAutoSquadAgentInstructions({
                role: template.role,
                expertise: template.expertise,
                direction: directionGiven.slice(0, 900)
              }),
              metadata: {
                creationSource: "direction_plan_auto_squad",
                source: "control_direction_plan",
                domain: autoSquadInference.domain ?? "general",
                templateRole: template.role
              }
            }
          });
        }
      }

      if (autoSquadResult.created.length > 0) {
        await tx.log.create({
          data: {
            orgId,
            type: LogType.SYS,
            actor: "MAIN_AGENT_ORCHESTRATOR",
            message: `Auto-squad bootstrap created ${autoSquadResult.created.length} AI personnel from planning intent (${autoSquadResult.domain}).`
          }
        });
      }
    }

    const directionRecord = await createDirection(
      orgId,
      {
        title: directionTitle,
        summary: parsed.analysis.slice(0, 400),
        direction: directionGiven,
        status: "ACTIVE",
        source: "CHAT",
        ownerUserId: access.actor.userId,
        ownerEmail: access.actor.email
      },
      tx
    );

    const planRecord = await createPlan(
      orgId,
      {
        title: `Plan: ${directionTitle}`,
        summary: parsed.analysis.slice(0, 400),
        direction: directionGiven,
        directionId: directionRecord.id,
        humanPlan,
        primaryPlan: parsed.primaryPlan as unknown as Record<string, unknown>,
        fallbackPlan: parsed.fallbackPlan as unknown as Record<string, unknown>,
        status: "ACTIVE",
        source: "CHAT",
        ownerEmail: access.actor.email
      },
      tx
    );

    const permissionRequests = await createPermissionRequests({
      orgId,
      direction: directionGiven,
      directionId: directionRecord.id,
      planId: planRecord.id,
      requestedByUserId: access.actor.userId,
      requestedByEmail: access.actor.email,
      items: dedupedPermissions.map((item) => ({
        area: item.area,
        reason: item.reason,
        workflowTitle: item.workflowTitle,
        taskTitle: item.taskTitle,
        targetRole: normalizeRole(item.requestedFromRole)
      }))
    });

    await tx.log.create({
      data: {
        orgId,
        type: LogType.USER,
        actor: "CONTROL",
        message: `Direction plans generated by ${access.actor.email}. direction=${directionRecord.id}, plan=${planRecord.id}, permissionRequests=${permissionRequests.length}, requiredToolkits=${requiredToolkits.length}.`
      }
    });

    return {
      directionRecord,
      planRecord,
      permissionRequests,
      autoSquadResult
    };
  });

    return NextResponse.json({
      ok: true,
      analysis: parsed.analysis,
      directionGiven,
      primaryPlan: parsed.primaryPlan,
      fallbackPlan: parsed.fallbackPlan,
      permissions: dedupedPermissions,
      permissionRequests: persisted.permissionRequests,
      requestCount: persisted.permissionRequests.length,
      requiredToolkits,
      planQuality: {
        primary: {
          detailScore: parsed.primaryPlan.detailScore,
          workflowCount: parsed.primaryPlan.workflows.length,
          taskCount: countPlanTasks(parsed.primaryPlan)
        },
        fallback: {
          detailScore: parsed.fallbackPlan.detailScore,
          workflowCount: parsed.fallbackPlan.workflows.length,
          taskCount: countPlanTasks(parsed.fallbackPlan)
        }
      },
      autoSquad: persisted.autoSquadResult,
      directionRecord: persisted.directionRecord,
      planRecord: persisted.planRecord,
      model: {
        provider: planningGraphResult.model?.provider ?? null,
        name: planningGraphResult.model?.name ?? null,
        source: planningGraphResult.model?.source ?? null
      },
      tokenUsage: planningGraphResult.tokenUsage ?? null,
      billing: planningGraphResult.billing ?? null,
      contextSelection: planningGraphResult.contextSelection,
      planningGraph: {
        graphRunId: planningGraphResult.graphRunId,
        warnings: planningGraphResult.warnings
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed generating plans.";
    console.error("[api/control/direction-plan] unexpected error", error);
    return NextResponse.json(
      {
        ok: false,
        message
      },
      { status: 500 }
    );
  }
}
