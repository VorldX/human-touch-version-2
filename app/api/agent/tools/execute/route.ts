export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { executeAgentTool } from "@/lib/agent/tools/execute";
import { resolveIntegrationActor } from "@/lib/integrations/composio/request-context";
import { resolveInternalApiKey } from "@/lib/security/internal-api";

type ExecuteBody = {
  orgId?: string;
  userId?: string;
  userEmail?: string;
  toolkit?: string;
  action?: string;
  arguments?: Record<string, unknown>;
  taskId?: string;
} | null;

function internalAgentKey() {
  return resolveInternalApiKey();
}

function matchesInternalAgentKey(request: NextRequest) {
  const expected = internalAgentKey();
  if (!expected) {
    return false;
  }
  const incoming = request.headers.get("x-agent-exec-key")?.trim() || "";
  return incoming.length > 0 && incoming === expected;
}

function statusFromErrorCode(code: string) {
  if (code === "INVALID_TOOL_ACTION") return 400;
  if (code === "INTEGRATION_NOT_CONNECTED") return 409;
  if (code === "TOOLS_UNAVAILABLE") return 503;
  return 502;
}

async function resolveActorForExecution(request: NextRequest, body: ExecuteBody) {
  if (matchesInternalAgentKey(request)) {
    const orgId = body?.orgId?.trim() ?? "";
    const userId = body?.userId?.trim() ?? "";
    if (!orgId || !userId) {
      return {
        ok: false as const,
        response: NextResponse.json(
          {
            ok: false,
            message: "orgId and userId are required for internal tool execution."
          },
          { status: 400 }
        )
      };
    }

    const membership = await prisma.orgMember.findFirst({
      where: {
        orgId,
        userId
      },
      select: {
        orgId: true,
        userId: true
      }
    });

    if (!membership) {
      return {
        ok: false as const,
        response: NextResponse.json(
          {
            ok: false,
            message: "User does not belong to this organization."
          },
          { status: 403 }
        )
      };
    }

    return {
      ok: true as const,
      actor: {
        orgId: membership.orgId,
        userId: membership.userId
      }
    };
  }

  const actorResult = await resolveIntegrationActor({
    request,
    body: {
      orgId: body?.orgId,
      userEmail: body?.userEmail,
      userId: body?.userId
    }
  });
  if (!actorResult.ok) {
    return {
      ok: false as const,
      response: actorResult.response
    };
  }

  return {
    ok: true as const,
    actor: {
      orgId: actorResult.actor.orgId,
      userId: actorResult.actor.userId
    }
  };
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as ExecuteBody;
  const toolkit = body?.toolkit?.trim().toLowerCase() ?? "";
  const action = body?.action?.trim().toUpperCase() ?? "";
  if (!toolkit || !action) {
    return NextResponse.json(
      {
        ok: false,
        message: "toolkit and action are required."
      },
      { status: 400 }
    );
  }

  const actorResult = await resolveActorForExecution(request, body);
  if (!actorResult.ok) {
    return actorResult.response;
  }

  const result = await executeAgentTool({
    orgId: actorResult.actor.orgId,
    userId: actorResult.actor.userId,
    toolkit,
    action,
    arguments:
      body?.arguments && typeof body.arguments === "object" && !Array.isArray(body.arguments)
        ? body.arguments
        : {},
    ...(body?.taskId?.trim() ? { taskId: body.taskId.trim() } : {})
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
        attempts: result.attempts
      },
      { status: statusFromErrorCode(result.error.code) }
    );
  }

  return NextResponse.json({
    ok: true,
    result
  });
}
