import { LogType, WebhookEventType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";

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

async function resolveOrgId(request: NextRequest) {
  const urlOrgId = request.nextUrl.searchParams.get("orgId")?.trim();
  if (urlOrgId) {
    return urlOrgId;
  }
  const body = (await request.json().catch(() => null)) as { orgId?: string } | null;
  return body?.orgId?.trim() ?? "";
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ webhookId: string }> }
) {
  const { webhookId } = await context.params;
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        targetUrl?: string;
        eventType?: string;
        isActive?: boolean;
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

  const current = await prisma.webhook.findUnique({
    where: { id: webhookId }
  });
  if (!current || current.orgId !== orgId) {
    return NextResponse.json(
      {
        ok: false,
        message: "Webhook not found for this organization."
      },
      { status: 404 }
    );
  }

  const eventType = body?.eventType ? parseEventType(body.eventType) : undefined;
  if (body?.eventType && !eventType) {
    return NextResponse.json(
      {
        ok: false,
        message: "Invalid eventType."
      },
      { status: 400 }
    );
  }

  const targetUrl = body?.targetUrl?.trim();
  if (targetUrl && !isValidHttpUrl(targetUrl)) {
    return NextResponse.json(
      {
        ok: false,
        message: "targetUrl must be a valid http(s) URL."
      },
      { status: 400 }
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const webhook = await tx.webhook.update({
      where: { id: webhookId },
      data: {
        ...(targetUrl ? { targetUrl } : {}),
        ...(eventType ? { eventType } : {}),
        ...(typeof body?.isActive === "boolean" ? { isActive: body.isActive } : {})
      }
    });

    await tx.log.create({
      data: {
        orgId,
        type: LogType.USER,
        actor: "SETTINGS",
        message: `Webhook ${webhook.id} updated.`
      }
    });

    return webhook;
  });

  return NextResponse.json({ ok: true, webhook: updated });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ webhookId: string }> }
) {
  const { webhookId } = await context.params;
  const orgId = await resolveOrgId(request);

  if (!orgId) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId is required."
      },
      { status: 400 }
    );
  }

  const current = await prisma.webhook.findUnique({
    where: { id: webhookId }
  });
  if (!current || current.orgId !== orgId) {
    return NextResponse.json(
      {
        ok: false,
        message: "Webhook not found for this organization."
      },
      { status: 404 }
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.webhook.delete({
      where: { id: webhookId }
    });

    await tx.log.create({
      data: {
        orgId,
        type: LogType.USER,
        actor: "SETTINGS",
        message: `Webhook ${webhookId} removed.`
      }
    });
  });

  return NextResponse.json({ ok: true });
}
