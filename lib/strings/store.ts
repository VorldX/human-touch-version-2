import "server-only";

import { randomUUID } from "node:crypto";

import { HubFileType, MemoryTier, OrgRole, Prisma } from "@prisma/client";

import type {
  ChatAudience,
  ChatMessage,
  ChatMention,
  CollaboratorKind,
  ChatString,
  DirectionPayload,
  DirectionStep,
  MessageMetrics,
  MessageRole,
  MessageRouting,
  StringMode
} from "@/components/chat-ui/types";
import type {
  AssistantMessageMeta,
  WorkflowTaskStatus
} from "@/src/types/chat";
import { prisma } from "@/lib/db/prisma";
import { readOrganizationCollaboration } from "@/lib/hub/organization-hub";

type MemoryEntryClient = Pick<Prisma.TransactionClient, "memoryEntry" | "file"> | typeof prisma;

interface StringAccessActor {
  userId: string;
  role?: OrgRole | "INTERNAL" | null;
}

export interface PersistedStringRecord extends ChatString {
  orgId: string;
  createdByUserId: string | null;
  updatedByUserId: string | null;
}

interface SaveStringInput {
  id?: string;
  title?: string;
  mode?: StringMode;
  updatedAt?: string;
  createdAt?: string;
  directionId?: string | null;
  planId?: string | null;
  selectedTeamId?: string | null;
  selectedTeamLabel?: string | null;
  activeAudience?: ChatString["activeAudience"];
  source?: ChatString["source"];
  messages?: ChatMessage[];
  workspaceState?: ChatString["workspaceState"] | null;
}

const STRING_PREFIX = "string.record.";
const DEFAULT_TITLE = "New string";
const COMPANY_DATA_FILE_NAME = "Company Data";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asNullableText(value: unknown) {
  const text = asText(value);
  return text || null;
}

function asStringArray(value: unknown, limit: number) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => asText(item))
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeMode(value: unknown): StringMode {
  return value === "direction" ? "direction" : "discussion";
}

function normalizeRole(value: unknown): MessageRole {
  if (value === "assistant") return "assistant";
  if (value === "system") return "system";
  return "user";
}

function normalizeSource(
  value: unknown,
  fallback?: ChatString["source"]
): ChatString["source"] {
  if (value === "direction" || value === "plan") {
    return value;
  }
  if (value === "workspace") {
    return value;
  }
  return fallback ?? "workspace";
}

function normalizeCollaboratorKind(value: unknown): CollaboratorKind | undefined {
  if (value === "AI") return "AI";
  if (value === "HUMAN") return "HUMAN";
  return undefined;
}

function normalizeAudience(value: unknown): ChatAudience | undefined {
  const record = asRecord(value);
  const kind =
    record.kind === "team" || record.kind === "person" || record.kind === "everyone"
      ? record.kind
      : "";
  const id = asNullableText(record.id);
  const label = asNullableText(record.label);

  if (!kind) {
    return undefined;
  }

  return {
    kind,
    ...(id !== null ? { id } : {}),
    ...(label !== null ? { label } : {})
  };
}

function normalizeMention(value: unknown): ChatMention | null {
  const record = asRecord(value);
  const id = asText(record.id);
  const label = asText(record.label);
  const handle = asText(record.handle);
  const kind = record.kind === "team" || record.kind === "person" ? record.kind : "";
  const collaboratorKind = normalizeCollaboratorKind(record.collaboratorKind);

  if (!id || !label || !handle || !kind) {
    return null;
  }

  return {
    id,
    label,
    handle,
    kind,
    ...(collaboratorKind ? { collaboratorKind } : {})
  };
}

function normalizeMentions(value: unknown): ChatMention[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const mentions = value
    .map((item) => normalizeMention(item))
    .filter((item): item is ChatMention => Boolean(item))
    .slice(0, 24);

  return mentions.length > 0 ? mentions : undefined;
}

