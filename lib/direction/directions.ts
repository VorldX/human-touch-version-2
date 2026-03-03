import "server-only";

import { randomUUID } from "node:crypto";

import { MemoryTier, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";

export type DirectionStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";
export type DirectionSource = "MANUAL" | "CHAT" | "SYSTEM";
export type DirectionRelation = "SUPPORTS" | "BLOCKS" | "DEPENDS_ON" | "RELATES_TO";

export interface DirectionRecord {
  id: string;
  orgId: string;
  title: string;
  summary: string;
  direction: string;
  status: DirectionStatus;
  source: DirectionSource;
  ownerUserId: string | null;
  ownerEmail: string | null;
  ownerName: string | null;
  tags: string[];
  impactScore: number;
  createdAt: string;
  updatedAt: string;
  lastExecutedAt?: string;
}

export interface DirectionLinkRecord {
  id: string;
  orgId: string;
  fromDirectionId: string;
  toDirectionId: string;
  relation: DirectionRelation;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DirectionFlowRecord {
  id: string;
  orgId: string;
  directionId: string;
  flowId: string;
  createdAt: string;
}

interface CreateDirectionInput {
  title: string;
  summary?: string;
  direction: string;
  status?: DirectionStatus;
  source?: DirectionSource;
  ownerUserId?: string | null;
  ownerEmail?: string | null;
  ownerName?: string | null;
  tags?: string[];
  impactScore?: number;
}

interface UpdateDirectionInput {
  title?: string;
  summary?: string;
  direction?: string;
  status?: DirectionStatus;
  source?: DirectionSource;
  ownerUserId?: string | null;
  ownerEmail?: string | null;
  ownerName?: string | null;
  tags?: string[];
  impactScore?: number;
  lastExecutedAt?: string;
}

interface CreateDirectionLinkInput {
  fromDirectionId: string;
  toDirectionId: string;
  relation?: DirectionRelation;
  note?: string | null;
}

type MemoryEntryClient = Pick<Prisma.TransactionClient, "memoryEntry"> | typeof prisma;

const DIRECTION_PREFIX = "direction.record.";
const DIRECTION_LINK_PREFIX = "direction.link.";
const DIRECTION_FLOW_PREFIX = "direction.flow.";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeStatus(value: unknown): DirectionStatus {
  if (value === "DRAFT") return "DRAFT";
  if (value === "ARCHIVED") return "ARCHIVED";
  return "ACTIVE";
}

function normalizeSource(value: unknown): DirectionSource {
  if (value === "CHAT") return "CHAT";
  if (value === "SYSTEM") return "SYSTEM";
  return "MANUAL";
}

function normalizeRelation(value: unknown): DirectionRelation {
  if (value === "SUPPORTS") return "SUPPORTS";
  if (value === "BLOCKS") return "BLOCKS";
  if (value === "DEPENDS_ON") return "DEPENDS_ON";
  return "RELATES_TO";
}

function normalizeTags(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 24);
}

function normalizeImpactScore(value: unknown, fallback = 0.5) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, Number(value.toFixed(3))));
}

function keyFromDirectionId(directionId: string) {
  return `${DIRECTION_PREFIX}${directionId}`;
}

function keyFromDirectionLinkIds(fromDirectionId: string, toDirectionId: string) {
  return `${DIRECTION_LINK_PREFIX}${fromDirectionId}.${toDirectionId}`;
}

function keyFromDirectionFlow(directionId: string, flowId: string) {
  return `${DIRECTION_FLOW_PREFIX}${directionId}.${flowId}`;
}

