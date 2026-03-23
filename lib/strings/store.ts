import "server-only";

import { randomUUID } from "node:crypto";

import { MemoryTier, Prisma } from "@prisma/client";

import type {
  ChatMessage,
  ChatString,
  DirectionPayload,
  DirectionStep,
  MessageMetrics,
  MessageRole,
  MessageRouting,
  StringMode
} from "@/components/chat-ui/types";
import { prisma } from "@/lib/db/prisma";

type MemoryEntryClient = Pick<Prisma.TransactionClient, "memoryEntry"> | typeof prisma;

export interface PersistedStringRecord extends ChatString {
  orgId: string;
  userId: string;
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
  source?: ChatString["source"];
  messages?: ChatMessage[];
}

const STRING_PREFIX = "string.record.";
const DEFAULT_TITLE = "New string";

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

function normalizeMessage(value: unknown, fallbackId: string, fallbackCreatedAt: string): ChatMessage {
  const record = asRecord(value);
  const content = asText(record.content);
  const metrics = normalizeMetrics(record.metrics);
  const routing = normalizeRouting(record.routing);
  const direction = normalizeDirection(record.direction);

  return {
    id: asText(record.id) || fallbackId,
    role: normalizeRole(record.role),
    content,
    createdAt: asText(record.createdAt) || fallbackCreatedAt,
    ...(asText(record.authorName) ? { authorName: asText(record.authorName) } : {}),
    ...(asText(record.authorRole) ? { authorRole: asText(record.authorRole) } : {}),
    ...(asNullableText(record.teamId) !== null ? { teamId: asNullableText(record.teamId) } : {}),
    ...(asNullableText(record.teamLabel) !== null
      ? { teamLabel: asNullableText(record.teamLabel) }
      : {}),
    ...(record.error === true ? { error: true } : {}),
    ...(metrics ? { metrics } : {}),
    ...(routing ? { routing } : {}),
    ...(direction ? { direction } : {})
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
    .filter((item) => item.content.length > 0 || item.direction);
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

function parseStringRecord(
  orgId: string,
  userId: string,
  value: unknown
): PersistedStringRecord {
  const record = asRecord(value);
  const now = new Date().toISOString();
  const id = asText(record.id) || randomUUID();
  const createdAt = asText(record.createdAt) || now;
  const updatedAt = asText(record.updatedAt) || createdAt;
  const directionId = asNullableText(record.directionId);
  const planId = asNullableText(record.planId);

  return {
    id,
    orgId,
    userId,
    title: asText(record.title) || DEFAULT_TITLE,
    mode: normalizeMode(record.mode),
    updatedAt,
    createdAt,
    directionId,
    planId,
    selectedTeamId: asNullableText(record.selectedTeamId),
    selectedTeamLabel: asNullableText(record.selectedTeamLabel),
    source: normalizeSource(
      record.source,
      planId ? "plan" : directionId ? "direction" : "workspace"
    ),
    persisted: true,
    messages: normalizeMessages(record.messages, createdAt)
  };
}

export async function listStrings(
  orgId: string,
  userId: string,
  client?: MemoryEntryClient
) {
  const db = client ?? prisma;
  const rows = await db.memoryEntry.findMany({
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
    take: 200
  });

  return sortStrings(rows.map((row) => parseStringRecord(orgId, userId, row.value)));
}

export async function getString(
  orgId: string,
  userId: string,
  stringId: string,
  client?: MemoryEntryClient
) {
  const db = client ?? prisma;
  const row = await db.memoryEntry.findFirst({
    where: {
      orgId,
      userId,
      tier: MemoryTier.USER,
      key: keyFromStringId(stringId),
      redactedAt: null
    }
  });

  if (!row) {
    return null;
  }

  return parseStringRecord(orgId, userId, row.value);
}

export async function saveString(
  orgId: string,
  userId: string,
  input: SaveStringInput,
  client?: MemoryEntryClient
) {
  const db = client ?? prisma;
  const now = new Date().toISOString();
  const requestedId = asText(input.id);
  const stringId = requestedId || randomUUID();
  const existing = await db.memoryEntry.findFirst({
    where: {
      orgId,
      userId,
      tier: MemoryTier.USER,
      key: keyFromStringId(stringId),
      redactedAt: null
    }
  });

  const current = existing ? parseStringRecord(orgId, userId, existing.value) : null;
  const createdAt = asText(input.createdAt) || current?.createdAt || now;
  const directionId =
    input.directionId !== undefined ? asNullableText(input.directionId) : current?.directionId ?? null;
  const planId =
    input.planId !== undefined ? asNullableText(input.planId) : current?.planId ?? null;
  const nextRecord: PersistedStringRecord = {
    id: stringId,
    orgId,
    userId,
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
    source: normalizeSource(
      input.source,
      current?.source ?? (planId ? "plan" : directionId ? "direction" : "workspace")
    ),
    persisted: true,
    messages:
      input.messages !== undefined
        ? normalizeMessages(input.messages, createdAt)
        : current?.messages ?? []
  };

  if (existing) {
    await db.memoryEntry.update({
      where: {
        id: existing.id
      },
      data: {
        value: nextRecord as unknown as Prisma.InputJsonValue,
        redactedAt: null
      }
    });
  } else {
    await db.memoryEntry.create({
      data: {
        orgId,
        userId,
        tier: MemoryTier.USER,
        key: keyFromStringId(nextRecord.id),
        value: nextRecord as unknown as Prisma.InputJsonValue
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
  const row = await db.memoryEntry.findFirst({
    where: {
      orgId,
      userId,
      tier: MemoryTier.USER,
      key: keyFromStringId(stringId),
      redactedAt: null
    }
  });

  if (!row) {
    return false;
  }

  await db.memoryEntry.update({
    where: {
      id: row.id
    },
    data: {
      redactedAt: new Date(),
      value: Prisma.DbNull
    }
  });

  return true;
}
