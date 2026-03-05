import { randomUUID } from "node:crypto";

import { LogType, PersonnelStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { executeSwarmAgent } from "@/lib/ai/swarm-runtime";
import { getOrgLlmRuntime } from "@/lib/ai/org-llm-settings";
import { prisma } from "@/lib/db/prisma";
import { createDirection } from "@/lib/direction/directions";
import { ensureCompanyDataFile } from "@/lib/hub/organization-hub";
import { createPlan } from "@/lib/plans/plans";
import { createPermissionRequests } from "@/lib/requests/permission-requests";
import { requireOrgAccess } from "@/lib/security/org-access";

interface PlanTask {
  title: string;
  ownerRole: string;
  subtasks: string[];
  tools: string[];
  requiresApproval: boolean;
  approvalRole: string;
  approvalReason: string;
}

interface PlanWorkflow {
  title: string;
  goal: string;
  tasks: PlanTask[];
}

interface ExecutionPlan {
  summary: string;
  workflows: PlanWorkflow[];
  risks: string[];
  successMetrics: string[];
}

interface PermissionHint {
  area: string;
  requestedFromRole: string;
  reason: string;
  workflowTitle: string;
  taskTitle: string;
}

interface ModelPlanResponse {
  analysis: string;
  directionGiven: string;
  primaryPlan: ExecutionPlan;
  fallbackPlan: ExecutionPlan;
  permissions: PermissionHint[];
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function safeHistory(value: unknown) {
  if (!Array.isArray(value)) return [] as Array<{ role: string; content: string }>;
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const raw = item as Record<string, unknown>;
      const role = cleanText(raw.role).toLowerCase();
      const content = cleanText(raw.content);
      if (!content) return null;
      if (role !== "owner" && role !== "organization") return null;
      return { role, content };
    })
    .filter((item): item is { role: string; content: string } => Boolean(item))
    .slice(-12);
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

function normalizeTask(raw: unknown): PlanTask {
  const record =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return {
    title: cleanText(record.title) || "Task",
    ownerRole: cleanText(record.ownerRole) || "EMPLOYEE",
    subtasks: normalizeStringList(record.subtasks, []),
    tools: normalizeStringList(record.tools, []),
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
  return {
    title: cleanText(record.title) || "Workflow",
    goal: cleanText(record.goal) || "",
    tasks: rawTasks.map((item) => normalizeTask(item)).slice(0, 12)
  };
}

function normalizePlan(raw: unknown): ExecutionPlan {
  const record =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const rawWorkflows = Array.isArray(record.workflows) ? record.workflows : [];
  return {
    summary: cleanText(record.summary),
    workflows: rawWorkflows.map((item) => normalizeWorkflow(item)).slice(0, 8),
    risks: normalizeStringList(record.risks, []),
    successMetrics: normalizeStringList(record.successMetrics, [])
  };
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

  if (primaryPlan.workflows.length === 0) {
    primaryPlan.workflows = [
      {
        title: "Primary Execution Workflow",
        goal: fallbackDirection,
        tasks: [
          {
            title: "Translate direction into deliverable milestones",
            ownerRole: "EMPLOYEE",
            subtasks: [
              "Break direction into measurable milestones",
              "Assign execution owners and due windows"
            ],
            tools: [],
            requiresApproval: false,
            approvalRole: "ADMIN",
            approvalReason: ""
          }
        ]
      }
    ];
  }

  if (fallbackPlan.workflows.length === 0) {
    fallbackPlan.workflows = [
      {
        title: "Fallback Stabilization Workflow",
        goal: `Fallback for: ${fallbackDirection}`,
        tasks: [
          {
            title: "Run conservative fallback execution path",
            ownerRole: "EMPLOYEE",
            subtasks: [
              "Scale down scope to critical outcomes",
              "Protect ongoing operations from disruption"
            ],
            tools: [],
            requiresApproval: true,
            approvalRole: "ADMIN",
            approvalReason: "Fallback path changes delivery scope."
          }
        ]
      }
    ];
  }

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
  const direction = cleanText(body?.direction);
  const history = safeHistory(body?.history);
  const humanPlan = cleanText(body?.humanPlan);
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

  const personnelSummary = personnel
    .map((item) => `${item.type}:${item.role}:${item.name}`)
    .join(", ");

  let companyContext = "";
  try {
    const companyData = await ensureCompanyDataFile(orgId);
    companyContext = companyData.content.slice(0, 9000);
  } catch {
    companyContext = "";
  }

  const modelPrompt = [
    "You are preparing implementation plans for a direction.",
    `Direction: ${direction}`,
    humanPlan ? `Human Proposed Plan: ${humanPlan}` : "Human Proposed Plan: (none provided)",
    "",
    history.length > 0
      ? [
          "Recent Conversation:",
          ...history.map(
            (item) => `${item.role === "owner" ? "Owner" : "Organization"}: ${item.content}`
          )
        ].join("\n")
      : "Recent Conversation: (none)",
    "",
    `Organization Name: ${org.name}`,
    personnelSummary
      ? `Available Personnel (role map): ${personnelSummary}`
      : "Available Personnel: unknown",
    "",
    "Return STRICT JSON with this schema:",
    "{",
    '  "analysis": "short reasoning summary",',
    '  "directionGiven": "refined direction paragraph",',
    '  "primaryPlan": {',
    '    "summary": "text",',
    '    "workflows": [',
    "      {",
    '        "title": "workflow title",',
    '        "goal": "workflow goal",',
    '        "tasks": [',
    "          {",
    '            "title": "task title",',
    '            "ownerRole": "EMPLOYEE/ADMIN/FOUNDER",',
    '            "subtasks": ["subtask 1"],',
    '            "tools": ["tool name"],',
    '            "requiresApproval": true,',
    '            "approvalRole": "ADMIN",',
    '            "approvalReason": "why approval needed"',
    "          }",
    "        ]",
    "      }",
    "    ],",
    '    "risks": ["risk"],',
    '    "successMetrics": ["metric"]',
    "  },",
    '  "fallbackPlan": {',
    '    "summary": "text",',
    '    "workflows": [],',
    '    "risks": [],',
    '    "successMetrics": []',
    "  },",
    '  "permissions": [',
    "    {",
    '      "area": "scope area",',
    '      "requestedFromRole": "ADMIN/FOUNDER/EMPLOYEE",',
    '      "reason": "why permission required",',
    '      "workflowTitle": "workflow title",',
    '      "taskTitle": "task title"',
    "    }",
    "  ]",
    "}",
    "",
    "Do not include markdown. JSON only."
  ].join("\n");

  const runtime = await getOrgLlmRuntime(orgId);
  const execution = await executeSwarmAgent({
    taskId: `direction-plan-${randomUUID().slice(0, 8)}`,
    flowId: "direction-plan",
    prompt: direction,
    agent:
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
    contextBlocks: companyContext
      ? [
          {
            id: "company-data",
            name: "Company Data",
            content: companyContext,
            amnesiaProtected: false
          }
        ]
      : [],
    organizationRuntime: runtime,
    ...(provider || model
      ? {
          modelPreference: {
            ...(provider ? { provider } : {}),
            ...(model ? { model } : {})
          }
        }
      : {}),
    systemPromptOverride: [
      `You are the Main Agent planner for organization ${org.name}.`,
      "Produce complete, auditable implementation plans with realistic dependency and approval mapping."
    ].join("\n"),
    userPromptOverride: modelPrompt
  });

  if (!execution.ok || !execution.outputText) {
    return NextResponse.json(
      {
        ok: false,
        message: execution.error ?? "Failed generating plans."
      },
      { status: 502 }
    );
  }

  const parsed = parseModelPlan(execution.outputText, direction);
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
        message: `Direction plans generated by ${access.actor.email}. direction=${directionRecord.id}, plan=${planRecord.id}, permissionRequests=${permissionRequests.length}.`
      }
    });

    return {
      directionRecord,
      planRecord,
      permissionRequests
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
    directionRecord: persisted.directionRecord,
    planRecord: persisted.planRecord,
    model: {
      provider: execution.usedProvider ?? null,
      name: execution.usedModel ?? null,
      source: execution.apiSource ?? null
    },
    tokenUsage: execution.tokenUsage ?? null,
    billing: execution.billing ?? null
  });
}
