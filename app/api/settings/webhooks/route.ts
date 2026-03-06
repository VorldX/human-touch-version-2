export const dynamic = "force-dynamic";

import { LogType, WebhookEventType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { requireOrgAccess } from "@/lib/security/org-access";

function parseEventType(value: string | undefined): WebhookEventType | null {
  if (!value) return null;
  if (value === "FLOW_PAUSED") return WebhookEventType.FLOW_PAUSED;
  if (value === "FLOW_COMPLETED") return WebhookEventType.FLOW_COMPLETED;
  if (value === "FLOW_ABORTED") return WebhookEventType.FLOW_ABORTED;
  if (value === "TASK_UPDATED") return WebhookEventType.TASK_UPDATED;
  if (value === "HUMAN_TOUCH_REQUIRED") return WebhookEventType.HUMAN_TOUCH_REQUIRED;
  if (value === "KILL_SWITCH") return WebhookEventType.KILL_SWITCH;
  return null;
}

function isValidHttpUrl(input: string) {
  try {
    const url = new URL(input);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
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

  const webhooks = await prisma.webhook.findMany({
    where: { orgId },
    orderBy: { updatedAt: "desc" }
  });

  return NextResponse.json({
    ok: true,
    webhooks
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        targetUrl?: string;
        eventType?: string;
        isActive?: boolean;
      }
    | null;

  const orgId = body?.orgId?.trim() ?? "";
  const targetUrl = body?.targetUrl?.trim() ?? "";
  const eventType = parseEventType(body?.eventType);
  const isActive = body?.isActive ?? true;

  if (!orgId || !targetUrl || !eventType) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId, targetUrl, and eventType are required."
      },
      { status: 400 }
    );
  }
  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  if (!isValidHttpUrl(targetUrl)) {
    return NextResponse.json(
      {
        ok: false,
        message: "targetUrl must be a valid http(s) URL."
      },
      { status: 400 }
    );
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true }
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

  const webhook = await prisma.$transaction(async (tx) => {
    const created = await tx.webhook.create({
      data: {
        orgId,
        targetUrl,
        eventType,
        isActive: Boolean(isActive)
      }
    });

    await tx.log.create({
      data: {
        orgId,
        type: LogType.USER,
        actor: "SETTINGS",
        message: `Webhook ${created.id} registered for ${created.eventType}.`
      }
    });

    return created;
  });

  return NextResponse.json({ ok: true, webhook }, { status: 201 });
}
