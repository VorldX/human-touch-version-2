export const dynamic = "force-dynamic";

import { OrgRole } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import {
  createJoinRequest,
  listOrgJoinRequests,
  listUserJoinRequests,
  type JoinRequestRole
} from "@/lib/squad/join-requests";
import { requireOrgAccess } from "@/lib/security/org-access";

interface SessionActor {
  userId: string;
  email: string;
  username: string;
}

function normalizeRequestedRole(value: unknown): JoinRequestRole {
  return value === "ADMIN" ? "ADMIN" : "EMPLOYEE";
}

async function resolveActor(request: NextRequest) {
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
      email: true,
      username: true
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
    actor: {
      userId: user.id,
      email: user.email,
      username: user.username
    } satisfies SessionActor
  };
}

async function resolveOrganizationByIdentifier(identifier: string) {
  const raw = identifier.trim();
  if (!raw) {
    return {
      organization: null as null,
      matches: [] as Array<{ id: string; name: string }>
    };
  }

  const byId = await prisma.organization.findUnique({
    where: { id: raw },
    select: { id: true, name: true }
  });
  if (byId) {
    return {
      organization: byId,
      matches: [] as Array<{ id: string; name: string }>
    };
  }

  const byExactName = await prisma.organization.findFirst({
    where: {
      name: {
        equals: raw,
        mode: "insensitive"
      }
    },
    select: { id: true, name: true }
  });
  if (byExactName) {
    return {
      organization: byExactName,
      matches: [] as Array<{ id: string; name: string }>
    };
  }

  const matches = await prisma.organization.findMany({
    where: {
      name: {
        contains: raw,
        mode: "insensitive"
      }
    },
    select: {
      id: true,
      name: true
    },
    orderBy: {
      updatedAt: "desc"
    },
    take: 5
  });

  if (matches.length === 1) {
    return {
      organization: matches[0],
      matches
    };
  }

  return {
    organization: null as null,
    matches
  };
}

async function ensureCanReviewRequests(input: { request: NextRequest; orgId: string }) {
  const access = await requireOrgAccess({
    request: input.request,
    orgId: input.orgId
  });
  if (!access.ok) {
    return access;
  }

  const membership = await prisma.orgMember.findFirst({
    where: {
      orgId: input.orgId,
      userId: access.actor.userId
    },
    select: {
      role: true
    }
  });

  if (!membership || (membership.role !== OrgRole.FOUNDER && membership.role !== OrgRole.ADMIN)) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          ok: false,
          message: "Only Founder/Admin can review join requests."
        },
        { status: 403 }
      )
    };
  }

  return access;
}

export async function GET(request: NextRequest) {
  const actorResult = await resolveActor(request);
  if (!actorResult.ok) {
    return actorResult.response;
  }

  const orgId = request.nextUrl.searchParams.get("orgId")?.trim() ?? "";
  if (!orgId) {
    const requests = await listUserJoinRequests({
      userId: actorResult.actor.userId,
      userEmail: actorResult.actor.email
    });

    const orgIds = [...new Set(requests.map((item) => item.orgId))];
    const organizations =
      orgIds.length > 0
        ? await prisma.organization.findMany({
            where: {
              id: {
                in: orgIds
              }
            },
            select: {
              id: true,
              name: true
            }
          })
        : [];
    const orgNameById = new Map(organizations.map((item) => [item.id, item.name]));

    return NextResponse.json({
      ok: true,
      requests: requests.map((item) => ({
        ...item,
        organizationName: orgNameById.get(item.orgId) ?? null
      }))
    });
  }

  const reviewAccess = await ensureCanReviewRequests({
    request,
    orgId
  });
  if (!reviewAccess.ok) {
    return reviewAccess.response;
  }

  const status = request.nextUrl.searchParams.get("status")?.trim().toUpperCase();
  const requests = await listOrgJoinRequests(
    orgId,
    status === "APPROVED" || status === "REJECTED" || status === "CANCELLED" || status === "PENDING"
      ? status
      : undefined
  );

  return NextResponse.json({
    ok: true,
    requests
  });
}

export async function POST(request: NextRequest) {
  const actorResult = await resolveActor(request);
  if (!actorResult.ok) {
    return actorResult.response;
  }

  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        organizationIdentifier?: string;
        message?: string;
        requestedRole?: JoinRequestRole;
      }
    | null;

  const identifier = body?.orgId?.trim() || body?.organizationIdentifier?.trim() || "";
  if (!identifier) {
    return NextResponse.json(
      {
        ok: false,
        message: "Provide orgId or organizationIdentifier."
      },
      { status: 400 }
    );
  }

  const resolved = await resolveOrganizationByIdentifier(identifier);
  if (!resolved.organization) {
    return NextResponse.json(
      {
        ok: false,
        message:
          resolved.matches.length > 1
            ? "Multiple organizations matched. Use a specific organization id."
            : "Organization not found.",
        matches: resolved.matches
      },
      { status: resolved.matches.length > 1 ? 409 : 404 }
    );
  }

  const org = resolved.organization;

  const existingMembership = await prisma.orgMember.findFirst({
    where: {
      orgId: org.id,
      userId: actorResult.actor.userId
    },
    select: {
      orgId: true
    }
  });
  if (existingMembership) {
    return NextResponse.json(
      {
        ok: false,
        message: "You are already a member of this organization."
      },
      { status: 409 }
    );
  }

  const created = await createJoinRequest({
    orgId: org.id,
    requesterUserId: actorResult.actor.userId,
    requesterEmail: actorResult.actor.email,
    requesterName: actorResult.actor.username,
    requestedRole: normalizeRequestedRole(body?.requestedRole),
    message: body?.message?.trim() || ""
  });

  if (!created.ok && created.reason === "already_pending") {
    return NextResponse.json(
      {
        ok: false,
        message: "A pending request already exists for this organization.",
        request: created.request,
        organization: org
      },
      { status: 409 }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      request: created.request,
      organization: org
    },
    { status: 201 }
  );
}
