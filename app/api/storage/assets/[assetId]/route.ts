export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { deleteOrgStorageAsset, updateOrgStorageAsset, type ToolPrincipalType } from "@/lib/storage/org-storage";
import { requireOrgAccess } from "@/lib/security/org-access";

interface RouteContext {
  params: Promise<{
    assetId: string;
  }>;
}

function parseOwnerType(value: unknown): ToolPrincipalType | "ORG" | undefined {
  if (value === "ORG") return "ORG";
  if (value === "OWNER") return "OWNER";
  if (value === "EMPLOYEE") return "EMPLOYEE";
  if (value === "AGENT") return "AGENT";
  return undefined;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { assetId } = await context.params;
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        name?: string;
        namespace?: string;
        ownerType?: ToolPrincipalType | "ORG";
        ownerId?: string | null;
        tags?: string[];
        connectorId?: string | null;
      }
    | null;

  const orgId = body?.orgId?.trim() ?? "";
  if (!orgId || !assetId?.trim()) {
    return NextResponse.json(
      { ok: false, message: "orgId and assetId are required." },
      { status: 400 }
    );
  }
  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  const updated = await updateOrgStorageAsset(orgId, assetId, {
    ...(body?.name !== undefined ? { name: body.name } : {}),
    ...(body?.namespace !== undefined ? { namespace: body.namespace } : {}),
    ...(parseOwnerType(body?.ownerType) ? { ownerType: parseOwnerType(body?.ownerType) } : {}),
    ...(body?.ownerId !== undefined ? { ownerId: body.ownerId } : {}),
    ...(Array.isArray(body?.tags) ? { tags: body.tags } : {}),
    ...(body?.connectorId !== undefined ? { connectorId: body.connectorId } : {})
  });

  if (!updated) {
    return NextResponse.json({ ok: false, message: "Storage asset not found." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    asset: updated
  });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { assetId } = await context.params;
  const orgId =
    request.nextUrl.searchParams.get("orgId")?.trim() ||
    ((await request.json().catch(() => null)) as { orgId?: string } | null)?.orgId?.trim() ||
    "";

  if (!orgId || !assetId?.trim()) {
    return NextResponse.json(
      { ok: false, message: "orgId and assetId are required." },
      { status: 400 }
    );
  }
  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  const deleted = await deleteOrgStorageAsset(orgId, assetId);
  if (!deleted) {
    return NextResponse.json({ ok: false, message: "Storage asset not found." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true
  });
}
