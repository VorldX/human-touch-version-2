#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { MemoryTier, Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  log: ["warn", "error"]
});

const OWNER_EMAIL = "hsp@vx.com";
const DEMO_ORG_NAME = "VX Demo Command Center";
const SEED_TAG = "hsp_demo_v1";

const IDS = {
  direction: {
    northStar: "demo-direction-north-star",
    automation: "demo-direction-automation",
    risk: "demo-direction-risk"
  },
  plan: {
    northStar: "demo-plan-north-star",
    automation: "demo-plan-automation"
  },
  permissionRequest: {
    pending: "demo-perm-request-pending",
    approved: "demo-perm-request-approved",
    rejected: "demo-perm-request-rejected"
  },
  joinRequest: {
    pending: "demo-join-request-pending",
    approved: "demo-join-request-approved"
  },
  schedule: {
    daily: "demo-mission-schedule-daily",
    weekly: "demo-mission-schedule-weekly"
  },
  connector: {
    google: "demo-storage-connector-google",
    s3: "demo-storage-connector-s3"
  },
  toolGrant: {
    owner: "demo-storage-grant-owner",
    agent: "demo-storage-grant-agent",
    employee: "demo-storage-grant-employee"
  }
};

function cleanSegment(input) {
  return input.replace(/[^a-zA-Z0-9_-]/g, "");
}

function ago({ days = 0, hours = 0, minutes = 0 }) {
  const value = new Date();
  value.setDate(value.getDate() - days);
  value.setHours(value.getHours() - hours);
  value.setMinutes(value.getMinutes() - minutes);
  return value.toISOString();
}

function fromNow({ days = 0, hours = 0, minutes = 0 }) {
  const value = new Date();
  value.setDate(value.getDate() + days);
  value.setHours(value.getHours() + hours);
  value.setMinutes(value.getMinutes() + minutes);
  return value.toISOString();
}

function hash(input, length = 64) {
  return createHash("sha256").update(input).digest("hex").slice(0, length);
}

function encryptedStub(label) {
  const digest = hash(`${SEED_TAG}:${label}`, 64);
  return {
    cipherText: Buffer.from(`${label}:${SEED_TAG}`).toString("base64"),
    iv: digest.slice(0, 24),
    authTag: digest.slice(24, 56),
    keyVersion: 1
  };
}

function toBigIntSize(content) {
  return BigInt(Buffer.byteLength(content, "utf8"));
}

async function ensureLocalUpload(orgId, fileName, content) {
  const orgSegment = cleanSegment(orgId);
  const uploadDir = join(process.cwd(), "public", "uploads", orgSegment);
  await mkdir(uploadDir, { recursive: true });
  const absolutePath = join(uploadDir, fileName);
  await writeFile(absolutePath, content, "utf8");
  return {
    url: `/uploads/${orgSegment}/${fileName}`,
    size: toBigIntSize(content)
  };
}

async function ensureUser(email, username) {
  return prisma.user.upsert({
    where: { email },
    update: { username },
    create: { email, username }
  });
}

async function ensureOrgMemoryEntry({
  orgId,
  key,
  value,
  flowId = null,
  taskId = null,
  agentId = null,
  userId = null,
  ttlSeconds = null,
  expiresAt = null
}) {
  const rows = await prisma.memoryEntry.findMany({
    where: {
      orgId,
      tier: MemoryTier.ORG,
      key
    },
    orderBy: {
      updatedAt: "desc"
    }
  });

  if (rows.length === 0) {
    return prisma.memoryEntry.create({
      data: {
        orgId,
        tier: MemoryTier.ORG,
        key,
        value,
        flowId,
        taskId,
        agentId,
        userId,
        ttlSeconds,
        expiresAt
      }
    });
  }

  const [primary, ...extras] = rows;

  const updated = await prisma.memoryEntry.update({
    where: { id: primary.id },
    data: {
      value,
      flowId,
      taskId,
      agentId,
      userId,
      ttlSeconds,
      expiresAt,
      redactedAt: null
    }
  });

  if (extras.length > 0) {
    await prisma.memoryEntry.updateMany({
      where: {
        id: { in: extras.map((row) => row.id) }
      },
      data: {
        redactedAt: new Date(),
        value: Prisma.DbNull
      }
    });
  }

  return updated;
}

async function ensureMemoryEntryByTier({
  orgId,
  tier,
  key,
  value,
  flowId = null,
  taskId = null,
  agentId = null,
  userId = null,
  ttlSeconds = null,
  expiresAt = null
}) {
  const rows = await prisma.memoryEntry.findMany({
    where: {
      orgId,
      tier,
      key
    },
    orderBy: {
      updatedAt: "desc"
    }
  });

  if (rows.length === 0) {
    return prisma.memoryEntry.create({
      data: {
        orgId,
        tier,
        key,
        value,
        flowId,
        taskId,
        agentId,
        userId,
        ttlSeconds,
        expiresAt
      }
    });
  }

  const [primary, ...extras] = rows;
  const updated = await prisma.memoryEntry.update({
    where: { id: primary.id },
    data: {
      value,
      flowId,
      taskId,
      agentId,
      userId,
      ttlSeconds,
      expiresAt,
      redactedAt: null
    }
  });

  if (extras.length > 0) {
    await prisma.memoryEntry.updateMany({
      where: { id: { in: extras.map((row) => row.id) } },
      data: {
        redactedAt: new Date(),
        value: Prisma.DbNull
      }
    });
  }

  return updated;
}

async function ensureFileRecord({
  orgId,
  name,
  type,
  url,
  size,
  health = 100,
  isAmnesiaProtected = false,
  metadata
}) {
  const existing = await prisma.file.findFirst({
    where: { orgId, name, type },
    orderBy: { updatedAt: "desc" }
  });

  if (!existing) {
    return prisma.file.create({
      data: {
        orgId,
        name,
        type,
        url,
        size,
        health,
        isAmnesiaProtected,
        metadata
      }
    });
  }

  return prisma.file.update({
    where: { id: existing.id },
    data: {
      url,
      size,
      health,
      isAmnesiaProtected,
      metadata
    }
  });
}

async function ensurePersonnel({
  orgId,
  type,
  name,
  role,
  expertise,
  brainConfig,
  fallbackBrainConfig,
  salary,
  cost,
  rentRate,
  pricingModel,
  autonomyScore,
  isRented,
  status,
  assignedOAuthIds
}) {
  const existing = await prisma.personnel.findFirst({
    where: {
      orgId,
      type,
      name,
      role
    }
  });

  const payload = {
    orgId,
    type,
    name,
    role,
    expertise: expertise ?? null,
    brainConfig: brainConfig ?? Prisma.JsonNull,
    fallbackBrainConfig: fallbackBrainConfig ?? Prisma.JsonNull,
    salary: salary != null ? new Prisma.Decimal(salary) : null,
    cost: cost != null ? new Prisma.Decimal(cost) : null,
    rentRate: rentRate != null ? new Prisma.Decimal(rentRate) : null,
    pricingModel: pricingModel ?? null,
    autonomyScore,
    isRented,
    status,
    assignedOAuthIds: assignedOAuthIds ?? []
  };

  if (!existing) {
    return prisma.personnel.create({
      data: payload
    });
  }

  return prisma.personnel.update({
    where: { id: existing.id },
    data: payload
  });
}

async function ensureFlow({
  orgId,
  prompt,
  status,
  progress,
  predictedBurn,
  requiredSignatures,
  parentFlowId = null
}) {
  const existing = await prisma.flow.findFirst({
    where: {
      orgId,
      prompt
    }
  });

  if (!existing) {
    return prisma.flow.create({
      data: {
        orgId,
        prompt,
        status,
        progress,
        predictedBurn,
        requiredSignatures,
        parentFlowId
      }
    });
  }

  return prisma.flow.update({
    where: { id: existing.id },
    data: {
      status,
      progress,
      predictedBurn,
      requiredSignatures,
      parentFlowId
    }
  });
}

async function ensureTask({
  flowId,
  agentId = null,
  prompt,
  status,
  requiredFiles = [],
  isPausedForInput = false,
  humanInterventionReason = null,
  executionTrace = null,
  verifiableProof = null
}) {
  const existing = await prisma.task.findFirst({
    where: {
      flowId,
      prompt
    }
  });

  const payload = {
    flowId,
    agentId,
    prompt,
    status,
    requiredFiles,
    isPausedForInput,
    humanInterventionReason,
    executionTrace: executionTrace ?? Prisma.JsonNull,
    verifiableProof
  };

  if (!existing) {
    return prisma.task.create({
      data: payload
    });
  }

  return prisma.task.update({
    where: { id: existing.id },
    data: payload
  });
}

async function ensureLog({ orgId, type, actor, message, timestamp }) {
  const existing = await prisma.log.findFirst({
    where: {
      orgId,
      type,
      actor,
      message
    }
  });

  if (existing) {
    return existing;
  }

  return prisma.log.create({
    data: {
      orgId,
      type,
      actor,
      message,
      timestamp: timestamp ? new Date(timestamp) : undefined
    }
  });
}

