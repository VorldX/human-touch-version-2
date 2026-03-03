import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";

export interface OrgActor {
  userId: string;
  email: string;
  orgId: string;
}

export async function requireOrgAccess(input: {
  request: NextRequest;
  orgId: string;
}) {
  const orgId = input.orgId.trim();
  if (!orgId) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          ok: false,
          message: "orgId is required."
        },
        { status: 400 }
      )
    };
  }

  const userEmail =
    input.request.headers.get("x-user-email")?.trim().toLowerCase() ?? "";
  const sessionUserId = input.request.headers.get("x-user-id")?.trim() ?? "";
  if (!userEmail || !sessionUserId) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          ok: false,
          message: "Authentication headers are required."
        },
        { status: 401 }
      )
    };
  }

  const user = await prisma.user.findFirst({
    where: {
      id: sessionUserId,
      email: userEmail
    },
    select: {
      id: true,
      email: true,
      orgMemberships: {
        where: { orgId },
        select: { orgId: true },
        take: 1
      }
    }
  });

  if (!user || user.orgMemberships.length === 0) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          ok: false,
          message: "You do not have access to this organization."
        },
        { status: 403 }
      )
    };
  }

  return {
    ok: true as const,
    actor: {
      userId: user.id,
      email: user.email,
      orgId
    } satisfies OrgActor
  };
}

