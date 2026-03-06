export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import {
  ensureCompanyDataFile,
  getOrganizationalInputDocuments,
  getOrganizationalOutputFiles,
  updateCompanyDataFile
} from "@/lib/hub/organization-hub";
import { requireOrgAccess } from "@/lib/security/org-access";

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

  try {
    const company = await ensureCompanyDataFile(orgId);
    const outputs = await getOrganizationalOutputFiles(orgId);
    const documents = await getOrganizationalInputDocuments(orgId);
    return NextResponse.json({
      ok: true,
      input: {
        id: company.file.id,
        name: company.file.name,
        size: company.file.size.toString(),
        updatedAt: company.file.updatedAt,
        content: company.content
      },
      documents,
      output: outputs
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Failed to load organizational hub."
      },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        content?: string;
      }
    | null;

  const orgId = body?.orgId?.trim() ?? "";
  const content = body?.content ?? "";

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

  if (typeof content !== "string" || content.trim().length === 0) {
    return NextResponse.json(
      {
        ok: false,
        message: "content is required."
      },
      { status: 400 }
    );
  }

  try {
    const updated = await updateCompanyDataFile(orgId, content);
    return NextResponse.json({
      ok: true,
      input: {
        id: updated.id,
        name: updated.name,
        size: updated.size.toString(),
        updatedAt: updated.updatedAt
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Failed to update Company Data."
      },
      { status: 500 }
    );
  }
}
