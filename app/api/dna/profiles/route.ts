import { NextRequest, NextResponse } from "next/server";

import { buildDnaProfileFromStorage, listDnaProfiles } from "@/lib/dna/profiles";
import { requireOrgAccess } from "@/lib/security/org-access";

type Scope = "ORGANIZATION" | "EMPLOYEE" | "AGENT";

function parseScope(value: unknown): Scope {
  if (value === "EMPLOYEE") return "EMPLOYEE";
  if (value === "AGENT") return "AGENT";
  return "ORGANIZATION";
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

  const scopeRaw = request.nextUrl.searchParams.get("scope");
  const scope = scopeRaw ? parseScope(scopeRaw) : undefined;
  const profiles = await listDnaProfiles(orgId, scope);

  return NextResponse.json({
    ok: true,
    profiles
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        scope?: Scope;
        targetId?: string | null;
        title?: string;
        sourceAssetIds?: string[];
      }
    | null;

  const orgId = body?.orgId?.trim() ?? "";
  const title = body?.title?.trim() ?? "";
  if (!orgId || !title || !Array.isArray(body?.sourceAssetIds) || body.sourceAssetIds.length === 0) {
    return NextResponse.json(
      { ok: false, message: "orgId, title, and sourceAssetIds are required." },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  const profile = await buildDnaProfileFromStorage({
    orgId,
    scope: parseScope(body?.scope),
    ...(body?.targetId !== undefined ? { targetId: body.targetId } : {}),
    title,
    sourceAssetIds: body.sourceAssetIds
  });

  return NextResponse.json(
    {
      ok: true,
      profile
    },
    { status: 201 }
  );
}
