export const dynamic = "force-dynamic";

import {
  LogType,
  Prisma,
  PersonnelStatus,
  PersonnelType,
  PricingModel,
  SpendEventType
} from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { encryptBrainKey } from "@/lib/security/crypto";
import { featureFlags } from "@/lib/config/feature-flags";
import { recordPassivePolicy, recordPassiveSpend } from "@/lib/enterprise/passive";
import { requireOrgAccess } from "@/lib/security/org-access";

function parseType(value: string | undefined): PersonnelType | null {
  if (value === "HUMAN") return PersonnelType.HUMAN;
  if (value === "AI") return PersonnelType.AI;
  return null;
}

function parseStatus(value: string | undefined): PersonnelStatus | null {
  if (!value) return null;
  if (value === "IDLE") return PersonnelStatus.IDLE;
  if (value === "ACTIVE") return PersonnelStatus.ACTIVE;
  if (value === "PAUSED") return PersonnelStatus.PAUSED;
  if (value === "DISABLED") return PersonnelStatus.DISABLED;
  if (value === "RENTED") return PersonnelStatus.RENTED;
  return null;
}

function parsePricingModel(value: string | undefined): PricingModel | null {
  if (!value) return null;
  if (value === "TOKEN") return PricingModel.TOKEN;
  if (value === "SUBSCRIPTION") return PricingModel.SUBSCRIPTION;
  if (value === "OUTCOME") return PricingModel.OUTCOME;
  return null;
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

  const [personnel, linkedAccounts, capabilityGrants] = await Promise.all([
    prisma.personnel.findMany({
      where: { orgId },
      orderBy: { updatedAt: "desc" }
    }),
    prisma.linkedAccount.findMany({
      where: {
        user: {
          orgMemberships: {
            some: {
              orgId
            }
          }
        }
      },
      select: {
        id: true,
        provider: true,
        providerAccountId: true,
        user: {
          select: {
            id: true,
            username: true,
            email: true
          }
        }
      }
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

  return NextResponse.json({
    ok: true,
    personnel,
    linkedAccounts,
    capabilityVaultEnabled: featureFlags.capabilityVault,
    capabilityGrants
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        type?: string;
        name?: string;
        role?: string;
        expertise?: string;
        brainConfig?: Record<string, unknown>;
        fallbackBrainConfig?: Record<string, unknown>;
        brainKey?: string;
        fallbackBrainKey?: string;
        salary?: number;
        cost?: number;
        rentRate?: number;
        pricingModel?: string;
        autonomyScore?: number;
        isRented?: boolean;
        status?: string;
        assignedOAuthIds?: string[];
        capabilityGrants?: Array<{ linkedAccountId: string; scopes: Record<string, unknown> }>;
      }
    | null;

  const orgId = body?.orgId?.trim() ?? "";
  const type = parseType(body?.type);
  const name = body?.name?.trim() ?? "";
  const role = body?.role?.trim() ?? "";

  if (!orgId || !type || !name || !role) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId, type, name, and role are required."
      },
      { status: 400 }
    );
  }
  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true }
  });

  if (!org) {
    return NextResponse.json(
      {
        ok: false,
        message: "Organization not found."
      },
      { status: 404 }
    );
  }

  const assignedOAuthIds = Array.isArray(body?.assignedOAuthIds)
    ? body?.assignedOAuthIds.filter((value) => typeof value === "string" && value.trim().length > 0)
    : [];

  if (assignedOAuthIds.length > 0) {
    const count = await prisma.linkedAccount.count({
      where: {
        id: { in: assignedOAuthIds },
        user: {
          orgMemberships: {
            some: { orgId }
          }
        }
      }
    });

    if (count !== assignedOAuthIds.length) {
      return NextResponse.json(
        {
          ok: false,
          message: "One or more assigned OAuth identities do not belong to this organization."
        },
        { status: 403 }
      );
    }
  }

  const brainKeyEncrypted = body?.brainKey?.trim() ? encryptBrainKey(body.brainKey.trim()) : null;
  const fallbackBrainKeyEncrypted = body?.fallbackBrainKey?.trim()
    ? encryptBrainKey(body.fallbackBrainKey.trim())
    : null;
  const brainConfigInput =
    body?.brainConfig && typeof body.brainConfig === "object" && !Array.isArray(body.brainConfig)
      ? (body.brainConfig as Prisma.InputJsonValue)
      : undefined;
  const fallbackBrainConfigInput =
    body?.fallbackBrainConfig &&
    typeof body.fallbackBrainConfig === "object" &&
    !Array.isArray(body.fallbackBrainConfig)
      ? (body.fallbackBrainConfig as Prisma.InputJsonValue)
      : undefined;

  const created = await prisma.$transaction(async (tx) => {
    const personnel = await tx.personnel.create({
      data: {
        orgId,
        type,
        name,
        role,
        expertise: body?.expertise?.trim() || null,
        ...(brainConfigInput !== undefined ? { brainConfig: brainConfigInput } : {}),
        ...(fallbackBrainConfigInput !== undefined
          ? { fallbackBrainConfig: fallbackBrainConfigInput }
          : {}),
        brainKeyEnc: brainKeyEncrypted?.cipherText ?? null,
        brainKeyIv: brainKeyEncrypted?.iv ?? null,
        brainKeyAuthTag: brainKeyEncrypted?.authTag ?? null,
        brainKeyKeyVer: brainKeyEncrypted?.keyVersion ?? null,
        fallbackBrainKeyEnc: fallbackBrainKeyEncrypted?.cipherText ?? null,
        fallbackBrainKeyIv: fallbackBrainKeyEncrypted?.iv ?? null,
        fallbackBrainKeyAuthTag: fallbackBrainKeyEncrypted?.authTag ?? null,
        fallbackBrainKeyKeyVer: fallbackBrainKeyEncrypted?.keyVersion ?? null,
        salary: typeof body?.salary === "number" ? body.salary : null,
        cost: typeof body?.cost === "number" ? body.cost : null,
        rentRate: typeof body?.rentRate === "number" ? body.rentRate : null,
        pricingModel: parsePricingModel(body?.pricingModel) ?? null,
        autonomyScore:
          typeof body?.autonomyScore === "number"
            ? Math.min(1, Math.max(0, body.autonomyScore))
            : 0,
        isRented: Boolean(body?.isRented),
        status: parseStatus(body?.status) ?? PersonnelStatus.IDLE,
        assignedOAuthIds
      }
    });

    if (featureFlags.capabilityVault && Array.isArray(body?.capabilityGrants)) {
      const grants = body.capabilityGrants.filter(
        (entry) => assignedOAuthIds.includes(entry.linkedAccountId)
      );
      for (const grant of grants) {
        await tx.capabilityGrant.create({
          data: {
            orgId,
            agentId: personnel.id,
            linkedAccountId: grant.linkedAccountId,
            scopes: (grant.scopes ?? {}) as Prisma.InputJsonValue
          }
        });
      }
    }

    await tx.log.create({
      data: {
        orgId,
        type: LogType.USER,
        actor: "SQUAD",
        message: `Personnel ${personnel.id} recruited (${personnel.type}:${personnel.role}).`
      }
    });

    await recordPassivePolicy(
      {
        orgId,
        subjectType: "PERSONNEL_RECRUIT",
        subjectId: personnel.id,
        riskScore: type === PersonnelType.AI ? 0.25 : 0.1,
        reason: "Passive policy observation for squad recruitment.",
        meta: {
          type,
          role: personnel.role,
          capabilityVault: featureFlags.capabilityVault
        }
      },
      tx
    );

    await recordPassiveSpend(
      {
        orgId,
        amount: personnel.rentRate ?? personnel.cost ?? personnel.salary ?? 0,
        type: SpendEventType.PREDICTED_BURN,
        meta: {
          source: "squad.recruit",
          personnelId: personnel.id
        }
      },
      tx
    );

    return personnel;
  });

  return NextResponse.json(
    {
      ok: true,
      personnel: created
    },
    { status: 201 }
  );
}