async function ensureComplianceAudit({
  orgId,
  flowId,
  humanActorId,
  actionType,
  complianceHash,
  timestamp
}) {
  const existing = await prisma.complianceAudit.findFirst({
    where: {
      orgId,
      flowId,
      actionType,
      complianceHash
    }
  });

  if (existing) {
    return existing;
  }

  return prisma.complianceAudit.create({
    data: {
      orgId,
      flowId,
      humanActorId,
      actionType,
      complianceHash,
      timestamp: timestamp ? new Date(timestamp) : undefined
    }
  });
}

async function ensureSpendEvent({ orgId, flowId, taskId, amount, type, meta, timestamp }) {
  const existing = await prisma.spendEvent.findFirst({
    where: {
      orgId,
      flowId: flowId ?? null,
      taskId: taskId ?? null,
      type,
      meta: {
        equals: meta
      }
    }
  });

  if (existing) {
    return existing;
  }

  return prisma.spendEvent.create({
    data: {
      orgId,
      flowId: flowId ?? null,
      taskId: taskId ?? null,
      amount: new Prisma.Decimal(amount),
      type,
      meta,
      timestamp: timestamp ? new Date(timestamp) : undefined
    }
  });
}

async function ensurePolicyLog({
  orgId,
  subjectType,
  subjectId,
  decision,
  riskScore,
  reason,
  meta,
  timestamp
}) {
  const existing = await prisma.policyLog.findFirst({
    where: {
      orgId,
      subjectType,
      subjectId,
      reason: reason ?? null
    }
  });

  if (existing) {
    return existing;
  }

  return prisma.policyLog.create({
    data: {
      orgId,
      subjectType,
      subjectId,
      decision,
      riskScore,
      reason: reason ?? null,
      meta: meta ?? Prisma.JsonNull,
      timestamp: timestamp ? new Date(timestamp) : undefined
    }
  });
}

