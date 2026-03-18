import "server-only";

import { randomUUID } from "node:crypto";

import { MemoryTier, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { readLocalUploadByUrl, toPreviewText } from "@/lib/hub/storage";

type DnaScope = "ORGANIZATION" | "EMPLOYEE" | "AGENT";

interface DnaProfileRecord {
  id: string;
  orgId: string;
  scope: DnaScope;
  targetId: string | null;
  title: string;
  summary: string;
  coreTraits: string[];
  sourceAssetIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface BuildDnaProfileInput {
  orgId: string;
  scope: DnaScope;
  targetId?: string | null;
  title: string;
  sourceAssetIds: string[];
}

const DNA_PROFILE_PREFIX = "dna.profile.";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function parseScope(value: unknown): DnaScope {
  if (value === "EMPLOYEE") return "EMPLOYEE";
  if (value === "AGENT") return "AGENT";
  return "ORGANIZATION";
}

function parseTraits(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function profileKey(scope: DnaScope, targetId?: string | null) {
  const subject = targetId?.trim() || "root";
  return `${DNA_PROFILE_PREFIX}${scope.toLowerCase()}.${subject}`;
}

function parseDnaProfile(orgId: string, value: unknown): DnaProfileRecord {
  const record = asRecord(value);
  const now = new Date().toISOString();
  return {
    id: typeof record.id === "string" ? record.id : randomUUID(),
    orgId,
    scope: parseScope(record.scope),
    targetId: typeof record.targetId === "string" ? record.targetId : null,
    title:
      typeof record.title === "string" && record.title.trim().length > 0
        ? record.title.trim()
        : "DNA Profile",
    summary: typeof record.summary === "string" ? record.summary : "",
    coreTraits: parseTraits(record.coreTraits),
    sourceAssetIds: parseTraits(record.sourceAssetIds),
    createdAt: typeof record.createdAt === "string" ? record.createdAt : now,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : now
  };
}

function extractTraits(rawText: string) {
  const keywords = [
    "vision",
    "goal",
    "identity",
    "quality",
    "trust",
    "compliance",
    "speed",
    "efficiency",
    "customer",
    "security",
    "culture",
    "collaboration",
    "innovation",
    "responsibility"
  ];
  const lower = rawText.toLowerCase();
  return keywords.filter((item) => lower.includes(item)).slice(0, 8);
}

function summarizeText(chunks: string[]) {
  const text = chunks.join("\n").replace(/\s+/g, " ").trim();
  if (!text) {
    return {
      summary: "No readable source data was available for DNA synthesis.",
      coreTraits: [] as string[]
    };
  }

  const summary = text.slice(0, 1200);
  const coreTraits = extractTraits(text);

  return {
    summary,
    coreTraits
  };
}

async function readAssetText(url: string) {
  const local = await readLocalUploadByUrl(url);
  if (local) {
    return toPreviewText(local, 2000);
  }
  if (/^https?:\/\//.test(url)) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) return "";
      return (await response.text()).slice(0, 2000);
    } catch {
      return "";
    }
  }
  return "";
}

export async function listDnaProfiles(orgId: string, scope?: DnaScope) {
  const rows = await prisma.memoryEntry.findMany({
    where: {
      orgId,
      tier: MemoryTier.ORG,
      key: {
        startsWith: DNA_PROFILE_PREFIX
      },
      redactedAt: null
    },
    orderBy: { updatedAt: "desc" },
    take: 300
  });

  const profiles = rows.map((row) => parseDnaProfile(orgId, row.value));
  if (!scope) return profiles;
  return profiles.filter((item) => item.scope === scope);
}

export async function buildDnaProfileFromStorage(input: BuildDnaProfileInput) {
  const assets = await prisma.file.findMany({
    where: {
      orgId: input.orgId,
      id: { in: input.sourceAssetIds }
    },
    select: {
      id: true,
      url: true,
      metadata: true
    }
  });

  const chunks: string[] = [];
  for (const asset of assets) {
    // Intentional sequential read for predictable ordering.
    // eslint-disable-next-line no-await-in-loop
    const metadata = asRecord(asset.metadata);
    const metadataContent =
      typeof metadata.content === "string"
        ? metadata.content
        : typeof metadata.rawText === "string"
          ? metadata.rawText
          : "";
    const text = metadataContent || (await readAssetText(asset.url));
    if (text) {
      chunks.push(text);
    }
  }

  const { summary, coreTraits } = summarizeText(chunks);
  const now = new Date().toISOString();
  const record: DnaProfileRecord = {
    id: randomUUID(),
    orgId: input.orgId,
    scope: input.scope,
    targetId: input.targetId?.trim() || null,
    title: input.title.trim() || `${input.scope} DNA`,
    summary,
    coreTraits,
    sourceAssetIds: assets.map((asset) => asset.id),
    createdAt: now,
    updatedAt: now
  };

  const key = profileKey(input.scope, input.targetId);
  const existing = await prisma.memoryEntry.findFirst({
    where: {
      orgId: input.orgId,
      tier: MemoryTier.ORG,
      key,
      redactedAt: null
    }
  });

  if (existing) {
    await prisma.memoryEntry.update({
      where: { id: existing.id },
      data: {
        value: {
          ...record,
          createdAt: parseDnaProfile(input.orgId, existing.value).createdAt
        } as unknown as Prisma.InputJsonValue
      }
    });
  } else {
    await prisma.memoryEntry.create({
      data: {
        orgId: input.orgId,
        tier: MemoryTier.ORG,
        key,
        value: record as unknown as Prisma.InputJsonValue
      }
    });
  }

  return record;
}

