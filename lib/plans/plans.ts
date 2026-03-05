import "server-only";

import { randomUUID } from "node:crypto";

import { MemoryTier, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";

export type PlanStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";
export type PlanSource = "MANUAL" | "CHAT" | "SYSTEM";

export interface PlanRecord {
  id: string;
  orgId: string;
  title: string;
  summary: string;
  direction: string;
  directionId: string | null;
  humanPlan: string;
  primaryPlan: Record<string, unknown>;
  fallbackPlan: Record<string, unknown>;
  status: PlanStatus;
  source: PlanSource;
  ownerEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CreatePlanInput {
  title: string;
  summary?: string;
  direction: string;
  directionId?: string | null;
  humanPlan?: string;
  primaryPlan?: Record<string, unknown>;
  fallbackPlan?: Record<string, unknown>;
  status?: PlanStatus;
  source?: PlanSource;
  ownerEmail?: string | null;
}

interface UpdatePlanInput {
  title?: string;
  summary?: string;
  direction?: string;
  directionId?: string | null;
  humanPlan?: string;
  primaryPlan?: Record<string, unknown>;
  fallbackPlan?: Record<string, unknown>;
  status?: PlanStatus;
  source?: PlanSource;
  ownerEmail?: string | null;
}

type MemoryEntryClient = Pick<Prisma.TransactionClient, "memoryEntry"> | typeof prisma;

const PLAN_PREFIX = "plan.record.";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeStatus(value: unknown): PlanStatus {
  if (value === "DRAFT") return "DRAFT";
  if (value === "ARCHIVED") return "ARCHIVED";
  return "ACTIVE";
}

function normalizeSource(value: unknown): PlanSource {
  if (value === "CHAT") return "CHAT";
  if (value === "SYSTEM") return "SYSTEM";
  return "MANUAL";
}

function keyFromPlanId(planId: string) {
  return `${PLAN_PREFIX}${planId}`;
}

function parsePlan(orgId: string, raw: unknown): PlanRecord {
  const data = asRecord(raw);
  const now = new Date().toISOString();
  const id = typeof data.id === "string" ? data.id : randomUUID();
  const primaryPlan = asRecord(data.primaryPlan);
  const fallbackPlan = asRecord(data.fallbackPlan);

  return {
    id,
    orgId,
    title:
      (typeof data.title === "string" && data.title.trim()) ||
      `Plan ${id.slice(0, 8).toUpperCase()}`,
    summary: typeof data.summary === "string" ? data.summary.trim() : "",
    direction: typeof data.direction === "string" ? data.direction.trim() : "",
    directionId:
      typeof data.directionId === "string" && data.directionId.trim().length > 0
        ? data.directionId.trim()
        : null,
    humanPlan: typeof data.humanPlan === "string" ? data.humanPlan : "",
    primaryPlan,
    fallbackPlan,
    status: normalizeStatus(data.status),
    source: normalizeSource(data.source),
    ownerEmail:
      typeof data.ownerEmail === "string" && data.ownerEmail.trim().length > 0
        ? data.ownerEmail.trim().toLowerCase()
        : null,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : now,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : now
  };
}

function sortByUpdatedAtDesc<T extends { updatedAt: string }>(rows: T[]) {
  return [...rows].sort((a, b) => {
    const left = new Date(a.updatedAt).getTime();
    const right = new Date(b.updatedAt).getTime();
    return right - left;
  });
}

export async function listPlans(orgId: string, client?: MemoryEntryClient) {
  const db = client ?? prisma;
  const rows = await db.memoryEntry.findMany({
    where: {
      orgId,
      tier: MemoryTier.ORG,
      key: {
        startsWith: PLAN_PREFIX
      },
      redactedAt: null
    },
    orderBy: {
      updatedAt: "desc"
    },
    take: 500
  });

  const plans = rows.map((row) => parsePlan(orgId, row.value));
  return sortByUpdatedAtDesc(plans);
}

export async function getPlan(orgId: string, planId: string, client?: MemoryEntryClient) {
  const db = client ?? prisma;
  const row = await db.memoryEntry.findFirst({
    where: {
      orgId,
      tier: MemoryTier.ORG,
      key: keyFromPlanId(planId),
      redactedAt: null
    }
  });

  if (!row) {
    return null;
  }
  return parsePlan(orgId, row.value);
}

export async function createPlan(orgId: string, input: CreatePlanInput, client?: MemoryEntryClient) {
  const db = client ?? prisma;
  const now = new Date().toISOString();
  const record: PlanRecord = {
    id: randomUUID(),
    orgId,
    title: input.title.trim() || `Plan ${new Date().toISOString().slice(0, 10)}`,
    summary: input.summary?.trim() || "",
    direction: input.direction.trim(),
    directionId: input.directionId?.trim() || null,
    humanPlan: input.humanPlan ?? "",
    primaryPlan: asRecord(input.primaryPlan),
    fallbackPlan: asRecord(input.fallbackPlan),
    status: normalizeStatus(input.status),
    source: normalizeSource(input.source),
    ownerEmail: input.ownerEmail?.trim().toLowerCase() || null,
    createdAt: now,
    updatedAt: now
  };

  await db.memoryEntry.create({
    data: {
      orgId,
      tier: MemoryTier.ORG,
      key: keyFromPlanId(record.id),
      value: record as unknown as Prisma.InputJsonValue
    }
  });

  return record;
}

export async function updatePlan(orgId: string, planId: string, patch: UpdatePlanInput) {
  const row = await prisma.memoryEntry.findFirst({
    where: {
      orgId,
      tier: MemoryTier.ORG,
      key: keyFromPlanId(planId),
      redactedAt: null
    }
  });

  if (!row) {
    return null;
  }

  const current = parsePlan(orgId, row.value);
  const next: PlanRecord = {
    ...current,
    ...(patch.title !== undefined ? { title: patch.title.trim() || current.title } : {}),
    ...(patch.summary !== undefined ? { summary: patch.summary.trim() } : {}),
    ...(patch.direction !== undefined
      ? { direction: patch.direction.trim() || current.direction }
      : {}),
    ...(patch.directionId !== undefined
      ? { directionId: patch.directionId?.trim() || null }
      : {}),
    ...(patch.humanPlan !== undefined ? { humanPlan: patch.humanPlan } : {}),
    ...(patch.primaryPlan !== undefined ? { primaryPlan: asRecord(patch.primaryPlan) } : {}),
    ...(patch.fallbackPlan !== undefined
      ? { fallbackPlan: asRecord(patch.fallbackPlan) }
      : {}),
    ...(patch.status !== undefined ? { status: normalizeStatus(patch.status) } : {}),
    ...(patch.source !== undefined ? { source: normalizeSource(patch.source) } : {}),
    ...(patch.ownerEmail !== undefined
      ? { ownerEmail: patch.ownerEmail?.trim().toLowerCase() || null }
      : {}),
    updatedAt: new Date().toISOString()
  };

  await prisma.memoryEntry.update({
    where: { id: row.id },
    data: {
      value: next as unknown as Prisma.InputJsonValue
    }
  });

  return next;
}
