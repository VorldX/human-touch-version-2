import "server-only";

import {
  HubFileType,
  LogType,
  OrgRole,
  OrgExecutionMode,
  OrganizationTheme,
  type Prisma
} from "@prisma/client";

import { prisma } from "@/lib/db/prisma";

const COMPANY_DATA_FILE_NAME = "Company Data";

type PrismaClientLike = Prisma.TransactionClient | typeof prisma;
export type HubAccessTargetKind = "MEMBER" | "PERSONNEL" | "TEAM";
export type HubAccessTeamKey = "HUMAN_WORKFORCE" | "AI_WORKFORCE";
export type CollaborationManagementLevel =
  | "FOUNDER"
  | "ADMIN"
  | "SUB_ADMIN"
  | "MANAGER"
  | "WORKER";
export type CollaborationAccessArea =
  | "STRINGS"
  | "APPROVALS"
  | "WORKFORCE"
  | "HUB"
  | "SETTINGS"
  | "ROLES";

export interface CollaborationTeamEntry {
  id: string;
  name: string;
  description: string;
  leadUserId: string | null;
  memberUserIds: string[];
  personnelIds: string[];
  createdAt: string;
  updatedAt: string;
  createdByUserId: string | null;
}

export interface CollaborationMemberProfileEntry {
  userId: string;
  managementLevel: CollaborationManagementLevel;
  accessAreas: CollaborationAccessArea[];
  activeTeamId: string | null;
  updatedAt: string;
}

export interface OrganizationCollaborationState {
  teams: CollaborationTeamEntry[];
  memberProfiles: CollaborationMemberProfileEntry[];
}

export const COLLABORATION_ACCESS_AREA_CATALOG: Array<{
  id: CollaborationAccessArea;
  label: string;
  helper: string;
}> = [
  {
    id: "STRINGS",
    label: "Strings",
    helper: "Discussion, direction, plan, and steer collaboration."
  },
  {
    id: "APPROVALS",
    label: "Approvals",
    helper: "Join requests, permission requests, and checkpoints."
  },
  {
    id: "WORKFORCE",
    label: "Workforce",
    helper: "Teams, assignments, and workforce coordination."
  },
  {
    id: "HUB",
    label: "Hub",
    helper: "Organization knowledge, input documents, and outputs."
  },
  {
    id: "SETTINGS",
    label: "Settings",
    helper: "Operational controls and workspace configuration."
  },
  {
    id: "ROLES",
    label: "Roles",
    helper: "Member role changes and delegated management controls."
  }
] as const;

export const COLLABORATION_MANAGEMENT_LEVEL_CATALOG: Array<{
  id: CollaborationManagementLevel;
  label: string;
  helper: string;
}> = [
  {
    id: "FOUNDER",
    label: "Founder",
    helper: "Organization owner with full authority across every area."
  },
  {
    id: "ADMIN",
    label: "Admin",
    helper: "Platform administrator with broad management authority."
  },
  {
    id: "SUB_ADMIN",
    label: "Sub-admin",
    helper: "Extended management coverage without full organization admin authority."
  },
  {
    id: "MANAGER",
    label: "Manager",
    helper: "Owns team execution, approvals, and collaboration flow."
  },
  {
    id: "WORKER",
    label: "Worker",
    helper: "Focused contributor with scoped execution access."
  }
] as const;

export interface HubDelegatedAccessEntry {
  kind: HubAccessTargetKind;
  targetId: string;
}

