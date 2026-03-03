import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";

export interface IntegrationActor {
  orgId: string;
  userId: string;
  userEmail: string;
  sessionUserId: string;
}

export async function resolveIntegrationActor(input: {
  request: NextRequest;
  body?: {
    orgId?: string;
    userEmail?: string;
    userId?: string;
  } | null;
}): Promise<
  | {
      ok: true;
      actor: IntegrationActor;
    }
  | {
      ok: false;
      response: NextResponse;
    }
> {
  const orgId =
    input.request.nextUrl.searchParams.get("orgId")?.trim() ||
    input.body?.orgId?.trim() ||
    "";

  if (!orgId) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          message: "orgId is required."
        },
        { status: 400 }
      )
    };
  }

  const userEmail = input.request.headers.get("x-user-email")?.trim().toLowerCase() || "";
  const sessionUserId = input.request.headers.get("x-user-id")?.trim() || "";

  if (!userEmail || !sessionUserId) {
    return {
      ok: false,
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
      email: userEmail,
      orgMemberships: {
        some: {
          orgId
        }
      }
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
      ok: false,
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
    ok: true,
    actor: {
      orgId,
      userId: user.id,
      userEmail: user.email,
      sessionUserId
    }
  };
}
