import { LogType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import {
  getOrgCreditsWallet,
  upsertOrgCreditsWallet
} from "@/lib/billing/org-credits";
import { requireOrgAccess } from "@/lib/security/org-access";

function toPositiveNumber(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  if (value <= 0) {
    return null;
  }
  return Number(value.toFixed(4));
}

function toNonNegativeNumber(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  if (value < 0) {
    return null;
  }
  return Number(value.toFixed(4));
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

  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  const wallet = await getOrgCreditsWallet(orgId);
  return NextResponse.json({
    ok: true,
    wallet
  });
}

export async function PUT(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        rechargeCredits?: number;
        lowBalanceThreshold?: number;
        autoRechargeEnabled?: boolean;
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

  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  const rechargeCredits =
    body?.rechargeCredits === undefined ? undefined : toPositiveNumber(body.rechargeCredits);
  if (body?.rechargeCredits !== undefined && rechargeCredits === null) {
    return NextResponse.json(
      {
        ok: false,
        message: "rechargeCredits must be a positive number."
      },
      { status: 400 }
    );
  }

  const lowBalanceThreshold =
    body?.lowBalanceThreshold === undefined
      ? undefined
      : toNonNegativeNumber(body.lowBalanceThreshold);
  if (body?.lowBalanceThreshold !== undefined && lowBalanceThreshold === null) {
    return NextResponse.json(
      {
        ok: false,
        message: "lowBalanceThreshold must be a non-negative number."
      },
      { status: 400 }
    );
  }

  const hasAnyUpdate =
    rechargeCredits != null ||
    lowBalanceThreshold != null ||
    typeof body?.autoRechargeEnabled === "boolean";
  if (!hasAnyUpdate) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Provide at least one update field: rechargeCredits, lowBalanceThreshold, or autoRechargeEnabled."
      },
      { status: 400 }
    );
  }

  const wallet = await prisma.$transaction(async (tx) => {
    const next = await upsertOrgCreditsWallet(
      {
        orgId,
        ...(rechargeCredits != null ? { rechargeCredits } : {}),
        ...(lowBalanceThreshold != null ? { lowBalanceThreshold } : {}),
        ...(typeof body?.autoRechargeEnabled === "boolean"
          ? { autoRechargeEnabled: body.autoRechargeEnabled }
          : {})
      },
      tx
    );

    const logParts = [
      rechargeCredits != null ? `recharge=${rechargeCredits}` : null,
      lowBalanceThreshold != null ? `threshold=${lowBalanceThreshold}` : null,
      typeof body?.autoRechargeEnabled === "boolean"
        ? `autoRecharge=${body.autoRechargeEnabled}`
        : null
    ].filter((value): value is string => Boolean(value));

    await tx.log.create({
      data: {
        orgId,
        type: LogType.USER,
        actor: "SETTINGS",
        message: `Org credits wallet updated by ${access.actor.email}. ${logParts.join(", ")}`
      }
    });

    return next;
  });

  return NextResponse.json({
    ok: true,
    wallet
  });
}