function asRecord(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseAccessKind(value: unknown): HubAccessTargetKind | null {
  if (value === "MEMBER" || value === "PERSONNEL" || value === "TEAM") {
    return value;
  }
  return null;
}

function parseAccessTeam(value: unknown): HubAccessTeamKey | null {
  if (value === "HUMAN_WORKFORCE" || value === "AI_WORKFORCE") {
    return value;
  }
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

function parseAccessArea(value: unknown): CollaborationAccessArea | null {
  if (value === "STRINGS") return "STRINGS";
  if (value === "APPROVALS") return "APPROVALS";
  if (value === "WORKFORCE") return "WORKFORCE";
  if (value === "HUB") return "HUB";
  if (value === "SETTINGS") return "SETTINGS";
  if (value === "ROLES") return "ROLES";
  return null;
}

function dedupeTextList(values: unknown) {
  const items = Array.isArray(values) ? values : [];
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

export function defaultAccessAreasForManagementLevel(
  level: CollaborationManagementLevel
): CollaborationAccessArea[] {
  if (level === "FOUNDER" || level === "ADMIN") {
    return COLLABORATION_ACCESS_AREA_CATALOG.map((item) => item.id);
  }
  if (level === "SUB_ADMIN") {
    return ["STRINGS", "APPROVALS", "WORKFORCE", "HUB"];
  }
  if (level === "MANAGER") {
    return ["STRINGS", "APPROVALS", "WORKFORCE"];
  }
  return ["STRINGS"];
}

export function defaultManagementLevelForOrgRole(role: OrgRole): CollaborationManagementLevel {
  if (role === OrgRole.FOUNDER) return "FOUNDER";
  if (role === OrgRole.ADMIN) return "ADMIN";
  return "WORKER";
}

function normalizeTeamEntry(value: unknown): CollaborationTeamEntry | null {
  const record = asRecord(value);
  const id = asText(record.id);
  const name = asText(record.name);
  const createdAt = asText(record.createdAt) || new Date().toISOString();
  const updatedAt = asText(record.updatedAt) || createdAt;

  if (!id || !name) {
    return null;
  }

  const leadUserId = asText(record.leadUserId) || null;
  const memberUserIds = dedupeTextList(record.memberUserIds);
  const nextMemberUserIds = leadUserId
    ? [...new Set([leadUserId, ...memberUserIds])].sort((left, right) =>
        left.localeCompare(right)
      )
    : memberUserIds;

  return {
    id,
    name,
    description: asText(record.description),
    leadUserId,
    memberUserIds: nextMemberUserIds,
    personnelIds: dedupeTextList(record.personnelIds),
    createdAt,
    updatedAt,
    createdByUserId: asText(record.createdByUserId) || null
  };
}

function normalizeMemberProfileEntry(value: unknown): CollaborationMemberProfileEntry | null {
  const record = asRecord(value);
  const userId = asText(record.userId);
  const managementLevel = parseManagementLevel(record.managementLevel);
  if (!userId || !managementLevel) {
    return null;
  }

  const accessAreas = Array.isArray(record.accessAreas)
    ? [
        ...new Set(
          record.accessAreas
            .map((item) => parseAccessArea(item))
            .filter((item): item is CollaborationAccessArea => Boolean(item))
        )
      ].sort((left, right) => left.localeCompare(right))
    : defaultAccessAreasForManagementLevel(managementLevel);

  return {
    userId,
    managementLevel,
    accessAreas,
    activeTeamId: asText(record.activeTeamId) || null,
    updatedAt: asText(record.updatedAt) || new Date().toISOString()
  };
}

function sortTeamEntries(left: CollaborationTeamEntry, right: CollaborationTeamEntry) {
  return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
}

function sortMemberProfiles(
  left: CollaborationMemberProfileEntry,
  right: CollaborationMemberProfileEntry
) {
  return left.userId.localeCompare(right.userId);
}

export function readOrganizationCollaboration(metadata: unknown): OrganizationCollaborationState {
  const root = asRecord(metadata);
  const collaboration = asRecord(root.collaboration);

  const teams = (Array.isArray(collaboration.teams) ? collaboration.teams : [])
    .map((entry) => normalizeTeamEntry(entry))
    .filter((entry): entry is CollaborationTeamEntry => Boolean(entry));

  const memberProfiles = (Array.isArray(collaboration.memberProfiles)
    ? collaboration.memberProfiles
    : []
  )
    .map((entry) => normalizeMemberProfileEntry(entry))
    .filter((entry): entry is CollaborationMemberProfileEntry => Boolean(entry));

  const seenTeams = new Set<string>();
  const seenProfiles = new Set<string>();

  return {
    teams: teams
      .filter((entry) => {
        if (seenTeams.has(entry.id)) {
          return false;
        }
        seenTeams.add(entry.id);
        return true;
      })
      .sort(sortTeamEntries),
    memberProfiles: memberProfiles
      .filter((entry) => {
        if (seenProfiles.has(entry.userId)) {
          return false;
        }
        seenProfiles.add(entry.userId);
        return true;
      })
      .sort(sortMemberProfiles)
  };
}

export function writeOrganizationCollaborationMetadata(
  metadata: unknown,
  state: OrganizationCollaborationState
) {
  const root = asRecord(metadata);

  return {
    ...root,
    collaboration: {
      teams: state.teams
        .map((entry) => normalizeTeamEntry(entry))
        .filter((entry): entry is CollaborationTeamEntry => Boolean(entry))
        .sort(sortTeamEntries),
      memberProfiles: state.memberProfiles
        .map((entry) => normalizeMemberProfileEntry(entry))
        .filter((entry): entry is CollaborationMemberProfileEntry => Boolean(entry))
        .sort(sortMemberProfiles)
    }
  };
}

function normalizeDelegatedAccessEntry(value: unknown): HubDelegatedAccessEntry | null {
  const entry = asRecord(value);
  const kind = parseAccessKind(entry.kind);
  const targetId = asText(entry.targetId);

  if (!kind || !targetId) {
    return null;
  }

  if (kind === "TEAM") {
    const team = parseAccessTeam(targetId);
    if (!team) {
      return null;
    }
    return { kind, targetId: team };
  }

  return { kind, targetId };
}

function sortDelegatedAccessEntries(
  left: HubDelegatedAccessEntry,
  right: HubDelegatedAccessEntry
) {
  const kindOrder: Record<HubAccessTargetKind, number> = {
    MEMBER: 0,
    PERSONNEL: 1,
    TEAM: 2
  };

  const kindDelta = kindOrder[left.kind] - kindOrder[right.kind];
  if (kindDelta !== 0) {
    return kindDelta;
  }

  return left.targetId.localeCompare(right.targetId);
}

export function readDelegatedAccessEntries(metadata: unknown) {
  const root = asRecord(metadata);
  const rawEntries = Array.isArray(root.delegatedAccess) ? root.delegatedAccess : [];
  const normalized = rawEntries
    .map((entry) => normalizeDelegatedAccessEntry(entry))
    .filter((entry): entry is HubDelegatedAccessEntry => Boolean(entry));

  const seen = new Set<string>();
  return normalized
    .filter((entry) => {
      const key = `${entry.kind}:${entry.targetId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(sortDelegatedAccessEntries);
}

export function writeDelegatedAccessMetadata(metadata: unknown, entries: HubDelegatedAccessEntry[]) {
  const root = asRecord(metadata);
  const nextEntries = entries
    .map((entry) => normalizeDelegatedAccessEntry(entry))
    .filter((entry): entry is HubDelegatedAccessEntry => Boolean(entry))
    .sort(sortDelegatedAccessEntries);

  return {
    ...root,
    delegatedAccess: nextEntries
  };
}

function parseExecutionMode(value: unknown): OrgExecutionMode | null {
  if (value === OrgExecutionMode.ECO) return OrgExecutionMode.ECO;
  if (value === OrgExecutionMode.TURBO) return OrgExecutionMode.TURBO;
  if (value === OrgExecutionMode.BALANCED) return OrgExecutionMode.BALANCED;
  return null;
}

function parseTheme(value: unknown): OrganizationTheme | null {
  if (value === OrganizationTheme.APEX) return OrganizationTheme.APEX;
  if (value === OrganizationTheme.VEDA) return OrganizationTheme.VEDA;
  if (value === OrganizationTheme.NEXUS) return OrganizationTheme.NEXUS;
  return null;
}

function parseBudgetValue(value: unknown) {
  const raw = typeof value === "number" || typeof value === "string" ? String(value).trim() : "";
  if (!raw) return null;
  const normalized = raw.replace(/,/g, "");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed.toFixed(2);
}

function parseIntegerValue(value: unknown) {
  const raw = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(raw) || raw < 0) {
    return null;
  }
  return Math.floor(raw);
}

function parseCompanyDataPatch(content: string) {
  try {
    const parsed = JSON.parse(content);
    const root = asRecord(parsed);
    const company = asRecord(root.company);
    const financials = asRecord(root.financials);

    const name = asText(company.name);
    const description =
      typeof company.description === "string" ? company.description.trim() : undefined;
    const executionMode = parseExecutionMode(company.executionMode);
    const theme = parseTheme(company.theme);
    const monthlyBudget = parseBudgetValue(
      financials.monthlyBudgetUsd ?? financials.monthlyBudget
    );
    const monthlyBtuCap = parseIntegerValue(financials.monthlyBtuCap);

    return {
      ...(name ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(executionMode ? { executionMode } : {}),
      ...(theme ? { theme } : {}),
      ...(monthlyBudget ? { monthlyBudget } : {}),
      ...(monthlyBtuCap !== null ? { monthlyBtuCap } : {})
    };
  } catch {
    return null;
  }
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
          editable: true,
          delegatedAccess: Array.isArray(metadata.delegatedAccess) ? metadata.delegatedAccess : [],
          collaboration: asRecord(metadata.collaboration) as unknown as Prisma.InputJsonValue
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
        editable: true,
        delegatedAccess: [],
        collaboration: {
          teams: [],
          memberProfiles: []
        }
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
  const orgPatch = parseCompanyDataPatch(content);

  const updated = await prisma.$transaction(async (tx) => {
    if (orgPatch && Object.keys(orgPatch).length > 0) {
      await tx.organization.update({
        where: { id: orgId },
        data: {
          ...(orgPatch.name ? { name: orgPatch.name } : {}),
          ...(orgPatch.description !== undefined
            ? { description: orgPatch.description || null }
            : {}),
          ...(orgPatch.executionMode ? { executionMode: orgPatch.executionMode } : {}),
          ...(orgPatch.theme ? { theme: orgPatch.theme } : {}),
          ...(orgPatch.monthlyBudget ? { monthlyBudget: orgPatch.monthlyBudget } : {}),
          ...(orgPatch.monthlyBtuCap !== undefined
            ? { monthlyBtuCap: orgPatch.monthlyBtuCap }
            : {})
        }
      });
    }

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
          delegatedAccess: Array.isArray(metadata.delegatedAccess) ? metadata.delegatedAccess : [],
          collaboration: asRecord(metadata.collaboration) as unknown as Prisma.InputJsonValue,
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
