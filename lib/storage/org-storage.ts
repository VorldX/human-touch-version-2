import "server-only";

import { randomUUID } from "node:crypto";

import { HubFileType, MemoryTier, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { persistUploadLocal } from "@/lib/hub/storage";
import { decryptSecret, encryptSecret, type EncryptedSecret } from "@/lib/security/crypto";

export type StorageProvider = "MANAGED" | "GOOGLE_DRIVE" | "S3_COMPATIBLE";
export type ConnectorStatus = "CONNECTED" | "PENDING" | "ERROR" | "DISCONNECTED";

export type ToolPrincipalType = "OWNER" | "EMPLOYEE" | "AGENT";
export type ToolName = "GOOGLE_DRIVE" | "S3_COMPATIBLE" | "MANAGED_VAULT";

export interface OrgStorageAsset {
  id: string;
  orgId: string;
  name: string;
  size: string;
  url: string;
  type: HubFileType;
  ownerType: ToolPrincipalType | "ORG";
  ownerId: string | null;
  namespace: string;
  provider: StorageProvider;
  connectorId: string | null;
  tags: string[];
  contentType: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StorageConnector {
  id: string;
  orgId: string;
  name: string;
  provider: Exclude<StorageProvider, "MANAGED">;
  status: ConnectorStatus;
  createdByUserId: string | null;
  createdByEmail: string | null;
  accountHint: string | null;
  settings: Record<string, unknown>;
  hasCredential: boolean;
  createdAt: string;
  updatedAt: string;
  lastSyncAt?: string;
}

export interface StorageToolGrant {
  id: string;
  orgId: string;
  tool: ToolName;
  principalType: ToolPrincipalType;
  principalId: string;
  capabilities: string[];
  createdAt: string;
  updatedAt: string;
}

interface CreateAssetInput {
  orgId: string;
  name: string;
  namespace?: string;
  ownerType?: ToolPrincipalType | "ORG";
  ownerId?: string | null;
  tags?: string[];
  provider?: StorageProvider;
  connectorId?: string | null;
  file?: File | null;
  sourceUrl?: string;
  contentType?: string | null;
  asDna?: boolean;
}

interface CreateConnectorInput {
  orgId: string;
  name: string;
  provider: Exclude<StorageProvider, "MANAGED">;
  createdByUserId?: string | null;
  createdByEmail?: string | null;
  accountHint?: string | null;
  settings?: Record<string, unknown>;
  credential?: string | null;
}

interface UpdateConnectorInput {
  name?: string;
  status?: ConnectorStatus;
  accountHint?: string | null;
  settings?: Record<string, unknown>;
  credential?: string | null;
  lastSyncAt?: string;
}

interface UpsertToolGrantInput {
  orgId: string;
  tool: ToolName;
  principalType: ToolPrincipalType;
  principalId: string;
  capabilities?: string[];
}

const CONNECTOR_KEY_PREFIX = "storage.connector.";
const TOOL_GRANT_KEY_PREFIX = "storage.tool.grant.";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asEncryptedSecret(value: unknown): EncryptedSecret | null {
  const input = asRecord(value);
  if (
    typeof input.cipherText !== "string" ||
    typeof input.iv !== "string" ||
    typeof input.authTag !== "string" ||
    typeof input.keyVersion !== "number"
  ) {
    return null;
  }
  return {
    cipherText: input.cipherText,
    iv: input.iv,
    authTag: input.authTag,
    keyVersion: input.keyVersion
  };
}

function normalizeProvider(value: unknown): StorageProvider {
  if (value === "GOOGLE_DRIVE") return "GOOGLE_DRIVE";
  if (value === "S3_COMPATIBLE") return "S3_COMPATIBLE";
  return "MANAGED";
}

function normalizeConnectorStatus(value: unknown): ConnectorStatus {
  if (value === "CONNECTED") return "CONNECTED";
  if (value === "PENDING") return "PENDING";
  if (value === "ERROR") return "ERROR";
  if (value === "DISCONNECTED") return "DISCONNECTED";
  return "PENDING";
}

function normalizeToolName(value: unknown): ToolName {
  if (value === "GOOGLE_DRIVE") return "GOOGLE_DRIVE";
  if (value === "S3_COMPATIBLE") return "S3_COMPATIBLE";
  return "MANAGED_VAULT";
}

function normalizePrincipalType(value: unknown): ToolPrincipalType {
  if (value === "OWNER") return "OWNER";
  if (value === "AGENT") return "AGENT";
  return "EMPLOYEE";
}

function normalizeTags(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 30);
}

function connectorKey(connectorId: string) {
  return `${CONNECTOR_KEY_PREFIX}${connectorId}`;
}

function toolGrantKey(grantId: string) {
  return `${TOOL_GRANT_KEY_PREFIX}${grantId}`;
}

function parseConnector(value: unknown, orgId: string): StorageConnector {
  const record = asRecord(value);
  const now = new Date().toISOString();
  const encryptedCredential = asEncryptedSecret(record.encryptedCredential);
  return {
    id: typeof record.id === "string" ? record.id : randomUUID(),
    orgId,
    name:
      typeof record.name === "string" && record.name.trim().length > 0
        ? record.name.trim()
        : "Connector",
    provider: normalizeProvider(record.provider) as Exclude<StorageProvider, "MANAGED">,
    status: normalizeConnectorStatus(record.status),
    createdByUserId:
      typeof record.createdByUserId === "string" ? record.createdByUserId : null,
    createdByEmail:
      typeof record.createdByEmail === "string" ? record.createdByEmail : null,
    accountHint: typeof record.accountHint === "string" ? record.accountHint : null,
    settings: asRecord(record.settings),
    hasCredential: Boolean(encryptedCredential),
    createdAt: typeof record.createdAt === "string" ? record.createdAt : now,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : now,
    ...(typeof record.lastSyncAt === "string" ? { lastSyncAt: record.lastSyncAt } : {})
  };
}

function parseToolGrant(value: unknown, orgId: string): StorageToolGrant {
  const record = asRecord(value);
  const now = new Date().toISOString();
  return {
    id: typeof record.id === "string" ? record.id : randomUUID(),
    orgId,
    tool: normalizeToolName(record.tool),
    principalType: normalizePrincipalType(record.principalType),
    principalId: typeof record.principalId === "string" ? record.principalId : "",
    capabilities: normalizeTags(record.capabilities),
    createdAt: typeof record.createdAt === "string" ? record.createdAt : now,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : now
  };
}

function parseStorageAsset(file: {
  id: string;
  orgId: string;
  name: string;
  size: bigint;
  url: string;
  type: HubFileType;
  metadata: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}): OrgStorageAsset | null {
  const metadata = asRecord(file.metadata);
  if (metadata.hubScope !== "STORAGE") {
    return null;
  }
  return {
    id: file.id,
    orgId: file.orgId,
    name: file.name,
    size: file.size.toString(),
    url: file.url,
    type: file.type,
    ownerType:
      metadata.ownerType === "OWNER" ||
      metadata.ownerType === "EMPLOYEE" ||
      metadata.ownerType === "AGENT" ||
      metadata.ownerType === "ORG"
        ? (metadata.ownerType as ToolPrincipalType | "ORG")
        : "ORG",
    ownerId: typeof metadata.ownerId === "string" ? metadata.ownerId : null,
    namespace:
      typeof metadata.namespace === "string" && metadata.namespace.trim().length > 0
        ? metadata.namespace
        : "/org",
    provider: normalizeProvider(metadata.provider),
    connectorId: typeof metadata.connectorId === "string" ? metadata.connectorId : null,
    tags: normalizeTags(metadata.tags),
    contentType: typeof metadata.contentType === "string" ? metadata.contentType : null,
    createdAt: file.createdAt.toISOString(),
    updatedAt: file.updatedAt.toISOString()
  };
}

export async function listOrgStorageAssets(
  orgId: string,
  options?: { namespace?: string; ownerId?: string; ownerType?: ToolPrincipalType | "ORG" }
) {
  const files = await prisma.file.findMany({
    where: {
      orgId,
      type: {
        in: [HubFileType.INPUT, HubFileType.DNA]
      }
    },
    orderBy: { updatedAt: "desc" },
    take: 2000
  });

  const assets = files
    .map(parseStorageAsset)
    .filter((item): item is OrgStorageAsset => Boolean(item))
    .filter((item) => {
      if (options?.namespace && !item.namespace.startsWith(options.namespace)) return false;
      if (options?.ownerId && item.ownerId !== options.ownerId) return false;
      if (options?.ownerType && item.ownerType !== options.ownerType) return false;
      return true;
    });

  return assets;
}

export async function createOrgStorageAsset(input: CreateAssetInput) {
  let finalUrl = input.sourceUrl?.trim() ?? "";
  let finalName = input.name.trim();
  let size = BigInt(0);
  let contentType = input.contentType ?? null;

  if (input.file && input.file.size > 0) {
    const uploaded = await persistUploadLocal({
      orgId: input.orgId,
      file: input.file
    });
    finalUrl = uploaded.url;
    size = BigInt(uploaded.byteLength);
    finalName = finalName || input.file.name || "upload.bin";
    contentType = contentType || input.file.type || "application/octet-stream";
  } else if (finalUrl) {
    finalName = finalName || "external-asset";
  } else {
    throw new Error("Either file or sourceUrl is required.");
  }

  const metadata = {
    hubScope: "STORAGE",
    namespace: input.namespace?.trim() || "/org",
    ownerType: input.ownerType ?? "ORG",
    ownerId: input.ownerId?.trim() || null,
    provider: input.provider ?? "MANAGED",
    connectorId: input.connectorId?.trim() || null,
    tags: normalizeTags(input.tags ?? []),
    contentType: contentType ?? null
  };

  const created = await prisma.file.create({
    data: {
      orgId: input.orgId,
      name: finalName,
      type: input.asDna ? HubFileType.DNA : HubFileType.INPUT,
      size,
      url: finalUrl,
      health: 100,
      isAmnesiaProtected: false,
      metadata
    }
  });

  const parsed = parseStorageAsset({
    ...created,
    metadata: created.metadata as Prisma.JsonValue
  });
  if (!parsed) {
    throw new Error("Unable to parse created storage asset.");
  }
  return parsed;
}

export async function updateOrgStorageAsset(
  orgId: string,
  assetId: string,
  patch: {
    name?: string;
    namespace?: string;
    ownerType?: ToolPrincipalType | "ORG";
    ownerId?: string | null;
    tags?: string[];
    connectorId?: string | null;
  }
) {
  const asset = await prisma.file.findUnique({
    where: { id: assetId }
  });
  if (!asset || asset.orgId !== orgId) {
    return null;
  }

  const metadata = asRecord(asset.metadata);
  if (metadata.hubScope !== "STORAGE") {
    return null;
  }

  const nextMetadata = {
    ...metadata,
    ...(patch.namespace !== undefined ? { namespace: patch.namespace.trim() || "/org" } : {}),
    ...(patch.ownerType !== undefined ? { ownerType: patch.ownerType } : {}),
    ...(patch.ownerId !== undefined ? { ownerId: patch.ownerId?.trim() || null } : {}),
    ...(patch.tags !== undefined ? { tags: normalizeTags(patch.tags) } : {}),
    ...(patch.connectorId !== undefined ? { connectorId: patch.connectorId?.trim() || null } : {})
  };

  const updated = await prisma.file.update({
    where: { id: assetId },
    data: {
      ...(patch.name !== undefined ? { name: patch.name.trim() || asset.name } : {}),
      metadata: nextMetadata
    }
  });

  return parseStorageAsset({
    ...updated,
    metadata: updated.metadata as Prisma.JsonValue
  });
}

export async function deleteOrgStorageAsset(orgId: string, assetId: string) {
  const asset = await prisma.file.findUnique({
    where: { id: assetId }
  });
  if (!asset || asset.orgId !== orgId) {
    return false;
  }
  const metadata = asRecord(asset.metadata);
  if (metadata.hubScope !== "STORAGE") {
    return false;
  }

  await prisma.file.delete({
    where: { id: assetId }
  });
  return true;
}

export async function listStorageConnectors(orgId: string) {
  const rows = await prisma.memoryEntry.findMany({
    where: {
      orgId,
      tier: MemoryTier.ORG,
      key: {
        startsWith: CONNECTOR_KEY_PREFIX
      },
      redactedAt: null
    },
    orderBy: { updatedAt: "desc" },
    take: 200
  });
  return rows.map((row) => parseConnector(row.value, orgId));
}

export async function getStorageConnector(orgId: string, connectorId: string) {
  const row = await prisma.memoryEntry.findFirst({
    where: {
      orgId,
      tier: MemoryTier.ORG,
      key: connectorKey(connectorId),
      redactedAt: null
    }
  });
  if (!row) return null;
  return parseConnector(row.value, orgId);
}

export async function createStorageConnector(input: CreateConnectorInput) {
  const now = new Date().toISOString();
  const id = randomUUID();
  const encryptedCredential =
    input.credential && input.credential.trim().length > 0
      ? encryptSecret(input.credential.trim())
      : null;
  const record = {
    id,
    orgId: input.orgId,
    name: input.name.trim() || "Connector",
    provider: input.provider,
    status: "CONNECTED" as ConnectorStatus,
    createdByUserId: input.createdByUserId?.trim() || null,
    createdByEmail: input.createdByEmail?.trim().toLowerCase() || null,
    accountHint: input.accountHint?.trim() || null,
    settings: input.settings ?? {},
    ...(encryptedCredential ? { encryptedCredential } : {}),
    createdAt: now,
    updatedAt: now
  };

  await prisma.memoryEntry.create({
    data: {
      orgId: input.orgId,
      tier: MemoryTier.ORG,
      key: connectorKey(id),
      value: record as unknown as Prisma.InputJsonValue
    }
  });

  return parseConnector(record, input.orgId);
}

export async function updateStorageConnector(orgId: string, connectorId: string, patch: UpdateConnectorInput) {
  const existing = await prisma.memoryEntry.findFirst({
    where: {
      orgId,
      tier: MemoryTier.ORG,
      key: connectorKey(connectorId),
      redactedAt: null
    }
  });
  if (!existing) return null;

  const current = asRecord(existing.value);
  const next = {
    ...current,
    ...(patch.name !== undefined ? { name: patch.name.trim() || current.name } : {}),
    ...(patch.status !== undefined ? { status: normalizeConnectorStatus(patch.status) } : {}),
    ...(patch.accountHint !== undefined ? { accountHint: patch.accountHint?.trim() || null } : {}),
    ...(patch.settings !== undefined ? { settings: patch.settings } : {}),
    ...(patch.lastSyncAt !== undefined ? { lastSyncAt: patch.lastSyncAt } : {}),
    ...(patch.credential !== undefined
      ? typeof patch.credential === "string" && patch.credential.trim().length > 0
        ? { encryptedCredential: encryptSecret(patch.credential.trim()) }
        : { encryptedCredential: null }
      : {}),
    updatedAt: new Date().toISOString()
  };

  await prisma.memoryEntry.update({
    where: { id: existing.id },
    data: {
      value: next as unknown as Prisma.InputJsonValue
    }
  });

  return parseConnector(next, orgId);
}

export async function deleteStorageConnector(orgId: string, connectorId: string) {
  const existing = await prisma.memoryEntry.findFirst({
    where: {
      orgId,
      tier: MemoryTier.ORG,
      key: connectorKey(connectorId),
      redactedAt: null
    }
  });
  if (!existing) return false;
  await prisma.memoryEntry.update({
    where: { id: existing.id },
    data: {
      redactedAt: new Date(),
      value: Prisma.DbNull
    }
  });
  return true;
}

export async function getConnectorCredential(orgId: string, connectorId: string) {
  const existing = await prisma.memoryEntry.findFirst({
    where: {
      orgId,
      tier: MemoryTier.ORG,
      key: connectorKey(connectorId),
      redactedAt: null
    }
  });
  if (!existing) return null;
  const record = asRecord(existing.value);
  const encrypted = asEncryptedSecret(record.encryptedCredential);
  if (!encrypted) return null;
  try {
    return decryptSecret(encrypted);
  } catch {
    return null;
  }
}

export async function listStorageToolGrants(orgId: string) {
  const rows = await prisma.memoryEntry.findMany({
    where: {
      orgId,
      tier: MemoryTier.ORG,
      key: {
        startsWith: TOOL_GRANT_KEY_PREFIX
      },
      redactedAt: null
    },
    orderBy: { updatedAt: "desc" },
    take: 600
  });
  return rows.map((row) => parseToolGrant(row.value, orgId));
}

export async function upsertStorageToolGrant(input: UpsertToolGrantInput) {
  const now = new Date().toISOString();
  const existingRows = await prisma.memoryEntry.findMany({
    where: {
      orgId: input.orgId,
      tier: MemoryTier.ORG,
      key: {
        startsWith: TOOL_GRANT_KEY_PREFIX
      },
      redactedAt: null
    },
    take: 600
  });
  const existing = existingRows.find((row) => {
    const parsed = parseToolGrant(row.value, input.orgId);
    return (
      parsed.tool === input.tool &&
      parsed.principalType === input.principalType &&
      parsed.principalId === input.principalId.trim()
    );
  });

  const record: StorageToolGrant = {
    id: existing ? parseToolGrant(existing.value, input.orgId).id : randomUUID(),
    orgId: input.orgId,
    tool: normalizeToolName(input.tool),
    principalType: normalizePrincipalType(input.principalType),
    principalId: input.principalId.trim(),
    capabilities: normalizeTags(input.capabilities ?? []),
    createdAt: existing ? parseToolGrant(existing.value, input.orgId).createdAt : now,
    updatedAt: now
  };

  if (existing) {
    await prisma.memoryEntry.update({
      where: { id: existing.id },
      data: {
        key: toolGrantKey(record.id),
        value: record as unknown as Prisma.InputJsonValue,
        redactedAt: null
      }
    });
  } else {
    await prisma.memoryEntry.create({
      data: {
        orgId: input.orgId,
        tier: MemoryTier.ORG,
        key: toolGrantKey(record.id),
        value: record as unknown as Prisma.InputJsonValue
      }
    });
  }

  return record;
}

export async function deleteStorageToolGrant(orgId: string, grantId: string) {
  const row = await prisma.memoryEntry.findFirst({
    where: {
      orgId,
      tier: MemoryTier.ORG,
      key: toolGrantKey(grantId),
      redactedAt: null
    }
  });
  if (!row) return false;
  await prisma.memoryEntry.update({
    where: { id: row.id },
    data: {
      redactedAt: new Date(),
      value: Prisma.DbNull
    }
  });
  return true;
}
