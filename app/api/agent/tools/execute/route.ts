export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { executeAgentTool } from "@/lib/agent/tools/execute";
import { featureFlags } from "@/lib/config/feature-flags";
import { resolveIntegrationActor } from "@/lib/integrations/composio/request-context";
import { hashIdempotencyRequest, withIdempotency } from "@/lib/migration/idempotency";
import { resolveInternalApiKey } from "@/lib/security/internal-api";
import { executeToolViaGateway } from "@/lib/tools/tool-gateway";

type ExecuteBody = {
  orgId?: string;
  userId?: string;
  userEmail?: string;
  toolkit?: string;
  action?: string;
  arguments?: Record<string, unknown>;
  taskId?: string;
  agentId?: string;
  runId?: string;
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

  const safeArgs =
    body?.arguments && typeof body.arguments === "object" && !Array.isArray(body.arguments)
      ? body.arguments
      : {};
  const safeTaskId = body?.taskId?.trim() || undefined;
  const safeAgentId = body?.agentId?.trim() || undefined;
  const safeRunId = body?.runId?.trim() || undefined;

  const execute = async (): Promise<{ code: number; body: Record<string, unknown> }> => {
    const gatewayResult = featureFlags.useToolGateway
      ? await executeToolViaGateway({
          orgId: actorResult.actor.orgId,
          userId: actorResult.actor.userId,
          toolkit,
          action,
          arguments: safeArgs,
          ...(safeTaskId ? { taskId: safeTaskId } : {}),
          ...(safeAgentId ? { agentId: safeAgentId } : {}),
          ...(safeRunId ? { runId: safeRunId } : {})
        })
      : null;

    const result =
      gatewayResult?.result ??
      (await executeAgentTool({
        orgId: actorResult.actor.orgId,
        userId: actorResult.actor.userId,
        toolkit,
        action,
        arguments: safeArgs,
        ...(safeTaskId ? { taskId: safeTaskId } : {})
      }));

    if (!result.ok) {
      return {
        code: statusFromErrorCode(result.error.code),
        body: {
          ok: false,
          error: result.error,
          attempts: result.attempts,
          ...(gatewayResult?.receiptId ? { receiptId: gatewayResult.receiptId } : {})
        }
      };
    }

    return {
      code: 200,
      body: {
        ok: true,
        result,
        ...(gatewayResult?.receiptId ? { receiptId: gatewayResult.receiptId } : {})
      }
    };
  };

  const idempotencyKey = request.headers.get("x-idempotency-key")?.trim() || "";
  if (idempotencyKey) {
    const replay = await withIdempotency({
      orgId: actorResult.actor.orgId,
      scope: "TOOL_EXECUTE",
      key: idempotencyKey,
      requestHash: hashIdempotencyRequest({
        orgId: actorResult.actor.orgId,
        userId: actorResult.actor.userId,
        toolkit,
        action,
        arguments: safeArgs,
        taskId: safeTaskId,
        agentId: safeAgentId,
        runId: safeRunId
      }),
      execute
    });

    return NextResponse.json(replay.body, { status: replay.code });
  }

  const live = await execute();
  return NextResponse.json(live.body, { status: live.code });
}
