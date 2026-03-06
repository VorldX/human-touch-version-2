import { randomUUID } from "node:crypto";

import { LogType, PersonnelStatus, PersonnelType } from "@prisma/client";
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

function normalizeToolkitName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

function collectPlanToolkits(plan: ExecutionPlan) {
  const unique = new Set<string>();
  for (const workflow of plan.workflows) {
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
      "Produce complete, auditable implementation plans with realistic dependency and approval mapping.",
      "Do not fabricate capabilities, tool availability, approvals, or execution outcomes.",
      "When required information is missing, mark explicit assumptions and risk notes."
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
      const existingRoleSet = new Set(
        existingAiRoles.map((item) => item.role.trim().toLowerCase()).filter(Boolean)
      );

      for (const template of autoSquadInference.templates) {
        const roleKey = template.role.trim().toLowerCase();
        if (!roleKey || existingRoleSet.has(roleKey)) {
          continue;
        }

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
        existingRoleSet.add(roleKey);
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
      autoSquad: persisted.autoSquadResult,
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
