export const dynamic = "force-dynamic";

import { HubFileType, LogType, Prisma, SpendEventType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { posix } from "node:path";

import { prisma } from "@/lib/db/prisma";
import {
  HUB_UPLOAD_MAX_BYTES,
  persistUploadLocal,
  UploadTooLargeError
} from "@/lib/hub/storage";
import { publishInngestEvent } from "@/lib/inngest/publish";
import { recordPassivePolicy, recordPassiveSpend } from "@/lib/enterprise/passive";
import { requireOrgAccess } from "@/lib/security/org-access";

const DNA_MEMORY_LANES = new Set([
  "ARCHIVE",
  "LONG_TERM",
  "SHORT_TERM",
  "QUARANTINE",
  "CACHE"
]);
const GENERAL_FOLDER_KEY = "__general__";
const GENERAL_FOLDER_NAME = "General";
const GENERAL_FUNCTIONALITY_GROUP = "General";

type FolderSelection = {
  id: string;
  name: string;
  functionalityGroup: string;
};

type HubFileWithFolder = Prisma.FileGetPayload<{
  include: { folder: { select: { id: true; name: true; functionalityGroup: true } } };
}>;

function parseHubType(value: string | null | undefined): HubFileType | null {
  if (!value) return null;
  if (value === "INPUT") return HubFileType.INPUT;
  if (value === "OUTPUT") return HubFileType.OUTPUT;
  if (value === "DNA") return HubFileType.DNA;
  return null;
}

function asBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
  }
  return false;
}

function readOptionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function compactSpaces(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeWords(value: string) {
  return compactSpaces(value)
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function normalizeFunctionalityGroup(value: unknown, key?: unknown) {
  const rawKey = readOptionalString(key)
    .replace(/^function:/i, "")
    .replace(/[_:-]+/g, " ");
  const rawValue = readOptionalString(value);
  const candidate = rawKey || rawValue;
  if (!candidate) return GENERAL_FUNCTIONALITY_GROUP;
  const normalized = normalizeWords(candidate);
  const lower = normalized.toLowerCase();
  if (lower === "org" || lower === "organisation") return "Organization";
  return normalized || GENERAL_FUNCTIONALITY_GROUP;
}

function toFunctionalityGroupKey(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
  return `function:${normalized || "general"}`;
}

function normalizeFolderName(value: unknown, fallback = GENERAL_FOLDER_NAME) {
  const normalized = compactSpaces(readOptionalString(value)).slice(0, 160);
  return normalized || fallback;
}

function buildFolderRecordId(orgId: string, folderKey: string) {
  const digest = createHash("md5").update(`${orgId}|${folderKey}`).digest("hex");
  return `folder_${digest}`;
}

function resolveFolderKeyFromMetadata(metadata: unknown) {
  const value = readOptionalString(asRecord(metadata).targetFolderId);
  return value || "";
}

function resolveFolderTitleFromMetadata(metadata: unknown) {
  return readOptionalString(asRecord(metadata).targetFolderTitle);
}

function resolveFunctionalityGroupFromMetadata(metadata: unknown) {
  const record = asRecord(metadata);
  return normalizeFunctionalityGroup(record.functionalityGroupLabel, record.functionalityGroupKey);
}

function shouldUseDnaFoldering(input: {
  type: HubFileType;
  hubScope?: string;
  targetFolderId?: string;
  targetFolderTitle?: string;
}) {
  return (
    input.type === HubFileType.DNA ||
    readOptionalString(input.hubScope).toUpperCase() === "DNA_MEMORY" ||
    Boolean(readOptionalString(input.targetFolderId)) ||
    Boolean(readOptionalString(input.targetFolderTitle))
  );
}

function resolveRequestedFolderContext(input: {
  orgId: string;
  targetFolderId?: string;
  targetFolderTitle?: string;
  functionalityGroupLabel?: string;
  functionalityGroupKey?: string;
}) {
  const folderKey = readOptionalString(input.targetFolderId) || GENERAL_FOLDER_KEY;
  return {
    folderKey,
    folderRecordId: buildFolderRecordId(input.orgId, folderKey),
    folderName: normalizeFolderName(
      input.targetFolderTitle,
      folderKey === GENERAL_FOLDER_KEY ? GENERAL_FOLDER_NAME : readOptionalString(input.targetFolderId)
    ),
    functionalityGroup: normalizeFunctionalityGroup(
      input.functionalityGroupLabel,
      input.functionalityGroupKey
    )
  };
}

async function upsertFolderRecord(
  tx: Prisma.TransactionClient,
  input: {
    orgId: string;
    folderRecordId: string;
    folderName: string;
    functionalityGroup: string;
  }
) {
  return tx.folder.upsert({
    where: { id: input.folderRecordId },
    update: {
      name: input.folderName,
      functionalityGroup: input.functionalityGroup
    },
    create: {
      id: input.folderRecordId,
      orgId: input.orgId,
      name: input.folderName,
      functionalityGroup: input.functionalityGroup
    },
    select: {
      id: true,
      name: true,
      functionalityGroup: true
    }
  });
}

async function ensureGeneralFolder(tx: Prisma.TransactionClient, orgId: string) {
  return upsertFolderRecord(tx, {
    orgId,
    folderRecordId: buildFolderRecordId(orgId, GENERAL_FOLDER_KEY),
    folderName: GENERAL_FOLDER_NAME,
    functionalityGroup: GENERAL_FUNCTIONALITY_GROUP
  });
}

function buildSerializedFolderContext(file: HubFileWithFolder) {
  const metadata = asRecord(file.metadata);
  const metadataFolderKey = resolveFolderKeyFromMetadata(file.metadata);
  const isDnaFile = file.type === HubFileType.DNA;
  const folderKey = metadataFolderKey || (isDnaFile && file.folderId ? GENERAL_FOLDER_KEY : "");
  const folderName =
    file.folder?.name ||
    resolveFolderTitleFromMetadata(file.metadata) ||
    (isDnaFile && file.folderId ? GENERAL_FOLDER_NAME : "");
  const functionalityGroup =
    file.folder?.functionalityGroup ||
    resolveFunctionalityGroupFromMetadata(file.metadata) ||
    (isDnaFile && file.folderId ? GENERAL_FUNCTIONALITY_GROUP : "");

  return {
    folderId: folderKey || null,
    folderRecordId: file.folderId ?? null,
    folderName: folderName || null,
    functionalityGroup: functionalityGroup || null,
    metadata
  };
}

function serializeHubFile(file: HubFileWithFolder) {
  const folderContext = buildSerializedFolderContext(file);
  return {
    id: file.id,
    orgId: file.orgId,
    name: file.name,
    type: file.type,
    size: file.size.toString(),
    url: file.url,
    health: file.health,
    isAmnesiaProtected: file.isAmnesiaProtected,
    folderId: folderContext.folderId,
    folderRecordId: folderContext.folderRecordId,
    folderName: folderContext.folderName,
    functionalityGroup: folderContext.functionalityGroup,
    metadata: folderContext.metadata,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt
  };
}

async function repairMissingDnaFolderAssignments(orgId: string, files: HubFileWithFolder[]) {
  const orphanedFileIds = files
    .filter((file) => file.type === HubFileType.DNA && !file.folderId)
    .map((file) => file.id);
  if (orphanedFileIds.length === 0) {
    return files;
  }

  await prisma.$transaction(async (tx) => {
    const generalFolder = await ensureGeneralFolder(tx, orgId);
    for (const file of files) {
      if (file.type !== HubFileType.DNA || file.folderId) continue;
      const metadata = asRecord(file.metadata);
      await tx.file.update({
        where: { id: file.id },
        data: {
          folderId: generalFolder.id,
          metadata: {
            ...metadata,
            targetFolderId: GENERAL_FOLDER_KEY,
            targetFolderTitle: generalFolder.name,
            functionalityGroupLabel: generalFolder.functionalityGroup,
            functionalityGroupKey: toFunctionalityGroupKey(generalFolder.functionalityGroup)
          } as Prisma.InputJsonObject
        }
      });
    }
  });

  return prisma.file.findMany({
    where: {
      orgId,
      id: { in: orphanedFileIds.concat(files.filter((file) => file.folderId).map((file) => file.id)) }
    },
    include: {
      folder: {
        select: {
          id: true,
          name: true,
          functionalityGroup: true
        }
      }
    },
    orderBy: { createdAt: "desc" }
  });
}

function parseDnaMemoryLane(value: unknown) {
  const normalized = readOptionalString(value).toUpperCase();
  return DNA_MEMORY_LANES.has(normalized) ? normalized : null;
}

function normalizeSourceUrl(value: string) {
  const raw = value.trim();
  if (!raw) return "";
  if (raw.includes("\0")) return null;

  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  const slashNormalized = raw.replace(/\\/g, "/");
  if (!slashNormalized.startsWith("/uploads/")) {
    return null;
  }

  let decoded = slashNormalized;
  try {
    decoded = decodeURIComponent(slashNormalized);
  } catch {
    return null;
  }

  const normalized = posix.normalize(decoded);
  if (!normalized.startsWith("/uploads/")) {
    return null;
  }

  return normalized;
}

function formatByteSize(bytes: number) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.ceil(bytes / 1024)} KB`;
  }
  return `${bytes} B`;
}

export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("orgId")?.trim();
  const tab = parseHubType(request.nextUrl.searchParams.get("tab"));

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

  let files = await prisma.file.findMany({
    where: {
      orgId,
      ...(tab ? { type: tab } : {})
    },
    include: {
      folder: {
        select: {
          id: true,
          name: true,
          functionalityGroup: true
        }
      }
    },
    orderBy: { createdAt: "desc" }
  });

  files = await repairMissingDnaFolderAssignments(orgId, files);

  return NextResponse.json({
    ok: true,
    files: files.map(serializeHubFile)
  });
}

export async function POST(request: NextRequest) {
  let orgId = "";
  let name = "";
  let type: HubFileType | null = null;
  let sourceUrl = "";
  let isAmnesiaProtected = false;
  let uploadFile: File | null = null;
  let hubScope = "";
  let memoryLane = "";
  let functionalityGroupKey = "";
  let functionalityGroupLabel = "";
  let targetFolderId = "";
  let targetFolderTitle = "";

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    orgId = String(formData.get("orgId") ?? "").trim();
    name = String(formData.get("name") ?? "").trim();
    type = parseHubType(String(formData.get("type") ?? ""));
    sourceUrl = String(formData.get("sourceUrl") ?? "").trim();
    isAmnesiaProtected = asBoolean(formData.get("isAmnesiaProtected"));
    hubScope = String(formData.get("hubScope") ?? "").trim();
    memoryLane = String(formData.get("memoryLane") ?? "").trim();
    functionalityGroupKey = String(formData.get("functionalityGroupKey") ?? "").trim();
    functionalityGroupLabel = String(formData.get("functionalityGroupLabel") ?? "").trim();
    targetFolderId = String(formData.get("targetFolderId") ?? "").trim();
    targetFolderTitle = String(formData.get("targetFolderTitle") ?? "").trim();
    const fileField = formData.get("file");
    if (fileField instanceof File) {
      uploadFile = fileField;
    }
  } else {
    const body = (await request.json().catch(() => null)) as
      | {
          orgId?: string;
          name?: string;
          type?: string;
          sourceUrl?: string;
          isAmnesiaProtected?: boolean;
          hubScope?: string;
          memoryLane?: string;
          functionalityGroupKey?: string;
          functionalityGroupLabel?: string;
          targetFolderId?: string;
          targetFolderTitle?: string;
        }
      | null;
    orgId = body?.orgId?.trim() ?? "";
    name = body?.name?.trim() ?? "";
    type = parseHubType(body?.type ?? null);
    sourceUrl = body?.sourceUrl?.trim() ?? "";
    isAmnesiaProtected = Boolean(body?.isAmnesiaProtected);
    hubScope = body?.hubScope?.trim() ?? "";
    memoryLane = body?.memoryLane?.trim() ?? "";
    functionalityGroupKey = body?.functionalityGroupKey?.trim() ?? "";
    functionalityGroupLabel = body?.functionalityGroupLabel?.trim() ?? "";
    targetFolderId = body?.targetFolderId?.trim() ?? "";
    targetFolderTitle = body?.targetFolderTitle?.trim() ?? "";
  }

  if (!orgId || !type) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId and type are required."
      },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  if (sourceUrl) {
    const normalizedSourceUrl = normalizeSourceUrl(sourceUrl);
    if (!normalizedSourceUrl) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Invalid sourceUrl. Use a local /uploads/... path or an absolute http(s) URL."
        },
        { status: 400 }
      );
    }
    sourceUrl = normalizedSourceUrl;
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true }
  });

  if (!org) {
    return NextResponse.json(
      {
        ok: false,
        message: "Organization not found."
      },
      { status: 404 }
    );
  }

  let url = sourceUrl;
  let finalName = name;
  let sizeValue = BigInt(0);
  let contentMime = "application/octet-stream";

  if (uploadFile && uploadFile.size > 0) {
    if (uploadFile.size > HUB_UPLOAD_MAX_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          message: `Upload too large. Max allowed size is ${formatByteSize(HUB_UPLOAD_MAX_BYTES)}.`
        },
        { status: 413 }
      );
    }

    let saved: Awaited<ReturnType<typeof persistUploadLocal>>;
    try {
      saved = await persistUploadLocal({
        orgId,
        file: uploadFile
      });
    } catch (error) {
      if (error instanceof UploadTooLargeError) {
        return NextResponse.json(
          {
            ok: false,
            message: `Upload too large. Max allowed size is ${formatByteSize(error.maxBytes)}.`
          },
          { status: 413 }
        );
      }
      throw error;
    }

    url = saved.url;
    sizeValue = BigInt(saved.byteLength);
    finalName = finalName || uploadFile.name || "upload.bin";
    contentMime = uploadFile.type || contentMime;
  } else if (sourceUrl) {
    finalName = finalName || "remote-resource";
  } else {
    return NextResponse.json(
      {
        ok: false,
        message: "Either file upload or sourceUrl is required."
      },
      { status: 400 }
    );
  }

  const metadata: Record<string, Prisma.InputJsonValue> = {
    storage: uploadFile ? "local" : "remote",
    contentType: contentMime,
    ingestStatus: type === HubFileType.DNA ? "queued" : "n/a"
  };
  const normalizedHubScope = readOptionalString(hubScope);
  const normalizedMemoryLane = parseDnaMemoryLane(memoryLane);
  const requestedFolderContext = shouldUseDnaFoldering({
    type,
    hubScope: normalizedHubScope,
    targetFolderId,
    targetFolderTitle
  })
    ? resolveRequestedFolderContext({
        orgId,
        targetFolderId,
        targetFolderTitle,
        functionalityGroupLabel,
        functionalityGroupKey
      })
    : null;

  if (normalizedHubScope) metadata.hubScope = normalizedHubScope;
  if (normalizedMemoryLane) metadata.memoryLane = normalizedMemoryLane;
  if (requestedFolderContext) {
    metadata.functionalityGroupKey =
      readOptionalString(functionalityGroupKey) ||
      toFunctionalityGroupKey(requestedFolderContext.functionalityGroup);
    metadata.functionalityGroupLabel = requestedFolderContext.functionalityGroup;
    metadata.targetFolderId = requestedFolderContext.folderKey;
    metadata.targetFolderTitle = requestedFolderContext.folderName;
  }

  let file = await prisma.$transaction(async (tx) => {
    let folder: FolderSelection | null = null;
    if (requestedFolderContext) {
      folder =
        requestedFolderContext.folderKey === GENERAL_FOLDER_KEY
          ? await ensureGeneralFolder(tx, orgId)
          : await upsertFolderRecord(tx, {
              orgId,
              folderRecordId: requestedFolderContext.folderRecordId,
              folderName: requestedFolderContext.folderName,
              functionalityGroup: requestedFolderContext.functionalityGroup
            });
    }

    const created = await tx.file.create({
      data: {
        orgId,
        folderId: folder?.id ?? null,
        name: finalName,
        type,
        size: sizeValue,
        url,
        health: 100,
        isAmnesiaProtected,
        metadata: metadata as Prisma.InputJsonObject
      },
      include: {
        folder: {
          select: {
            id: true,
            name: true,
            functionalityGroup: true
          }
        }
      }
    });

    await tx.log.create({
      data: {
        orgId,
        type: type === HubFileType.DNA ? LogType.DNA : LogType.USER,
        actor: "HUB",
        message: `File ${created.id} uploaded to ${type} sector${isAmnesiaProtected ? " with Amnesia protection" : ""}.`
      }
    });

    await recordPassivePolicy(
      {
        orgId,
        subjectType: "FILE_UPLOAD",
        subjectId: created.id,
        riskScore: isAmnesiaProtected ? 0.12 : 0.08,
        reason: "Passive policy observation for Hub upload.",
        meta: { type, amnesia: isAmnesiaProtected, size: created.size.toString() }
      },
      tx
    );

    await recordPassiveSpend(
      {
        orgId,
        amount: Number(created.size) / 1024,
        type: SpendEventType.ACTUAL_BURN,
        meta: { source: "hub.upload", fileId: created.id, hubType: type }
      },
      tx
    );

    return created;
  });

  let warning: string | undefined;
  if (type === HubFileType.DNA) {
    const publish = await publishInngestEvent("vorldx/dna.ingest", {
      orgId,
      fileId: file.id
    });
    if (!publish.ok) {
      warning = publish.message;
      file = await prisma.file.update({
        where: { id: file.id },
        data: {
          metadata: {
            ...metadata,
            ingestStatus: "publish_failed"
          } as Prisma.InputJsonObject
        },
        include: {
          folder: {
            select: {
              id: true,
              name: true,
              functionalityGroup: true
            }
          }
        }
      });
    }
  }

  return NextResponse.json(
    {
      ok: true,
      file: serializeHubFile(file),
      warning
    },
    { status: 201 }
  );
}
