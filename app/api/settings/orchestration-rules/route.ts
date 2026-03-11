export const dynamic = "force-dynamic";

import { LogType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import {
  getOrgOrchestrationPipelineSettings,
  resolveOrchestrationPipelineEffectivePolicy,
  upsertOrgOrchestrationPipelineSettings,
  type OrchestrationPipelineMode,
  type OrchestrationPipelineRule,
  type OrchestrationPipelineRuleType
} from "@/lib/agent/orchestration/pipeline-policy";
import { prisma } from "@/lib/db/prisma";
import { requireOrgAccess } from "@/lib/security/org-access";

function normalizeMode(value: unknown): OrchestrationPipelineMode | null {
  if (value === "OFF") return "OFF";
  if (value === "AUDIT") return "AUDIT";
  if (value === "ENFORCE") return "ENFORCE";
  return null;
}

function normalizeRuleType(value: unknown): OrchestrationPipelineRuleType | null {
  if (value === "REQUIRE_PLAN_BEFORE_EXECUTION") return "REQUIRE_PLAN_BEFORE_EXECUTION";
  if (value === "REQUIRE_PLAN_WORKFLOWS") return "REQUIRE_PLAN_WORKFLOWS";
  if (value === "BLOCK_DIRECT_WORKFLOW_LAUNCH") return "BLOCK_DIRECT_WORKFLOW_LAUNCH";
  if (value === "FREEZE_EXECUTION_TO_APPROVED_PLAN") return "FREEZE_EXECUTION_TO_APPROVED_PLAN";
  if (value === "REQUIRE_DETAILED_PLAN") return "REQUIRE_DETAILED_PLAN";
  if (value === "REQUIRE_MULTI_WORKFLOW_DECOMPOSITION") {
    return "REQUIRE_MULTI_WORKFLOW_DECOMPOSITION";
  }
  if (value === "ENFORCE_SPECIALIST_TOOL_ASSIGNMENT") {
    return "ENFORCE_SPECIALIST_TOOL_ASSIGNMENT";
  }
  return null;
}

function asRules(value: unknown): OrchestrationPipelineRule[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const parsed: OrchestrationPipelineRule[] = [];
  for (const row of value.slice(0, 64)) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      continue;
    }
    const record = row as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const type = normalizeRuleType(typeof record.type === "string" ? record.type.trim() : "");
    const enabled = typeof record.enabled === "boolean" ? record.enabled : true;
    const priority =
      typeof record.priority === "number" && Number.isFinite(record.priority)
        ? Math.max(1, Math.min(999, Math.floor(record.priority)))
        : (parsed.length + 1) * 10;

    if (!type) {
      continue;
    }

    parsed.push({
      id: id || `rule-${type.toLowerCase()}-${parsed.length + 1}`,
      name: name || type,
      type,
      enabled,
      priority
    });
  }
  return parsed;
}

export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("orgId")?.trim();
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

  const settings = await getOrgOrchestrationPipelineSettings(orgId);
  const effectivePolicy = resolveOrchestrationPipelineEffectivePolicy(settings);
  return NextResponse.json({
    ok: true,
    settings,
    effectivePolicy
  });
}

export async function PUT(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        mode?: OrchestrationPipelineMode;
        rules?: OrchestrationPipelineRule[];
      }
    | null;

  const orgId = typeof body?.orgId === "string" ? body.orgId.trim() : "";
  const mode = normalizeMode(body?.mode);
  const rules = asRules(body?.rules);

  if (!orgId || !mode || rules === null) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId, mode, and rules are required."
      },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  const result = await prisma.$transaction(async (tx) => {
    const updated = await upsertOrgOrchestrationPipelineSettings(
      {
        orgId,
        mode,
        rules
      },
      tx
    );

    await tx.log.create({
      data: {
        orgId,
        type: LogType.USER,
        actor: "SETTINGS",
        message: `Orchestration pipeline settings updated. mode=${updated.settings.mode}; rules=${updated.settings.rules.length}.`
      }
    });

    return updated.settings;
  });

  return NextResponse.json({
    ok: true,
    settings: result,
    effectivePolicy: resolveOrchestrationPipelineEffectivePolicy(result)
  });
}
