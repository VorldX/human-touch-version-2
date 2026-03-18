import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { OrgRole } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { hasValidInternalApiKey } from "@/lib/security/internal-api";

export interface OrgActor {
  userId: string;
  email: string;
  orgId: string;
  isInternal?: boolean;
  role?: OrgRole | "INTERNAL";
  isAdmin?: boolean;
}

export async function requireOrgAccess(input: {
  request: NextRequest;
  orgId: string;
  allowInternal?: boolean;
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

  if (input.allowInternal && hasValidInternalApiKey(input.request)) {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true }
    });
    if (!org) {
      return {
        ok: false as const,
        response: NextResponse.json(
          {
            ok: false,
            message: "Organization not found."
          },
          { status: 404 }
        )
      };
    }

    return {
      ok: true as const,
      actor: {
        userId: "internal-system",
        email: "internal@vorldx.local",
        orgId,
        isInternal: true,
        role: "INTERNAL",
        isAdmin: true
      } satisfies OrgActor
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
        select: { orgId: true, role: true },
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

  const role = user.orgMemberships[0]?.role ?? OrgRole.EMPLOYEE;
  const adminRoles: OrgRole[] = [OrgRole.FOUNDER, OrgRole.ADMIN];

  return {
    ok: true as const,
    actor: {
      userId: user.id,
      email: user.email,
      orgId,
      role,
      isAdmin: adminRoles.includes(role)
    } satisfies OrgActor
  };
}
