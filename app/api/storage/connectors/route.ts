export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import {
  createStorageConnector,
  listStorageConnectors,
  type StorageProvider
} from "@/lib/storage/org-storage";
import { requireOrgAccess } from "@/lib/security/org-access";

function parseProvider(value: unknown): Exclude<StorageProvider, "MANAGED"> | null {
  if (value === "GOOGLE_DRIVE") return "GOOGLE_DRIVE";
  if (value === "S3_COMPATIBLE") return "S3_COMPATIBLE";
  return null;
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

  const connectors = await listStorageConnectors(orgId);
  return NextResponse.json({
    ok: true,
    connectors
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        name?: string;
        provider?: Exclude<StorageProvider, "MANAGED">;
        createdByUserId?: string | null;
        createdByEmail?: string | null;
        accountHint?: string | null;
        settings?: Record<string, unknown>;
        credential?: string | null;
      }
    | null;

  const orgId = body?.orgId?.trim() ?? "";
  const name = body?.name?.trim() ?? "";
  const provider = parseProvider(body?.provider);
  if (!orgId || !name || !provider) {
    return NextResponse.json(
      { ok: false, message: "orgId, name, and provider are required." },
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

  const connector = await createStorageConnector({
    orgId,
    name,
    provider,
    ...(body?.createdByUserId !== undefined ? { createdByUserId: body.createdByUserId } : {}),
    ...(body?.createdByEmail !== undefined ? { createdByEmail: body.createdByEmail } : {}),
    ...(body?.accountHint !== undefined ? { accountHint: body.accountHint } : {}),
    ...(body?.settings ? { settings: body.settings } : {}),
    ...(body?.credential !== undefined ? { credential: body.credential } : {})
  });

  return NextResponse.json(
    {
      ok: true,
      connector
    },
    { status: 201 }
  );
}
