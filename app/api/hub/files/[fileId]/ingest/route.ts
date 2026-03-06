export const dynamic = "force-dynamic";

import { HubFileType, LogType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { publishInngestEvent } from "@/lib/inngest/publish";
import { requireOrgAccess } from "@/lib/security/org-access";

interface RouteContext {
  params: {
    fileId: string;
  };
}

export async function POST(request: NextRequest, context: RouteContext) {
  const fileId = context.params.fileId?.trim();
  const body = (await request.json().catch(() => null)) as { orgId?: string } | null;
  const orgId = body?.orgId?.trim() ?? "";

  if (!fileId || !orgId) {
    return NextResponse.json(
      {
        ok: false,
        message: "fileId and orgId are required."
      },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  const file = await prisma.file.findUnique({
    where: { id: fileId }
  });

  if (!file || file.orgId !== orgId) {
    return NextResponse.json(
      {
        ok: false,
        message: "DNA file not found for this organization."
      },
      { status: 404 }
    );
  }

  if (file.type !== HubFileType.DNA) {
    return NextResponse.json(
      {
        ok: false,
        message: "Only DNA files support embedding ingestion."
      },
      { status: 409 }
    );
  }

  const metadata =
    file.metadata && typeof file.metadata === "object"
      ? (file.metadata as Record<string, unknown>)
      : {};

  await prisma.file.update({
    where: { id: fileId },
    data: {
      metadata: {
        ...metadata,
        ingestStatus: "queued",
        ingestRequestedAt: new Date().toISOString()
      }
    }
  });

  await prisma.log.create({
    data: {
      orgId,
      type: LogType.DNA,
      actor: "HUB",
      message: `DNA ingestion requested for file ${fileId}.`
    }
  });

  const publish = await publishInngestEvent("vorldx/dna.ingest", {
    orgId,
    fileId
  });

  return NextResponse.json({
    ok: publish.ok,
    message: publish.ok ? "DNA ingestion event queued." : "DNA ingestion publish failed.",
    warning: publish.ok ? undefined : publish.message
  });
}
