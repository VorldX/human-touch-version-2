export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import {
  completeBlackboardStep,
  createBlackboardSession,
  DnaPhase3HiveGraph,
  listBlackboardSnapshot
} from "@/lib/dna/phase3";
import { requireOrgAccess } from "@/lib/security/org-access";

function parseLimit(value: string | null, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("orgId")?.trim() ?? "";
  if (!orgId) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId query param is required."
      },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId, allowInternal: true });
  if (!access.ok) {
    return access.response;
  }

  const boardId = request.nextUrl.searchParams.get("boardId")?.trim() ?? "";
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"), 30, 120);

  const snapshot = await listBlackboardSnapshot({
    tenantId: orgId,
    userId: access.actor.userId,
    boardId,
    limit
  });

  return NextResponse.json({
    ok: true,
    orgId,
    userId: access.actor.userId,
    ...snapshot
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        pathwayId?: string;
        pathwayName?: string;
        sessionId?: string;
        flowId?: string;
        mainAgentId?: string;
        payload?: Record<string, unknown>;
      }
    | null;

  const orgId = body?.orgId?.trim() ?? "";
  if (!orgId) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId is required."
      },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId, allowInternal: true });
  if (!access.ok) {
    return access.response;
  }

  const sessionId =
    body?.sessionId?.trim() || `phase3-blackboard:${orgId}:${access.actor.userId}:${Date.now()}`;

  const board = await createBlackboardSession({
    tenantId: orgId,
    userId: access.actor.userId,
    sessionId,
    pathwayId: body?.pathwayId,
    pathwayName: body?.pathwayName,
    flowId: body?.flowId,
    mainAgentId: body?.mainAgentId,
    payload: body?.payload
  });

  return NextResponse.json({
    ok: true,
    orgId,
    userId: access.actor.userId,
    board
  });
}

export async function PATCH(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        action?: "claim" | "complete";
        boardId?: string;
        agentId?: string;
        stepId?: number;
        lockToken?: string;
        result?: Record<string, unknown>;
      }
    | null;

  const orgId = body?.orgId?.trim() ?? "";
  if (!orgId || !body?.action) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId and action are required."
      },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId, allowInternal: true });
  if (!access.ok) {
    return access.response;
  }

  const boardId = body.boardId?.trim() ?? "";
  const agentId = body.agentId?.trim() || access.actor.userId;

  if (!boardId) {
    return NextResponse.json(
      {
        ok: false,
        message: "boardId is required."
      },
      { status: 400 }
    );
  }

  if (body.action === "claim") {
    const graph = new DnaPhase3HiveGraph();
    const claim = await graph.run({
      tenantId: orgId,
      userId: access.actor.userId,
      boardId,
      agentId
    });

    return NextResponse.json({
      ok: true,
      orgId,
      userId: access.actor.userId,
      action: "claim",
      ...claim
    });
  }

  const stepId =
    typeof body.stepId === "number" && Number.isFinite(body.stepId)
      ? Math.floor(body.stepId)
      : null;
  const lockToken = body.lockToken?.trim() ?? "";

  if (!stepId || !lockToken) {
    return NextResponse.json(
      {
        ok: false,
        message: "stepId and lockToken are required for complete action."
      },
      { status: 400 }
    );
  }

  const completed = await completeBlackboardStep({
    tenantId: orgId,
    userId: access.actor.userId,
    boardId,
    stepId,
    agentId,
    lockToken,
    result: body.result
  });

  return NextResponse.json({
    ok: true,
    orgId,
    userId: access.actor.userId,
    action: "complete",
    ...completed
  });
}
