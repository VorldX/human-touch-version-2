import "server-only";

import { HubFileType, LogType } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { buildDnaProfileFromStorage } from "@/lib/dna/profiles";
import { ensureCompanyDataFile } from "@/lib/hub/organization-hub";
import { publishInngestEvent } from "@/lib/inngest/publish";

const ORG_DNA_BOOTSTRAP_FILE_NAME = "Organization DNA Bootstrap";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function bootstrapOrganizationDnaContext(orgId: string) {
  const nowIso = new Date().toISOString();
  const companyData = await ensureCompanyDataFile(orgId);

  const existingBootstrap = await prisma.file.findFirst({
    where: {
      orgId,
      type: HubFileType.DNA,
      name: ORG_DNA_BOOTSTRAP_FILE_NAME
    },
    orderBy: { updatedAt: "desc" }
  });

  const baseMetadata = {
    seededBy: "onboarding",
    sourceFileId: companyData.file.id,
    sourceFileName: companyData.file.name,
    rawText: companyData.content.slice(0, 12000),
    ingestStatus: "queued",
    bootstrapUpdatedAt: nowIso
  };

  const dnaFile = existingBootstrap
    ? await prisma.file.update({
        where: { id: existingBootstrap.id },
        data: {
          size: BigInt(Buffer.byteLength(companyData.content, "utf8")),
          metadata: {
            ...asRecord(existingBootstrap.metadata),
            ...baseMetadata
          }
        }
      })
    : await prisma.file.create({
        data: {
          orgId,
          name: ORG_DNA_BOOTSTRAP_FILE_NAME,
          type: HubFileType.DNA,
          size: BigInt(Buffer.byteLength(companyData.content, "utf8")),
          url: `memory://org/${orgId}/dna/bootstrap`,
          health: 100,
          isAmnesiaProtected: false,
          metadata: baseMetadata
        }
      });

  const profile = await buildDnaProfileFromStorage({
    orgId,
    scope: "ORGANIZATION",
    title: "Organization DNA",
    sourceAssetIds: [companyData.file.id, dnaFile.id]
  }).catch(() => null);

  const publish = await publishInngestEvent("vorldx/dna.ingest", {
    orgId,
    fileId: dnaFile.id
  });

  await prisma.log.create({
    data: {
      orgId,
      type: publish.ok ? LogType.DNA : LogType.NET,
      actor: "DNA_BOOTSTRAP",
      message: publish.ok
        ? `Organization DNA bootstrap queued ingestion for file ${dnaFile.id}.`
        : `Organization DNA bootstrap created file ${dnaFile.id} but ingest publish failed: ${publish.message ?? "unknown error"}.`
    }
  });

  if (!publish.ok) {
    await prisma.file.update({
      where: { id: dnaFile.id },
      data: {
        metadata: {
          ...asRecord(dnaFile.metadata),
          ingestStatus: "publish_failed",
          ingestPublishError: publish.message ?? "unknown error"
        }
      }
    });
  }

  return {
    fileId: dnaFile.id,
    profileId: profile?.id ?? null,
    queued: publish.ok
  };
}
