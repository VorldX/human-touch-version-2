export const dynamic = "force-dynamic";

import { OrgRole, OrganizationTheme } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";

function toRoleLabel(role: OrgRole) {
  if (role === OrgRole.FOUNDER) return "Founder";
  if (role === OrgRole.ADMIN) return "Admin";
  return "Employee";
}

function toTheme(value: OrganizationTheme): "APEX" | "VEDA" | "NEXUS" {
  if (value === OrganizationTheme.APEX) return "APEX";
  if (value === OrganizationTheme.VEDA) return "VEDA";
  return "NEXUS";
}

async function loadSessionUser(request: NextRequest) {
  const sessionUserId = request.headers.get("x-user-id")?.trim() ?? "";
  const email = request.headers.get("x-user-email")?.trim().toLowerCase() ?? "";

  if (!sessionUserId || !email) {
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
      email
    },
    select: {
      id: true,
      activeOrgId: true,
      orgMemberships: {
        select: {
          role: true,
          org: {
            select: {
              id: true,
              name: true,
              theme: true
            }
          }
        },
        orderBy: {
          createdAt: "asc"
        }
      }
    }
  });

  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          ok: false,
          message: "Session is invalid."
        },
        { status: 401 }
      )
    };
  }

  return {
    ok: true as const,
    user
  };
}

function serializeOrgs(
  memberships: Array<{
    role: OrgRole;
    org: {
      id: string;
      name: string;
      theme: OrganizationTheme;
    };
  }>
) {
  return memberships.map((membership) => ({
    id: membership.org.id,
    name: membership.org.name,
    role: toRoleLabel(membership.role),
    theme: toTheme(membership.org.theme)
  }));
}

export async function GET(request: NextRequest) {
  try {
    const session = await loadSessionUser(request);
    if (!session.ok) {
      return session.response;
    }

    const { user } = session;
    const orgs = serializeOrgs(user.orgMemberships);

    const activeOrgId =
      user.activeOrgId && orgs.some((item) => item.id === user.activeOrgId)
        ? user.activeOrgId
        : orgs[0]?.id ?? null;

    if (activeOrgId !== user.activeOrgId) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          activeOrgId
        }
      });
    }

    return NextResponse.json({
      ok: true,
      orgs,
      activeOrgId
    });
  } catch (error) {
    console.error("[api/orgs][GET] unexpected error", error);
    return NextResponse.json(
      {
        ok: false,
        message: "Unable to load organizations right now."
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await loadSessionUser(request);
    if (!session.ok) {
      return session.response;
    }

    const body = (await request.json().catch(() => null)) as { orgId?: string } | null;
    const requestedOrgId = body?.orgId?.trim() ?? "";

    if (!requestedOrgId) {
      return NextResponse.json(
        {
          ok: false,
          message: "orgId is required."
        },
        { status: 400 }
      );
    }

    const { user } = session;
    const orgs = serializeOrgs(user.orgMemberships);
    const nextOrg = orgs.find((item) => item.id === requestedOrgId);

    if (!nextOrg) {
      return NextResponse.json(
        {
          ok: false,
          message: "You do not have access to that organization."
        },
        { status: 403 }
      );
    }

    if (user.activeOrgId !== requestedOrgId) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          activeOrgId: requestedOrgId
        }
      });
    }

    return NextResponse.json({
      ok: true,
      orgs,
      activeOrgId: requestedOrgId
    });
  } catch (error) {
    console.error("[api/orgs][PATCH] unexpected error", error);
    return NextResponse.json(
      {
        ok: false,
        message: "Unable to switch organizations right now."
      },
      { status: 500 }
    );
  }
}
