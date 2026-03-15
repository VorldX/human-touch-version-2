export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import {
  type CalendarActorFilter,
  type CalendarScope,
  type CalendarTemporalFilter,
  createManualCalendarEvent,
  listCalendarTimelineEvents
} from "@/lib/calendar/calendar-events";
import { requireOrgAccess } from "@/lib/security/org-access";

function parseScope(value: unknown): CalendarScope {
  return value === "USER" ? "USER" : "ORG";
}

function parseActorFilter(value: unknown): CalendarActorFilter {
  if (value === "HUMAN") return "HUMAN";
  if (value === "AI") return "AI";
  return "ALL";
}

function parseTemporalFilter(value: unknown): CalendarTemporalFilter {
  if (value === "PAST") return "PAST";
  if (value === "FUTURE") return "FUTURE";
  return "ALL";
}

interface MonthRange {
  month: string;
  from: string;
  to: string;
}

function resolveMonthRange(rawMonth: string | null): MonthRange {
  const monthMatch = rawMonth?.trim().match(/^(\d{4})-(\d{2})$/);
  if (!monthMatch) {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    return {
      month: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`,
      from: start.toISOString(),
      to: end.toISOString()
    };
  }

  const year = Number(monthMatch[1]);
  const monthIndex = Number(monthMatch[2]) - 1;
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    const fallback = resolveMonthRange(null);
    return fallback;
  }

  const start = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999));
  return {
    month: `${year}-${String(monthIndex + 1).padStart(2, "0")}`,
    from: start.toISOString(),
    to: end.toISOString()
  };
}

function toBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value === "1" || value.toLowerCase() === "true";
  }
  return false;
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

  const access = await requireOrgAccess({ request, orgId, allowInternal: true });
  if (!access.ok) {
    return access.response;
  }

  const scope = parseScope(request.nextUrl.searchParams.get("scope")?.trim().toUpperCase());
  const actor = parseActorFilter(request.nextUrl.searchParams.get("actor")?.trim().toUpperCase());
  const temporal = parseTemporalFilter(
    request.nextUrl.searchParams.get("temporal")?.trim().toUpperCase()
  );
  const liveOnly = toBoolean(request.nextUrl.searchParams.get("live"));
  const monthRange = resolveMonthRange(request.nextUrl.searchParams.get("month"));

  const result = await listCalendarTimelineEvents({
    orgId,
    userId: access.actor.userId,
    scope,
    rangeStart: monthRange.from,
    rangeEnd: monthRange.to,
    actor,
    temporal,
    liveOnly
  });

  return NextResponse.json({
    ok: true,
    month: monthRange.month,
    range: {
      from: monthRange.from,
      to: monthRange.to
    },
    scope,
    actor,
    temporal,
    liveOnly,
    ...result
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        scope?: CalendarScope;
        title?: string;
        detail?: string;
        startsAt?: string;
        endsAt?: string | null;
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

  if (!body?.title?.trim()) {
    return NextResponse.json(
      {
        ok: false,
        message: "title is required."
      },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId, allowInternal: true });
  if (!access.ok) {
    return access.response;
  }

  const created = await createManualCalendarEvent({
    orgId,
    actorUserId: access.actor.userId,
    actorEmail: access.actor.email,
    isInternal: Boolean(access.actor.isInternal),
    scope: parseScope(body.scope),
    title: body.title,
    detail: body.detail,
    startsAt: body.startsAt ?? new Date().toISOString(),
    endsAt: body.endsAt ?? null,
    actorType: body.actorType,
    actorLabel: body.actorLabel,
    tags: body.tags
  });

  return NextResponse.json(
    {
      ok: true,
      event: created
    },
    { status: 201 }
  );
}