function parseDirection(value: unknown, orgId: string): DirectionRecord {
  const record = asRecord(value);
  const now = new Date().toISOString();
  const id = typeof record.id === "string" ? record.id : randomUUID();
  const titleRaw = typeof record.title === "string" ? record.title.trim() : "";
  const directionRaw = typeof record.direction === "string" ? record.direction.trim() : "";
  const summaryRaw = typeof record.summary === "string" ? record.summary.trim() : "";

  return {
    id,
    orgId,
    title: titleRaw || `Direction ${id.slice(0, 8).toUpperCase()}`,
    summary: summaryRaw,
    direction: directionRaw,
    status: normalizeStatus(record.status),
    source: normalizeSource(record.source),
    ownerUserId:
      typeof record.ownerUserId === "string" && record.ownerUserId.trim().length > 0
        ? record.ownerUserId.trim()
        : null,
    ownerEmail:
      typeof record.ownerEmail === "string" && record.ownerEmail.trim().length > 0
        ? record.ownerEmail.trim().toLowerCase()
        : null,
    ownerName:
      typeof record.ownerName === "string" && record.ownerName.trim().length > 0
        ? record.ownerName.trim()
        : null,
    tags: normalizeTags(record.tags),
    impactScore: normalizeImpactScore(record.impactScore),
    createdAt: typeof record.createdAt === "string" ? record.createdAt : now,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : now,
    ...(typeof record.lastExecutedAt === "string"
      ? { lastExecutedAt: record.lastExecutedAt }
      : {})
  };
}

function parseDirectionLink(value: unknown, orgId: string): DirectionLinkRecord {
  const record = asRecord(value);
  const now = new Date().toISOString();
  return {
    id: typeof record.id === "string" ? record.id : randomUUID(),
    orgId,
    fromDirectionId:
      typeof record.fromDirectionId === "string" ? record.fromDirectionId : "",
    toDirectionId: typeof record.toDirectionId === "string" ? record.toDirectionId : "",
    relation: normalizeRelation(record.relation),
    note: typeof record.note === "string" ? record.note : null,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : now,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : now
  };
}

function parseDirectionFlow(value: unknown, orgId: string): DirectionFlowRecord {
  const record = asRecord(value);
  const now = new Date().toISOString();
  return {
    id: typeof record.id === "string" ? record.id : randomUUID(),
    orgId,
    directionId: typeof record.directionId === "string" ? record.directionId : "",
    flowId: typeof record.flowId === "string" ? record.flowId : "",
    createdAt: typeof record.createdAt === "string" ? record.createdAt : now
  };
}

function sortByUpdatedAtDesc<T extends { updatedAt?: string; createdAt?: string }>(rows: T[]) {
  return [...rows].sort((left, right) => {
    const leftMs = new Date(left.updatedAt ?? left.createdAt ?? 0).getTime();
    const rightMs = new Date(right.updatedAt ?? right.createdAt ?? 0).getTime();
    return rightMs - leftMs;
  });
}

async function listDirectionEntries(orgId: string, client?: MemoryEntryClient) {
  const db = client ?? prisma;
  return db.memoryEntry.findMany({
    where: {
      orgId,
      tier: MemoryTier.ORG,
      key: {
        startsWith: DIRECTION_PREFIX
      },
      redactedAt: null
    },
    orderBy: {
      updatedAt: "desc"
    },
    take: 500
  });
}

export async function listDirections(orgId: string, options?: { ownerEmail?: string; status?: DirectionStatus }) {
  const entries = await listDirectionEntries(orgId);
  const directions = entries.map((entry) => parseDirection(entry.value, orgId));
  return sortByUpdatedAtDesc(
    directions.filter((item) => {
      if (options?.ownerEmail && item.ownerEmail !== options.ownerEmail.toLowerCase()) {
        return false;
      }
      if (options?.status && item.status !== options.status) {
        return false;
      }
      return true;
    })
  );
}

export async function getDirection(orgId: string, directionId: string) {
  const entry = await prisma.memoryEntry.findFirst({
    where: {
      orgId,
      tier: MemoryTier.ORG,
      key: keyFromDirectionId(directionId),
      redactedAt: null
    }
  });

  if (!entry) {
    return null;
  }

  return parseDirection(entry.value, orgId);
}

export async function createDirection(orgId: string, input: CreateDirectionInput, client?: MemoryEntryClient) {
  const db = client ?? prisma;
  const now = new Date().toISOString();
  const direction: DirectionRecord = {
    id: randomUUID(),
    orgId,
    title: input.title.trim() || `Direction ${new Date().toISOString().slice(0, 10)}`,
    summary: input.summary?.trim() ?? "",
    direction: input.direction.trim(),
    status: input.status ?? "ACTIVE",
    source: input.source ?? "MANUAL",
    ownerUserId: input.ownerUserId?.trim() || null,
    ownerEmail: input.ownerEmail?.trim().toLowerCase() || null,
    ownerName: input.ownerName?.trim() || null,
    tags: normalizeTags(input.tags ?? []),
    impactScore: normalizeImpactScore(input.impactScore, 0.5),
    createdAt: now,
    updatedAt: now
  };

  await db.memoryEntry.create({
    data: {
      orgId,
      tier: MemoryTier.ORG,
      key: keyFromDirectionId(direction.id),
      value: direction as unknown as Prisma.InputJsonValue
    }
  });

  return direction;
}

