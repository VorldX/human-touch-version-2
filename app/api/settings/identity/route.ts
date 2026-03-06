export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { requireOrgAccess } from "@/lib/security/org-access";

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

  const [linkedAccounts, personnel, grants] = await Promise.all([
    prisma.linkedAccount.findMany({
      where: {
        user: {
          orgMemberships: {
            some: { orgId }
          }
        }
      },
      select: {
        id: true,
        provider: true,
        providerAccountId: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            username: true,
            email: true
          }
        }
      },
      orderBy: { updatedAt: "desc" }
    }),
    prisma.personnel.findMany({
      where: { orgId },
      select: {
        id: true,
        name: true,
        role: true,
        type: true,
        status: true,
        assignedOAuthIds: true,
        brainKeyEnc: true,
        fallbackBrainKeyEnc: true
      },
      orderBy: { updatedAt: "desc" }
    }),
    prisma.capabilityGrant.findMany({
      where: {
        orgId,
        revokedAt: null
      },
      select: {
        id: true,
        agentId: true,
        linkedAccountId: true,
        scopes: true,
        createdAt: true
      }
    })
  ]);

  const delegatedByAccount = new Map<string, string[]>();
  const delegatedByAgent = new Map<string, string[]>();

  for (const agent of personnel) {
    for (const accountId of agent.assignedOAuthIds) {
      delegatedByAccount.set(accountId, [...(delegatedByAccount.get(accountId) ?? []), agent.id]);
      delegatedByAgent.set(agent.id, [...(delegatedByAgent.get(agent.id) ?? []), accountId]);
    }
  }

  const grantByAccount = new Map<string, typeof grants>();
  const grantByAgent = new Map<string, typeof grants>();
  for (const grant of grants) {
    grantByAccount.set(grant.linkedAccountId, [
      ...(grantByAccount.get(grant.linkedAccountId) ?? []),
      grant
    ]);
    grantByAgent.set(grant.agentId, [...(grantByAgent.get(grant.agentId) ?? []), grant]);
  }

  const accountRecords = linkedAccounts.map((account) => ({
    ...account,
    delegatedAgentIds: delegatedByAccount.get(account.id) ?? [],
    capabilityGrantCount: (grantByAccount.get(account.id) ?? []).length
  }));

  const personnelRecords = personnel.map((agent) => ({
    ...agent,
    hasPrimaryBrainKey: Boolean(agent.brainKeyEnc),
    hasFallbackBrainKey: Boolean(agent.fallbackBrainKeyEnc),
    delegatedAccountIds: delegatedByAgent.get(agent.id) ?? [],
    capabilityGrantCount: (grantByAgent.get(agent.id) ?? []).length
  }));

  return NextResponse.json({
    ok: true,
    accounts: accountRecords,
    agents: personnelRecords,
    grants
  });
}