async function main() {
  const owner = await ensureUser(OWNER_EMAIL, "hsp");

  let demoOrg = await prisma.organization.findFirst({
    where: {
      name: DEMO_ORG_NAME,
      members: {
        some: {
          userId: owner.id
        }
      }
    }
  });

  if (!demoOrg) {
    demoOrg = await prisma.organization.create({
      data: {
        name: DEMO_ORG_NAME,
        description: "Seeded demo org for complete end-to-end platform validation.",
        theme: "NEXUS",
        monthlyBudget: new Prisma.Decimal("250000.00"),
        currentSpend: new Prisma.Decimal("42860.50"),
        monthlyBtuCap: 480000,
        currentBtuBurn: 191200
      }
    });
  }

  await prisma.orgMember.upsert({
    where: {
      userId_orgId: {
        userId: owner.id,
        orgId: demoOrg.id
      }
    },
    update: {
      role: "FOUNDER"
    },
    create: {
      userId: owner.id,
      orgId: demoOrg.id,
      role: "FOUNDER"
    }
  });

  await prisma.user.update({
    where: { id: owner.id },
    data: {
      activeOrgId: demoOrg.id
    }
  });

  const adminUser = await ensureUser("opsadmin@vx.com", "opsadmin");
  const employeeUser = await ensureUser("rhea.pm@vx.com", "rhea");
  const salesUser = await ensureUser("arjun.sales@vx.com", "arjun");
  const pendingRequester = await ensureUser("meera.candidate@vx.com", "meera");
  const approvedRequester = await ensureUser("devon.joined@vx.com", "devon");

  const memberships = [
    { userId: adminUser.id, role: "ADMIN" },
    { userId: employeeUser.id, role: "EMPLOYEE" },
    { userId: salesUser.id, role: "EMPLOYEE" },
    { userId: approvedRequester.id, role: "EMPLOYEE" }
  ];

  for (const membership of memberships) {
    await prisma.orgMember.upsert({
      where: {
        userId_orgId: {
          userId: membership.userId,
          orgId: demoOrg.id
        }
      },
      update: {
        role: membership.role
      },
      create: {
        userId: membership.userId,
        orgId: demoOrg.id,
        role: membership.role
      }
    });
  }

  await prisma.user.updateMany({
    where: {
      id: {
        in: [adminUser.id, employeeUser.id, salesUser.id]
      },
      activeOrgId: null
    },
    data: {
      activeOrgId: demoOrg.id
    }
  });

  const ownerGoogleSecret = encryptedStub("owner-google");
  const ownerLinkedInSecret = encryptedStub("owner-linkedin");
  const adminGoogleSecret = encryptedStub("admin-google");

  const ownerGoogle = await prisma.linkedAccount.upsert({
    where: {
      provider_providerAccountId: {
        provider: "GOOGLE",
        providerAccountId: `${SEED_TAG}:hsp:google`
      }
    },
    update: {
      userId: owner.id,
      accessTokenEnc: ownerGoogleSecret.cipherText,
      accessTokenIv: ownerGoogleSecret.iv,
      accessTokenAuthTag: ownerGoogleSecret.authTag,
      accessTokenKeyVer: 1
    },
    create: {
      userId: owner.id,
      provider: "GOOGLE",
      providerAccountId: `${SEED_TAG}:hsp:google`,
      accessTokenEnc: ownerGoogleSecret.cipherText,
      accessTokenIv: ownerGoogleSecret.iv,
      accessTokenAuthTag: ownerGoogleSecret.authTag,
      accessTokenKeyVer: 1
    }
  });

  const ownerLinkedIn = await prisma.linkedAccount.upsert({
    where: {
      provider_providerAccountId: {
        provider: "LINKEDIN",
        providerAccountId: `${SEED_TAG}:hsp:linkedin`
      }
    },
    update: {
      userId: owner.id,
      accessTokenEnc: ownerLinkedInSecret.cipherText,
      accessTokenIv: ownerLinkedInSecret.iv,
      accessTokenAuthTag: ownerLinkedInSecret.authTag,
      accessTokenKeyVer: 1
    },
    create: {
      userId: owner.id,
      provider: "LINKEDIN",
      providerAccountId: `${SEED_TAG}:hsp:linkedin`,
      accessTokenEnc: ownerLinkedInSecret.cipherText,
      accessTokenIv: ownerLinkedInSecret.iv,
      accessTokenAuthTag: ownerLinkedInSecret.authTag,
      accessTokenKeyVer: 1
    }
  });

  const adminGoogle = await prisma.linkedAccount.upsert({
    where: {
      provider_providerAccountId: {
        provider: "GOOGLE",
        providerAccountId: `${SEED_TAG}:admin:google`
      }
    },
    update: {
      userId: adminUser.id,
      accessTokenEnc: adminGoogleSecret.cipherText,
      accessTokenIv: adminGoogleSecret.iv,
      accessTokenAuthTag: adminGoogleSecret.authTag,
      accessTokenKeyVer: 1
    },
    create: {
      userId: adminUser.id,
      provider: "GOOGLE",
      providerAccountId: `${SEED_TAG}:admin:google`,
      accessTokenEnc: adminGoogleSecret.cipherText,
      accessTokenIv: adminGoogleSecret.iv,
      accessTokenAuthTag: adminGoogleSecret.authTag,
      accessTokenKeyVer: 1
    }
  });

  const mainAgent = await ensurePersonnel({
    orgId: demoOrg.id,
    type: "AI",
    name: "Main Agent",
    role: "Main Agent",
    expertise: "Orchestrates direction-to-plan execution for the entire org.",
    brainConfig: {
      provider: "OpenAI",
      model: "gpt-4o-mini",
      computeType: "CLOUD"
    },
    fallbackBrainConfig: {
      provider: "Anthropic",
      model: "claude-3-5-sonnet",
      computeType: "CLOUD"
    },
    salary: null,
    cost: "14.2000",
    rentRate: "29.5000",
    pricingModel: "TOKEN",
    autonomyScore: 0.93,
    isRented: false,
    status: "ACTIVE",
    assignedOAuthIds: [ownerGoogle.id, ownerLinkedIn.id]
  });

  const strategyAgent = await ensurePersonnel({
    orgId: demoOrg.id,
    type: "AI",
    name: "Direction Analyst",
    role: "Strategy Analyst",
    expertise: "Transforms founder direction into executable workflows.",
    brainConfig: {
      provider: "OpenAI",
      model: "gpt-4o-mini",
      computeType: "CLOUD"
    },
    fallbackBrainConfig: {
      provider: "Anthropic",
      model: "claude-3-5-haiku",
      computeType: "CLOUD"
    },
    salary: null,
    cost: "9.4000",
    rentRate: "21.3000",
    pricingModel: "TOKEN",
    autonomyScore: 0.82,
    isRented: false,
    status: "ACTIVE",
    assignedOAuthIds: [ownerGoogle.id]
  });

  const complianceAgent = await ensurePersonnel({
    orgId: demoOrg.id,
    type: "AI",
    name: "Compliance Sentinel",
    role: "Compliance Guard",
    expertise: "Policy checks, approvals, and governance monitoring.",
    brainConfig: {
      provider: "Anthropic",
      model: "claude-3-5-sonnet",
      computeType: "CLOUD"
    },
    fallbackBrainConfig: {
      provider: "OpenAI",
      model: "gpt-4o-mini",
      computeType: "CLOUD"
    },
    salary: null,
    cost: "11.6000",
    rentRate: "25.0000",
    pricingModel: "OUTCOME",
    autonomyScore: 0.76,
    isRented: true,
    status: "RENTED",
    assignedOAuthIds: [adminGoogle.id]
  });

  const revenueAgent = await ensurePersonnel({
    orgId: demoOrg.id,
    type: "AI",
    name: "Revenue Ops Agent",
    role: "Revenue Ops",
    expertise: "Pipeline cleanup, account routing, and KPI tracking.",
    brainConfig: {
      provider: "OpenAI",
      model: "gpt-4o-mini",
      computeType: "CLOUD"
    },
    fallbackBrainConfig: {
      provider: "Gemini",
      model: "gemini-1.5-pro",
      computeType: "CLOUD"
    },
    salary: null,
    cost: "7.4000",
    rentRate: "16.3000",
    pricingModel: "SUBSCRIPTION",
    autonomyScore: 0.64,
    isRented: false,
    status: "IDLE",
    assignedOAuthIds: [ownerGoogle.id]
  });

  await ensurePersonnel({
    orgId: demoOrg.id,
    type: "HUMAN",
    name: "Rhea Kapoor",
    role: "Program Manager",
    expertise: "Cross-team delivery and stakeholder communication.",
    brainConfig: null,
    fallbackBrainConfig: null,
    salary: "9800.00",
    cost: "54.5000",
    rentRate: "0.0000",
    pricingModel: "SUBSCRIPTION",
    autonomyScore: 0.43,
    isRented: false,
    status: "ACTIVE",
    assignedOAuthIds: []
  });

  await ensurePersonnel({
    orgId: demoOrg.id,
    type: "HUMAN",
    name: "Arjun Verma",
    role: "Growth Lead",
    expertise: "Demand generation and conversion optimization.",
    brainConfig: null,
    fallbackBrainConfig: null,
    salary: "9400.00",
    cost: "47.0000",
    rentRate: "0.0000",
    pricingModel: "TOKEN",
    autonomyScore: 0.51,
    isRented: false,
    status: "ACTIVE",
    assignedOAuthIds: []
  });

  await ensurePersonnel({
    orgId: demoOrg.id,
    type: "HUMAN",
    name: "Mina Shah",
    role: "Finance Controller",
    expertise: "Budget governance and burn-rate approvals.",
    brainConfig: null,
    fallbackBrainConfig: null,
    salary: "10300.00",
    cost: "58.0000",
    rentRate: "0.0000",
    pricingModel: "OUTCOME",
    autonomyScore: 0.39,
    isRented: false,
    status: "PAUSED",
    assignedOAuthIds: []
  });

  async function ensureCapabilityGrant(agentId, linkedAccountId, scopes) {
    const existing = await prisma.capabilityGrant.findFirst({
      where: {
        orgId: demoOrg.id,
        agentId,
        linkedAccountId,
        revokedAt: null
      }
    });

    if (existing) {
      return prisma.capabilityGrant.update({
        where: { id: existing.id },
        data: { scopes }
      });
    }

    return prisma.capabilityGrant.create({
      data: {
        orgId: demoOrg.id,
        agentId,
        linkedAccountId,
        scopes
      }
    });
  }

  await ensureCapabilityGrant(mainAgent.id, ownerGoogle.id, {
    gmail: { read: true, send: true },
    drive: { read: true, write: true },
    seedTag: SEED_TAG
  });

  await ensureCapabilityGrant(strategyAgent.id, ownerLinkedIn.id, {
    linkedin: { read: true, post: true },
    docs: { read: true },
    seedTag: SEED_TAG
  });

  await ensureCapabilityGrant(complianceAgent.id, adminGoogle.id, {
    drive: { read: true },
    calendar: { read: true },
    seedTag: SEED_TAG
  });

  await ensureOrgMemoryEntry({
    orgId: demoOrg.id,
    key: "org.settings.llm",
    value: {
      mode: "PLATFORM_MANAGED",
      provider: "OpenAI",
      model: "gpt-4o-mini",
      fallbackProvider: "Anthropic",
      fallbackModel: "claude-3-5-sonnet",
      servicePlan: "GROWTH",
      serviceMarkupPct: 18,
      updatedAt: ago({ minutes: 15 }),
      seedTag: SEED_TAG
    }
  });

  await ensureOrgMemoryEntry({
    orgId: demoOrg.id,
    key: "org.billing.credits",
    value: {
      balanceCredits: 275000,
      lowBalanceThreshold: 30000,
      autoRechargeEnabled: true,
      updatedAt: ago({ minutes: 10 }),
      seedTag: SEED_TAG
    }
  });

  const companyDataContent = JSON.stringify(
    {
      company: {
        orgId: demoOrg.id,
        name: demoOrg.name,
        description:
          demoOrg.description ||
          "Seeded demo organization for platform-wide scenario validation.",
        theme: demoOrg.theme
      },
      founder: {
        username: owner.username,
        email: owner.email
      },
      orchestration: {
        mode: "PLATFORM_MANAGED",
        primaryProvider: "OpenAI",
        primaryModel: "gpt-4o-mini",
        fallbackProvider: "Anthropic",
        fallbackModel: "claude-3-5-sonnet"
      },
      billing: {
        monthlyBudgetUsd: "250000.00",
        tokenWalletCredits: 275000
      },
      seedTag: SEED_TAG,
      updatedAt: new Date().toISOString()
    },
    null,
    2
  );

  const companyDataFile = await ensureFileRecord({
    orgId: demoOrg.id,
    name: "Company Data",
    type: "INPUT",
    url: `memory://org/${demoOrg.id}/company-data`,
    size: toBigIntSize(companyDataContent),
    metadata: {
      hubScope: "ORGANIZATIONAL",
      hubSection: "INPUT",
      contentType: "application/json",
      editable: true,
      content: companyDataContent,
      seedTag: SEED_TAG
    }
  });

  const gtmUpload = await ensureLocalUpload(
    demoOrg.id,
    "demo-gtm-notes.txt",
    [
      "Enterprise GTM Notes",
      "Target segment: Series B SaaS buyers in North America.",
      "Need stronger inbound pipeline, high-intent keyword capture, and SDR handoff quality.",
      "North-star metric: SQL to Opportunity conversion above 32%."
    ].join("\n")
  );

  const ownerVaultUpload = await ensureLocalUpload(
    demoOrg.id,
    "demo-founder-vault.txt",
    [
      "Founder Vault Strategy",
      "Maintain speed while adding governance for security, legal, and finance approvals.",
      "Avoid growth that exceeds gross margin targets."
    ].join("\n")
  );

  const sopUpload = await ensureLocalUpload(
    demoOrg.id,
    "demo-employee-sop.txt",
    [
      "Employee SOP",
      "Every outbound campaign must include UTM mapping and owner assignment.",
      "Any pricing change above 12% needs finance + founder approval."
    ].join("\n")
  );

  const agentLibraryUpload = await ensureLocalUpload(
    demoOrg.id,
    "demo-agent-prompt-library.txt",
    [
      "Agent Prompt Library",
      "Prompt style: concise, numbered, evidence-driven.",
      "Escalation policy: open permission request when crossing role boundary."
    ].join("\n")
  );

  const dnaKnowledgeUpload = await ensureLocalUpload(
    demoOrg.id,
    "demo-dna-knowledge.txt",
    [
      "DNA Knowledge Snapshot",
      "Values: trust, speed, accountability, security, and customer empathy.",
      "Operating model: direction -> plan -> workflow -> review loop."
    ].join("\n")
  );

  const secureNotesUpload = await ensureLocalUpload(
    demoOrg.id,
    "demo-secure-notes.txt",
    [
      "Secure Notes",
      "Contains protected M&A hypotheses and confidential partner data.",
      "Read path must use amnesia protocol."
    ].join("\n")
  );

  const gtmAsset = await ensureFileRecord({
    orgId: demoOrg.id,
    name: "[DEMO-HSP] GTM Notes",
    type: "INPUT",
    url: gtmUpload.url,
    size: gtmUpload.size,
    metadata: {
      hubScope: "STORAGE",
      namespace: "/org/shared",
      ownerType: "ORG",
      ownerId: null,
      provider: "MANAGED",
      connectorId: null,
      tags: ["gtm", "inbound", "demo"],
      contentType: "text/plain",
      seedTag: SEED_TAG
    }
  });

  const ownerVaultAsset = await ensureFileRecord({
    orgId: demoOrg.id,
    name: "[DEMO-HSP] Founder Vault Strategy",
    type: "INPUT",
    url: ownerVaultUpload.url,
    size: ownerVaultUpload.size,
    metadata: {
      hubScope: "STORAGE",
      namespace: "/owner/main",
      ownerType: "OWNER",
      ownerId: owner.email,
      provider: "MANAGED",
      connectorId: IDS.connector.google,
      tags: ["founder", "strategy", "vault"],
      contentType: "text/plain",
      seedTag: SEED_TAG
    }
  });

  const employeeSopAsset = await ensureFileRecord({
    orgId: demoOrg.id,
    name: "[DEMO-HSP] Employee SOP",
    type: "INPUT",
    url: sopUpload.url,
    size: sopUpload.size,
    metadata: {
      hubScope: "STORAGE",
      namespace: "/employee/rhea",
      ownerType: "EMPLOYEE",
      ownerId: employeeUser.id,
      provider: "GOOGLE_DRIVE",
      connectorId: IDS.connector.google,
      tags: ["sop", "ops"],
      contentType: "text/plain",
      seedTag: SEED_TAG
    }
  });

  const agentPromptAsset = await ensureFileRecord({
    orgId: demoOrg.id,
    name: "[DEMO-HSP] Agent Prompt Library",
    type: "DNA",
    url: agentLibraryUpload.url,
    size: agentLibraryUpload.size,
    metadata: {
      hubScope: "STORAGE",
      namespace: "/agent/main-agent",
      ownerType: "AGENT",
      ownerId: mainAgent.id,
      provider: "S3_COMPATIBLE",
      connectorId: IDS.connector.s3,
      tags: ["agent", "dna", "prompt"],
      contentType: "text/plain",
      ingestStatus: "completed",
      seedTag: SEED_TAG
    }
  });

  const dnaSnapshot = await ensureFileRecord({
    orgId: demoOrg.id,
    name: "[DEMO-HSP] Knowledge Graph Snapshot",
    type: "DNA",
    url: dnaKnowledgeUpload.url,
    size: dnaKnowledgeUpload.size,
    metadata: {
      hubScope: "DNA",
      ingestStatus: "processing",
      ingestRequestedAt: ago({ minutes: 8 }),
      source: "workflow",
      seedTag: SEED_TAG
    }
  });

  const secureDna = await ensureFileRecord({
    orgId: demoOrg.id,
    name: "[DEMO-HSP] Secure M&A Notes",
    type: "DNA",
    url: secureNotesUpload.url,
    size: secureNotesUpload.size,
    isAmnesiaProtected: true,
    metadata: {
      hubScope: "DNA",
      ingestStatus: "queued",
      sensitivity: "high",
      seedTag: SEED_TAG
    }
  });

  const directionNorth = {
    id: IDS.direction.northStar,
    orgId: demoOrg.id,
    title: "Shift to enterprise inbound engine",
    summary:
      "Move from opportunistic leads to repeatable enterprise inbound acquisition.",
    direction:
      "In the next quarter, prioritize enterprise inbound as the primary pipeline source. Tighten qualification, shorten handoff latency, and increase SQL-to-opportunity conversion while controlling CAC.",
    status: "ACTIVE",
    source: "CHAT",
    ownerUserId: owner.id,
    ownerEmail: owner.email,
    ownerName: owner.username,
    tags: ["growth", "enterprise", "pipeline"],
    impactScore: 0.93,
    createdAt: ago({ days: 12 }),
    updatedAt: ago({ hours: 4 }),
    lastExecutedAt: ago({ hours: 2 }),
    seedTag: SEED_TAG
  };

  const directionAutomation = {
    id: IDS.direction.automation,
    orgId: demoOrg.id,
    title: "Automate revenue operations handoff",
    summary:
      "Reduce manual state transitions between marketing, SDR, and account executives.",
    direction:
      "Automate CRM stage transitions, assignment routing, and follow-up SLAs. Keep human oversight on exception paths and approvals touching legal or finance.",
    status: "ACTIVE",
    source: "MANUAL",
    ownerUserId: adminUser.id,
    ownerEmail: adminUser.email,
    ownerName: adminUser.username,
    tags: ["automation", "revops", "workflow"],
    impactScore: 0.81,
    createdAt: ago({ days: 10 }),
    updatedAt: ago({ hours: 5 }),
    seedTag: SEED_TAG
  };

  const directionRisk = {
    id: IDS.direction.risk,
    orgId: demoOrg.id,
    title: "Deploy risk and budget guardrails",
    summary: "Prevent runaway spend and unauthorized scope expansion in automation.",
    direction:
      "Introduce permission gates for budget-sensitive changes, legal content updates, and cross-team ownership changes. Keep fallback plans ready for every major workflow.",
    status: "DRAFT",
    source: "SYSTEM",
    ownerUserId: owner.id,
    ownerEmail: owner.email,
    ownerName: owner.username,
    tags: ["risk", "compliance", "cost"],
    impactScore: 0.74,
    createdAt: ago({ days: 8 }),
    updatedAt: ago({ hours: 7 }),
    seedTag: SEED_TAG
  };

  await ensureOrgMemoryEntry({
    orgId: demoOrg.id,
    key: `direction.record.${directionNorth.id}`,
    value: directionNorth
  });
  await ensureOrgMemoryEntry({
    orgId: demoOrg.id,
    key: `direction.record.${directionAutomation.id}`,
    value: directionAutomation
  });
  await ensureOrgMemoryEntry({
    orgId: demoOrg.id,
    key: `direction.record.${directionRisk.id}`,
    value: directionRisk
  });

  await ensureOrgMemoryEntry({
    orgId: demoOrg.id,
    key: `direction.link.${directionNorth.id}.${directionAutomation.id}`,
    value: {
      id: "demo-direction-link-1",
      orgId: demoOrg.id,
      fromDirectionId: directionNorth.id,
      toDirectionId: directionAutomation.id,
      relation: "SUPPORTS",
      note: "Automation is required to scale inbound throughput.",
      createdAt: ago({ days: 9 }),
      updatedAt: ago({ hours: 6 }),
      seedTag: SEED_TAG
    }
  });

  await ensureOrgMemoryEntry({
    orgId: demoOrg.id,
    key: `direction.link.${directionAutomation.id}.${directionRisk.id}`,
    value: {
      id: "demo-direction-link-2",
      orgId: demoOrg.id,
      fromDirectionId: directionAutomation.id,
      toDirectionId: directionRisk.id,
      relation: "DEPENDS_ON",
      note: "Risk guardrails must land before broad automation rollout.",
      createdAt: ago({ days: 7 }),
      updatedAt: ago({ hours: 6 }),
      seedTag: SEED_TAG
    }
  });

  const primaryPlanNorth = {
    summary: "Enterprise inbound execution with tight owner mapping and approvals.",
    workflows: [
      {
        title: "Inbound Demand Workflow",
        goal: "Generate and qualify enterprise demand with measurable conversion lifts.",
        tasks: [
          {
            title: "Publish ICP-aligned inbound campaign",
            ownerRole: "Growth Lead",
            subtasks: [
              "Refine keyword clusters by ICP stage.",
              "Publish landing pages with intent capture."
            ],
            tools: ["GOOGLE_DRIVE", "CRM"],
            requiresApproval: false,
            approvalRole: "ADMIN",
            approvalReason: ""
          },
          {
            title: "Automate SQL routing",
            ownerRole: "Revenue Ops",
            subtasks: [
              "Route SQL by segment and account score.",
              "Raise escalations for incomplete records."
            ],
            tools: ["CRM", "SLACK"],
            requiresApproval: true,
            approvalRole: "ADMIN",
            approvalReason: "Automation affects ownership boundaries."
          }
        ]
      }
    ],
    risks: [
      "Lead quality may drop with aggressive volume goals.",
      "Routing bugs can delay account handoff."
    ],
    successMetrics: [
      "SQL to opportunity > 32%",
      "Median handoff latency < 30 minutes"
    ]
  };

  const fallbackPlanNorth = {
    summary: "Fallback path if routing quality degrades or burn exceeds threshold.",
    workflows: [
      {
        title: "Controlled Fallback Workflow",
        goal: "Protect conversion quality while reducing automation scope.",
        tasks: [
          {
            title: "Disable high-risk automation rules",
            ownerRole: "Program Manager",
            subtasks: [
              "Freeze dynamic owner reassignment.",
              "Switch critical stages to manual review."
            ],
            tools: ["CRM"],
            requiresApproval: true,
            approvalRole: "FOUNDER",
            approvalReason: "Fallback changes core execution model."
          }
        ]
      }
    ],
    risks: ["Manual load increases for operations team."],
    successMetrics: ["No SLA breach during fallback period"]
  };

  await ensureOrgMemoryEntry({
    orgId: demoOrg.id,
    key: `plan.record.${IDS.plan.northStar}`,
    value: {
      id: IDS.plan.northStar,
      orgId: demoOrg.id,
      title: "Plan: Enterprise inbound engine",
      summary:
        "Primary and fallback plan for enterprise inbound direction with explicit approvals.",
      direction: directionNorth.direction,
      directionId: directionNorth.id,
      humanPlan:
        "Human review requested on workflow sequencing and legal approval touchpoints.",
      primaryPlan: primaryPlanNorth,
      fallbackPlan: fallbackPlanNorth,
      status: "ACTIVE",
      source: "CHAT",
      ownerEmail: owner.email,
      createdAt: ago({ days: 11 }),
      updatedAt: ago({ hours: 3 }),
      seedTag: SEED_TAG
    }
  });

  await ensureOrgMemoryEntry({
    orgId: demoOrg.id,
    key: `plan.record.${IDS.plan.automation}`,
    value: {
      id: IDS.plan.automation,
      orgId: demoOrg.id,
      title: "Plan: RevOps automation hardening",
      summary:
        "Tune automation sequence and permission checks for cross-functional routing.",
      direction: directionAutomation.direction,
      directionId: directionAutomation.id,
      humanPlan:
        "Keep exception handling manual for legal-sensitive accounts until confidence improves.",
      primaryPlan: {
        summary: "Progressive automation rollout by region.",
        workflows: [
          {
            title: "Routing and SLA Workflow",
            goal: "Standardize assignments and follow-ups",
            tasks: [
              {
                title: "Launch routing v2",
                ownerRole: "Revenue Ops",
                subtasks: ["Apply score thresholds", "Track exceptions"],
                tools: ["CRM"],
                requiresApproval: true,
                approvalRole: "ADMIN",
                approvalReason: "Ownership and SLA constraints are impacted."
              }
            ]
          }
        ],
        risks: ["Incorrect routing may hurt response times"],
        successMetrics: ["SLA breaches reduced by 30%"]
      },
      fallbackPlan: {
        summary: "Manual fallback with controlled queue ownership.",
        workflows: [],
        risks: ["Manual review overhead"],
        successMetrics: ["No missed handoff in fallback mode"]
      },
      status: "ACTIVE",
      source: "MANUAL",
      ownerEmail: adminUser.email,
      createdAt: ago({ days: 9 }),
      updatedAt: ago({ hours: 5 }),
      seedTag: SEED_TAG
    }
  });

  const flowNorthActive = await ensureFlow({
    orgId: demoOrg.id,
    prompt:
      "[DEMO-HSP] Execute enterprise inbound launch and qualification routing hardening.",
    status: "PAUSED",
    progress: 62,
    predictedBurn: 18500,
    requiredSignatures: 2
  });

  const flowNorthCompleted = await ensureFlow({
    orgId: demoOrg.id,
    prompt: "[DEMO-HSP] Complete weekly KPI aggregation and founder briefing.",
    status: "COMPLETED",
    progress: 100,
    predictedBurn: 7200,
    requiredSignatures: 1
  });

  const flowBranchFailed = await ensureFlow({
    orgId: demoOrg.id,
    prompt: "[DEMO-HSP] Branch experiment for recovery after outbound sequence mismatch.",
    status: "FAILED",
    progress: 48,
    predictedBurn: 9300,
    requiredSignatures: 1,
    parentFlowId: flowNorthCompleted.id
  });

  const flowQueuedLaunch = await ensureFlow({
    orgId: demoOrg.id,
    prompt: "[DEMO-HSP] Queue new APAC expansion campaign for approval staging.",
    status: "QUEUED",
    progress: 8,
    predictedBurn: 5600,
    requiredSignatures: 1
  });

  const flowLiveExecution = await ensureFlow({
    orgId: demoOrg.id,
    prompt: "[DEMO-HSP] Active execution of inbound landing page conversion experiments.",
    status: "ACTIVE",
    progress: 37,
    predictedBurn: 8100,
    requiredSignatures: 1
  });

  const flowAbortedRollback = await ensureFlow({
    orgId: demoOrg.id,
    prompt: "[DEMO-HSP] Abort stale automation rollout after governance timeout.",
    status: "ABORTED",
    progress: 23,
    predictedBurn: 3400,
    requiredSignatures: 1
  });

  const flowAPlanningTask = await ensureTask({
    flowId: flowNorthActive.id,
    agentId: mainAgent.id,
    prompt:
      "[DEMO-HSP:TASK] Planning phase: convert direction to milestones and owner assignments.",
    status: "COMPLETED",
    requiredFiles: [companyDataFile.id, gtmAsset.id],
    executionTrace: {
      stage: "planning",
      completedAt: ago({ hours: 5 }),
      seedTag: SEED_TAG
    },
    verifiableProof: `proof:${hash("flowAPlanning", 16)}`
  });

  const flowAExecutionTask = await ensureTask({
    flowId: flowNorthActive.id,
    agentId: strategyAgent.id,
    prompt:
      "[DEMO-HSP:TASK] Draft and validate enterprise inbound messaging sequence.",
    status: "RUNNING",
    requiredFiles: [gtmAsset.id, ownerVaultAsset.id],
    executionTrace: {
      stage: "execution",
      nextAction: "Publish variant testing matrix",
      requestedToolkits: ["gmail", "notion"],
      seedTag: SEED_TAG
    },
    verifiableProof: `proof:${hash("flowAExecution", 16)}`
  });

  const flowAHumanInputTask = await ensureTask({
    flowId: flowNorthActive.id,
    agentId: complianceAgent.id,
    prompt:
      "[DEMO-HSP:TASK] Review legal-sensitive campaign claims before launch.",
    status: "PAUSED",
    requiredFiles: [employeeSopAsset.id],
    isPausedForInput: true,
    humanInterventionReason:
      "Approval required from founder/admin for legal-sensitive outbound copy.",
    executionTrace: {
      stage: "human_touch",
      integrationError: {
        code: "INTEGRATION_NOT_CONNECTED",
        toolkit: "notion",
        action: "LEGAL_REVIEW_NOTE",
        connectUrl: "/app?tab=hub&hubScope=TOOLS&toolkit=notion"
      },
      seedTag: SEED_TAG
    },
    verifiableProof: `proof:${hash("flowAHuman", 16)}`
  });

  const flowAQueuedTask = await ensureTask({
    flowId: flowNorthActive.id,
    agentId: revenueAgent.id,
    prompt:
      "[DEMO-HSP:TASK] Roll out routing changes to SDR queue after approvals.",
    status: "QUEUED",
    requiredFiles: [employeeSopAsset.id, gtmAsset.id],
    executionTrace: {
      stage: "queued",
      waitingForTaskId: flowAHumanInputTask.id,
      seedTag: SEED_TAG
    }
  });

  const flowBTaskOne = await ensureTask({
    flowId: flowNorthCompleted.id,
    agentId: mainAgent.id,
    prompt:
      "[DEMO-HSP:TASK] Aggregate weekly KPI deltas and summarize leadership context.",
    status: "COMPLETED",
    requiredFiles: [companyDataFile.id, gtmAsset.id],
    executionTrace: {
      stage: "completed",
      outputGenerated: true,
      seedTag: SEED_TAG
    },
    verifiableProof: `proof:${hash("flowBTaskOne", 16)}`
  });

  const flowBTaskTwo = await ensureTask({
    flowId: flowNorthCompleted.id,
    agentId: strategyAgent.id,
    prompt:
      "[DEMO-HSP:TASK] Generate founder-ready performance brief and next-step options.",
    status: "COMPLETED",
    requiredFiles: [ownerVaultAsset.id],
    executionTrace: {
      stage: "completed",
      outputGenerated: true,
      seedTag: SEED_TAG
    },
    verifiableProof: `proof:${hash("flowBTaskTwo", 16)}`
  });

  const flowCTaskOne = await ensureTask({
    flowId: flowBranchFailed.id,
    agentId: revenueAgent.id,
    prompt:
      "[DEMO-HSP:TASK] Execute branch hypothesis on outbound sequence timing.",
    status: "FAILED",
    requiredFiles: [employeeSopAsset.id],
    executionTrace: {
      stage: "failed",
      error: "Sequence conflict with existing SLA windows.",
      seedTag: SEED_TAG
    },
    humanInterventionReason: "Branch failed due to SLA rule conflicts."
  });

  await ensureTask({
    flowId: flowBranchFailed.id,
    agentId: complianceAgent.id,
    prompt:
      "[DEMO-HSP:TASK] Validate branch rollback and preserve audit trail.",
    status: "ABORTED",
    requiredFiles: [secureDna.id],
    executionTrace: {
      stage: "aborted",
      reason: "Upstream branch failed",
      seedTag: SEED_TAG
    }
  });

  await ensureTask({
    flowId: flowQueuedLaunch.id,
    agentId: revenueAgent.id,
    prompt:
      "[DEMO-HSP:TASK] Prepare APAC launch checklist and wait for kickoff approval.",
    status: "QUEUED",
    requiredFiles: [companyDataFile.id, employeeSopAsset.id],
    executionTrace: {
      stage: "queued",
      waitingForApproverRole: "ADMIN",
      seedTag: SEED_TAG
    }
  });

  await ensureTask({
    flowId: flowLiveExecution.id,
    agentId: strategyAgent.id,
    prompt:
      "[DEMO-HSP:TASK] Execute live landing-page experiment and monitor conversion deltas.",
    status: "RUNNING",
    requiredFiles: [gtmAsset.id, ownerVaultAsset.id],
    executionTrace: {
      stage: "running",
      experimentWindow: "48h",
      seedTag: SEED_TAG
    },
    verifiableProof: `proof:${hash("flowLiveExecution", 16)}`
  });

  await ensureTask({
    flowId: flowAbortedRollback.id,
    agentId: mainAgent.id,
    prompt:
      "[DEMO-HSP:TASK] Rollback stale automation rollout and archive pending changes.",
    status: "ABORTED",
    requiredFiles: [secureDna.id],
    executionTrace: {
      stage: "aborted",
      reason: "Governance timeout exceeded.",
      seedTag: SEED_TAG
    }
  });

  await ensureFileRecord({
    orgId: demoOrg.id,
    name: "[DEMO-HSP] Weekly KPI Output",
    type: "OUTPUT",
    url: `memory://org/${demoOrg.id}/output/kpi-brief`,
    size: toBigIntSize("Seeded KPI summary output for dashboard preview."),
    metadata: {
      outputPreview:
        "KPI Brief: SQL conversion +3.4%, median handoff latency 24m, CAC down 7.8%.",
      sourceFlowId: flowNorthCompleted.id,
      sourceTaskId: flowBTaskTwo.id,
      seedTag: SEED_TAG
    }
  });

  await ensureFileRecord({
    orgId: demoOrg.id,
    name: "[DEMO-HSP] Approval Packet",
    type: "OUTPUT",
    url: `memory://org/${demoOrg.id}/output/approval-packet`,
    size: toBigIntSize("Approval packet preview."),
    metadata: {
      outputPreview:
        "Approval packet prepared for legal-sensitive launch claims and budget change request.",
      sourceFlowId: flowNorthActive.id,
      sourceTaskId: flowAPlanningTask.id,
      seedTag: SEED_TAG
    }
  });

  const existingLock = await prisma.hubFileLock.findFirst({
    where: {
      orgId: demoOrg.id,
      fileId: employeeSopAsset.id,
      taskId: flowAHumanInputTask.id,
      releasedAt: null
    }
  });

  if (!existingLock) {
    await prisma.hubFileLock.create({
      data: {
        orgId: demoOrg.id,
        fileId: employeeSopAsset.id,
        taskId: flowAHumanInputTask.id,
        agentId: complianceAgent.id,
        reason: "Human review lock for legal-sensitive SOP dependency.",
        metadata: {
          seedTag: SEED_TAG
        },
        acquiredAt: new Date(ago({ minutes: 48 })),
        expiresAt: new Date(fromNow({ hours: 6 }))
      }
    });
  }

  const runningLock = await prisma.hubFileLock.findFirst({
    where: {
      orgId: demoOrg.id,
      fileId: gtmAsset.id,
      taskId: flowAExecutionTask.id,
      releasedAt: null
    }
  });

  if (!runningLock) {
    await prisma.hubFileLock.create({
      data: {
        orgId: demoOrg.id,
        fileId: gtmAsset.id,
        taskId: flowAExecutionTask.id,
        agentId: strategyAgent.id,
        reason: "Execution lock for active message testing.",
        metadata: {
          seedTag: SEED_TAG
        },
        acquiredAt: new Date(ago({ minutes: 22 })),
        expiresAt: new Date(fromNow({ hours: 4 }))
      }
    });
  }

  const directionFlowLinks = [
    {
      key: `direction.flow.${directionNorth.id}.${flowNorthActive.id}`,
      value: {
        id: "demo-direction-flow-link-1",
        orgId: demoOrg.id,
        directionId: directionNorth.id,
        flowId: flowNorthActive.id,
        createdAt: ago({ hours: 6 }),
        seedTag: SEED_TAG
      }
    },
    {
      key: `direction.flow.${directionNorth.id}.${flowNorthCompleted.id}`,
      value: {
        id: "demo-direction-flow-link-2",
        orgId: demoOrg.id,
        directionId: directionNorth.id,
        flowId: flowNorthCompleted.id,
        createdAt: ago({ days: 1, hours: 2 }),
        seedTag: SEED_TAG
      }
    },
    {
      key: `direction.flow.${directionAutomation.id}.${flowBranchFailed.id}`,
      value: {
        id: "demo-direction-flow-link-3",
        orgId: demoOrg.id,
        directionId: directionAutomation.id,
        flowId: flowBranchFailed.id,
        createdAt: ago({ hours: 14 }),
        seedTag: SEED_TAG
      }
    },
    {
      key: `direction.flow.${directionAutomation.id}.${flowQueuedLaunch.id}`,
      value: {
        id: "demo-direction-flow-link-4",
        orgId: demoOrg.id,
        directionId: directionAutomation.id,
        flowId: flowQueuedLaunch.id,
        createdAt: ago({ hours: 9 }),
        seedTag: SEED_TAG
      }
    },
    {
      key: `direction.flow.${directionNorth.id}.${flowLiveExecution.id}`,
      value: {
        id: "demo-direction-flow-link-5",
        orgId: demoOrg.id,
        directionId: directionNorth.id,
        flowId: flowLiveExecution.id,
        createdAt: ago({ hours: 5 }),
        seedTag: SEED_TAG
      }
    },
    {
      key: `direction.flow.${directionRisk.id}.${flowAbortedRollback.id}`,
      value: {
        id: "demo-direction-flow-link-6",
        orgId: demoOrg.id,
        directionId: directionRisk.id,
        flowId: flowAbortedRollback.id,
        createdAt: ago({ days: 2 }),
        seedTag: SEED_TAG
      }
    }
  ];

  for (const link of directionFlowLinks) {
    await ensureOrgMemoryEntry({
      orgId: demoOrg.id,
      key: link.key,
      value: link.value
    });
  }

  const approvals = [
    { flowId: flowNorthActive.id, userId: owner.id },
    { flowId: flowNorthActive.id, userId: adminUser.id },
    { flowId: flowNorthCompleted.id, userId: owner.id },
    { flowId: flowLiveExecution.id, userId: owner.id }
  ];

  for (const approval of approvals) {
    await prisma.flowApproval.upsert({
      where: {
        flowId_userId: {
          flowId: approval.flowId,
          userId: approval.userId
        }
      },
      update: {},
      create: approval
    });
  }

  const permissionRequests = [
    {
      id: IDS.permissionRequest.pending,
      status: "PENDING",
      targetRole: "ADMIN",
      direction: directionNorth.direction,
      requestedByUserId: owner.id,
      requestedByEmail: owner.email,
      area: "Routing Automation",
      reason: "Need admin approval before enabling ownership auto-reassignment.",
      workflowTitle: "Inbound Demand Workflow",
      taskTitle: "Automate SQL routing",
      createdAt: ago({ hours: 4 }),
      updatedAt: ago({ hours: 2 }),
      decidedAt: null,
      decidedByUserId: null,
      decidedByEmail: null,
      decisionNote: null
    },
    {
      id: IDS.permissionRequest.approved,
      status: "APPROVED",
      targetRole: "FOUNDER",
      direction: directionAutomation.direction,
      requestedByUserId: adminUser.id,
      requestedByEmail: adminUser.email,
      area: "Budget Controls",
      reason: "Automation rollout changes forecasted monthly burn profile.",
      workflowTitle: "Routing and SLA Workflow",
      taskTitle: "Launch routing v2",
      createdAt: ago({ days: 1, hours: 3 }),
      updatedAt: ago({ days: 1, hours: 1 }),
      decidedAt: ago({ days: 1, hours: 1 }),
      decidedByUserId: owner.id,
      decidedByEmail: owner.email,
      decisionNote: "Approved with weekly burn checkpoints."
    },
    {
      id: IDS.permissionRequest.rejected,
      status: "REJECTED",
      targetRole: "FOUNDER",
      direction: directionRisk.direction,
      requestedByUserId: adminUser.id,
      requestedByEmail: adminUser.email,
      area: "Legal Messaging",
      reason: "Requested auto-approval for legal copy changes.",
      workflowTitle: "Controlled Fallback Workflow",
      taskTitle: "Disable high-risk automation rules",
      createdAt: ago({ days: 2, hours: 4 }),
      updatedAt: ago({ days: 2, hours: 2 }),
      decidedAt: ago({ days: 2, hours: 2 }),
      decidedByUserId: owner.id,
      decidedByEmail: owner.email,
      decisionNote: "Legal copy must remain manually approved."
    }
  ];

  for (const request of permissionRequests) {
    await ensureOrgMemoryEntry({
      orgId: demoOrg.id,
      key: `org.request.permission.${request.id}`,
      value: {
        ...request,
        orgId: demoOrg.id,
        seedTag: SEED_TAG
      }
    });
  }

  const joinRequests = [
    {
      id: IDS.joinRequest.pending,
      requesterUserId: pendingRequester.id,
      requesterEmail: pendingRequester.email,
      requesterName: pendingRequester.username,
      requestedRole: "EMPLOYEE",
      message:
        "Requesting access to support campaign operations and workflow QA.",
      status: "PENDING",
      createdAt: ago({ hours: 9 }),
      updatedAt: ago({ hours: 9 }),
      decidedAt: null,
      decidedByUserId: null,
      decidedByEmail: null,
      decisionNote: null
    },
    {
      id: IDS.joinRequest.approved,
      requesterUserId: approvedRequester.id,
      requesterEmail: approvedRequester.email,
      requesterName: approvedRequester.username,
      requestedRole: "EMPLOYEE",
      message: "Joined to support launch analytics reporting.",
      status: "APPROVED",
      createdAt: ago({ days: 3 }),
      updatedAt: ago({ days: 2, hours: 21 }),
      decidedAt: ago({ days: 2, hours: 21 }),
      decidedByUserId: owner.id,
      decidedByEmail: owner.email,
      decisionNote: "Approved for analytics scope only."
    }
  ];

  for (const request of joinRequests) {
    await ensureOrgMemoryEntry({
      orgId: demoOrg.id,
      key: `squad.join-request.${request.id}`,
      value: {
        ...request,
        orgId: demoOrg.id,
        seedTag: SEED_TAG
      }
    });
  }

  const schedules = [
    {
      id: IDS.schedule.daily,
      title: "Daily inbound quality checkpoint",
      direction: directionNorth.direction,
      directionId: directionNorth.id,
      cadence: "DAILY",
      nextRunAt: fromNow({ hours: 12 }),
      timezone: "Asia/Calcutta",
      swarmDensity: 28,
      requiredSignatures: 2,
      predictedBurn: 4200,
      enabled: true,
      createdAt: ago({ days: 5 }),
      updatedAt: ago({ hours: 2 }),
      lastRunAt: ago({ hours: 12 })
    },
    {
      id: IDS.schedule.weekly,
      title: "Weekly automation governance review",
      direction: directionAutomation.direction,
      directionId: directionAutomation.id,
      cadence: "WEEKLY",
      nextRunAt: fromNow({ days: 4 }),
      timezone: "Asia/Calcutta",
      swarmDensity: 20,
      requiredSignatures: 1,
      predictedBurn: 3100,
      enabled: true,
      createdAt: ago({ days: 12 }),
      updatedAt: ago({ days: 1 }),
      lastRunAt: ago({ days: 3 })
    }
  ];

  for (const schedule of schedules) {
    await ensureOrgMemoryEntry({
      orgId: demoOrg.id,
      key: `schedule.mission.${schedule.id}`,
      value: {
        ...schedule,
        orgId: demoOrg.id,
        seedTag: SEED_TAG
      }
    });
  }

  const connectors = [
    {
      id: IDS.connector.google,
      name: "Google Drive Workspace Connector",
      provider: "GOOGLE_DRIVE",
      createdByUserId: owner.id,
      createdByEmail: owner.email,
      accountHint: owner.email,
      settings: {
        rootFolder: "VX Demo Shared",
        syncMode: "two-way"
      },
      encryptedCredential: encryptedStub("storage-google"),
      createdAt: ago({ days: 14 }),
      updatedAt: ago({ hours: 3 }),
      lastSyncAt: ago({ minutes: 35 })
    },
    {
      id: IDS.connector.s3,
      name: "S3 Archive Connector",
      provider: "S3_COMPATIBLE",
      createdByUserId: adminUser.id,
      createdByEmail: adminUser.email,
      accountHint: "vx-demo-archive",
      settings: {
        bucket: "vx-demo-archive",
        region: "ap-south-1"
      },
      encryptedCredential: encryptedStub("storage-s3"),
      createdAt: ago({ days: 10 }),
      updatedAt: ago({ hours: 5 }),
      lastSyncAt: ago({ minutes: 52 })
    }
  ];

  for (const connector of connectors) {
    await ensureOrgMemoryEntry({
      orgId: demoOrg.id,
      key: `storage.connector.${connector.id}`,
      value: {
        ...connector,
        orgId: demoOrg.id,
        status: "CONNECTED",
        seedTag: SEED_TAG
      }
    });
  }

  const toolGrants = [
    {
      id: IDS.toolGrant.owner,
      tool: "MANAGED_VAULT",
      principalType: "OWNER",
      principalId: owner.email,
      capabilities: ["read", "write", "ingest"]
    },
    {
      id: IDS.toolGrant.agent,
      tool: "GOOGLE_DRIVE",
      principalType: "AGENT",
      principalId: mainAgent.id,
      capabilities: ["read", "write"]
    },
    {
      id: IDS.toolGrant.employee,
      tool: "S3_COMPATIBLE",
      principalType: "EMPLOYEE",
      principalId: employeeUser.id,
      capabilities: ["read"]
    }
  ];

  for (const grant of toolGrants) {
    await ensureOrgMemoryEntry({
      orgId: demoOrg.id,
      key: `storage.tool.grant.${grant.id}`,
      value: {
        ...grant,
        orgId: demoOrg.id,
        createdAt: ago({ days: 8 }),
        updatedAt: ago({ hours: 4 }),
        seedTag: SEED_TAG
      }
    });
  }

  const dnaProfiles = [
    {
      key: "dna.profile.organization.root",
      value: {
        id: "demo-dna-org",
        orgId: demoOrg.id,
        scope: "ORGANIZATION",
        targetId: null,
        title: "Organizational DNA",
        summary:
          "The organization optimizes for trusted speed: fast execution with explicit approvals where risk is high.",
        coreTraits: ["trust", "speed", "compliance", "collaboration"],
        sourceAssetIds: [gtmAsset.id, companyDataFile.id, dnaSnapshot.id],
        createdAt: ago({ days: 7 }),
        updatedAt: ago({ hours: 1 }),
        seedTag: SEED_TAG
      }
    },
    {
      key: `dna.profile.employee.${employeeUser.id}`,
      value: {
        id: "demo-dna-employee-rhea",
        orgId: demoOrg.id,
        scope: "EMPLOYEE",
        targetId: employeeUser.id,
        title: "Rhea Kapoor DNA",
        summary:
          "Delivery-focused and escalation-aware. Prefers explicit ownership boundaries and measurable milestones.",
        coreTraits: ["delivery", "ownership", "clarity"],
        sourceAssetIds: [employeeSopAsset.id, ownerVaultAsset.id],
        createdAt: ago({ days: 6 }),
        updatedAt: ago({ hours: 2 }),
        seedTag: SEED_TAG
      }
    },
    {
      key: `dna.profile.agent.${mainAgent.id}`,
      value: {
        id: "demo-dna-agent-main",
        orgId: demoOrg.id,
        scope: "AGENT",
        targetId: mainAgent.id,
        title: "Main Agent DNA",
        summary:
          "Operates as strategic orchestrator: decomposes direction, raises permissions early, and maintains fallback plans.",
        coreTraits: ["orchestration", "governance", "fallback-thinking"],
        sourceAssetIds: [agentPromptAsset.id, dnaSnapshot.id],
        createdAt: ago({ days: 6 }),
        updatedAt: ago({ hours: 2 }),
        seedTag: SEED_TAG
      }
    }
  ];

  for (const profile of dnaProfiles) {
    await ensureOrgMemoryEntry({
      orgId: demoOrg.id,
      key: profile.key,
      value: profile.value
    });
  }

  await ensureMemoryEntryByTier({
    orgId: demoOrg.id,
    tier: MemoryTier.USER,
    key: "demo.user.preference.focus",
    userId: owner.id,
    value: {
      focus: "enterprise inbound",
      updatedAt: ago({ minutes: 50 }),
      seedTag: SEED_TAG
    }
  });

  await ensureMemoryEntryByTier({
    orgId: demoOrg.id,
    tier: MemoryTier.AGENT,
    key: "demo.agent.main.instructions",
    agentId: mainAgent.id,
    value: {
      policy: "Ask for permission when touching legal, finance, or ownership data.",
      seedTag: SEED_TAG
    }
  });

  await ensureMemoryEntryByTier({
    orgId: demoOrg.id,
    tier: MemoryTier.WORKING,
    key: "demo.working.current.execution",
    flowId: flowNorthActive.id,
    taskId: flowAExecutionTask.id,
    value: {
      state: "running",
      note: "Testing message variants before full rollout.",
      seedTag: SEED_TAG
    },
    ttlSeconds: 3600,
    expiresAt: new Date(fromNow({ hours: 1 }))
  });

  const webhookDefs = [
    {
      targetUrl: "https://hooks.vx-demo.local/flow-completed",
      eventType: "FLOW_COMPLETED",
      isActive: true
    },
    {
      targetUrl: "https://hooks.vx-demo.local/human-touch",
      eventType: "HUMAN_TOUCH_REQUIRED",
      isActive: true
    },
    {
      targetUrl: "https://hooks.vx-demo.local/kill-switch",
      eventType: "KILL_SWITCH",
      isActive: false
    }
  ];

  for (const item of webhookDefs) {
    const existing = await prisma.webhook.findFirst({
      where: {
        orgId: demoOrg.id,
        targetUrl: item.targetUrl,
        eventType: item.eventType
      }
    });

    if (existing) {
      await prisma.webhook.update({
        where: { id: existing.id },
        data: { isActive: item.isActive }
      });
    } else {
      await prisma.webhook.create({
        data: {
          orgId: demoOrg.id,
          targetUrl: item.targetUrl,
          eventType: item.eventType,
          isActive: item.isActive
        }
      });
    }
  }

  const railDefs = [
    {
      name: "ONDC Primary Rail",
      railType: "ONDC",
      baseUrl: "https://api.ondc.sandbox.vx",
      region: "India",
      isActive: true,
      config: { network: "sandbox", seedTag: SEED_TAG }
    },
    {
      name: "Custom Sovereign Rail",
      railType: "CUSTOM",
      baseUrl: "https://rail.custom.vx",
      region: "US-East",
      isActive: true,
      config: { version: "v1", seedTag: SEED_TAG }
    }
  ];

  for (const rail of railDefs) {
    const existing = await prisma.sovereignRailConfig.findFirst({
      where: {
        orgId: demoOrg.id,
        name: rail.name,
        railType: rail.railType
      }
    });

    if (existing) {
      await prisma.sovereignRailConfig.update({
        where: { id: existing.id },
        data: {
          baseUrl: rail.baseUrl,
          region: rail.region,
          isActive: rail.isActive,
          config: rail.config
        }
      });
    } else {
      await prisma.sovereignRailConfig.create({
        data: {
          orgId: demoOrg.id,
          name: rail.name,
          railType: rail.railType,
          baseUrl: rail.baseUrl,
          region: rail.region,
          isActive: rail.isActive,
          config: rail.config
        }
      });
    }
  }

  await prisma.userIntegration.upsert({
    where: {
      provider_connectionId: {
        provider: "composio",
        connectionId: `${SEED_TAG}-gmail-connection`
      }
    },
    update: {
      userId: owner.id,
      orgId: demoOrg.id,
      toolkit: "gmail",
      status: "ACTIVE",
      metadata: {
        seedTag: SEED_TAG
      }
    },
    create: {
      userId: owner.id,
      orgId: demoOrg.id,
      provider: "composio",
      toolkit: "gmail",
      connectionId: `${SEED_TAG}-gmail-connection`,
      status: "ACTIVE",
      metadata: {
        seedTag: SEED_TAG
      }
    }
  });

  await ensureLog({
    orgId: demoOrg.id,
    type: "SYS",
    actor: "MAIN_AGENT_ORCHESTRATOR",
    message: `[DEMO-HSP] fallback model hot-swap engaged for flow ${flowNorthActive.id}.`,
    timestamp: ago({ hours: 3 })
  });

  await ensureLog({
    orgId: demoOrg.id,
    type: "EXE",
    actor: "FLOW_ENGINE",
    message: `[DEMO-HSP] Flow ${flowNorthActive.id} paused for human touch on task ${flowAHumanInputTask.id}.`,
    timestamp: ago({ hours: 2 })
  });

  await ensureLog({
    orgId: demoOrg.id,
    type: "USER",
    actor: owner.email,
    message: "[DEMO-HSP] Founder updated strategic direction and approved two-signature launch.",
    timestamp: ago({ hours: 1 })
  });

  await ensureLog({
    orgId: demoOrg.id,
    type: "NET",
    actor: "INTEGRATION_GATEWAY",
    message: "[DEMO-HSP] sovereign routing check passed for outbound connector.",
    timestamp: ago({ minutes: 55 })
  });

  await ensureLog({
    orgId: demoOrg.id,
    type: "SCRUB",
    actor: "AMNESIA_PROTOCOL",
    message: `[DEMO-HSP] amnesia zero-retention wipe applied to ${secureDna.id}.`,
    timestamp: ago({ minutes: 35 })
  });

  await ensureLog({
    orgId: demoOrg.id,
    type: "DNA",
    actor: "DNA_PIPELINE",
    message: `[DEMO-HSP] DNA embedding refresh started for ${dnaSnapshot.id}.`,
    timestamp: ago({ minutes: 32 })
  });

  await ensureLog({
    orgId: demoOrg.id,
    type: "COMPLIANCE",
    actor: "POLICY_ENGINE",
    message: `[DEMO-HSP] governance denied autonomous legal copy publish for flow ${flowAbortedRollback.id}.`,
    timestamp: ago({ minutes: 30 })
  });

  await ensureComplianceAudit({
    orgId: demoOrg.id,
    flowId: flowNorthActive.id,
    humanActorId: owner.id,
    actionType: "HUMAN_TOUCH_PAUSE",
    complianceHash: hash(`pause:${flowNorthActive.id}:${flowAHumanInputTask.id}`, 64),
    timestamp: ago({ hours: 2 })
  });

  await ensureComplianceAudit({
    orgId: demoOrg.id,
    flowId: flowBranchFailed.id,
    humanActorId: adminUser.id,
    actionType: "TEMPORAL_BRANCH_FORK",
    complianceHash: hash(`fork:${flowBranchFailed.id}:${flowCTaskOne.id}`, 64),
    timestamp: ago({ hours: 13 })
  });

  await ensureSpendEvent({
    orgId: demoOrg.id,
    flowId: flowNorthActive.id,
    taskId: flowAExecutionTask.id,
    amount: "18500.0000",
    type: "PREDICTED_BURN",
    meta: {
      seedTag: SEED_TAG,
      source: "seed",
      label: "flow-active-predicted"
    },
    timestamp: ago({ hours: 4 })
  });

  await ensureSpendEvent({
    orgId: demoOrg.id,
    flowId: flowNorthCompleted.id,
    taskId: flowBTaskTwo.id,
    amount: "6890.3400",
    type: "ACTUAL_BURN",
    meta: {
      seedTag: SEED_TAG,
      source: "seed",
      label: "flow-completed-actual"
    },
    timestamp: ago({ hours: 22 })
  });

  await ensureSpendEvent({
    orgId: demoOrg.id,
    flowId: flowBranchFailed.id,
    taskId: flowCTaskOne.id,
    amount: "9300.0000",
    type: "RUNAWAY_SIGNAL",
    meta: {
      seedTag: SEED_TAG,
      source: "seed",
      label: "flow-branch-runaway"
    },
    timestamp: ago({ hours: 12 })
  });

  await ensureSpendEvent({
    orgId: demoOrg.id,
    flowId: flowAbortedRollback.id,
    taskId: null,
    amount: "1200.0000",
    type: "MANUAL_ADJUSTMENT",
    meta: {
      seedTag: SEED_TAG,
      source: "seed",
      label: "rollback-credit-reversal"
    },
    timestamp: ago({ hours: 8 })
  });

  await ensurePolicyLog({
    orgId: demoOrg.id,
    subjectType: "FLOW_LAUNCH",
    subjectId: flowNorthActive.id,
    decision: "WARN",
    riskScore: 0.63,
    reason: "Human approval required before legal-sensitive publish action.",
    meta: {
      seedTag: SEED_TAG
    },
    timestamp: ago({ hours: 2 })
  });

  await ensurePolicyLog({
    orgId: demoOrg.id,
    subjectType: "FILE_READ",
    subjectId: secureDna.id,
    decision: "ALLOW",
    riskScore: 0.22,
    reason: "Amnesia protocol active for sensitive file read.",
    meta: {
      seedTag: SEED_TAG
    },
    timestamp: ago({ minutes: 34 })
  });

  await ensurePolicyLog({
    orgId: demoOrg.id,
    subjectType: "AUTONOMOUS_PUBLISH",
    subjectId: flowAbortedRollback.id,
    decision: "DENY",
    riskScore: 0.91,
    reason: "High legal risk without founder approval.",
    meta: {
      seedTag: SEED_TAG,
      requiredApprovalRole: "FOUNDER"
    },
    timestamp: ago({ hours: 9 })
  });

  const summary = {
    owner: {
      id: owner.id,
      email: owner.email
    },
    org: {
      id: demoOrg.id,
      name: demoOrg.name
    },
    seeded: {
      directions: 3,
      plans: 2,
      flows: 6,
      tasks: 11,
      files: 9,
      permissionRequests: 3,
      joinRequests: 2,
      schedules: 2,
      connectors: 2,
      toolGrants: 3
    }
  };

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error("[seed-hsp-demo] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
