export const dynamic = "force-dynamic";

import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { executeSwarmAgent } from "@/lib/ai/swarm-runtime";
import { getOrgLlmRuntime } from "@/lib/ai/org-llm-settings";
import { runAgentEngine, type AgentRunResponse } from "@/lib/agent/run/engine";
import { executeAgentTool } from "@/lib/agent/tools/execute";
import { buildEmailWriterPrompt, parseEmailWriterOutput } from "@/lib/agent/prompts/emailWriter";
import {
  buildGmailPlannerPrompt,
  parseGmailPlannerOutput,
  type GmailPlannerOutput
} from "@/lib/agent/prompts/gmailPlanner";
import { prisma } from "@/lib/db/prisma";

type RunBody = {
  prompt?: string;
  input?: Record<string, unknown>;
  confirm?: boolean;
  orgId?: string;
} | null;

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

const plannerAgentSelect = {
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
} as const;

async function resolveLlmAgent(orgId: string) {
  const selected =
    (await prisma.personnel.findFirst({
      where: {
        orgId,
        type: "AI",
        role: { contains: "Main", mode: "insensitive" },
        status: { not: "DISABLED" }
      },
      select: plannerAgentSelect
    })) ??
    (await prisma.personnel.findFirst({
      where: {
        orgId,
        type: "AI",
        role: { contains: "Boss", mode: "insensitive" },
        status: { not: "DISABLED" }
      },
      select: plannerAgentSelect
    })) ??
    (await prisma.personnel.findFirst({
      where: {
        orgId,
        type: "AI",
        status: { not: "DISABLED" }
      },
      orderBy: { updatedAt: "desc" },
      select: plannerAgentSelect
    }));

  if (selected) {
    return selected;
  }

  return {
    id: "agent-run-proxy",
    name: "Main Agent",
    role: "Gmail Planner",
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
  };
}

async function runJsonTask(input: {
  orgId: string;
  taskKind: "planner" | "writer";
  systemPrompt: string;
  userPrompt: string;
}) {
  const organizationRuntime = await getOrgLlmRuntime(input.orgId);
  const agent = await resolveLlmAgent(input.orgId);
  const execution = await executeSwarmAgent({
    taskId: `agent-run-${input.taskKind}-${randomUUID().slice(0, 8)}`,
    flowId: "agent-run",
    prompt: input.userPrompt,
    agent,
    contextBlocks: [],
    organizationRuntime,
    systemPromptOverride: input.systemPrompt,
    userPromptOverride: input.userPrompt
  });

  if (!execution.ok || !execution.outputText?.trim()) {
    throw new Error(execution.error || `LLM ${input.taskKind} call failed.`);
  }

  return execution.outputText.trim();
}

async function resolveRunActor(request: NextRequest, body: RunBody) {
  const sessionUserId = request.headers.get("x-user-id")?.trim() || "";
  const userEmail = request.headers.get("x-user-email")?.trim().toLowerCase() || "";

  if (!sessionUserId || !userEmail) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          status: "error",
          assistant_message: "Authentication headers are required.",
          error: {
            code: "UNAUTHENTICATED",
            message: "x-user-id and x-user-email headers are required."
          }
        },
        { status: 401 }
      )
    };
  }

  const bodyInput = asRecord(body?.input);
  const requestedOrgId =
    asText(request.nextUrl.searchParams.get("orgId")) ||
    asText(body?.orgId) ||
    asText(bodyInput.orgId);

  const user = await prisma.user.findFirst({
    where: {
      id: sessionUserId,
      email: userEmail
    },
    select: {
      id: true,
      email: true,
      activeOrgId: true,
      orgMemberships: {
        select: {
          orgId: true
        }
      }
    }
  });

  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          status: "error",
          assistant_message: "You do not have access to this organization.",
          error: {
            code: "FORBIDDEN",
            message: "User not found."
          }
        },
        { status: 403 }
      )
    };
  }

  const membershipOrgIds = new Set(user.orgMemberships.map((item) => item.orgId));
  let orgId = "";
  if (requestedOrgId && membershipOrgIds.has(requestedOrgId)) {
    orgId = requestedOrgId;
  } else if (user.activeOrgId && membershipOrgIds.has(user.activeOrgId)) {
    orgId = user.activeOrgId;
  } else if (user.orgMemberships[0]?.orgId) {
    orgId = user.orgMemberships[0].orgId;
  }

  if (!orgId) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          status: "error",
          assistant_message: "You do not have access to this organization.",
          error: {
            code: "FORBIDDEN",
            message: "No organization membership found."
          }
        },
        { status: 403 }
      )
    };
  }

  return {
    ok: true as const,
    actor: {
      orgId,
      userId: user.id,
      userEmail: user.email,
      sessionUserId
    }
  };
}

