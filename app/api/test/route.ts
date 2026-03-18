export const dynamic = "force-dynamic";

import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { emitAgentRunEvent } from "@/src/api/agent-run";

interface TestRunBody {
  orgId?: string;
  prompt?: string;
  workflowId?: string;
  requestId?: string;
}

export async function POST(request: NextRequest) {
  let body: TestRunBody = {};
  try {
    body = (await request.json()) as TestRunBody;
  } catch {
    body = {};
  }

  const orgId = body.orgId?.trim() || "dev-org";
  const prompt = body.prompt?.trim() || "Smoke test from /api/test";
  const workflowId = body.workflowId?.trim() || `test_${randomUUID().slice(0, 10)}`;
  const requestId = body.requestId?.trim() || randomUUID();

  try {
    const payload = await emitAgentRunEvent({
      orgId,
      prompt,
      workflowId,
      requestId
    });

    return NextResponse.json(
      {
        ok: true,
        message: "agent/run emitted",
        payload
      },
      { status: 202 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Unable to emit agent/run"
      },
      { status: 500 }
    );
  }
}
