"use server";

import {
  AgentRole,
  AgentStatus,
  LogType,
  OAuthProvider,
  OrganizationTheme,
  OrgRole,
  PersonnelStatus,
  PersonnelType,
  Prisma,
  PricingModel
} from "@prisma/client";
import { cookies } from "next/headers";

import { prisma } from "@/lib/db/prisma";
import { bootstrapOrganizationDnaContext } from "@/lib/dna/bootstrap";
import { ensureCompanyDataFile } from "@/lib/hub/organization-hub";
import { hashSovereignIdentity } from "@/lib/security/identity";
import { encryptAccessToken, encryptBrainKey } from "@/lib/security/crypto";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/security/session";
import {
  defaultServiceMarkupForPlan,
  upsertOrgLlmSettings,
  type OrgLlmMode,
  type OrgServicePlan
} from "@/lib/ai/org-llm-settings";
import type { OnboardingPayload, OnboardingResult } from "@/lib/types/onboarding";

function clean(input: string) {
  return input.trim();
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function parseProvider(value: string): OAuthProvider {
  if (value === "GOOGLE") {
    return OAuthProvider.GOOGLE;
  }
  if (value === "LINKEDIN") {
    return OAuthProvider.LINKEDIN;
  }
  if (value === "X") {
    return OAuthProvider.X;
  }
  throw new Error("Unsupported OAuth provider.");
}

function parseTheme(value: string): OrganizationTheme {
  if (value === "APEX") {
    return OrganizationTheme.APEX;
  }
  if (value === "VEDA") {
    return OrganizationTheme.VEDA;
  }
  if (value === "NEXUS") {
    return OrganizationTheme.NEXUS;
  }
  throw new Error("Unsupported organization theme.");
}

function parseCredentialMode(value: string): OrgLlmMode {
  if (value === "BYOK") {
    return "BYOK";
  }
  if (value === "PLATFORM_MANAGED") {
    return "PLATFORM_MANAGED";
  }
  throw new Error("Unsupported credential mode.");
}

function parseServicePlan(value: string): OrgServicePlan {
  if (value === "STARTER") return "STARTER";
  if (value === "GROWTH") return "GROWTH";
  if (value === "ENTERPRISE") return "ENTERPRISE";
  throw new Error("Unsupported service plan.");
}

function validatePayload(payload: OnboardingPayload) {
  const username = clean(payload.identity.username);
  const email = clean(payload.identity.email).toLowerCase();
  const aadhaarId = clean(payload.identity.aadhaarId);
  const orgName = clean(payload.organization.name);
  const orgDescription = clean(payload.organization.description);

  if (!username || !email || !aadhaarId || !orgName || !orgDescription) {
    throw new Error("All required fields must be completed.");
  }

  if (!isValidEmail(email)) {
    throw new Error("Invalid email format.");
  }

  if (aadhaarId.length < 8) {
    throw new Error("Sovereign identity value is too short.");
  }

  if (
    payload.orchestration.credentialMode === "BYOK" &&
    !payload.orchestration.organizationApiKey?.trim()
  ) {
    throw new Error("A one-time organization API key is required in BYOK mode.");
  }

  if (payload.financial.monthlyBudgetUsd <= 0 || payload.financial.monthlyBtuCap <= 0) {
    throw new Error("Financial caps must be greater than zero.");
  }
}

export async function completeOnboardingAction(
  payload: OnboardingPayload
): Promise<OnboardingResult> {
  try {
    validatePayload(payload);

    const username = clean(payload.identity.username);
    const sovereignIdentityHash = hashSovereignIdentity(payload.identity.aadhaarId);
    const sessionToken = (await cookies()).get(SESSION_COOKIE_NAME)?.value ?? "";
    const session = sessionToken ? await verifySessionToken(sessionToken) : null;
    if (!session?.userId || !session.email) {
      return {
        ok: false,
        message: "Authentication required. Sign in again and retry setup."
      };
    }
    const email = session.email.trim().toLowerCase();

    const orgTheme = parseTheme(payload.organization.theme);
    const credentialMode = parseCredentialMode(payload.orchestration.credentialMode);
    const servicePlan = parseServicePlan(payload.orchestration.servicePlan);
    const serviceMarkupPct =
      typeof payload.orchestration.serviceMarkupPct === "number" &&
      Number.isFinite(payload.orchestration.serviceMarkupPct)
        ? payload.orchestration.serviceMarkupPct
        : defaultServiceMarkupForPlan(servicePlan);
    const orgName = clean(payload.organization.name);
    const orgDescription = clean(payload.organization.description);

    const primaryBrainEncrypted = payload.orchestration.primary.apiKey?.trim()
      ? encryptBrainKey(payload.orchestration.primary.apiKey.trim())
      : null;
    const fallbackBrainEncrypted = payload.orchestration.fallback.apiKey?.trim()
      ? encryptBrainKey(payload.orchestration.fallback.apiKey.trim())
      : null;

    const createdOrg = await prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { email },
        update: {
          username,
          sovereignIdentityHash
        },
        create: {
          username,
          email,
          sovereignIdentityHash
        }
      });

      const org = await tx.organization.create({
        data: {
          name: orgName,
          description: orgDescription,
          theme: orgTheme,
          monthlyBudget: new Prisma.Decimal(payload.financial.monthlyBudgetUsd),
          currentSpend: new Prisma.Decimal(0),
          monthlyBtuCap: payload.financial.monthlyBtuCap,
          currentBtuBurn: 0
        }
      });

      await tx.orgMember.create({
        data: {
          userId: user.id,
          orgId: org.id,
          role: OrgRole.FOUNDER
        }
      });

      await tx.user.update({
        where: { id: user.id },
        data: { activeOrgId: org.id }
      });

      const assignedOAuthIds: string[] = [];

      for (const account of payload.oauthAccounts) {
        const provider = parseProvider(account.provider);
        const providerAccountId = clean(account.providerAccountId);
        const accessToken = clean(account.accessToken);

        if (!providerAccountId || !accessToken) {
          continue;
        }

        const encrypted = encryptAccessToken(accessToken);
        const linked = await tx.linkedAccount.upsert({
          where: {
            provider_providerAccountId: {
              provider,
              providerAccountId
            }
          },
          update: {
            userId: user.id,
            accessTokenEnc: encrypted.cipherText,
            accessTokenIv: encrypted.iv,
            accessTokenAuthTag: encrypted.authTag,
            accessTokenKeyVer: encrypted.keyVersion
          },
          create: {
            userId: user.id,
            provider,
            providerAccountId,
            accessTokenEnc: encrypted.cipherText,
            accessTokenIv: encrypted.iv,
            accessTokenAuthTag: encrypted.authTag,
            accessTokenKeyVer: encrypted.keyVersion
          }
        });

        assignedOAuthIds.push(linked.id);
      }

      const mainPersonnel = await tx.personnel.create({
        data: {
          orgId: org.id,
          type: PersonnelType.AI,
          name: "Main Agent",
          role: "Main Agent",
          expertise: "Mission decomposition, orchestration, and Human Touch gating.",
          brainConfig: {
            provider: payload.orchestration.primary.provider,
            model: payload.orchestration.primary.model,
            computeType: payload.orchestration.primary.computeType
          },
          fallbackBrainConfig: {
            provider: payload.orchestration.fallback.provider,
            model: payload.orchestration.fallback.model,
            computeType: payload.orchestration.fallback.computeType
          },
          brainKeyEnc: primaryBrainEncrypted?.cipherText ?? null,
          brainKeyIv: primaryBrainEncrypted?.iv ?? null,
          brainKeyAuthTag: primaryBrainEncrypted?.authTag ?? null,
          brainKeyKeyVer: primaryBrainEncrypted?.keyVersion ?? null,
          fallbackBrainKeyEnc: fallbackBrainEncrypted?.cipherText ?? null,
          fallbackBrainKeyIv: fallbackBrainEncrypted?.iv ?? null,
          fallbackBrainKeyAuthTag: fallbackBrainEncrypted?.authTag ?? null,
          fallbackBrainKeyKeyVer: fallbackBrainEncrypted?.keyVersion ?? null,
          pricingModel: PricingModel.TOKEN,
          autonomyScore: 0.74,
          isRented: false,
          status: PersonnelStatus.IDLE,
          assignedOAuthIds
        }
      });

      await tx.agent.create({
        data: {
          orgId: org.id,
          personnelId: mainPersonnel.id,
          role: AgentRole.MAIN,
          status: AgentStatus.ACTIVE,
          name: mainPersonnel.name,
          goal: "Orchestrate organization missions with budget-aware delegation and human touch safeguards.",
          instructions: {
            role: "Main Agent",
            hierarchy: ["main", "manager", "worker"],
            defaultMode: "BALANCED"
          },
          allowedTools: []
        }
      });

      await upsertOrgLlmSettings(
        {
          orgId: org.id,
          mode: credentialMode,
          provider: payload.orchestration.primary.provider,
          model: payload.orchestration.primary.model,
          fallbackProvider: payload.orchestration.fallback.provider,
          fallbackModel: payload.orchestration.fallback.model,
          servicePlan,
          serviceMarkupPct,
          ...(credentialMode === "BYOK"
            ? { organizationApiKey: payload.orchestration.organizationApiKey?.trim() ?? "" }
            : {})
        },
        tx
      );

      await tx.log.create({
        data: {
          orgId: org.id,
          type: LogType.SYS,
          actor: "ONBOARDING",
          message: "Tenant initialized with Main Agent, organization credential mode, and OAuth linkages."
        }
      });

      await ensureCompanyDataFile(org.id, { db: tx });

      return org;
    });

    await bootstrapOrganizationDnaContext(createdOrg.id).catch((error) => {
      console.error("[onboarding] DNA bootstrap failed", error);
    });

    return {
      ok: true,
      org: {
        id: createdOrg.id,
        name: createdOrg.name,
        role: "Founder",
        theme: createdOrg.theme as "APEX" | "VEDA" | "NEXUS"
      }
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Onboarding failed."
    };
  }
}
