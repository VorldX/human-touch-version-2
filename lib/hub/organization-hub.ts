import "server-only";

import { HubFileType, LogType, type Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";

const COMPANY_DATA_FILE_NAME = "Company Data";

type PrismaClientLike = Prisma.TransactionClient | typeof prisma;

function asRecord(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function buildCompanyDataText(input: {
  organization: {
    id: string;
    name: string;
    description: string | null;
    theme: string;
    executionMode?: string;
    monthlyBudget: unknown;
    monthlyBtuCap: number;
    currentSpend: unknown;
    currentBtuBurn: number;
    createdAt: Date;
  };
  founder?: {
    username: string;
    email: string;
  } | null;
  orchestration?: {
    primaryProvider?: string;
    primaryModel?: string;
    fallbackProvider?: string;
    fallbackModel?: string;
  } | null;
  oauthProviders?: string[];
}) {
  const payload = {
    company: {
      orgId: input.organization.id,
      name: input.organization.name,
      description: input.organization.description ?? "",
      theme: input.organization.theme,
      executionMode: input.organization.executionMode ?? "BALANCED"
    },
    financials: {
      monthlyBudgetUsd: String(input.organization.monthlyBudget),
      monthlyBtuCap: input.organization.monthlyBtuCap,
      currentSpendUsd: String(input.organization.currentSpend),
      currentBtuBurn: input.organization.currentBtuBurn
    },
    founder: input.founder
      ? {
          username: input.founder.username,
          email: input.founder.email
        }
      : null,
    orchestration: input.orchestration ?? null,
    oauthProviders: input.oauthProviders ?? [],
    lastUpdatedAt: new Date().toISOString(),
    createdAt: input.organization.createdAt.toISOString()
  };

  return JSON.stringify(payload, null, 2);
}

export async function ensureCompanyDataFile(
  orgId: string,
  options?: {
    db?: PrismaClientLike;
    preferredContent?: string;
  }
) {
  const db = options?.db ?? prisma;

  const existing = await db.file.findFirst({
    where: {
      orgId,
      type: HubFileType.INPUT,
      name: COMPANY_DATA_FILE_NAME
    },
    orderBy: { updatedAt: "desc" }
  });

  if (existing) {
    const metadata = asRecord(existing.metadata);
    const content =
      typeof metadata.content === "string" && metadata.content.trim().length > 0
        ? metadata.content
        : "";
    if (content.length > 0) {
      return { file: existing, content };
    }
  }

  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      name: true,
      description: true,
      theme: true,
      monthlyBudget: true,
      executionMode: true,
      monthlyBtuCap: true,
      currentSpend: true,
      currentBtuBurn: true,
      createdAt: true,
      members: {
        where: {
          role: "FOUNDER"
        },
        select: {
          user: {
            select: {
              username: true,
              email: true
            }
          }
        },
        take: 1
      }
    }
  });

  if (!org) {
    throw new Error("Organization not found.");
  }

  const mainAgent = await db.personnel.findFirst({
    where: {
      orgId,
      type: "AI",
      role: {
        contains: "Main",
        mode: "insensitive"
      }
    },
    select: {
      brainConfig: true,
      fallbackBrainConfig: true
    }
  });

  const fallbackMainAgent =
    mainAgent ??
    (await db.personnel.findFirst({
      where: {
        orgId,
        type: "AI",
        role: {
          contains: "Boss",
          mode: "insensitive"
        }
      },
      select: {
        brainConfig: true,
        fallbackBrainConfig: true
      }
    }));

  const linkedProviders = await db.linkedAccount.findMany({
    where: {
      user: {
        orgMemberships: {
          some: { orgId }
        }
      }
    },
    select: { provider: true }
  });

  const primaryConfig = asRecord(fallbackMainAgent?.brainConfig);
  const fallbackConfig = asRecord(fallbackMainAgent?.fallbackBrainConfig);
  const content =
    options?.preferredContent ??
    buildCompanyDataText({
      organization: org,
      founder: org.members[0]?.user ?? null,
      orchestration: {
        primaryProvider:
          typeof primaryConfig.provider === "string" ? primaryConfig.provider : undefined,
        primaryModel: typeof primaryConfig.model === "string" ? primaryConfig.model : undefined,
        fallbackProvider:
          typeof fallbackConfig.provider === "string" ? fallbackConfig.provider : undefined,
        fallbackModel:
          typeof fallbackConfig.model === "string" ? fallbackConfig.model : undefined
      },
      oauthProviders: [...new Set(linkedProviders.map((item) => item.provider))]
    });

  const fileUrl = `memory://org/${orgId}/company-data`;

  if (existing) {
    const metadata = asRecord(existing.metadata);
    const updated = await db.file.update({
      where: { id: existing.id },
      data: {
        size: BigInt(Buffer.byteLength(content, "utf8")),
        url: existing.url || fileUrl,
        metadata: {
          ...metadata,
          hubScope: "ORGANIZATIONAL",
          hubSection: "INPUT",
          content,
          contentType: "application/json",
          editable: true
        }
      }
    });
    return { file: updated, content };
  }

  const created = await db.file.create({
    data: {
      orgId,
      name: COMPANY_DATA_FILE_NAME,
      type: HubFileType.INPUT,
      size: BigInt(Buffer.byteLength(content, "utf8")),
      url: fileUrl,
      health: 100,
      isAmnesiaProtected: false,
      metadata: {
        hubScope: "ORGANIZATIONAL",
        hubSection: "INPUT",
        content,
        contentType: "application/json",
        editable: true
      }
    }
  });

  await db.log.create({
    data: {
      orgId,
      type: LogType.USER,
      actor: "ORG_HUB",
      message: `Company Data file ${created.id} initialized in Organizational Hub input.`
    }
  });

  return { file: created, content };
}

