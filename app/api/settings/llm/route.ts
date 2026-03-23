export const dynamic = "force-dynamic";

import { LogType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import {
  defaultServiceMarkupForPlan,
  getOrgLlmSettings,
  upsertOrgLlmSettings,
  type OrgLlmMode,
  type OrgServicePlan
} from "@/lib/ai/org-llm-settings";
import { requireOrgAccess } from "@/lib/security/org-access";

function normalizeMode(value: unknown): OrgLlmMode | null {
  if (value === "BYOK") return "BYOK";
  if (value === "PLATFORM_MANAGED") return "PLATFORM_MANAGED";
  return null;
}

function normalizePlan(value: unknown): OrgServicePlan | null {
  if (value === "STARTER") return "STARTER";
  if (value === "GROWTH") return "GROWTH";
  if (value === "ENTERPRISE") return "ENTERPRISE";
  return null;
}

function normalizeExecutionMode(value: unknown): "ECO" | "BALANCED" | "TURBO" | null {
  if (value === "ECO") return "ECO";
  if (value === "BALANCED") return "BALANCED";
  if (value === "TURBO") return "TURBO";
  return null;
}

function toTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asStringRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const output: Record<string, string> = {};
  for (const [key, current] of Object.entries(value)) {
    if (typeof current === "string") {
      output[key] = current;
    }
  }
  return output;
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
  if (!access.actor.isAdmin) {
    return NextResponse.json(
      {
        ok: false,
        message: "Only founders and admins can change organization LLM settings."
      },
      { status: 403 }
    );
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      executionMode: true
    }
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

  const settings = await getOrgLlmSettings(orgId);
  return NextResponse.json({
    ok: true,
    settings,
    executionMode: org.executionMode
  });
}

export async function PUT(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        mode?: OrgLlmMode;
        provider?: string;
        model?: string;
        fallbackProvider?: string;
        fallbackModel?: string;
        servicePlan?: OrgServicePlan;
        serviceMarkupPct?: number;
        organizationApiKey?: string;
        providerApiKeys?: Record<string, string>;
        executionMode?: "ECO" | "BALANCED" | "TURBO";
      }
    | null;

  const orgId = toTrimmedString(body?.orgId);
  const mode = normalizeMode(body?.mode);
  const provider = toTrimmedString(body?.provider);
  const model = toTrimmedString(body?.model);
  const fallbackProvider = toTrimmedString(body?.fallbackProvider);
  const fallbackModel = toTrimmedString(body?.fallbackModel);
  const servicePlan = normalizePlan(body?.servicePlan);
  const providerApiKeys = asStringRecord(body?.providerApiKeys);
  const executionMode = normalizeExecutionMode(body?.executionMode);

  if (!orgId || !mode || !provider || !model || !fallbackProvider || !fallbackModel || !servicePlan) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "orgId, mode, provider, model, fallbackProvider, fallbackModel, and servicePlan are required."
      },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      executionMode: true
    }
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

  const current = await getOrgLlmSettings(orgId);
  const incomingKey = body?.organizationApiKey?.trim();
  const hasIncomingProviderKey =
    providerApiKeys !== null &&
    Object.values(providerApiKeys).some((value) => value.trim().length > 0);
  const hasIncomingLegacyKey = typeof incomingKey === "string" && incomingKey.length > 0;
  if (mode === "BYOK" && !current.hasOrganizationApiKey && !hasIncomingLegacyKey && !hasIncomingProviderKey) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "At least one provider API key is required when mode is BYOK (organizationApiKey or providerApiKeys)."
      },
      { status: 400 }
    );
  }

  const markup =
    typeof body?.serviceMarkupPct === "number" && Number.isFinite(body.serviceMarkupPct)
      ? body.serviceMarkupPct
      : defaultServiceMarkupForPlan(servicePlan);

  const result = await prisma.$transaction(async (tx) => {
    if (executionMode) {
      await tx.organization.update({
        where: { id: orgId },
        data: {
          executionMode
        }
      });
    }

    const updated = await upsertOrgLlmSettings(
      {
        orgId,
        mode,
        provider,
        model,
        fallbackProvider,
        fallbackModel,
        servicePlan,
        serviceMarkupPct: markup,
        ...(body?.organizationApiKey !== undefined
          ? { organizationApiKey: body.organizationApiKey }
          : {}),
        ...(providerApiKeys !== null ? { providerApiKeys } : {})
      },
      tx
    );

    await tx.log.create({
      data: {
        orgId,
        type: LogType.USER,
        actor: "SETTINGS",
        message: `Organization LLM settings updated. mode=${mode}, executionMode=${executionMode ?? "unchanged"}, plan=${servicePlan}, provider=${provider}, model=${model}.`
      }
    });

    return updated;
  });

  return NextResponse.json({
    ok: true,
    settings: result.settings,
    executionMode: executionMode ?? org.executionMode
  });
}
