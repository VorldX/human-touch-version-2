export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { deleteStorageConnector, getStorageConnector, updateStorageConnector, type ConnectorStatus } from "@/lib/storage/org-storage";
import { requireOrgAccess } from "@/lib/security/org-access";

interface RouteContext {
  params: Promise<{
    connectorId: string;
  }>;
}

function parseStatus(value: unknown): ConnectorStatus | undefined {
  if (value === "CONNECTED" || value === "PENDING" || value === "ERROR" || value === "DISCONNECTED") {
    return value;
  }
  return undefined;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { connectorId } = await context.params;
  const orgId = request.nextUrl.searchParams.get("orgId")?.trim();
  if (!orgId || !connectorId?.trim()) {
    return NextResponse.json(
      { ok: false, message: "orgId and connectorId are required." },
      { status: 400 }
    );
  }
  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  const connector = await getStorageConnector(orgId, connectorId);
  if (!connector) {
    return NextResponse.json({ ok: false, message: "Connector not found." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    connector
  });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { connectorId } = await context.params;
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        name?: string;
        status?: ConnectorStatus;
        accountHint?: string | null;
        settings?: Record<string, unknown>;
        credential?: string | null;
        lastSyncAt?: string;
      }
    | null;

  const orgId = body?.orgId?.trim() ?? "";
  if (!orgId || !connectorId?.trim()) {
    return NextResponse.json(
      { ok: false, message: "orgId and connectorId are required." },
      { status: 400 }
    );
  }
  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  const updated = await updateStorageConnector(orgId, connectorId, {
    ...(body?.name !== undefined ? { name: body.name } : {}),
    ...(parseStatus(body?.status) ? { status: parseStatus(body?.status) } : {}),
    ...(body?.accountHint !== undefined ? { accountHint: body.accountHint } : {}),
    ...(body?.settings !== undefined ? { settings: body.settings } : {}),
    ...(body?.credential !== undefined ? { credential: body.credential } : {}),
    ...(body?.lastSyncAt !== undefined ? { lastSyncAt: body.lastSyncAt } : {})
  });

  if (!updated) {
    return NextResponse.json({ ok: false, message: "Connector not found." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    connector: updated
  });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { connectorId } = await context.params;
  const orgId =
    request.nextUrl.searchParams.get("orgId")?.trim() ||
    ((await request.json().catch(() => null)) as { orgId?: string } | null)?.orgId?.trim() ||
    "";

  if (!orgId || !connectorId?.trim()) {
    return NextResponse.json(
      { ok: false, message: "orgId and connectorId are required." },
      { status: 400 }
    );
  }
  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  const deleted = await deleteStorageConnector(orgId, connectorId);
  if (!deleted) {
    return NextResponse.json({ ok: false, message: "Connector not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
