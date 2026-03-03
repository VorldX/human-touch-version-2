import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";

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

  const updated = await prisma.memoryEntry.update({
    where: { id: entryId },
    data: {
      value: Prisma.DbNull,
      redactedAt: new Date()
    }
  });

  return NextResponse.json({
    ok: true,
    entry: updated
  });
}