function statusCodeForResponse(response: AgentRunResponse) {
  if (response.status !== "error") return 200;
  if (response.error?.code === "INVALID_REQUEST") return 400;
  if (response.error?.code === "UNAUTHENTICATED") return 401;
  if (response.error?.code === "FORBIDDEN") return 403;
  if (response.error?.code === "INTEGRATION_NOT_CONNECTED") return 409;
  if (response.error?.code === "INVALID_TOOL_ACTION") return 400;
  return 502;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as RunBody;
    const actorResult = await resolveRunActor(request, body);
    if (!actorResult.ok) {
      return actorResult.response;
    }

    const prompt = asText(body?.prompt);
    const providedInput = asRecord(body?.input);
    const confirm = body?.confirm === true;

    const response = await runAgentEngine(
      {
        prompt,
        input: providedInput,
        confirm
      },
      {
        plan: async ({ prompt: rawPrompt, providedInput: rawInput }) => {
          const prompts = buildGmailPlannerPrompt({
            prompt: rawPrompt,
            providedInput: rawInput
          });
          const raw = await runJsonTask({
            orgId: actorResult.actor.orgId,
            taskKind: "planner",
            systemPrompt: prompts.systemPrompt,
            userPrompt: prompts.userPrompt
          });
          const parsed = parseGmailPlannerOutput(raw);
          if (!parsed) {
            throw new Error("Planner produced invalid JSON.");
          }
          return parsed as GmailPlannerOutput;
        },
        writeEmail: async ({ prompt: rawPrompt, recipientEmail, recipientName, extraContext }) => {
          const prompts = buildEmailWriterPrompt({
            userPrompt: rawPrompt,
            recipientEmail,
            ...(recipientName ? { recipientName } : {}),
            ...(extraContext ? { extraContext } : {})
          });
          const raw = await runJsonTask({
            orgId: actorResult.actor.orgId,
            taskKind: "writer",
            systemPrompt: prompts.systemPrompt,
            userPrompt: prompts.userPrompt
          });
          const parsed = parseEmailWriterOutput(raw);
          if (!parsed) {
            throw new Error("Email writer produced invalid JSON.");
          }
          return parsed;
        },
        executeGmailAction: async ({ action, arguments: actionArgs }) => {
          return executeAgentTool({
            orgId: actorResult.actor.orgId,
            userId: actorResult.actor.userId,
            toolkit: "gmail",
            action,
            arguments: actionArgs
          });
        },
        logAction: async ({ type, meta }) => {
          await prisma.log.create({
            data: {
              orgId: actorResult.actor.orgId,
              type: "EXE",
              actor: "AGENT_RUN",
              message: `type=${type}; meta=${JSON.stringify(meta ?? {})}`
            }
          });
        }
      }
    );

    return NextResponse.json(response, { status: statusCodeForResponse(response) });
  } catch (error) {
    console.error("[api/agent/run][POST] unexpected error", error);
    return NextResponse.json(
      {
        status: "error",
        assistant_message: "Main Agent run failed.",
        error: {
          code: "INTERNAL_ERROR",
          message: "Unexpected server error during agent run."
        }
      },
      { status: 500 }
    );
  }
}
