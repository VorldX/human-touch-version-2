export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import type { ChatMessage } from "@/components/chat-ui/types";
import { deleteString, getString, saveString } from "@/lib/strings/store";
import { requireOrgAccess } from "@/lib/security/org-access";

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ stringId: string }> }
) {
  const { stringId } = await context.params;
  const orgId = request.nextUrl.searchParams.get("orgId")?.trim() ?? "";

  if (!orgId || !stringId) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId and stringId are required."
      },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  try {
    const record = await getString(orgId, access.actor.userId, stringId);
    if (!record) {
      return NextResponse.json(
        {
          ok: false,
          message: "String not found."
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      string: record
    });
  } catch (error) {
    console.error("[api/strings/[stringId]][GET] unexpected error", error);
    return NextResponse.json(
      {
        ok: false,
        message: "Failed to load string."
      },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ stringId: string }> }
) {
  const { stringId } = await context.params;
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        title?: string;
        mode?: "discussion" | "direction";
        updatedAt?: string;
        createdAt?: string;
        directionId?: string | null;
        planId?: string | null;
        selectedTeamId?: string | null;
        selectedTeamLabel?: string | null;
        source?: "workspace" | "direction" | "plan";
        messages?: unknown;
      }
    | null;

  const orgId = asText(body?.orgId);
  if (!orgId || !stringId) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId and stringId are required."
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
      id: stringId,
      title: body?.title,
      mode: body?.mode,
      updatedAt: body?.updatedAt,
      createdAt: body?.createdAt,
      directionId: body?.directionId,
      planId: body?.planId,
      selectedTeamId: body?.selectedTeamId,
      selectedTeamLabel: body?.selectedTeamLabel,
      source: body?.source,
      messages: Array.isArray(body?.messages) ? (body.messages as ChatMessage[]) : undefined
    });

    return NextResponse.json({
      ok: true,
      string: record
    });
  } catch (error) {
    console.error("[api/strings/[stringId]][PATCH] unexpected error", error);
    return NextResponse.json(
      {
        ok: false,
        message: "Failed to update string."
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ stringId: string }> }
) {
  const { stringId } = await context.params;
  const orgId = request.nextUrl.searchParams.get("orgId")?.trim() ?? "";

  if (!orgId || !stringId) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId and stringId are required."
      },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  try {
    const deleted = await deleteString(orgId, access.actor.userId, stringId);
    if (!deleted) {
      return NextResponse.json(
        {
          ok: false,
          message: "String not found."
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true
    });
  } catch (error) {
    console.error("[api/strings/[stringId]][DELETE] unexpected error", error);
    return NextResponse.json(
      {
        ok: false,
        message: "Failed to delete string."
      },
      { status: 500 }
    );
  }
}
