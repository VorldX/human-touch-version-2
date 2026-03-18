export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { emitAgentRunEvent } from "@/src/api/agent-run";
import { requireOrgAccess } from "@/lib/security/org-access";

interface OrchestratorRunBody {
  orgId?: string;
  prompt?: string;
  workflowId?: string;
  requestId?: string;
  context?: Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  let body: OrchestratorRunBody;
  try {
    body = (await request.json()) as OrchestratorRunBody;
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message: "Invalid JSON payload."
      },
      { status: 400 }
    );
  }

  const orgId = body.orgId?.trim() ?? "";
  const prompt = body.prompt?.trim() ?? "";
  if (!orgId || !prompt) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId and prompt are required."
      },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({
    request,
    orgId,
    allowInternal: true
  });
  if (!access.ok) {
    return access.response;
  }

  try {
    const payload = await emitAgentRunEvent({
      orgId,
      prompt,
      workflowId: body.workflowId?.trim() || undefined,
      requestId: body.requestId?.trim() || undefined,
      initiatedByUserId: access.actor.userId,
      context: body.context
    });

    return NextResponse.json(
      {
        ok: true,
        message: "Workflow accepted and queued in Inngest.",
        workflowId: payload.workflowId,
        requestId: payload.requestId
      },
      { status: 202 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Unable to queue orchestrator workflow."
      },
      { status: 503 }
    );
  }
}

