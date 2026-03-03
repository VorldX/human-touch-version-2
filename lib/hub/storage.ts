import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, posix, resolve, sep } from "node:path";

const PUBLIC_ROOT = join(process.cwd(), "public");
const UPLOAD_ROOT = join(PUBLIC_ROOT, "uploads");

function cleanSegment(input: string) {
  return input.replace(/[^a-zA-Z0-9_-]/g, "");
}

export async function persistUploadLocal(input: {
  orgId: string;
  file: File;
}) {
  const orgSegment = cleanSegment(input.orgId);
  const extension = extname(input.file.name).slice(0, 10) || ".bin";
  const fileName = `${Date.now()}-${randomUUID().slice(0, 8)}${extension}`;
  const targetDir = join(UPLOAD_ROOT, orgSegment);
  const targetPath = join(targetDir, fileName);
  await mkdir(targetDir, { recursive: true });

  const bytes = Buffer.from(await input.file.arrayBuffer());
  await writeFile(targetPath, bytes);

  return {
    localPath: targetPath,
    url: `/uploads/${orgSegment}/${fileName}`,
    byteLength: bytes.byteLength
  };
}

export async function readLocalUploadByUrl(url: string) {
  if (!url || typeof url !== "string") {
    return null;
  }

  const slashNormalized = url.trim().replace(/\\/g, "/");
  if (!slashNormalized.startsWith("/uploads/") || slashNormalized.includes("\0")) {
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

  const safeRelative = normalized.replace(/^\/+/, "");
  const absolutePath = resolve(PUBLIC_ROOT, safeRelative);
  const uploadRootPrefix = `${UPLOAD_ROOT}${sep}`;
  if (absolutePath !== UPLOAD_ROOT && !absolutePath.startsWith(uploadRootPrefix)) {
    return null;
  }

  try {
    return await readFile(absolutePath);
  } catch {
    return null;
  }
}

export function toPreviewText(buffer: Buffer, limit = 2400) {
  const content = buffer.toString("utf8");
  return content.slice(0, limit);
}