export async function updateDirection(orgId: string, directionId: string, patch: UpdateDirectionInput) {
  const existing = await prisma.memoryEntry.findFirst({
    where: {
      orgId,
      tier: MemoryTier.ORG,
      key: keyFromDirectionId(directionId),
      redactedAt: null
    }
  });

  if (!existing) {
    return null;
  }

  const current = parseDirection(existing.value, orgId);
  const next: DirectionRecord = {
    ...current,
    ...(patch.title !== undefined ? { title: patch.title.trim() || current.title } : {}),
    ...(patch.summary !== undefined ? { summary: patch.summary.trim() } : {}),
    ...(patch.direction !== undefined ? { direction: patch.direction.trim() || current.direction } : {}),
    ...(patch.status !== undefined ? { status: normalizeStatus(patch.status) } : {}),
    ...(patch.source !== undefined ? { source: normalizeSource(patch.source) } : {}),
    ...(patch.ownerUserId !== undefined ? { ownerUserId: patch.ownerUserId?.trim() || null } : {}),
    ...(patch.ownerEmail !== undefined
      ? { ownerEmail: patch.ownerEmail?.trim().toLowerCase() || null }
      : {}),
    ...(patch.ownerName !== undefined ? { ownerName: patch.ownerName?.trim() || null } : {}),
    ...(patch.tags !== undefined ? { tags: normalizeTags(patch.tags) } : {}),
    ...(patch.impactScore !== undefined
      ? { impactScore: normalizeImpactScore(patch.impactScore, current.impactScore) }
      : {}),
    ...(patch.lastExecutedAt !== undefined
      ? { lastExecutedAt: patch.lastExecutedAt }
      : {}),
    updatedAt: new Date().toISOString()
  };

  await prisma.memoryEntry.update({
    where: { id: existing.id },
    data: {
      value: next as unknown as Prisma.InputJsonValue
    }
  });

  return next;
}

export async function deleteDirection(orgId: string, directionId: string) {
  const row = await prisma.memoryEntry.findFirst({
    where: {
      orgId,
      tier: MemoryTier.ORG,
      key: keyFromDirectionId(directionId),
      redactedAt: null
    }
  });

  if (!row) {
    return false;
  }

  await prisma.memoryEntry.update({
    where: { id: row.id },
    data: {
      redactedAt: new Date(),
      value: Prisma.DbNull
    }
  });
  return true;
}

async function listDirectionLinkEntries(orgId: string) {
  return prisma.memoryEntry.findMany({
    where: {
      orgId,
      tier: MemoryTier.ORG,
      key: {
        startsWith: DIRECTION_LINK_PREFIX
      },
      redactedAt: null
    },
    orderBy: {
      updatedAt: "desc"
    },
    take: 2000
  });
}

export async function listDirectionLinks(orgId: string, directionId?: string) {
  const rows = await listDirectionLinkEntries(orgId);
  const links = rows.map((row) => parseDirectionLink(row.value, orgId));
  if (!directionId) {
    return links;
  }
  return links.filter(
    (item) => item.fromDirectionId === directionId || item.toDirectionId === directionId
  );
}