function normalizeMetrics(value: unknown): MessageMetrics | undefined {
  const record = asRecord(value);
  const latencyMs = Number(record.latencyMs);

  if (!Number.isFinite(latencyMs) || latencyMs < 0) {
    return undefined;
  }

  const promptTokens = Number(record.promptTokens);
  const completionTokens = Number(record.completionTokens);
  const totalTokens = Number(record.totalTokens);

  return {
    latencyMs: Math.max(0, Math.round(latencyMs)),
    ...(Number.isFinite(promptTokens) && promptTokens >= 0
      ? { promptTokens: Math.round(promptTokens) }
      : {}),
    ...(Number.isFinite(completionTokens) && completionTokens >= 0
      ? { completionTokens: Math.round(completionTokens) }
      : {}),
    ...(Number.isFinite(totalTokens) && totalTokens >= 0
      ? { totalTokens: Math.round(totalTokens) }
      : {}),
    ...(asText(record.provider) ? { provider: asText(record.provider) } : {}),
    ...(asText(record.model) ? { model: asText(record.model) } : {}),
    ...(asText(record.source) ? { source: asText(record.source) } : {})
  };
}

function normalizeRouting(value: unknown): MessageRouting | undefined {
  const record = asRecord(value);
  const hasRoute = record.route === "CHAT_RESPONSE" || record.route === "PLAN_REQUIRED";
  const route = record.route === "PLAN_REQUIRED" ? "PLAN_REQUIRED" : "CHAT_RESPONSE";
  const reason = asText(record.reason);
  const toolkitHints = asStringArray(record.toolkitHints, 16);

  if (!hasRoute && !reason && toolkitHints.length === 0) {
    return undefined;
  }

  return {
    route,
    ...(reason ? { reason } : {}),
    ...(toolkitHints.length > 0 ? { toolkitHints } : {})
  };
}

function normalizeDirectionStep(value: unknown, fallbackId: string): DirectionStep | null {
  const record = asRecord(value);
  const title = asText(record.title);
  if (!title) {
    return null;
  }

  const rawStatus = asText(record.status);
  const status =
    rawStatus === "done" || rawStatus === "in_progress" || rawStatus === "todo"
      ? rawStatus
      : "todo";

  return {
    id: asText(record.id) || fallbackId,
    title,
    owner: asText(record.owner) || "Owner",
    status,
    tasks: asStringArray(record.tasks, 16),
    actions: asStringArray(record.actions, 16)
  };
}

function normalizeDirection(value: unknown): DirectionPayload | undefined {
  const record = asRecord(value);
  const objective = asText(record.objective);
  const rawSteps = Array.isArray(record.steps) ? record.steps : [];
  const steps = rawSteps
    .map((item, index) => normalizeDirectionStep(item, `step-${index + 1}`))
    .filter((item): item is DirectionStep => Boolean(item))
    .slice(0, 12);

  if (!objective && steps.length === 0) {
    return undefined;
  }

  const detailScore = Number(record.detailScore);
  const approvalCount = Number(record.approvalCount);

  return {
    objective: objective || "Structured direction",
    ...(asText(record.summary) ? { summary: asText(record.summary) } : {}),
    ...(asText(record.teamName) ? { teamName: asText(record.teamName) } : {}),
    ...(asText(record.nextAction) ? { nextAction: asText(record.nextAction) } : {}),
    ...(Number.isFinite(detailScore) ? { detailScore: Math.round(detailScore) } : {}),
    ...(Number.isFinite(approvalCount) ? { approvalCount: Math.round(approvalCount) } : {}),
    ...(asStringArray(record.requiredToolkits, 16).length > 0
      ? { requiredToolkits: asStringArray(record.requiredToolkits, 16) }
      : {}),
    steps
  };
}

