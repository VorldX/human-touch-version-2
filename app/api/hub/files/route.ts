export const dynamic = "force-dynamic";

import { HubFileType, LogType, SpendEventType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
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

  const files = await prisma.file.findMany({
    where: {
      orgId,
      ...(tab ? { type: tab } : {})
    },
    orderBy: { createdAt: "desc" }
  });

  return NextResponse.json({
    ok: true,
    files: files.map((file) => ({
      id: file.id,
      orgId: file.orgId,
      name: file.name,
      type: file.type,
      size: file.size.toString(),
      url: file.url,
      health: file.health,
      isAmnesiaProtected: file.isAmnesiaProtected,
      metadata: file.metadata,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt
    }))
  });
}

export async function POST(request: NextRequest) {
  let orgId = "";
  let name = "";
  let type: HubFileType | null = null;
  let sourceUrl = "";
  let isAmnesiaProtected = false;
  let uploadFile: File | null = null;

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    orgId = String(formData.get("orgId") ?? "").trim();
    name = String(formData.get("name") ?? "").trim();
    type = parseHubType(String(formData.get("type") ?? ""));
    sourceUrl = String(formData.get("sourceUrl") ?? "").trim();
    isAmnesiaProtected = asBoolean(formData.get("isAmnesiaProtected"));
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
        }
      | null;
    orgId = body?.orgId?.trim() ?? "";
    name = body?.name?.trim() ?? "";
    type = parseHubType(body?.type ?? null);
    sourceUrl = body?.sourceUrl?.trim() ?? "";
    isAmnesiaProtected = Boolean(body?.isAmnesiaProtected);
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

  const metadata = {
    storage: uploadFile ? "local" : "remote",
    contentType: contentMime,
    ingestStatus: type === HubFileType.DNA ? "queued" : "n/a"
  };

  const file = await prisma.$transaction(async (tx) => {
    const created = await tx.file.create({
      data: {
        orgId,
        name: finalName,
        type,
        size: sizeValue,
        url,
        health: 100,
        isAmnesiaProtected,
        metadata
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
      await prisma.file.update({
        where: { id: file.id },
        data: {
          metadata: {
            ...metadata,
            ingestStatus: "publish_failed"
          }
        }
      });
    }
  }

  return NextResponse.json(
    {
      ok: true,
      file: {
        id: file.id,
        orgId: file.orgId,
        name: file.name,
        type: file.type,
        size: file.size.toString(),
        url: file.url,
        health: file.health,
        isAmnesiaProtected: file.isAmnesiaProtected,
        metadata: file.metadata,
        createdAt: file.createdAt
      },
      warning
    },
    { status: 201 }
  );
}
