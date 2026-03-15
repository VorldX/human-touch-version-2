export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import {
  deleteManualCalendarEvent,
  updateManualCalendarEvent
} from "@/lib/calendar/calendar-events";
import { requireOrgAccess } from "@/lib/security/org-access";

interface RouteContext {
  params: {
    eventId: string;
  };
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const eventId = context.params.eventId?.trim();
  if (!eventId) {
    return NextResponse.json(
      {
        ok: false,
        message: "eventId is required."
      },
      { status: 400 }
    );
  }

  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        title?: string;
        detail?: string;
        startsAt?: string;
        endsAt?: string | null;
        scope?: "ORG" | "USER";
        actorType?: "HUMAN" | "AI";
        actorLabel?: string;
        tags?: string[];
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

  const updated = await updateManualCalendarEvent({
    orgId,
    eventId,
    actorUserId: access.actor.userId,
    isInternal: Boolean(access.actor.isInternal),
    patch: {
      title: body?.title,
      detail: body?.detail,
      startsAt: body?.startsAt,
      endsAt: body?.endsAt,
      scope: body?.scope,
      actorType: body?.actorType,
      actorLabel: body?.actorLabel,
      tags: body?.tags
    }
  });

  if (updated.status === "NOT_FOUND") {
    return NextResponse.json(
      {
        ok: false,
        message: "Calendar event not found."
      },
      { status: 404 }
    );
  }

  if (updated.status === "FORBIDDEN") {
    return NextResponse.json(
      {
        ok: false,
        message: "You do not have permission to edit this calendar event."
      },
      { status: 403 }
    );
  }

  if (updated.status !== "UPDATED") {
    return NextResponse.json(
      {
        ok: false,
        message: "Unable to update calendar event."
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    event: updated.event
  });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const eventId = context.params.eventId?.trim();
  if (!eventId) {
    return NextResponse.json(
      {
        ok: false,
        message: "eventId is required."
      },
      { status: 400 }
    );
  }

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

  const deleted = await deleteManualCalendarEvent({
    orgId,
    eventId,
    actorUserId: access.actor.userId,
    isInternal: Boolean(access.actor.isInternal)
  });

  if (deleted === "NOT_FOUND") {
    return NextResponse.json(
      {
        ok: false,
        message: "Calendar event not found."
      },
      { status: 404 }
    );
  }

  if (deleted === "FORBIDDEN") {
    return NextResponse.json(
      {
        ok: false,
        message: "You do not have permission to delete this calendar event."
      },
      { status: 403 }
    );
  }

  return NextResponse.json({
    ok: true
  });
}
