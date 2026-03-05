import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";

function toRoleLabel(role: string) {
  if (role === "FOUNDER") return "Founder";
  if (role === "ADMIN") return "Admin";
  if (role === "EMPLOYEE") return "Employee";
  return role;
}

export async function GET(request: NextRequest) {
  const userEmail = request.headers.get("x-user-email")?.trim().toLowerCase() ?? "";
  const sessionUserId = request.headers.get("x-user-id")?.trim() ?? "";

  if (!userEmail || !sessionUserId) {
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
      email: userEmail
    },
    select: {
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
    theme: membership.org.theme
  }));

  return NextResponse.json({
    ok: true,
    activeOrgId: user.activeOrgId,
    orgs
  });
}
