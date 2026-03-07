export const dynamic = "force-dynamic";

import {
  FlowStatus,
  LogType,
  PersonnelStatus,
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
  ensureMainAgentProfile,
  resolveOrgExecutionMode
} from "@/lib/agent/orchestration/runtime";
import { linkFlowToDirection, updateDirection } from "@/lib/direction/directions";
import {
  composioAllowlistedToolkits,
  inferRequestedToolkits
} from "@/lib/integrations/composio/service";
import { publishInngestEvent } from "@/lib/inngest/publish";
import { publishRealtimeEvent } from "@/lib/realtime/publish";
import { buildInternalApiHeaders } from "@/lib/security/internal-api";
import { requireOrgAccess } from "@/lib/security/org-access";

interface LaunchFlowRequest {
  orgId?: string;
  prompt?: string;
  directionId?: string;
  planId?: string;
  fallbackPlanId?: string;
  executionMode?: "ECO" | "BALANCED" | "TURBO";
  swarmDensity?: number;
  predictedBurn?: number;
  requiredSignatures?: number;
  approvalsProvided?: number;
  requestedToolkits?: string[];
}

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

function splitDirectionIntoTasks(direction: string, swarmDensity: number) {
  const normalized = direction.replace(/\r\n/g, "\n").trim();
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

function buildTaskPlan(prompt: string, swarmDensity: number) {
  const executionSteps = splitDirectionIntoTasks(prompt, swarmDensity);
  const mission = compactText(prompt);
  const missionToolkits = inferRequestedToolkits(mission);
  const planStep = `Main Agent planning phase: break this mission into ordered subtasks, dependencies, and required toolkit access before execution. Mission: ${mission} | ${formatToolkitMarker(missionToolkits)}`;

  return [
    planStep,
    ...executionSteps.map((step, index) => {
      const stepToolkits = [...new Set([...missionToolkits, ...inferRequestedToolkits(step)])];
      return `Execution step ${index + 1}: ${step} | ${formatToolkitMarker(stepToolkits)}`;
    })
  ];
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
  const approvalsProvided = asPositiveInt(body.approvalsProvided);
  const providedRequestedToolkits = parseRequestedToolkits(body.requestedToolkits);

  if (!orgId || !prompt || !swarmDensity || !predictedBurn || !requiredSignatures) {
    return NextResponse.json(
      {
        ok: false,
        message: "Missing required mission launch fields."
      },
      { status: 400 }
    );
  }

  if (!approvalsProvided || approvalsProvided < requiredSignatures) {
    return NextResponse.json(
      {
        ok: false,
        message: `Insufficient signatures. Required: ${requiredSignatures}, received: ${approvalsProvided ?? 0}.`
      },
      { status: 412 }
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
    const orgExecutionMode = await resolveOrgExecutionMode(orgId);

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
    const taskPrompts = buildTaskPlan(prompt, swarmDensity);
    const promptInferredToolkits = inferRequestedToolkits(prompt);
    const subTaskInferredToolkits = taskPrompts.flatMap((step) => inferRequestedToolkits(step));
    const requestedToolkits = [
      ...new Set([
        ...providedRequestedToolkits,
        ...promptInferredToolkits,
        ...subTaskInferredToolkits
      ])
    ];

    const runawaySignal = detectRunawaySignal(predictedBurn, org.monthlyBtuCap);

    const initiatedByUserId = access.actor.userId;

    const flow = await prisma.$transaction(async (tx) => {
      const created = await tx.flow.create({
        data: {
          orgId,
          prompt,
          status: FlowStatus.QUEUED,
          progress: 0,
          predictedBurn,
          requiredSignatures
        }
      });

      for (let index = 0; index < taskPrompts.length; index += 1) {
        const stepPrompt = taskPrompts[index];
        const specialtyHints = inferTaskSpecialtyHints(stepPrompt);
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
        const assignedAgent =
          index === 0
            ? mainAgent
            : (specialistCandidate && specialistCandidate.score > 0
                ? specialistCandidate.agent
                : assignmentPool.length > 0
                  ? assignmentPool[index % assignmentPool.length]
                  : null);
        const taskRequestedToolkits = [
          ...new Set([...requestedToolkits, ...inferRequestedToolkits(stepPrompt)])
        ];
        // eslint-disable-next-line no-await-in-loop
        await tx.task.create({
          data: {
            flowId: created.id,
            agentId: assignedAgent?.id ?? null,
            prompt: stepPrompt,
            status: TaskStatus.QUEUED,
            requiredFiles: [],
            isPausedForInput: false,
            executionTrace: {
              requestedToolkits: taskRequestedToolkits,
              initiatedByUserId,
              orchestrator: {
                mode: fallbackToMainOnly ? "MAIN_AGENT_ONLY" : "MULTI_AGENT",
                stage: index === 0 ? "PLANNING" : "EXECUTION",
                stepIndex: index + 1,
                totalSteps: taskPrompts.length
              }
            }
          }
        });
      }

      await tx.log.create({
        data: {
          orgId,
          type: LogType.EXE,
          actor: "CONTROL_DECK",
          message: `Flow ${created.id} queued. Burn=${predictedBurn}, signatures=${requiredSignatures}, tasks=${taskPrompts.length}, mode=${fallbackToMainOnly ? "MAIN_AGENT_ONLY" : "MULTI_AGENT"}.`
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
            swarmDensity,
            taskCount: taskPrompts.length,
            requestedToolkits,
            initiatedByUserId,
            executionMode: fallbackToMainOnly ? "MAIN_AGENT_ONLY" : "MULTI_AGENT"
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
            taskCount: taskPrompts.length,
            requestedToolkits,
            initiatedByUserId,
            executionMode: fallbackToMainOnly ? "MAIN_AGENT_ONLY" : "MULTI_AGENT"
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

    const publish = await publishInngestEvent("vorldx/flow.launched", {
      flowId: flow.id,
      orgId,
      prompt,
      swarmDensity,
      predictedBurn,
      requiredSignatures,
      taskCount: taskPrompts.length,
      requestedToolkits,
      initiatedByUserId,
      executionMode: fallbackToMainOnly ? "MAIN_AGENT_ONLY" : "MULTI_AGENT",
      orgExecutionMode
    });

    let localKickWarning: string | undefined;
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
              taskCount: taskPrompts.length,
              requestedToolkits,
              initiatedByUserId,
              executionMode: fallbackToMainOnly ? "MAIN_AGENT_ONLY" : "MULTI_AGENT",
              orgExecutionMode
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

    await publishRealtimeEvent({
      orgId,
      event: "flow.created",
      payload: {
        flowId: flow.id,
        status: flow.status,
        predictedBurn: flow.predictedBurn,
        requiredSignatures: flow.requiredSignatures,
        approvalsProvided
      }
    });

    await publishRealtimeEvent({
      orgId,
      event: "signature.updated",
      payload: {
        flowId: flow.id,
        requiredSignatures: flow.requiredSignatures,
        approvalsProvided
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
          ...(directionId ? { directionId } : {}),
          ...(planId ? { planId } : {}),
          ...(fallbackPlanId ? { fallbackPlanId } : {}),
          taskCount: taskPrompts.length,
          executionMode: fallbackToMainOnly ? "MAIN_AGENT_ONLY" : "MULTI_AGENT",
          orgExecutionMode
        },
        warning: [publish.ok ? undefined : publish.message, localKickWarning]
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
