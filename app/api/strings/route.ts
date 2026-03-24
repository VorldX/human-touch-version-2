export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import type { ChatMessage } from "@/components/chat-ui/types";
import { listStrings, saveString } from "@/lib/strings/store";
import { requireOrgAccess } from "@/lib/security/org-access";

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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

  try {
    const strings = await listStrings(orgId, access.actor.userId);
    return NextResponse.json({
      ok: true,
      strings
    });
  } catch (error) {
    console.error("[api/strings][GET] unexpected error", error);
    return NextResponse.json(
      {
        ok: false,
        message: "Failed to load strings."
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
      | {
        orgId?: string;
        id?: string;
        title?: string;
        mode?: "discussion" | "direction";
        updatedAt?: string;
        createdAt?: string;
        directionId?: string | null;
        planId?: string | null;
        selectedTeamId?: string | null;
        selectedTeamLabel?: string | null;
        source?: "workspace" | "direction" | "plan";
        workspaceState?: Record<string, unknown> | null;
        messages?: unknown;
      }
    | null;

  const orgId = asText(body?.orgId);
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

  try {
    const record = await saveString(orgId, access.actor.userId, {
      id: body?.id,
      title: body?.title,
      mode: body?.mode,
      updatedAt: body?.updatedAt,
      createdAt: body?.createdAt,
      directionId: body?.directionId,
      planId: body?.planId,
      selectedTeamId: body?.selectedTeamId,
      selectedTeamLabel: body?.selectedTeamLabel,
      source: body?.source,
      workspaceState:
        body?.workspaceState &&
        typeof body.workspaceState === "object" &&
        !Array.isArray(body.workspaceState)
          ? body.workspaceState
          : undefined,
      messages: Array.isArray(body?.messages) ? (body.messages as ChatMessage[]) : undefined
    });

    return NextResponse.json({
      ok: true,
      string: record
    });
  } catch (error) {
    console.error("[api/strings][POST] unexpected error", error);
    return NextResponse.json(
      {
        ok: false,
        message: "Failed to save string."
      },
      { status: 500 }
    );
  }
}