function normalizeWorkflowTaskStatus(value: unknown): WorkflowTaskStatus {
  const normalized = asText(value).toUpperCase();
  if (
    normalized === "QUEUED" ||
    normalized === "RUNNING" ||
    normalized === "PAUSED" ||
    normalized === "COMPLETED" ||
    normalized === "FAILED" ||
    normalized === "ABORTED" ||
    normalized === "DRAFT" ||
    normalized === "ACTIVE"
  ) {
    return normalized;
  }
  return "UNKNOWN";
}

function normalizeMessageMeta(value: unknown): AssistantMessageMeta | undefined {
  const record = asRecord(value);
  const kind = asText(record.kind);

  if (kind === "thread_event") {
    const title = asText(record.title);
    const message = asText(record.message);
    const eventName = asText(record.eventName);
    const scope =
      record.scope === "MODE" ||
      record.scope === "MEMBERSHIP" ||
      record.scope === "PLANNING" ||
      record.scope === "EXECUTION" ||
      record.scope === "COLLABORATION"
        ? record.scope
        : undefined;
    const status = asText(record.status);
    const timestamp = Number(record.timestamp);

    if (!title && !message) {
      return undefined;
    }

    return {
      kind,
      title: title || "Thread Update",
      message: message || title,
      ...(eventName ? { eventName } : {}),
      ...(scope ? { scope } : {}),
      ...(status ? { status } : {}),
      ...(Number.isFinite(timestamp) && timestamp > 0 ? { timestamp: Math.round(timestamp) } : {})
    };
  }

  if (kind === "workflow_event") {
    const title = asText(record.title);
    const message = asText(record.message);
    const eventName = asText(record.eventName);
    const flowId = asText(record.flowId);
    const taskId = asText(record.taskId);
    const status = asText(record.status);
    const agentLabel = asText(record.agentLabel);
    const timestamp = Number(record.timestamp);

    if (!title && !message) {
      return undefined;
    }

    return {
      kind,
      title: title || "Workflow Update",
      message: message || title,
      ...(eventName ? { eventName } : {}),
      ...(flowId ? { flowId } : {}),
      ...(taskId ? { taskId } : {}),
      ...(status ? { status } : {}),
      ...(agentLabel ? { agentLabel } : {}),
      ...(Number.isFinite(timestamp) && timestamp > 0 ? { timestamp: Math.round(timestamp) } : {})
    };
  }

  if (kind === "workflow_graph") {
    const title = asText(record.title);
    const flowId = asText(record.flowId);
    const status = asText(record.status);
    const updatedAt = asText(record.updatedAt);
    const progress = Number(record.progress);
    const taskCount = Number(record.taskCount);
    const completedCount = Number(record.completedCount);
    const tasks = (Array.isArray(record.tasks) ? record.tasks : [])
      .map((item, index) => {
        const task = asRecord(item);
        const id = asText(task.id) || `task-${index + 1}`;
        const title = asText(task.title);
        if (!title) {
          return null;
        }
        const agentLabel = asText(task.agentLabel);
        const dependsOn = asStringArray(task.dependsOn, 8);
        return {
          id,
          title,
          status: normalizeWorkflowTaskStatus(task.status),
          ...(agentLabel ? { agentLabel } : {}),
          ...(dependsOn.length > 0 ? { dependsOn } : {})
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .slice(0, 20);

    if (!title || !flowId) {
      return undefined;
    }

    return {
      kind,
      title,
      flowId,
      ...(status ? { status } : {}),
      ...(updatedAt ? { updatedAt } : {}),
      ...(Number.isFinite(progress) ? { progress: Math.max(0, Math.min(100, Math.round(progress))) } : {}),
      ...(Number.isFinite(taskCount) && taskCount >= 0 ? { taskCount: Math.round(taskCount) } : {}),
      ...(Number.isFinite(completedCount) && completedCount >= 0
        ? { completedCount: Math.round(completedCount) }
        : {}),
      tasks
    };
  }

  if (kind === "plan_card") {
    const title = asText(record.title);
    const summary = asText(record.summary);
    const detailScore = Number(record.detailScore);
    const requiredToolkits = asStringArray(record.requiredToolkits, 20);
    const workflows = (Array.isArray(record.workflows) ? record.workflows : [])
      .map((item, workflowIndex) => {
        const workflow = asRecord(item);
        const workflowTitle = asText(workflow.title);
        const tasks = (Array.isArray(workflow.tasks) ? workflow.tasks : [])
          .map((taskValue, taskIndex) => {
            const task = asRecord(taskValue);
            const taskTitle = asText(task.title);
            if (!taskTitle) {
              return null;
            }
            const id = asText(task.id) || `wf${workflowIndex + 1}-task${taskIndex + 1}`;
            const agentLabel = asText(task.agentLabel);
            const dependsOn = asStringArray(task.dependsOn, 8);
            return {
              id,
              title: taskTitle,
              status: normalizeWorkflowTaskStatus(task.status),
              ...(agentLabel ? { agentLabel } : {}),
              ...(dependsOn.length > 0 ? { dependsOn } : {})
            };
          })
          .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
          .slice(0, 20);

        if (!workflowTitle) {
          return null;
        }

        return {
          title: workflowTitle,
          ...(asText(workflow.goal) ? { goal: asText(workflow.goal) } : {}),
          ...(asText(workflow.ownerRole) ? { ownerRole: asText(workflow.ownerRole) } : {}),
          tasks
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .slice(0, 8);

    if (!title && workflows.length === 0) {
      return undefined;
    }

    return {
      kind,
      title: title || "Execution Plan",
      ...(summary ? { summary } : {}),
      ...(Number.isFinite(detailScore) ? { detailScore: Math.round(detailScore) } : {}),
      ...(requiredToolkits.length > 0 ? { requiredToolkits } : {}),
      workflows
    };
  }

  return undefined;
}

function normalizeMessage(value: unknown, fallbackId: string, fallbackCreatedAt: string): ChatMessage {
  const record = asRecord(value);
  const content = asText(record.content);
  const metrics = normalizeMetrics(record.metrics);
  const routing = normalizeRouting(record.routing);
  const direction = normalizeDirection(record.direction);
  const audience = normalizeAudience(record.audience);
  const mentions = normalizeMentions(record.mentions);
  const authorKind = normalizeCollaboratorKind(record.authorKind);
  const meta = normalizeMessageMeta(record.meta);
  const authorId = asText(record.authorId);
  const authorName = asText(record.authorName);
  const authorRole = asText(record.authorRole);
  const teamId = audience?.kind === "person" ? null : asNullableText(record.teamId);
  const teamLabel = audience?.kind === "person" ? null : asNullableText(record.teamLabel);
  const normalizedAuthorName =
    authorId === "main-agent" && authorName === "Co-Founder Manager" ? "Main Agent" : authorName;
  const normalizedAuthorRole =
    authorId === "main-agent" && authorRole === "Organization lead"
      ? "Organization interface"
      : authorRole;

  return {
    id: asText(record.id) || fallbackId,
    role: normalizeRole(record.role),
    content,
    createdAt: asText(record.createdAt) || fallbackCreatedAt,
    ...(authorId ? { authorId } : {}),
    ...(normalizedAuthorName ? { authorName: normalizedAuthorName } : {}),
    ...(normalizedAuthorRole ? { authorRole: normalizedAuthorRole } : {}),
    ...(authorKind ? { authorKind } : {}),
    ...(teamId !== null ? { teamId } : {}),
    ...(teamLabel !== null ? { teamLabel } : {}),
    ...(audience ? { audience } : {}),
    ...(mentions ? { mentions } : {}),
    ...(record.error === true ? { error: true } : {}),
    ...(metrics ? { metrics } : {}),
    ...(routing ? { routing } : {}),
    ...(direction ? { direction } : {}),
    ...(meta ? { meta } : {})
  };
}

function normalizeMessages(value: unknown, fallbackCreatedAt: string) {
  if (!Array.isArray(value)) {
    return [] as ChatMessage[];
  }

  return value
    .map((item, index) =>
      normalizeMessage(item, `message-${index + 1}`, fallbackCreatedAt)
    )
    .filter((item) => item.content.length > 0 || item.direction || item.meta);
}

function memberKey(userId: string) {
  return `member:${userId}`;
}

function normalizeWorkspaceState(
  value: unknown
): ChatString["workspaceState"] | undefined {
  const record = asRecord(value);
  const editableDraft =
    record.editableDraft &&
    typeof record.editableDraft === "object" &&
    !Array.isArray(record.editableDraft)
      ? (record.editableDraft as Record<string, unknown>)
      : undefined;
  const scoreRecords = Array.isArray(record.scoreRecords)
    ? record.scoreRecords.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item)
      )
    : [];
  const steerDecisionsSource =
    record.steerDecisions &&
    typeof record.steerDecisions === "object" &&
    !Array.isArray(record.steerDecisions)
      ? (record.steerDecisions as Record<string, unknown>)
      : {};
  const steerDecisions = Object.fromEntries(
    Object.entries(steerDecisionsSource).filter(
      ([key, value]) =>
        key.trim().length > 0 &&
        (value === "CENTER" || value === "APPROVED" || value === "RETHINK")
    )
  ) as Record<string, "CENTER" | "APPROVED" | "RETHINK">;
  const linkedTeamIds = [...new Set(asStringArray(record.linkedTeamIds, 40))];
  const linkedParticipantIds = [...new Set(asStringArray(record.linkedParticipantIds, 80))];
  const excludedParticipantIds = [...new Set(asStringArray(record.excludedParticipantIds, 80))];

  if (
    !editableDraft &&
    scoreRecords.length === 0 &&
    Object.keys(steerDecisions).length === 0 &&
    linkedTeamIds.length === 0 &&
    linkedParticipantIds.length === 0 &&
    excludedParticipantIds.length === 0
  ) {
    return undefined;
  }

  return {
    ...(editableDraft ? { editableDraft } : {}),
    ...(scoreRecords.length > 0 ? { scoreRecords } : {}),
    ...(Object.keys(steerDecisions).length > 0 ? { steerDecisions } : {}),
    ...(linkedTeamIds.length > 0 ? { linkedTeamIds } : {}),
    ...(linkedParticipantIds.length > 0 ? { linkedParticipantIds } : {}),
    ...(excludedParticipantIds.length > 0 ? { excludedParticipantIds } : {})
  };
}

function keyFromStringId(stringId: string) {
  return `${STRING_PREFIX}${stringId}`;
}

function sortStrings(strings: PersistedStringRecord[]) {
  return [...strings].sort((left, right) => {
    const leftMs = new Date(left.updatedAt).getTime();
    const rightMs = new Date(right.updatedAt).getTime();
    return rightMs - leftMs;
  });
}

async function listViewerTeamIds(
  orgId: string,
  userId: string,
  client?: MemoryEntryClient
) {
  const db = client ?? prisma;
  const companyDataFile = await db.file.findFirst({
    where: {
      orgId,
      type: HubFileType.INPUT,
      name: COMPANY_DATA_FILE_NAME
    },
    orderBy: {
      updatedAt: "desc"
    },
    select: {
      metadata: true
    }
  });

  if (!companyDataFile) {
    return new Set<string>();
  }

  const collaboration = readOrganizationCollaboration(companyDataFile.metadata);
  return new Set(
    collaboration.teams
      .filter((team) => team.memberUserIds.includes(userId))
      .map((team) => team.id)
  );
}

function isViewerTeamParticipant(
  teamId: string | null | undefined,
  viewerTeamIds: Set<string>
) {
  return Boolean(teamId && viewerTeamIds.has(teamId));
}

function canActorAccessString(
  record: PersistedStringRecord,
  actor: StringAccessActor,
  viewerTeamIds: Set<string>
) {
  if (actor.role === OrgRole.FOUNDER || actor.role === "INTERNAL") {
    return true;
  }

  const viewerMemberId = memberKey(actor.userId);
  const linkedParticipantIds = record.workspaceState?.linkedParticipantIds ?? [];
  const linkedTeamIds = record.workspaceState?.linkedTeamIds ?? [];
  const excludedParticipantIds = new Set(record.workspaceState?.excludedParticipantIds ?? []);

  if (excludedParticipantIds.has(viewerMemberId)) {
    return false;
  }

  if (record.createdByUserId === actor.userId || record.updatedByUserId === actor.userId) {
    return true;
  }

  if (record.activeAudience?.kind === "person" && record.activeAudience.id === viewerMemberId) {
    return true;
  }

  if (linkedParticipantIds.includes(viewerMemberId)) {
    return true;
  }

  if (isViewerTeamParticipant(record.selectedTeamId, viewerTeamIds)) {
    return true;
  }

  if (
    record.activeAudience?.kind === "team" &&
    isViewerTeamParticipant(record.activeAudience.id, viewerTeamIds)
  ) {
    return true;
  }

  if (linkedTeamIds.some((teamId) => viewerTeamIds.has(teamId))) {
    return true;
  }

  return record.messages.some((message) => {
    if (message.authorId === viewerMemberId) {
      return true;
    }

    if (message.audience?.kind === "person" && message.audience.id === viewerMemberId) {
      return true;
    }

    if (
      message.audience?.kind === "team" &&
      isViewerTeamParticipant(message.audience.id, viewerTeamIds)
    ) {
      return true;
    }

    return isViewerTeamParticipant(message.teamId, viewerTeamIds);
  });
}

function parseStringRecord(
  orgId: string,
  fallbackUserId: string | null,
  value: unknown
): PersistedStringRecord {
  const record = asRecord(value);
  const now = new Date().toISOString();
  const id = asText(record.id) || randomUUID();
  const createdAt = asText(record.createdAt) || now;
  const updatedAt = asText(record.updatedAt) || createdAt;
  const directionId = asNullableText(record.directionId);
  const planId = asNullableText(record.planId);
  const workspaceState = normalizeWorkspaceState(record.workspaceState);
  const activeAudience = normalizeAudience(record.activeAudience);

  return {
    id,
    orgId,
    title: asText(record.title) || DEFAULT_TITLE,
    mode: normalizeMode(record.mode),
    updatedAt,
    createdAt,
    directionId,
    planId,
    selectedTeamId: asNullableText(record.selectedTeamId),
    selectedTeamLabel: asNullableText(record.selectedTeamLabel),
    ...(activeAudience ? { activeAudience } : {}),
    source: normalizeSource(
      record.source,
      planId ? "plan" : directionId ? "direction" : "workspace"
    ),
    ...(workspaceState ? { workspaceState } : {}),
    createdByUserId:
      asNullableText(record.createdByUserId) ?? fallbackUserId ?? null,
    updatedByUserId:
      asNullableText(record.updatedByUserId) ?? fallbackUserId ?? null,
    persisted: true,
    messages: normalizeMessages(record.messages, createdAt)
  };
}

async function listSharedStringEntries(orgId: string, client?: MemoryEntryClient) {
  const db = client ?? prisma;
  return db.memoryEntry.findMany({
    where: {
      orgId,
      tier: MemoryTier.ORG,
      key: {
        startsWith: STRING_PREFIX
      },
      redactedAt: null
    },
    orderBy: {
      updatedAt: "desc"
    },
    take: 300
  });
}

async function listLegacyUserStringEntries(
  orgId: string,
  userId: string,
  client?: MemoryEntryClient
) {
  const db = client ?? prisma;
  return db.memoryEntry.findMany({
    where: {
      orgId,
      userId,
      tier: MemoryTier.USER,
      key: {
        startsWith: STRING_PREFIX
      },
      redactedAt: null
    },
    orderBy: {
      updatedAt: "desc"
    },
    take: 300
  });
}

async function findSharedStringEntry(
  orgId: string,
  stringId: string,
  client?: MemoryEntryClient
) {
  const db = client ?? prisma;
  return db.memoryEntry.findFirst({
    where: {
      orgId,
      tier: MemoryTier.ORG,
      key: keyFromStringId(stringId),
      redactedAt: null
    }
  });
}

async function findLegacyUserStringEntry(
  orgId: string,
  userId: string,
  stringId: string,
  client?: MemoryEntryClient
) {
  const db = client ?? prisma;
  return db.memoryEntry.findFirst({
    where: {
      orgId,
      userId,
      tier: MemoryTier.USER,
      key: keyFromStringId(stringId),
      redactedAt: null
    }
  });
}

export async function listStrings(
  orgId: string,
  actor: StringAccessActor,
  client?: MemoryEntryClient
) {
  const [sharedRows, legacyRows] = await Promise.all([
    listSharedStringEntries(orgId, client),
    listLegacyUserStringEntries(orgId, actor.userId, client)
  ]);
  const merged = new Map<string, PersistedStringRecord>();

  for (const row of sharedRows) {
    const parsed = parseStringRecord(orgId, row.userId ?? actor.userId, row.value);
    merged.set(parsed.id, parsed);
  }

  for (const row of legacyRows) {
    const parsed = parseStringRecord(orgId, row.userId ?? actor.userId, row.value);
    if (!merged.has(parsed.id)) {
      merged.set(parsed.id, parsed);
    }
  }

  const allStrings = [...merged.values()];
  if (actor.role === OrgRole.FOUNDER || actor.role === "INTERNAL") {
    return sortStrings(allStrings);
  }

  const viewerTeamIds = await listViewerTeamIds(orgId, actor.userId, client);
  return sortStrings(
    allStrings.filter((record) => canActorAccessString(record, actor, viewerTeamIds))
  );
}

export async function getString(
  orgId: string,
  actor: StringAccessActor,
  stringId: string,
  client?: MemoryEntryClient
) {
  const shared = await findSharedStringEntry(orgId, stringId, client);
  if (shared) {
    const record = parseStringRecord(orgId, shared.userId ?? actor.userId, shared.value);
    if (actor.role === OrgRole.FOUNDER || actor.role === "INTERNAL") {
      return record;
    }

    const viewerTeamIds = await listViewerTeamIds(orgId, actor.userId, client);
    return canActorAccessString(record, actor, viewerTeamIds) ? record : null;
  }

  const legacy = await findLegacyUserStringEntry(orgId, actor.userId, stringId, client);
  if (!legacy) {
    return null;
  }

  const record = parseStringRecord(orgId, legacy.userId ?? actor.userId, legacy.value);
  if (actor.role === OrgRole.FOUNDER || actor.role === "INTERNAL") {
    return record;
  }

  const viewerTeamIds = await listViewerTeamIds(orgId, actor.userId, client);
  return canActorAccessString(record, actor, viewerTeamIds) ? record : null;
}

export async function saveString(
  orgId: string,
  actor: StringAccessActor,
  input: SaveStringInput,
  client?: MemoryEntryClient
) {
  const db = client ?? prisma;
  const now = new Date().toISOString();
  const requestedId = asText(input.id);
  const stringId = requestedId || randomUUID();
  const [sharedExisting, legacyExisting] = await Promise.all([
    findSharedStringEntry(orgId, stringId, client),
    findLegacyUserStringEntry(orgId, actor.userId, stringId, client)
  ]);
  const existing = sharedExisting ?? legacyExisting;
  const current = existing
    ? parseStringRecord(orgId, existing.userId ?? actor.userId, existing.value)
    : null;
  if (current && actor.role !== OrgRole.FOUNDER && actor.role !== "INTERNAL") {
    const viewerTeamIds = await listViewerTeamIds(orgId, actor.userId, client);
    if (!canActorAccessString(current, actor, viewerTeamIds)) {
      throw new Error("String not found.");
    }
  }
  const createdAt = asText(input.createdAt) || current?.createdAt || now;
  const directionId =
    input.directionId !== undefined ? asNullableText(input.directionId) : current?.directionId ?? null;
  const planId =
    input.planId !== undefined ? asNullableText(input.planId) : current?.planId ?? null;
  const nextRecord: PersistedStringRecord = {
    id: stringId,
    orgId,
    title: asText(input.title) || current?.title || DEFAULT_TITLE,
    mode: input.mode ? normalizeMode(input.mode) : current?.mode ?? "discussion",
    createdAt,
    updatedAt: asText(input.updatedAt) || now,
    directionId,
    planId,
    selectedTeamId:
      input.selectedTeamId !== undefined
        ? asNullableText(input.selectedTeamId)
        : current?.selectedTeamId ?? null,
    selectedTeamLabel:
      input.selectedTeamLabel !== undefined
        ? asNullableText(input.selectedTeamLabel)
        : current?.selectedTeamLabel ?? null,
    ...(input.activeAudience !== undefined
      ? normalizeAudience(input.activeAudience)
        ? { activeAudience: normalizeAudience(input.activeAudience) }
        : {}
      : current?.activeAudience
        ? { activeAudience: current.activeAudience }
        : {}),
    source: normalizeSource(
      input.source,
      current?.source ?? (planId ? "plan" : directionId ? "direction" : "workspace")
    ),
    ...(input.workspaceState !== undefined
      ? input.workspaceState
        ? { workspaceState: input.workspaceState }
        : {}
      : current?.workspaceState
        ? { workspaceState: current.workspaceState }
        : {}),
    createdByUserId: current?.createdByUserId ?? actor.userId,
    updatedByUserId: actor.userId,
    persisted: true,
    messages:
      input.messages !== undefined
        ? normalizeMessages(input.messages, createdAt)
        : current?.messages ?? []
  };

  if (sharedExisting) {
    await db.memoryEntry.update({
      where: {
        id: sharedExisting.id
      },
      data: {
        userId: actor.userId,
        value: nextRecord as unknown as Prisma.InputJsonValue,
        redactedAt: null
      }
    });
  } else {
    await db.memoryEntry.create({
      data: {
        orgId,
        userId: actor.userId,
        tier: MemoryTier.ORG,
        key: keyFromStringId(nextRecord.id),
        value: nextRecord as unknown as Prisma.InputJsonValue
      }
    });
  }

  if (legacyExisting) {
    await db.memoryEntry.update({
      where: {
        id: legacyExisting.id
      },
      data: {
        redactedAt: new Date(),
        value: Prisma.DbNull
      }
    });
  }

  return nextRecord;
}

export async function deleteString(
  orgId: string,
  userId: string,
  stringId: string,
  client?: MemoryEntryClient
) {
  const db = client ?? prisma;
  const [shared, legacy] = await Promise.all([
    findSharedStringEntry(orgId, stringId, client),
    findLegacyUserStringEntry(orgId, userId, stringId, client)
  ]);
  const rows = [shared, legacy].filter(Boolean);

  if (rows.length === 0) {
    return false;
  }

  await Promise.all(
    rows.map((row) =>
      db.memoryEntry.update({
        where: {
          id: row!.id
        },
        data: {
          redactedAt: new Date(),
          value: Prisma.DbNull
        }
      })
    )
  );

  return true;
}
