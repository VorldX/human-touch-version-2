export const dynamic = "force-dynamic";

import { createHash } from "node:crypto";

import { LogType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { createJoltProofStub } from "@/lib/security/crypto";
import { readLocalUploadByUrl, toPreviewText } from "@/lib/hub/storage";
import { recordPassivePolicy } from "@/lib/enterprise/passive";
import { featureFlags } from "@/lib/config/feature-flags";
import { requireOrgAccess } from "@/lib/security/org-access";

interface RouteContext {
  params: {
    fileId: string;
  };
}

export async function GET(request: NextRequest, context: RouteContext) {
  const fileId = context.params.fileId?.trim();
  const orgId = request.nextUrl.searchParams.get("orgId")?.trim();

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
        message: "File not found for this organization."
      },
      { status: 404 }
    );
  }

  if (file.isAmnesiaProtected) {
    const digest = createHash("sha256")
      .update(`${file.id}|${file.url}|${file.size.toString()}`)
      .digest("hex");

    const proof = await createJoltProofStub({
      taskId: file.id,
      digest,
      policy: "amnesia-zero-retention"
    });

    await prisma.$transaction(async (tx) => {
      await tx.log.create({
        data: {
          orgId,
          type: LogType.SCRUB,
          actor: "AMNESIA_PROTOCOL",
          message: `File ${file.id} read with amnesia wipe. Proof=${proof}`
        }
      });

      if (featureFlags.memoryGovernance) {
        await tx.memoryEntry.create({
          data: {
            orgId,
            tier: "WORKING",
            key: `hub.read.${file.id}`,
            value: {
              fileId: file.id,
              fileName: file.name,
              policy: "amnesia-zero-retention",
              digest
            },
            ttlSeconds: 300,
            expiresAt: new Date(Date.now() + 300_000),
            redactedAt: new Date()
          }
        });
      }

      await recordPassivePolicy(
        {
          orgId,
          subjectType: "FILE_READ",
          subjectId: file.id,
          riskScore: 0.2,
          reason: "Amnesia-protected file read observed in passive mode.",
          meta: {
            amnesia: true,
            proof
          }
        },
        tx
      );
    });

    return NextResponse.json({
      ok: true,
      file: {
        id: file.id,
        name: file.name,
        type: file.type,
        url: file.url,
        isAmnesiaProtected: true
      },
      contentPreview: null,
      amnesiaWiped: true,
      proof
    });
  }

  let contentPreview: string | null = null;
  const bytes = await readLocalUploadByUrl(file.url);
  if (bytes) {
    contentPreview = toPreviewText(bytes);
  }

  await recordPassivePolicy({
    orgId,
    subjectType: "FILE_READ",
    subjectId: file.id,
    riskScore: 0.05,
    reason: "Non-amnesia Hub read observed in passive mode.",
    meta: {
      amnesia: false,
      hasPreview: Boolean(contentPreview)
    }
  });

  return NextResponse.json({
    ok: true,
    file: {
      id: file.id,
      name: file.name,
      type: file.type,
      url: file.url,
      isAmnesiaProtected: false
    },
    contentPreview,
    amnesiaWiped: false
  });
}
