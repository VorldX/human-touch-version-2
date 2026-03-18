export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { publishDnaUpdateEvent, upsertWorkingRuleWithCollision } from "@/lib/dna/phase3";
import { requireOrgAccess } from "@/lib/security/org-access";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        ruleId?: string;
        content?: string;
        overridesRuleId?: string;
        metadata?: Record<string, unknown>;
      }
    | null;

  const orgId = body?.orgId?.trim() ?? "";
  const ruleId = body?.ruleId?.trim() ?? "";
  const content = body?.content?.trim() ?? "";

  if (!orgId || !ruleId || !content) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId, ruleId, and content are required."
      },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId, allowInternal: true });
  if (!access.ok) {
    return access.response;
  }

  const result = await upsertWorkingRuleWithCollision({
    tenantId: orgId,
    userId: access.actor.userId,
    ruleId,
    content,
    overridesRuleId: body?.overridesRuleId,
    metadata: body?.metadata
  });

  const update = await publishDnaUpdateEvent({
    tenantId: orgId,
    userId: access.actor.userId,
    payload: {
      source: "phase3.rule-collision",
      rule_id: result.ruleId,
      memory_id: result.memoryId,
      deprecated_rule_memory_id: result.deprecatedRuleMemoryId,
      created: result.created
    }
  });

  return NextResponse.json({
    ok: true,
    orgId,
    userId: access.actor.userId,
    rule: result,
    update
  });
}