export async function updateCompanyDataFile(orgId: string, content: string) {
  const ensured = await ensureCompanyDataFile(orgId);
  const metadata = asRecord(ensured.file.metadata);

  const updated = await prisma.$transaction(async (tx) => {
    const nextFile = await tx.file.update({
      where: { id: ensured.file.id },
      data: {
        size: BigInt(Buffer.byteLength(content, "utf8")),
        metadata: {
          ...metadata,
          hubScope: "ORGANIZATIONAL",
          hubSection: "INPUT",
          content,
          contentType: "application/json",
          editable: true,
          updatedAt: new Date().toISOString()
        }
      }
    });

    await tx.log.create({
      data: {
        orgId,
        type: LogType.USER,
        actor: "ORG_HUB",
        message: `Company Data file ${nextFile.id} updated from Organizational Hub.`
      }
    });

    return nextFile;
  });

  return updated;
}

export async function getOrganizationalOutputFiles(orgId: string) {
  const files = await prisma.file.findMany({
    where: {
      orgId,
      type: HubFileType.OUTPUT
    },
    orderBy: { updatedAt: "desc" },
    take: 100
  });

  return files.map((file) => {
    const metadata = asRecord(file.metadata);
    return {
      id: file.id,
      name: file.name,
      size: file.size.toString(),
      url: file.url,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      outputPreview:
        typeof metadata.outputPreview === "string"
          ? metadata.outputPreview
          : typeof metadata.content === "string"
            ? metadata.content
            : null,
      sourceFlowId:
        typeof metadata.sourceFlowId === "string" ? metadata.sourceFlowId : null,
      sourceTaskId:
        typeof metadata.sourceTaskId === "string" ? metadata.sourceTaskId : null
    };
  });
}

export async function getOrganizationalInputDocuments(orgId: string) {
  const files = await prisma.file.findMany({
    where: {
      orgId,
      type: HubFileType.INPUT,
      name: {
        not: COMPANY_DATA_FILE_NAME
      }
    },
    orderBy: { updatedAt: "desc" },
    take: 100
  });

  return files.map((file) => {
    const metadata = asRecord(file.metadata);
    return {
      id: file.id,
      name: file.name,
      size: file.size.toString(),
      url: file.url,
      updatedAt: file.updatedAt,
      contentType:
        typeof metadata.contentType === "string" ? metadata.contentType : null
    };
  });
}
