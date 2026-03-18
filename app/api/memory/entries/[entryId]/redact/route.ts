export const dynamic = "force-dynamic";

import { LogType, Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { buildComplianceHash } from "@/lib/security/audit";
import { requireOrgAccess } from "@/lib/security/org-access";

interface RouteContext {
  params: {
    entryId: string;
  };
}

export async function POST(request: NextRequest, context: RouteContext) {
  const entryId = context.params.entryId?.trim();
  const body = (await request.json().catch(() => null)) as { orgId?: string } | null;
  const orgId = body?.orgId?.trim() ?? "";

  if (!entryId || !orgId) {
    return NextResponse.json(
      {
        ok: false,
        message: "entryId and orgId are required."
      },
      { status: 400 }
    );
  }
  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  const entry = await prisma.memoryEntry.findUnique({
    where: { id: entryId }
  });

  if (!entry || entry.orgId !== orgId) {
    return NextResponse.json(
      {
        ok: false,
        message: "Memory entry not found for this organization."
      },
      { status: 404 }
    );
  }
  if (entry.redactedAt) {
    return NextResponse.json({
      ok: true,
      entry
    });
  }

  const actionType = "MEMORY_ENTRY_REDACT";
  const redactedAt = new Date();
  const complianceHash = buildComplianceHash({
    actionType,
    orgId,
    flowId: entry.flowId,
    taskId: entry.taskId,
    memoryEntryId: entry.id,
    tier: entry.tier,
    key: entry.key,
    actor: access.actor.userId,
    timestamp: redactedAt.toISOString()
  });
  const humanActorId = access.actor.isInternal ? null : access.actor.userId;

  const updated = await prisma.$transaction(async (tx) => {
    const nextEntry = await tx.memoryEntry.update({
      where: { id: entryId },
      data: {
        value: Prisma.DbNull,
        redactedAt
      }
    });

    await tx.log.create({
      data: {
        orgId,
        type: LogType.SCRUB,
        actor: "MEMORY_API",
        message: `Memory entry ${nextEntry.id} redacted (${nextEntry.tier}/${nextEntry.key}).`
      }
    });

    await tx.complianceAudit.create({
      data: {
        orgId,
        flowId: nextEntry.flowId,
        humanActorId,
        actionType,
        complianceHash
      }
    });

    return nextEntry;
  });

  return NextResponse.json({
    ok: true,
    entry: updated
  });
}
