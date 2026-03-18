export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { processRlhfDiff } from "@/lib/dna/phase2";
import { requireOrgAccess } from "@/lib/security/org-access";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        sessionId?: string;
        originalOutput?: string;
        editedOutput?: string;
        ruleScope?: "PERSONAL" | "GLOBAL";
      }
    | null;

  const orgId = body?.orgId?.trim() ?? "";
  const originalOutput = body?.originalOutput?.trim() ?? "";
  const editedOutput = body?.editedOutput?.trim() ?? "";
  const ruleScope = body?.ruleScope === "GLOBAL" ? "GLOBAL" : "PERSONAL";

  if (!orgId || !originalOutput || !editedOutput) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId, originalOutput, and editedOutput are required."
      },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId, allowInternal: true });
  if (!access.ok) {
    return access.response;
  }

  const result = await processRlhfDiff({
    tenantId: orgId,
    userId: access.actor.userId,
    sessionId: body?.sessionId?.trim() || null,
    originalOutput,
    editedOutput,
    ruleScope
  });

  return NextResponse.json({
    ok: true,
    orgId,
    userId: access.actor.userId,
    ruleScope,
    ...result
  });
}
