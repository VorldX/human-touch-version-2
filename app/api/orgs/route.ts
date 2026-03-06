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

export async function GET(request: NextRequest) {
  try {
    const sessionUserId = request.headers.get("x-user-id")?.trim() ?? "";
    const email = request.headers.get("x-user-email")?.trim().toLowerCase() ?? "";

    if (!sessionUserId || !email) {
      return NextResponse.json(
        {
          ok: false,
          message: "Authentication headers are required."
        },
        { status: 401 }
      );
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
      return NextResponse.json(
        {
          ok: false,
          message: "Session is invalid."
        },
        { status: 401 }
      );
    }

    const orgs = user.orgMemberships.map((membership) => ({
      id: membership.org.id,
      name: membership.org.name,
      role: toRoleLabel(membership.role),
      theme: toTheme(membership.org.theme)
    }));

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