export async function createDirectionLink(orgId: string, input: CreateDirectionLinkInput) {
  const now = new Date().toISOString();
  const key = keyFromDirectionLinkIds(input.fromDirectionId, input.toDirectionId);
  let record: DirectionLinkRecord = {
    id: randomUUID(),
    orgId,
    fromDirectionId: input.fromDirectionId,
    toDirectionId: input.toDirectionId,
    relation: input.relation ?? "RELATES_TO",
    note: input.note?.trim() || null,
    createdAt: now,
    updatedAt: now
  };

  const existing = await prisma.memoryEntry.findFirst({
    where: {
      orgId,
      tier: MemoryTier.ORG,
      key,
      redactedAt: null
    }
  });

  if (existing) {
    const current = parseDirectionLink(existing.value, orgId);
    record = {
      ...record,
      id: current.id,
      createdAt: current.createdAt
    };
    await prisma.memoryEntry.update({
      where: { id: existing.id },
      data: {
        value: record as unknown as Prisma.InputJsonValue,
        redactedAt: null
      }
    });
  } else {
    await prisma.memoryEntry.create({
      data: {
        orgId,
        tier: MemoryTier.ORG,
        key,
        value: record as unknown as Prisma.InputJsonValue
      }
    });
  }

  return record;
}

export async function deleteDirectionLink(orgId: string, fromDirectionId: string, toDirectionId: string) {
  const key = keyFromDirectionLinkIds(fromDirectionId, toDirectionId);
  const row = await prisma.memoryEntry.findFirst({
    where: {
      orgId,
      tier: MemoryTier.ORG,
      key,
      redactedAt: null
    }
  });

  if (!row) {
    return false;
  }

  await prisma.memoryEntry.update({
    where: { id: row.id },
    data: {
      redactedAt: new Date(),
      value: Prisma.DbNull
    }
  });
  return true;
}

async function listDirectionFlowLinks(orgId: string) {
  const rows = await prisma.memoryEntry.findMany({
    where: {
      orgId,
      tier: MemoryTier.ORG,
      key: {
        startsWith: DIRECTION_FLOW_PREFIX
      },
      redactedAt: null
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 2000
  });

  return rows.map((row) => parseDirectionFlow(row.value, orgId));
}

export async function listDirectionFlowLinksByDirection(orgId: string, directionId: string) {
  const links = await listDirectionFlowLinks(orgId);
  return links.filter((item) => item.directionId === directionId);
}

export async function listDirectionFlowLinksByFlow(orgId: string, flowId: string) {
  const links = await listDirectionFlowLinks(orgId);
  return links.filter((item) => item.flowId === flowId);
}

export async function linkFlowToDirection(
  orgId: string,
  directionId: string,
  flowId: string,
  client?: MemoryEntryClient
) {
  const db = client ?? prisma;
  const record: DirectionFlowRecord = {
    id: randomUUID(),
    orgId,
    directionId,
    flowId,
    createdAt: new Date().toISOString()
  };

  await db.memoryEntry.create({
    data: {
      orgId,
      tier: MemoryTier.ORG,
      key: keyFromDirectionFlow(directionId, flowId),
      value: record as unknown as Prisma.InputJsonValue
    }
  });

  return record;
}

export async function getDirectionAutopsy(orgId: string, directionId: string) {
  const [direction, allDirections, links, flowLinks] = await Promise.all([
    getDirection(orgId, directionId),
    listDirections(orgId),
    listDirectionLinks(orgId, directionId),
    listDirectionFlowLinksByDirection(orgId, directionId)
  ]);

  if (!direction) {
    return null;
  }

  const relatedDirectionIds = new Set<string>([
    directionId,
    ...links.map((item) => item.fromDirectionId),
    ...links.map((item) => item.toDirectionId)
  ]);

  const nodes = allDirections
    .filter((item) => relatedDirectionIds.has(item.id))
    .map((item) => ({
      id: item.id,
      kind: "direction",
      title: item.title,
      summary: item.summary,
      status: item.status,
      impactScore: item.impactScore,
      isPrimary: item.id === directionId
    }));

  const flowNodes = flowLinks.map((item) => ({
    id: `flow:${item.flowId}`,
    kind: "flow",
    title: `Workflow ${item.flowId.slice(0, 8).toUpperCase()}`,
    summary: `Created from direction ${direction.title}`
  }));

  const edges = [
    ...links.map((item) => ({
      id: item.id,
      source: item.fromDirectionId,
      target: item.toDirectionId,
      relation: item.relation,
      note: item.note
    })),
    ...flowLinks.map((item) => ({
      id: item.id,
      source: item.directionId,
      target: `flow:${item.flowId}`,
      relation: "GENERATES",
      note: null
    }))
  ];

  return {
    direction,
    nodes: [...nodes, ...flowNodes],
    edges
  };
}
