export const dynamic = "force-dynamic";

import { randomUUID } from "node:crypto";

import { LogType, OrgRole, OrganizationTheme, type Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import {
  COLLABORATION_ACCESS_AREA_CATALOG,
  COLLABORATION_MANAGEMENT_LEVEL_CATALOG,
  defaultAccessAreasForManagementLevel,
  defaultManagementLevelForOrgRole,
  ensureCompanyDataFile,
  getOrganizationalInputDocuments,
  getOrganizationalOutputFiles,
  readDelegatedAccessEntries,
  readOrganizationCollaboration,
  type CollaborationAccessArea,
  type CollaborationManagementLevel,
  type CollaborationMemberProfileEntry,
  type CollaborationTeamEntry,
  type HubAccessTargetKind,
  type HubDelegatedAccessEntry,
  writeOrganizationCollaborationMetadata,
  writeDelegatedAccessMetadata,
  updateCompanyDataFile
} from "@/lib/hub/organization-hub";
import { requireOrgAccess } from "@/lib/security/org-access";

function toRoleLabel(role: OrgRole) {
  if (role === OrgRole.FOUNDER) return "Founder";
  if (role === OrgRole.ADMIN) return "Admin";
  return "Employee";
}

function toThemeLabel(theme: OrganizationTheme) {
  if (theme === OrganizationTheme.APEX) return "APEX";
  if (theme === OrganizationTheme.VEDA) return "VEDA";
  return "NEXUS";
}

function parseManagedRole(value: unknown) {
  if (value === OrgRole.ADMIN || value === "ADMIN") return OrgRole.ADMIN;
  if (value === OrgRole.EMPLOYEE || value === "EMPLOYEE") return OrgRole.EMPLOYEE;
  return null;
}

function parseManagementLevel(value: unknown): CollaborationManagementLevel | null {
  if (value === "FOUNDER") return "FOUNDER";
  if (value === "ADMIN") return "ADMIN";
  if (value === "SUB_ADMIN") return "SUB_ADMIN";
  if (value === "MANAGER") return "MANAGER";
  if (value === "WORKER") return "WORKER";
  return null;
}

function parseAccessAreas(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  const next = new Set<CollaborationAccessArea>();
  for (const item of value) {
    if (
      item === "STRINGS" ||
      item === "APPROVALS" ||
      item === "WORKFORCE" ||
      item === "HUB" ||
      item === "SETTINGS" ||
      item === "ROLES"
    ) {
      next.add(item);
    }
  }
  return [...next].sort((left, right) => left.localeCompare(right));
}

function parseCollaborationAction(value: unknown) {
  if (value === "SAVE_MEMBER_PROFILE") return "SAVE_MEMBER_PROFILE";
  if (value === "SAVE_TEAM") return "SAVE_TEAM";
  if (value === "DELETE_TEAM") return "DELETE_TEAM";
  if (value === "SET_ACTIVE_TEAM") return "SET_ACTIVE_TEAM";
  return null;
}

function rolePriority(role: OrgRole) {
  if (role === OrgRole.FOUNDER) return 0;
  if (role === OrgRole.ADMIN) return 1;
  return 2;
}

function accessKindLabel(kind: HubAccessTargetKind) {
  if (kind === "MEMBER") return "Member";
  if (kind === "PERSONNEL") return "Workforce";
  return "Team";
}

function parseAccessKind(value: unknown): HubAccessTargetKind | null {
  if (value === "MEMBER" || value === "PERSONNEL" || value === "TEAM") return value;
  return null;
}

function parseAccessAction(value: unknown) {
  if (value === "ADD" || value === "REMOVE") return value;
  return null;
}

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueTextList(value: unknown) {
  const items = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  return items
    .map((item) => asText(item))
    .filter((item) => {
      if (!item || seen.has(item)) {
        return false;
      }
      seen.add(item);
      return true;
    })
    .sort((left, right) => left.localeCompare(right));
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function asRecord(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

const managementLevelLabelById = new Map(
  COLLABORATION_MANAGEMENT_LEVEL_CATALOG.map((item) => [item.id, item.label] as const)
);
const accessAreaLabelById = new Map(
  COLLABORATION_ACCESS_AREA_CATALOG.map((item) => [item.id, item.label] as const)
);

function managementLevelLabel(level: CollaborationManagementLevel) {
  return managementLevelLabelById.get(level) ?? level;
}

function resolveMemberProfile(input: {
  role: OrgRole;
  profile: CollaborationMemberProfileEntry | null | undefined;
  assignedTeamIds: string[];
}) {
  if (input.role === OrgRole.FOUNDER) {
    return {
      managementLevel: "FOUNDER" as const,
      accessAreas: defaultAccessAreasForManagementLevel("FOUNDER"),
      activeTeamId:
        input.profile?.activeTeamId && input.assignedTeamIds.includes(input.profile.activeTeamId)
          ? input.profile.activeTeamId
          : input.assignedTeamIds[0] ?? null
    };
  }

  if (input.role === OrgRole.ADMIN) {
    return {
      managementLevel: "ADMIN" as const,
      accessAreas: defaultAccessAreasForManagementLevel("ADMIN"),
      activeTeamId:
        input.profile?.activeTeamId && input.assignedTeamIds.includes(input.profile.activeTeamId)
          ? input.profile.activeTeamId
          : input.assignedTeamIds[0] ?? null
    };
  }

  const managementLevel =
    input.profile?.managementLevel && input.profile.managementLevel !== "FOUNDER" && input.profile.managementLevel !== "ADMIN"
      ? input.profile.managementLevel
      : defaultManagementLevelForOrgRole(input.role);
  const accessAreas =
    input.profile?.accessAreas?.length && input.profile.managementLevel === managementLevel
      ? input.profile.accessAreas
      : defaultAccessAreasForManagementLevel(managementLevel);
  const activeTeamId =
    input.profile?.activeTeamId && input.assignedTeamIds.includes(input.profile.activeTeamId)
      ? input.profile.activeTeamId
      : input.assignedTeamIds[0] ?? null;

  return {
    managementLevel,
    accessAreas,
    activeTeamId
  };
}

function denyManageAccess(message = "Founder or admin access is required to manage organization settings.") {
  return NextResponse.json(
    {
      ok: false,
      message
    },
    { status: 403 }
  );
}

export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("orgId")?.trim();
  if (!orgId) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId query param is required."
      },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  try {
    const [company, outputs, documents, organization] = await Promise.all([
      ensureCompanyDataFile(orgId),
      getOrganizationalOutputFiles(orgId),
      getOrganizationalInputDocuments(orgId),
      prisma.organization.findUnique({
        where: { id: orgId },
        select: {
          id: true,
          name: true,
          description: true,
          theme: true,
          executionMode: true,
          monthlyBudget: true,
          currentSpend: true,
          monthlyBtuCap: true,
          currentBtuBurn: true,
          createdAt: true,
          updatedAt: true,
          members: {
            select: {
              role: true,
              createdAt: true,
              user: {
                select: {
                  id: true,
                  username: true,
                  email: true,
                  activeOrgId: true
                }
              }
            }
          },
          personnel: {
            select: {
              id: true,
              name: true,
              type: true,
              role: true,
              status: true
            }
          }
        }
      })
    ]);

    if (!organization) {
      return NextResponse.json(
        {
          ok: false,
          message: "Organization not found."
        },
        { status: 404 }
      );
    }

    const sortedMembers = [...organization.members].sort((left, right) => {
      const roleDelta = rolePriority(left.role) - rolePriority(right.role);
      if (roleDelta !== 0) return roleDelta;
      return left.createdAt.getTime() - right.createdAt.getTime();
    });

    const members = sortedMembers.map((member) => ({
      userId: member.user.id,
      username: member.user.username,
      email: member.user.email,
      role: member.role,
      roleLabel: toRoleLabel(member.role),
      joinedAt: member.createdAt,
      isActiveOrganization: member.user.activeOrgId === orgId
    }));

    const memberCounts = members.reduce(
      (summary, member) => {
        if (member.role === OrgRole.FOUNDER) summary.founders += 1;
        else if (member.role === OrgRole.ADMIN) summary.admins += 1;
        else summary.employees += 1;
        return summary;
      },
      { founders: 0, admins: 0, employees: 0 }
    );

    const workforce = organization.personnel.reduce(
      (summary, person) => {
        if (person.type === "HUMAN") {
          summary.humans += 1;
          if (person.status === "ACTIVE") summary.activeHumans += 1;
        } else {
          summary.agents += 1;
          if (person.status === "ACTIVE") summary.activeAgents += 1;
        }
        return summary;
      },
      { humans: 0, agents: 0, activeHumans: 0, activeAgents: 0 }
    );

    const memberById = new Map(members.map((member) => [member.userId, member] as const));
    const personnelById = new Map(
      organization.personnel.map((person) => [person.id, person] as const)
    );
    const collaborationState = readOrganizationCollaboration(company.file.metadata);
    const collaborationProfilesByUserId = new Map(
      collaborationState.memberProfiles.map((entry) => [entry.userId, entry] as const)
    );
    const teamIdsByUserId = new Map<string, string[]>();
    const teamIdsByPersonnelId = new Map<string, string[]>();

    for (const team of collaborationState.teams) {
      for (const memberUserId of team.memberUserIds) {
        const items = teamIdsByUserId.get(memberUserId) ?? [];
        items.push(team.id);
        teamIdsByUserId.set(memberUserId, items);
      }
      for (const personnelId of team.personnelIds) {
        const items = teamIdsByPersonnelId.get(personnelId) ?? [];
        items.push(team.id);
        teamIdsByPersonnelId.set(personnelId, items);
      }
    }

    const collaborationTeams = collaborationState.teams.map((team) => {
      const resolvedMembers = team.memberUserIds
        .map((memberUserId) => memberById.get(memberUserId))
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
      const resolvedPersonnel = team.personnelIds
        .map((personnelId) => personnelById.get(personnelId))
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
      const leadMember = team.leadUserId ? memberById.get(team.leadUserId) ?? null : null;

      return {
        id: team.id,
        name: team.name,
        description: team.description,
        leadUserId: team.leadUserId,
        leadName: leadMember?.username ?? null,
        leadEmail: leadMember?.email ?? null,
        memberUserIds: resolvedMembers.map((member) => member.userId),
        memberNames: resolvedMembers.map((member) => member.username),
        memberCount: resolvedMembers.length,
        personnelIds: resolvedPersonnel.map((person) => person.id),
        personnelNames: resolvedPersonnel.map((person) => person.name),
        personnelCount: resolvedPersonnel.length,
        createdAt: team.createdAt,
        updatedAt: team.updatedAt,
        createdByUserId: team.createdByUserId
      };
    });
    const teamById = new Map(collaborationTeams.map((team) => [team.id, team] as const));
    const collaborationMembers = members.map((member) => {
      const assignedTeamIds = [...new Set(teamIdsByUserId.get(member.userId) ?? [])].sort((left, right) =>
        left.localeCompare(right)
      );
      const resolvedProfile = resolveMemberProfile({
        role: member.role,
        profile: collaborationProfilesByUserId.get(member.userId),
        assignedTeamIds
      });
      const activeTeamName = resolvedProfile.activeTeamId
        ? teamById.get(resolvedProfile.activeTeamId)?.name ?? null
        : null;

      return {
        ...member,
        managementLevel: resolvedProfile.managementLevel,
        managementLabel: managementLevelLabel(resolvedProfile.managementLevel),
        accessAreas: resolvedProfile.accessAreas,
        accessAreaLabels: resolvedProfile.accessAreas.map(
          (area) => accessAreaLabelById.get(area) ?? area
        ),
        activeTeamId: resolvedProfile.activeTeamId,
        activeTeamName,
        teamIds: assignedTeamIds,
        teamNames: assignedTeamIds
          .map((teamId) => teamById.get(teamId)?.name)
          .filter((value): value is string => Boolean(value))
      };
    });
    const personnel = organization.personnel
      .map((person) => {
        const assignedTeamIds = [...new Set(teamIdsByPersonnelId.get(person.id) ?? [])].sort(
          (left, right) => left.localeCompare(right)
        );
        return {
          id: person.id,
          name: person.name,
          type: person.type,
          role: person.role,
          status: person.status,
          teamIds: assignedTeamIds,
          teamNames: assignedTeamIds
            .map((teamId) => teamById.get(teamId)?.name)
            .filter((value): value is string => Boolean(value))
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name));
    const delegatedAccess = readDelegatedAccessEntries(company.file.metadata).map((entry) => {
      if (entry.kind === "MEMBER") {
        const member = memberById.get(entry.targetId);
        return {
          kind: entry.kind,
          targetId: entry.targetId,
          badgeLabel: member?.roleLabel ?? "Member",
          label: member?.username ?? "Missing member",
          secondaryLabel: member?.email ?? "No longer in organization",
          resolved: Boolean(member)
        };
      }

      if (entry.kind === "PERSONNEL") {
        const person = personnelById.get(entry.targetId);
        return {
          kind: entry.kind,
          targetId: entry.targetId,
          badgeLabel: person?.type === "AI" ? "AI" : "Human",
          label: person?.name ?? "Missing workforce",
          secondaryLabel:
            person?.type && person?.status
              ? `${person.type} | ${person.status}`
              : "No longer in organization",
          resolved: Boolean(person)
        };
      }

      return {
        kind: entry.kind,
        targetId: entry.targetId,
        badgeLabel: "Team",
        label: entry.targetId === "AI_WORKFORCE" ? "AI workforce" : "Human workforce",
        secondaryLabel:
          entry.targetId === "AI_WORKFORCE"
            ? `${workforce.agents} AI personnel`
            : `${workforce.humans} human personnel`,
        resolved: true
      };
    });

    const accessCandidates = {
      members: members
        .filter((member) => member.role !== OrgRole.FOUNDER)
        .map((member) => ({
          kind: "MEMBER" as const,
          targetId: member.userId,
          badgeLabel: member.roleLabel,
          label: member.username,
          secondaryLabel: member.email,
          disabled: delegatedAccess.some(
            (entry) => entry.kind === "MEMBER" && entry.targetId === member.userId
          )
        })),
      personnel: [...organization.personnel]
        .sort((left, right) => {
          const typeDelta = left.type.localeCompare(right.type);
          if (typeDelta !== 0) return typeDelta;
          return left.name.localeCompare(right.name);
        })
        .map((person) => ({
          kind: "PERSONNEL" as const,
          targetId: person.id,
          badgeLabel: person.type === "AI" ? "AI" : "Human",
          label: person.name,
          secondaryLabel: `${person.type} | ${person.status}`,
          disabled: delegatedAccess.some(
            (entry) => entry.kind === "PERSONNEL" && entry.targetId === person.id
          )
        })),
      teams: [
        {
          kind: "TEAM" as const,
          targetId: "HUMAN_WORKFORCE",
          badgeLabel: "Team",
          label: "Human workforce",
          secondaryLabel: `${workforce.humans} human personnel`,
          disabled: delegatedAccess.some(
            (entry) => entry.kind === "TEAM" && entry.targetId === "HUMAN_WORKFORCE"
          )
        },
        {
          kind: "TEAM" as const,
          targetId: "AI_WORKFORCE",
          badgeLabel: "Team",
          label: "AI workforce",
          secondaryLabel: `${workforce.agents} AI personnel`,
          disabled: delegatedAccess.some(
            (entry) => entry.kind === "TEAM" && entry.targetId === "AI_WORKFORCE"
          )
        }
      ]
    };

    const actorRole =
      access.actor.role === OrgRole.FOUNDER || access.actor.role === OrgRole.ADMIN
        ? access.actor.role
        : OrgRole.EMPLOYEE;
    const actorMember = collaborationMembers.find((member) => member.userId === access.actor.userId);

    return NextResponse.json({
      ok: true,
      actor: {
        userId: access.actor.userId,
        email: access.actor.email,
        role: actorRole,
        roleLabel: toRoleLabel(actorRole),
        isAdmin: access.actor.isAdmin,
        managementLevel:
          actorMember?.managementLevel ?? defaultManagementLevelForOrgRole(actorRole),
        managementLabel:
          actorMember?.managementLabel ??
          managementLevelLabel(defaultManagementLevelForOrgRole(actorRole)),
        accessAreas:
          actorMember?.accessAreas ??
          defaultAccessAreasForManagementLevel(defaultManagementLevelForOrgRole(actorRole)),
        activeTeamId: actorMember?.activeTeamId ?? null,
        activeTeamName: actorMember?.activeTeamName ?? null
      },
      organization: {
        id: organization.id,
        name: organization.name,
        description: organization.description,
        theme: toThemeLabel(organization.theme),
        executionMode: organization.executionMode,
        monthlyBudgetUsd: organization.monthlyBudget.toString(),
        currentSpendUsd: organization.currentSpend.toString(),
        monthlyBtuCap: organization.monthlyBtuCap,
        currentBtuBurn: organization.currentBtuBurn,
        createdAt: organization.createdAt,
        updatedAt: organization.updatedAt,
        memberCounts,
        workforce,
        teamCount: collaborationTeams.length
      },
      members: collaborationMembers,
      personnel,
      collaboration: {
        teams: collaborationTeams,
        managementLevels: COLLABORATION_MANAGEMENT_LEVEL_CATALOG,
        accessAreas: COLLABORATION_ACCESS_AREA_CATALOG
      },
      delegatedAccess,
      accessCandidates,
      input: {
        id: company.file.id,
        name: company.file.name,
        size: company.file.size.toString(),
        updatedAt: company.file.updatedAt,
        content: company.content
      },
      documents,
      output: outputs
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Failed to load organizational hub."
      },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        content?: string;
      }
    | null;

  const orgId = body?.orgId?.trim() ?? "";
  const content = body?.content ?? "";

  if (!orgId) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId is required."
      },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }
  if (!access.actor.isAdmin) {
    return denyManageAccess();
  }

  if (typeof content !== "string" || content.trim().length === 0) {
    return NextResponse.json(
      {
        ok: false,
        message: "content is required."
      },
      { status: 400 }
    );
  }

  try {
    const updated = await updateCompanyDataFile(orgId, content);
    return NextResponse.json({
      ok: true,
      input: {
        id: updated.id,
        name: updated.name,
        size: updated.size.toString(),
        updatedAt: updated.updatedAt
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Failed to update Company Data."
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const input = asRecord(body);

  if (!input) {
    return NextResponse.json(
      {
        ok: false,
        message: "Request body must be a JSON object."
      },
      { status: 400 }
    );
  }

  const orgId = typeof input.orgId === "string" ? input.orgId.trim() : "";
  const memberUserId = typeof input.memberUserId === "string" ? input.memberUserId.trim() : "";
  const role = parseManagedRole(input.role);
  const action = parseAccessAction(input.action);
  const targetKind = parseAccessKind(input.targetKind);
  const targetId = typeof input.targetId === "string" ? input.targetId.trim() : "";

  if (!orgId) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId is required."
      },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }
  const hasMemberRoleShape = memberUserId.length > 0 || input.role !== undefined;
  const hasDelegatedAccessShape = action !== null || input.targetKind !== undefined || input.targetId !== undefined;
  const collaborationAction = parseCollaborationAction(input.collaborationAction);
  const hasCollaborationShape =
    collaborationAction !== null ||
    input.collaborationAction !== undefined ||
    input.managementLevel !== undefined ||
    input.accessAreas !== undefined ||
    input.team !== undefined ||
    input.teamId !== undefined ||
    input.activeTeamId !== undefined;
  const describedShapeCount = [
    hasMemberRoleShape,
    hasDelegatedAccessShape,
    hasCollaborationShape
  ].filter(Boolean).length;

  if (describedShapeCount > 1) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "PATCH body must describe exactly one organization mutation: member role, delegated access, or collaboration update."
      },
      { status: 400 }
    );
  }

  if (hasMemberRoleShape) {
    if (!access.actor.isAdmin) {
      return denyManageAccess("Founder or admin access is required to manage organization access.");
    }

    if (!hasOnlyKeys(input, ["orgId", "memberUserId", "role"])) {
      return NextResponse.json(
        {
          ok: false,
          message: "Invalid member role patch payload."
        },
        { status: 400 }
      );
    }

    if (!memberUserId || !role) {
      return NextResponse.json(
        {
          ok: false,
          message: "orgId, memberUserId, and role are required."
        },
        { status: 400 }
      );
    }

    const membership = await prisma.orgMember.findUnique({
      where: {
        userId_orgId: {
          userId: memberUserId,
          orgId
        }
      },
      select: {
        userId: true,
        role: true,
        user: {
          select: {
            username: true,
            email: true,
            activeOrgId: true
          }
        }
      }
    });

    if (!membership) {
      return NextResponse.json(
        {
          ok: false,
          message: "Organization member not found."
        },
        { status: 404 }
      );
    }

    if (membership.role === OrgRole.FOUNDER) {
      return NextResponse.json(
        {
          ok: false,
          message: "Founder access cannot be changed from Hub."
        },
        { status: 409 }
      );
    }

    if (membership.role === role) {
      return NextResponse.json({
        ok: true,
        member: {
          userId: membership.userId,
          username: membership.user.username,
          email: membership.user.email,
          role: membership.role,
          roleLabel: toRoleLabel(membership.role),
          isActiveOrganization: membership.user.activeOrgId === orgId
        }
      });
    }

    if (membership.userId === access.actor.userId && role === OrgRole.EMPLOYEE) {
      const adminCount = await prisma.orgMember.count({
        where: {
          orgId,
          role: {
            in: [OrgRole.FOUNDER, OrgRole.ADMIN]
          }
        }
      });

      if (adminCount <= 1) {
        return NextResponse.json(
          {
            ok: false,
            message: "The last organization admin cannot remove their own management access."
          },
          { status: 409 }
        );
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const nextMembership = await tx.orgMember.update({
        where: {
          userId_orgId: {
            userId: memberUserId,
            orgId
          }
        },
        data: {
          role
        },
        select: {
          userId: true,
          role: true,
          createdAt: true,
          user: {
            select: {
              username: true,
              email: true,
              activeOrgId: true
            }
          }
        }
      });

      await tx.log.create({
        data: {
          orgId,
          type: LogType.USER,
          actor: "ORG_HUB",
          message: `Organization access for ${nextMembership.user.email} changed to ${toRoleLabel(role)} by ${access.actor.email}.`
        }
      });

      return nextMembership;
    });

    return NextResponse.json({
      ok: true,
      member: {
        userId: updated.userId,
        username: updated.user.username,
        email: updated.user.email,
        role: updated.role,
        roleLabel: toRoleLabel(updated.role),
        joinedAt: updated.createdAt,
        isActiveOrganization: updated.user.activeOrgId === orgId
      }
    });
  }

  if (action !== null) {
    if (!access.actor.isAdmin) {
      return denyManageAccess("Founder or admin access is required to manage organization access.");
    }

    if (!hasOnlyKeys(input, ["orgId", "action", "targetKind", "targetId"])) {
      return NextResponse.json(
        {
          ok: false,
          message: "Invalid delegated access patch payload."
        },
        { status: 400 }
      );
    }

    if (!targetKind || !targetId) {
      return NextResponse.json(
        {
          ok: false,
          message: "orgId, action, targetKind, and targetId are required."
        },
        { status: 400 }
      );
    }

    if (targetKind === "TEAM" && targetId !== "HUMAN_WORKFORCE" && targetId !== "AI_WORKFORCE") {
      return NextResponse.json(
        {
          ok: false,
          message: "TEAM targets must use HUMAN_WORKFORCE or AI_WORKFORCE."
        },
        { status: 400 }
      );
    }

    const company = await ensureCompanyDataFile(orgId);
    const currentEntries = readDelegatedAccessEntries(company.file.metadata);
    const entryKey = `${targetKind}:${targetId}`;
    const entryExists = currentEntries.some((entry) => `${entry.kind}:${entry.targetId}` === entryKey);

    if (action === "ADD" && entryExists) {
      return NextResponse.json(
        {
          ok: false,
          message: "Delegated access entry already exists."
        },
        { status: 409 }
      );
    }

    if (action === "REMOVE" && !entryExists) {
      return NextResponse.json(
        {
          ok: false,
          message: "Delegated access entry not found."
        },
        { status: 404 }
      );
    }

    if (targetKind === "MEMBER") {
      const membership = await prisma.orgMember.findUnique({
        where: {
          userId_orgId: {
            userId: targetId,
            orgId
          }
        },
        select: {
          userId: true,
          role: true,
          user: {
            select: {
              username: true,
              email: true
            }
          }
        }
      });

      if (!membership) {
        return NextResponse.json(
          {
            ok: false,
            message: "Organization member not found."
          },
          { status: 404 }
        );
      }

      if (membership.role === OrgRole.FOUNDER) {
        return NextResponse.json(
          {
            ok: false,
            message: "Founder access is immutable."
          },
          { status: 409 }
        );
      }
    } else if (targetKind === "PERSONNEL") {
      const person = await prisma.personnel.findFirst({
        where: {
          id: targetId,
          orgId
        },
        select: {
          id: true
        }
      });

      if (!person) {
        return NextResponse.json(
          {
            ok: false,
            message: "Workforce personnel not found."
          },
          { status: 404 }
        );
      }
    }

    const nextEntries: HubDelegatedAccessEntry[] =
      action === "ADD"
        ? [...currentEntries, { kind: targetKind, targetId }]
        : currentEntries.filter((entry) => `${entry.kind}:${entry.targetId}` !== entryKey);

    const updated = await prisma.$transaction(async (tx) => {
      const nextFile = await tx.file.update({
        where: { id: company.file.id },
        data: {
          metadata: writeDelegatedAccessMetadata(
            company.file.metadata,
            nextEntries
          ) as unknown as Prisma.InputJsonValue
        },
        select: {
          id: true
        }
      });

      await tx.log.create({
        data: {
          orgId,
          type: LogType.USER,
          actor: "ORG_HUB",
          message: `${access.actor.email} ${action === "ADD" ? "added" : "removed"} ${accessKindLabel(targetKind).toLowerCase()} access ${targetId}.`
        }
      });

      return nextFile;
    });

    return NextResponse.json({
      ok: true,
      delegatedAccess: {
        kind: targetKind,
        targetId,
        action,
        fileId: updated.id
      }
    });
  }

  if (hasCollaborationShape) {
    if (!collaborationAction) {
      return NextResponse.json(
        {
          ok: false,
          message: "Invalid collaboration patch payload."
        },
        { status: 400 }
      );
    }

    if (collaborationAction === "SAVE_MEMBER_PROFILE") {
      if (!access.actor.isAdmin) {
        return denyManageAccess(
          "Founder or admin access is required to manage collaboration profiles."
        );
      }

      if (
        !hasOnlyKeys(input, [
          "orgId",
          "collaborationAction",
          "memberUserId",
          "managementLevel",
          "accessAreas"
        ])
      ) {
        return NextResponse.json(
          {
            ok: false,
            message: "Invalid collaboration profile patch payload."
          },
          { status: 400 }
        );
      }

      const managementLevel = parseManagementLevel(input.managementLevel);
      const accessAreas = parseAccessAreas(input.accessAreas);
      if (!memberUserId || !managementLevel) {
        return NextResponse.json(
          {
            ok: false,
            message: "orgId, memberUserId, and managementLevel are required."
          },
          { status: 400 }
        );
      }

      if (managementLevel === "FOUNDER" || managementLevel === "ADMIN") {
        return NextResponse.json(
          {
            ok: false,
            message: "Founder and admin management levels are reserved for organization roles."
          },
          { status: 409 }
        );
      }

      const membership = await prisma.orgMember.findUnique({
        where: {
          userId_orgId: {
            userId: memberUserId,
            orgId
          }
        },
        select: {
          userId: true,
          role: true,
          user: {
            select: {
              username: true,
              email: true
            }
          }
        }
      });

      if (!membership) {
        return NextResponse.json(
          {
            ok: false,
            message: "Organization member not found."
          },
          { status: 404 }
        );
      }

      if (membership.role !== OrgRole.EMPLOYEE) {
        return NextResponse.json(
          {
            ok: false,
            message: "Founders and admins use organization roles and cannot be downgraded here."
          },
          { status: 409 }
        );
      }

      const company = await ensureCompanyDataFile(orgId);
      const collaboration = readOrganizationCollaboration(company.file.metadata);
      const existingProfile = collaboration.memberProfiles.find(
        (profile) => profile.userId === memberUserId
      );
      const now = new Date().toISOString();
      const nextProfile: CollaborationMemberProfileEntry = {
        userId: memberUserId,
        managementLevel,
        accessAreas:
          accessAreas && accessAreas.length > 0
            ? accessAreas
            : defaultAccessAreasForManagementLevel(managementLevel),
        activeTeamId: existingProfile?.activeTeamId ?? null,
        updatedAt: now
      };
      const nextProfiles = [
        ...collaboration.memberProfiles.filter((profile) => profile.userId !== memberUserId),
        nextProfile
      ];

      await prisma.$transaction(async (tx) => {
        await tx.file.update({
          where: { id: company.file.id },
          data: {
            metadata: writeOrganizationCollaborationMetadata(company.file.metadata, {
              ...collaboration,
              memberProfiles: nextProfiles
            }) as unknown as Prisma.InputJsonValue
          }
        });

        await tx.log.create({
          data: {
            orgId,
            type: LogType.USER,
            actor: "ORG_HUB",
            message: `${access.actor.email} set collaboration level ${managementLevelLabel(managementLevel)} for ${membership.user.email}.`
          }
        });
      });

      return NextResponse.json({
        ok: true,
        profile: {
          userId: nextProfile.userId,
          managementLevel: nextProfile.managementLevel,
          accessAreas: nextProfile.accessAreas
        }
      });
    }

    if (collaborationAction === "SAVE_TEAM") {
      if (access.actor.role !== OrgRole.FOUNDER) {
        return denyManageAccess("Founder access is required to create or edit teams.");
      }

      if (!hasOnlyKeys(input, ["orgId", "collaborationAction", "team"])) {
        return NextResponse.json(
          {
            ok: false,
            message: "Invalid team patch payload."
          },
          { status: 400 }
        );
      }

      const teamInput = asRecord(input.team);
      if (!teamInput) {
        return NextResponse.json(
          {
            ok: false,
            message: "team is required."
          },
          { status: 400 }
        );
      }

      const providedTeamId = asText(teamInput.id);
      const name = asText(teamInput.name);
      const description = asText(teamInput.description);
      const leadUserId = asText(teamInput.leadUserId) || null;
      const memberUserIds = uniqueTextList(teamInput.memberUserIds);
      const personnelIds = uniqueTextList(teamInput.personnelIds);
      const nextMemberUserIds = leadUserId
        ? [...new Set([leadUserId, ...memberUserIds])].sort((left, right) =>
            left.localeCompare(right)
          )
        : memberUserIds;

      if (!name) {
        return NextResponse.json(
          {
            ok: false,
            message: "Team name is required."
          },
          { status: 400 }
        );
      }

      if (nextMemberUserIds.length === 0 && personnelIds.length === 0) {
        return NextResponse.json(
          {
            ok: false,
            message: "Add at least one organization member or workforce profile to the team."
          },
          { status: 400 }
        );
      }

      const [memberMatches, personnelMatches] = await Promise.all([
        nextMemberUserIds.length > 0
          ? prisma.orgMember.findMany({
              where: {
                orgId,
                userId: {
                  in: nextMemberUserIds
                }
              },
              select: {
                userId: true
              }
            })
          : Promise.resolve([]),
        personnelIds.length > 0
          ? prisma.personnel.findMany({
              where: {
                orgId,
                id: {
                  in: personnelIds
                }
              },
              select: {
                id: true
              }
            })
          : Promise.resolve([])
      ]);

      if (memberMatches.length !== nextMemberUserIds.length) {
        return NextResponse.json(
          {
            ok: false,
            message: "One or more selected team members do not belong to this organization."
          },
          { status: 404 }
        );
      }

      if (personnelMatches.length !== personnelIds.length) {
        return NextResponse.json(
          {
            ok: false,
            message: "One or more selected workforce profiles do not belong to this organization."
          },
          { status: 404 }
        );
      }

      const company = await ensureCompanyDataFile(orgId);
      const collaboration = readOrganizationCollaboration(company.file.metadata);
      const existingTeam = providedTeamId
        ? collaboration.teams.find((team) => team.id === providedTeamId) ?? null
        : null;
      const now = new Date().toISOString();
      const teamId = (existingTeam?.id ?? providedTeamId) || randomUUID();
      const nextTeam: CollaborationTeamEntry = {
        id: teamId,
        name,
        description,
        leadUserId,
        memberUserIds: nextMemberUserIds,
        personnelIds,
        createdAt: existingTeam?.createdAt ?? now,
        updatedAt: now,
        createdByUserId: existingTeam?.createdByUserId ?? access.actor.userId
      };
      const nextTeams = [
        ...collaboration.teams.filter((team) => team.id !== teamId),
        nextTeam
      ];
      const nextProfiles = collaboration.memberProfiles.map((profile) => {
        if (profile.activeTeamId !== teamId) {
          return profile;
        }
        if (nextTeam.memberUserIds.includes(profile.userId)) {
          return profile;
        }
        const fallbackTeamId =
          nextTeams.find((team) => team.memberUserIds.includes(profile.userId))?.id ?? null;
        return {
          ...profile,
          activeTeamId: fallbackTeamId,
          updatedAt: now
        };
      });

      await prisma.$transaction(async (tx) => {
        await tx.file.update({
          where: { id: company.file.id },
          data: {
            metadata: writeOrganizationCollaborationMetadata(company.file.metadata, {
              teams: nextTeams,
              memberProfiles: nextProfiles
            }) as unknown as Prisma.InputJsonValue
          }
        });

        await tx.log.create({
          data: {
            orgId,
            type: LogType.USER,
            actor: "ORG_HUB",
            message: `${access.actor.email} ${existingTeam ? "updated" : "created"} team ${name}.`
          }
        });
      });

      return NextResponse.json({
        ok: true,
        team: {
          id: nextTeam.id,
          name: nextTeam.name
        }
      });
    }

    if (collaborationAction === "DELETE_TEAM") {
      if (access.actor.role !== OrgRole.FOUNDER) {
        return denyManageAccess("Founder access is required to remove teams.");
      }

      if (!hasOnlyKeys(input, ["orgId", "collaborationAction", "teamId"])) {
        return NextResponse.json(
          {
            ok: false,
            message: "Invalid delete team patch payload."
          },
          { status: 400 }
        );
      }

      const teamId = asText(input.teamId);
      if (!teamId) {
        return NextResponse.json(
          {
            ok: false,
            message: "teamId is required."
          },
          { status: 400 }
        );
      }

      const company = await ensureCompanyDataFile(orgId);
      const collaboration = readOrganizationCollaboration(company.file.metadata);
      const currentTeam = collaboration.teams.find((team) => team.id === teamId) ?? null;
      if (!currentTeam) {
        return NextResponse.json(
          {
            ok: false,
            message: "Team not found."
          },
          { status: 404 }
        );
      }

      const now = new Date().toISOString();
      const nextTeams = collaboration.teams.filter((team) => team.id !== teamId);
      const nextProfiles = collaboration.memberProfiles.map((profile) => {
        if (profile.activeTeamId !== teamId) {
          return profile;
        }
        const fallbackTeamId =
          nextTeams.find((team) => team.memberUserIds.includes(profile.userId))?.id ?? null;
        return {
          ...profile,
          activeTeamId: fallbackTeamId,
          updatedAt: now
        };
      });

      await prisma.$transaction(async (tx) => {
        await tx.file.update({
          where: { id: company.file.id },
          data: {
            metadata: writeOrganizationCollaborationMetadata(company.file.metadata, {
              teams: nextTeams,
              memberProfiles: nextProfiles
            }) as unknown as Prisma.InputJsonValue
          }
        });

        await tx.log.create({
          data: {
            orgId,
            type: LogType.USER,
            actor: "ORG_HUB",
            message: `${access.actor.email} removed team ${currentTeam.name}.`
          }
        });
      });

      return NextResponse.json({
        ok: true,
        teamId
      });
    }

    if (collaborationAction === "SET_ACTIVE_TEAM") {
      if (!hasOnlyKeys(input, ["orgId", "collaborationAction", "activeTeamId"])) {
        return NextResponse.json(
          {
            ok: false,
            message: "Invalid active team patch payload."
          },
          { status: 400 }
        );
      }

      const requestedActiveTeamId = asText(input.activeTeamId);
      const company = await ensureCompanyDataFile(orgId);
      const collaboration = readOrganizationCollaboration(company.file.metadata);
      const membership = await prisma.orgMember.findUnique({
        where: {
          userId_orgId: {
            userId: access.actor.userId,
            orgId
          }
        },
        select: {
          role: true
        }
      });

      if (!membership) {
        return NextResponse.json(
          {
            ok: false,
            message: "Organization member not found."
          },
          { status: 404 }
        );
      }

      if (requestedActiveTeamId) {
        const targetTeam = collaboration.teams.find((team) => team.id === requestedActiveTeamId);
        if (!targetTeam || !targetTeam.memberUserIds.includes(access.actor.userId)) {
          return NextResponse.json(
            {
              ok: false,
              message: "You can only activate a team you belong to."
            },
            { status: 409 }
          );
        }
      }

      const existingProfile =
        collaboration.memberProfiles.find((profile) => profile.userId === access.actor.userId) ??
        null;
      const now = new Date().toISOString();
      const defaultLevel = defaultManagementLevelForOrgRole(membership.role);
      const nextProfile: CollaborationMemberProfileEntry = {
        userId: access.actor.userId,
        managementLevel:
          membership.role === OrgRole.EMPLOYEE &&
          existingProfile?.managementLevel &&
          existingProfile.managementLevel !== "FOUNDER" &&
          existingProfile.managementLevel !== "ADMIN"
            ? existingProfile.managementLevel
            : defaultLevel,
        accessAreas:
          membership.role === OrgRole.EMPLOYEE && existingProfile?.accessAreas?.length
            ? existingProfile.accessAreas
            : defaultAccessAreasForManagementLevel(defaultLevel),
        activeTeamId: requestedActiveTeamId || null,
        updatedAt: now
      };
      const nextProfiles = [
        ...collaboration.memberProfiles.filter((profile) => profile.userId !== access.actor.userId),
        nextProfile
      ];

      await prisma.$transaction(async (tx) => {
        await tx.file.update({
          where: { id: company.file.id },
          data: {
            metadata: writeOrganizationCollaborationMetadata(company.file.metadata, {
              ...collaboration,
              memberProfiles: nextProfiles
            }) as unknown as Prisma.InputJsonValue
          }
        });

        await tx.log.create({
          data: {
            orgId,
            type: LogType.USER,
            actor: "ORG_HUB",
            message: `${access.actor.email} set active team ${requestedActiveTeamId || "unassigned"}.`
          }
        });
      });

      return NextResponse.json({
        ok: true,
        activeTeamId: requestedActiveTeamId || null
      });
    }
  }

  return NextResponse.json(
    {
      ok: false,
      message: "Invalid PATCH payload."
    },
    { status: 400 }
  );
}
