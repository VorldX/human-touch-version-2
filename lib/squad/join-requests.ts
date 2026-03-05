import "server-only";

import { randomUUID } from "node:crypto";

import { MemoryTier, OrgRole, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";

export type JoinRequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
export type JoinRequestRole = "EMPLOYEE" | "ADMIN";

export interface JoinRequestRecord {
  id: string;
  orgId: string;
  requesterUserId: string;
  requesterEmail: string;
  requesterName: string | null;
  requestedRole: JoinRequestRole;
  message: string;
  status: JoinRequestStatus;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
  decidedByUserId: string | null;
  decidedByEmail: string | null;
  decisionNote: string | null;
}

const JOIN_REQUEST_PREFIX = "squad.join-request.";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeRole(value: unknown): JoinRequestRole {
  return value === "ADMIN" ? "ADMIN" : "EMPLOYEE";
}

function normalizeStatus(value: unknown): JoinRequestStatus {
  if (value === "APPROVED") return "APPROVED";
  if (value === "REJECTED") return "REJECTED";
  if (value === "CANCELLED") return "CANCELLED";
  return "PENDING";
}

function keyForRequest(requestId: string) {
  return `${JOIN_REQUEST_PREFIX}${requestId}`;
}

function parseRequest(orgId: string, raw: unknown): JoinRequestRecord {
  const data = asRecord(raw);
  const now = new Date().toISOString();
  return {
    id: typeof data.id === "string" ? data.id : randomUUID(),
    orgId,
    requesterUserId: typeof data.requesterUserId === "string" ? data.requesterUserId : "",
    requesterEmail:
      typeof data.requesterEmail === "string" ? data.requesterEmail.toLowerCase() : "",
    requesterName: typeof data.requesterName === "string" ? data.requesterName : null,
    requestedRole: normalizeRole(data.requestedRole),
    message: typeof data.message === "string" ? data.message : "",
    status: normalizeStatus(data.status),
    createdAt: typeof data.createdAt === "string" ? data.createdAt : now,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : now,
    decidedAt: typeof data.decidedAt === "string" ? data.decidedAt : null,
    decidedByUserId:
      typeof data.decidedByUserId === "string" ? data.decidedByUserId : null,
    decidedByEmail:
      typeof data.decidedByEmail === "string" ? data.decidedByEmail : null,
    decisionNote: typeof data.decisionNote === "string" ? data.decisionNote : null
  };
}

export async function listOrgJoinRequests(orgId: string, status?: JoinRequestStatus) {
  const rows = await prisma.memoryEntry.findMany({
    where: {
      orgId,
      tier: MemoryTier.ORG,
      key: {
        startsWith: JOIN_REQUEST_PREFIX
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

export async function listUserJoinRequests(input: { userId: string; userEmail: string }) {
  const rows = await prisma.memoryEntry.findMany({
    where: {
      tier: MemoryTier.ORG,
      key: {
        startsWith: JOIN_REQUEST_PREFIX
      },
      redactedAt: null
    },
    orderBy: {
      updatedAt: "desc"
    },
    take: 1000
  });

  const email = input.userEmail.trim().toLowerCase();
  return rows
    .map((row) => parseRequest(row.orgId, row.value))
    .filter((item) => item.requesterUserId === input.userId || item.requesterEmail === email);
}

export async function createJoinRequest(input: {
  orgId: string;
  requesterUserId: string;
  requesterEmail: string;
  requesterName?: string | null;
  requestedRole?: JoinRequestRole;
  message?: string;
}) {
  const pending = await listOrgJoinRequests(input.orgId, "PENDING");
  const existing = pending.find((item) => item.requesterUserId === input.requesterUserId);
  if (existing) {
    return {
      ok: false as const,
      reason: "already_pending" as const,
      request: existing
    };
  }

  const now = new Date().toISOString();
  const request: JoinRequestRecord = {
    id: randomUUID(),
    orgId: input.orgId,
    requesterUserId: input.requesterUserId,
    requesterEmail: input.requesterEmail.trim().toLowerCase(),
    requesterName: input.requesterName?.trim() || null,
    requestedRole: normalizeRole(input.requestedRole),
    message: input.message?.trim() || "",
    status: "PENDING",
    createdAt: now,
    updatedAt: now,
    decidedAt: null,
    decidedByUserId: null,
    decidedByEmail: null,
    decisionNote: null
  };

  await prisma.memoryEntry.create({
    data: {
      orgId: input.orgId,
      tier: MemoryTier.ORG,
      key: keyForRequest(request.id),
      value: request as unknown as Prisma.InputJsonValue
    }
  });

  return {
    ok: true as const,
    request
  };
}

export async function decideJoinRequest(input: {
  orgId: string;
  requestId: string;
  decision: "APPROVE" | "REJECT";
  role?: JoinRequestRole;
  note?: string;
  decidedByUserId: string;
  decidedByEmail: string;
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

  const decidedAt = new Date().toISOString();
  const decidedRole = normalizeRole(input.role ?? current.requestedRole);
  const nextStatus: JoinRequestStatus =
    input.decision === "APPROVE" ? "APPROVED" : "REJECTED";
  const nextRole: OrgRole = decidedRole === "ADMIN" ? OrgRole.ADMIN : OrgRole.EMPLOYEE;

  const next: JoinRequestRecord = {
    ...current,
    ...(input.decision === "APPROVE" ? { requestedRole: decidedRole } : {}),
    status: nextStatus,
    updatedAt: decidedAt,
    decidedAt,
    decidedByUserId: input.decidedByUserId,
    decidedByEmail: input.decidedByEmail.trim().toLowerCase(),
    decisionNote: input.note?.trim() || null
  };

  await prisma.$transaction(async (tx) => {
    if (input.decision === "APPROVE") {
      await tx.orgMember.upsert({
        where: {
          userId_orgId: {
            userId: current.requesterUserId,
            orgId: current.orgId
          }
        },
        update: {
          role: nextRole
        },
        create: {
          userId: current.requesterUserId,
          orgId: current.orgId,
          role: nextRole
        }
      });

      const requester = await tx.user.findUnique({
        where: { id: current.requesterUserId },
        select: { activeOrgId: true }
      });
      if (requester && !requester.activeOrgId) {
        await tx.user.update({
          where: { id: current.requesterUserId },
          data: {
            activeOrgId: current.orgId
          }
        });
      }
    }

    await tx.memoryEntry.update({
      where: { id: row.id },
      data: {
        value: next as unknown as Prisma.InputJsonValue
      }
    });
  });

  return next;
}

