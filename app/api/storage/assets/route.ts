export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { createOrgStorageAsset, listOrgStorageAssets, type StorageProvider } from "@/lib/storage/org-storage";
import { requireOrgAccess } from "@/lib/security/org-access";

type OwnerType = "ORG" | "OWNER" | "EMPLOYEE" | "AGENT";

function parseOwnerType(value: unknown): OwnerType {
  if (value === "OWNER") return "OWNER";
  if (value === "EMPLOYEE") return "EMPLOYEE";
  if (value === "AGENT") return "AGENT";
  return "ORG";
}

function parseProvider(value: unknown): StorageProvider {
  if (value === "GOOGLE_DRIVE") return "GOOGLE_DRIVE";
  if (value === "S3_COMPATIBLE") return "S3_COMPATIBLE";
  return "MANAGED";
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

  const namespace = request.nextUrl.searchParams.get("namespace")?.trim();
  const ownerId = request.nextUrl.searchParams.get("ownerId")?.trim();
  const ownerTypeRaw = request.nextUrl.searchParams.get("ownerType");
  const ownerType = ownerTypeRaw ? parseOwnerType(ownerTypeRaw) : undefined;
  const assets = await listOrgStorageAssets(orgId, {
    ...(namespace ? { namespace } : {}),
    ...(ownerId ? { ownerId } : {}),
    ...(ownerType ? { ownerType } : {})
  });

  return NextResponse.json({
    ok: true,
    assets
  });
}

export async function POST(request: NextRequest) {
  let orgId = "";
  let name = "";
  let namespace = "";
  let ownerType: OwnerType = "ORG";
  let ownerId = "";
  let provider: StorageProvider = "MANAGED";
  let connectorId = "";
  let sourceUrl = "";
  let asDna = false;
  let tags: string[] = [];
  let file: File | null = null;

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    orgId = String(formData.get("orgId") ?? "").trim();
    name = String(formData.get("name") ?? "").trim();
    namespace = String(formData.get("namespace") ?? "").trim();
    ownerType = parseOwnerType(formData.get("ownerType"));
    ownerId = String(formData.get("ownerId") ?? "").trim();
    provider = parseProvider(formData.get("provider"));
    connectorId = String(formData.get("connectorId") ?? "").trim();
    sourceUrl = String(formData.get("sourceUrl") ?? "").trim();
    asDna = String(formData.get("asDna") ?? "").trim().toLowerCase() === "true";
    const rawTags = String(formData.get("tags") ?? "").trim();
    tags = rawTags ? rawTags.split(",").map((item) => item.trim()).filter(Boolean) : [];
    const candidate = formData.get("file");
    if (candidate instanceof File) {
      file = candidate;
    }
  } else {
    const body = (await request.json().catch(() => null)) as
      | {
          orgId?: string;
          name?: string;
          namespace?: string;
          ownerType?: OwnerType;
          ownerId?: string;
          provider?: StorageProvider;
          connectorId?: string;
          sourceUrl?: string;
          asDna?: boolean;
          tags?: string[];
        }
      | null;

    orgId = body?.orgId?.trim() ?? "";
    name = body?.name?.trim() ?? "";
    namespace = body?.namespace?.trim() ?? "";
    ownerType = parseOwnerType(body?.ownerType);
    ownerId = body?.ownerId?.trim() ?? "";
    provider = parseProvider(body?.provider);
    connectorId = body?.connectorId?.trim() ?? "";
    sourceUrl = body?.sourceUrl?.trim() ?? "";
    asDna = Boolean(body?.asDna);
    tags = Array.isArray(body?.tags)
      ? body.tags.filter((item) => typeof item === "string")
      : [];
  }

  if (!orgId || !name) {
    return NextResponse.json(
      { ok: false, message: "orgId and name are required." },
      { status: 400 }
    );
  }
  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true }
  });
  if (!org) {
    return NextResponse.json({ ok: false, message: "Organization not found." }, { status: 404 });
  }

  try {
    const asset = await createOrgStorageAsset({
      orgId,
      name,
      ...(namespace ? { namespace } : {}),
      ownerType,
      ...(ownerId ? { ownerId } : {}),
      provider,
      ...(connectorId ? { connectorId } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
      tags,
      ...(file ? { file } : {}),
      asDna
    });

    return NextResponse.json(
      {
        ok: true,
        asset
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Unable to create storage asset."
      },
      { status: 400 }
    );
  }
}
