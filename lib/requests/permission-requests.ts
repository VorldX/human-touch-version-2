import "server-only";

import { randomUUID } from "node:crypto";

import { MemoryTier, OrgRole, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";

export type PermissionRequestStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED";
export type PermissionDecision = "APPROVE" | "REJECT";

export interface PermissionRequestRecord {
  id: string;
  orgId: string;
  direction: string;
  directionId: string | null;
  planId: string | null;
  requestedByUserId: string;
  requestedByEmail: string;
  targetRole: "FOUNDER" | "ADMIN" | "EMPLOYEE";
  area: string;
  reason: string;
  workflowTitle: string;
  taskTitle: string;
  status: PermissionRequestStatus;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
  decidedByUserId: string | null;
  decidedByEmail: string | null;
  decisionNote: string | null;
}

const REQUEST_PREFIX = "org.request.permission.";

function keyForRequest(requestId: string) {
  return `${REQUEST_PREFIX}${requestId}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeStatus(value: unknown): PermissionRequestStatus {
  if (value === "APPROVED") return "APPROVED";
  if (value === "REJECTED") return "REJECTED";
  if (value === "CANCELLED") return "CANCELLED";
  return "PENDING";
}

function normalizeTargetRole(value: unknown): "FOUNDER" | "ADMIN" | "EMPLOYEE" {
  if (value === "FOUNDER") return "FOUNDER";
  if (value === "ADMIN") return "ADMIN";
  return "EMPLOYEE";
}

function parseRequest(orgId: string, raw: unknown): PermissionRequestRecord {
  const data = asRecord(raw);
  const now = new Date().toISOString();
  return {
    id: typeof data.id === "string" ? data.id : randomUUID(),
    orgId,
    direction: typeof data.direction === "string" ? data.direction : "",
    directionId:
      typeof data.directionId === "string" && data.directionId.trim().length > 0
        ? data.directionId.trim()
        : null,
    planId:
      typeof data.planId === "string" && data.planId.trim().length > 0
        ? data.planId.trim()
        : null,
    requestedByUserId:
      typeof data.requestedByUserId === "string" ? data.requestedByUserId : "",
    requestedByEmail:
      typeof data.requestedByEmail === "string"
        ? data.requestedByEmail.toLowerCase()
        : "",
    targetRole: normalizeTargetRole(data.targetRole),
    area: typeof data.area === "string" ? data.area : "General",
    reason: typeof data.reason === "string" ? data.reason : "",
    workflowTitle:
      typeof data.workflowTitle === "string" ? data.workflowTitle : "",
    taskTitle: typeof data.taskTitle === "string" ? data.taskTitle : "",
    status: normalizeStatus(data.status),
    createdAt: typeof data.createdAt === "string" ? data.createdAt : now,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : now,
    decidedAt: typeof data.decidedAt === "string" ? data.decidedAt : null,
    decidedByUserId:
      typeof data.decidedByUserId === "string" ? data.decidedByUserId : null,
    decidedByEmail:
      typeof data.decidedByEmail === "string" ? data.decidedByEmail : null,
    decisionNote:
      typeof data.decisionNote === "string" ? data.decisionNote : null
  };
}

export async function listOrgPermissionRequests(
  orgId: string,
  status?: PermissionRequestStatus
) {
  const rows = await prisma.memoryEntry.findMany({
    where: {
      orgId,
      tier: MemoryTier.ORG,
      key: {
        startsWith: REQUEST_PREFIX
      },
      redactedAt: null
    },
    orderBy: {
      updatedAt: "desc"
    },
    take: 500
  });

  const parsed = rows.map((row) => parseRequest(orgId, row.value));
  if (!status) {
    return parsed;
  }
  return parsed.filter((item) => item.status === status);
}

export async function clearOrgPermissionRequests(orgId: string) {
  const result = await prisma.memoryEntry.updateMany({
    where: {
      orgId,
      tier: MemoryTier.ORG,
      key: {
        startsWith: REQUEST_PREFIX
      },
      redactedAt: null
    },
    data: {
      redactedAt: new Date()
    }
  });

  return result.count;
}

export async function createPermissionRequests(input: {
  orgId: string;
  direction: string;
  directionId?: string | null;
  planId?: string | null;
  requestedByUserId: string;
  requestedByEmail: string;
  items: Array<{
    area?: string;
    reason?: string;
    workflowTitle?: string;
    taskTitle?: string;
    targetRole?: "FOUNDER" | "ADMIN" | "EMPLOYEE";
  }>;
}) {
  const now = new Date().toISOString();

  const normalizedItems = input.items
    .map((item) => ({
      area: item.area?.trim() || "General",
      reason: item.reason?.trim() || "",
      workflowTitle: item.workflowTitle?.trim() || "",
      taskTitle: item.taskTitle?.trim() || "",
      targetRole: normalizeTargetRole(item.targetRole)
    }))
    .filter((item) => item.reason.length > 0);

  if (normalizedItems.length === 0) {
    return [];
  }

  const created: PermissionRequestRecord[] = [];
  await prisma.$transaction(async (tx) => {
    for (const item of normalizedItems) {
      const request: PermissionRequestRecord = {
        id: randomUUID(),
        orgId: input.orgId,
        direction: input.direction.trim(),
        directionId: input.directionId?.trim() || null,
        planId: input.planId?.trim() || null,
        requestedByUserId: input.requestedByUserId,
        requestedByEmail: input.requestedByEmail.trim().toLowerCase(),
        targetRole: item.targetRole,
        area: item.area,
        reason: item.reason,
        workflowTitle: item.workflowTitle,
        taskTitle: item.taskTitle,
        status: "PENDING",
        createdAt: now,
        updatedAt: now,
        decidedAt: null,
        decidedByUserId: null,
        decidedByEmail: null,
        decisionNote: null
      };

      await tx.memoryEntry.create({
        data: {
          orgId: input.orgId,
          tier: MemoryTier.ORG,
          key: keyForRequest(request.id),
          value: request as unknown as Prisma.InputJsonValue
        }
      });

      created.push(request);
    }
  });

  return created;
}

export async function decidePermissionRequest(input: {
  orgId: string;
  requestId: string;
  decision: PermissionDecision;
  decidedByUserId: string;
  decidedByEmail: string;
  note?: string;
}) {
  const row = await prisma.memoryEntry.findFirst({
    where: {
      orgId: input.orgId,
      tier: MemoryTier.ORG,
      key: keyForRequest(input.requestId),
      redactedAt: null
    }
  });

  if (!row) {
    return null;
  }

  const current = parseRequest(input.orgId, row.value);
  if (current.status !== "PENDING") {
    return current;
  }

  const now = new Date().toISOString();
  const next: PermissionRequestRecord = {
    ...current,
    status: input.decision === "APPROVE" ? "APPROVED" : "REJECTED",
    updatedAt: now,
    decidedAt: now,
    decidedByUserId: input.decidedByUserId,
    decidedByEmail: input.decidedByEmail.trim().toLowerCase(),
    decisionNote: input.note?.trim() || null
  };

  await prisma.memoryEntry.update({
    where: {
      id: row.id
    },
    data: {
      value: next as unknown as Prisma.InputJsonValue
    }
  });

  return next;
}

export function canReviewPermissionRequests(role: OrgRole | null | undefined) {
  return role === OrgRole.FOUNDER || role === OrgRole.ADMIN;
}
