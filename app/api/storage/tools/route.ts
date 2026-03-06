export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import {
  deleteStorageToolGrant,
  listStorageConnectors,
  listStorageToolGrants,
  upsertStorageToolGrant,
  type ToolName,
  type ToolPrincipalType
} from "@/lib/storage/org-storage";
import { requireOrgAccess } from "@/lib/security/org-access";

function parseTool(value: unknown): ToolName {
  if (value === "GOOGLE_DRIVE") return "GOOGLE_DRIVE";
  if (value === "S3_COMPATIBLE") return "S3_COMPATIBLE";
  return "MANAGED_VAULT";
}

function parsePrincipalType(value: unknown): ToolPrincipalType {
  if (value === "OWNER") return "OWNER";
  if (value === "AGENT") return "AGENT";
  return "EMPLOYEE";
}

export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("orgId")?.trim();
  if (!orgId) {
    return NextResponse.json({ ok: false, message: "orgId query param is required." }, { status: 400 });
  }
  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  const [connectors, grants] = await Promise.all([
    listStorageConnectors(orgId),
    listStorageToolGrants(orgId)
  ]);

  return NextResponse.json({
    ok: true,
    tools: [
      {
        key: "MANAGED_VAULT",
        label: "Managed Vault",
        description: "Built-in organization storage pool for files and DNA sources.",
        enabled: true
      },
      {
        key: "GOOGLE_DRIVE",
        label: "Google Drive",
        description: "External connector for organization-owned Google Drive storage.",
        enabled: connectors.some((item) => item.provider === "GOOGLE_DRIVE" && item.status === "CONNECTED")
      },
      {
        key: "S3_COMPATIBLE",
        label: "S3 Compatible",
        description: "Bring your own object storage using S3-compatible APIs.",
        enabled: connectors.some((item) => item.provider === "S3_COMPATIBLE" && item.status === "CONNECTED")
      }
    ],
    connectors,
    grants
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        tool?: ToolName;
        principalType?: ToolPrincipalType;
        principalId?: string;
        capabilities?: string[];
      }
    | null;

  const orgId = body?.orgId?.trim() ?? "";
  const principalId = body?.principalId?.trim() ?? "";
  if (!orgId || !principalId) {
    return NextResponse.json(
      { ok: false, message: "orgId and principalId are required." },
      { status: 400 }
    );
  }
  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  const grant = await upsertStorageToolGrant({
    orgId,
    tool: parseTool(body?.tool),
    principalType: parsePrincipalType(body?.principalType),
    principalId,
    ...(Array.isArray(body?.capabilities) ? { capabilities: body.capabilities } : {})
  });

  return NextResponse.json(
    {
      ok: true,
      grant
    },
    { status: 201 }
  );
}

export async function DELETE(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        grantId?: string;
      }
    | null;
  const orgId = request.nextUrl.searchParams.get("orgId")?.trim() || body?.orgId?.trim() || "";
  const grantId =
    request.nextUrl.searchParams.get("grantId")?.trim() || body?.grantId?.trim() || "";

  if (!orgId || !grantId) {
    return NextResponse.json(
      { ok: false, message: "orgId and grantId are required." },
      { status: 400 }
    );
  }
  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  const deleted = await deleteStorageToolGrant(orgId, grantId);
  if (!deleted) {
    return NextResponse.json({ ok: false, message: "Grant not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
