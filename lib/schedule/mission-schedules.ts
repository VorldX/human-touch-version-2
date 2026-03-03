import "server-only";

import { randomUUID } from "node:crypto";

import { MemoryTier, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";

export type MissionCadence = "DAILY" | "WEEKLY" | "MONTHLY" | "CUSTOM";

export interface MissionSchedule {
  id: string;
  title: string;
  direction: string;
  directionId?: string;
  cadence: MissionCadence;
  nextRunAt: string;
  timezone: string;
  swarmDensity: number;
  requiredSignatures: number;
  predictedBurn: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
}

interface CreateMissionScheduleInput {
  title: string;
  direction: string;
  directionId?: string;
  cadence: MissionCadence;
  nextRunAt: string;
  timezone?: string;
  swarmDensity?: number;
  requiredSignatures?: number;
  predictedBurn?: number;
  enabled?: boolean;
}

interface UpdateMissionScheduleInput {
  title?: string;
  direction?: string;
  directionId?: string;
  cadence?: MissionCadence;
  nextRunAt?: string;
  timezone?: string;
  swarmDensity?: number;
  requiredSignatures?: number;
  predictedBurn?: number;
  enabled?: boolean;
  lastRunAt?: string;
}

const SCHEDULE_KEY_PREFIX = "schedule.mission.";

function asRecord(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeCadence(value: unknown): MissionCadence {
  if (value === "WEEKLY") return "WEEKLY";
  if (value === "MONTHLY") return "MONTHLY";
  if (value === "CUSTOM") return "CUSTOM";
  return "DAILY";
}

function clampInt(value: unknown, fallback: number, min = 1, max = 1_000_000) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function normalizeTimestamp(value: unknown, fallback: Date) {
  if (typeof value !== "string") return fallback.toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback.toISOString();
  return parsed.toISOString();
}

function parseSchedule(value: unknown): MissionSchedule {
  const record = asRecord(value);
  const now = new Date();
  return {
    id: typeof record.id === "string" ? record.id : randomUUID(),
    title: typeof record.title === "string" ? record.title : "Scheduled Mission",
    direction: typeof record.direction === "string" ? record.direction : "",
    ...(typeof record.directionId === "string" ? { directionId: record.directionId } : {}),
    cadence: normalizeCadence(record.cadence),
    nextRunAt: normalizeTimestamp(record.nextRunAt, now),
    timezone: typeof record.timezone === "string" ? record.timezone : "UTC",
    swarmDensity: clampInt(record.swarmDensity, 24, 1, 100),
    requiredSignatures: clampInt(record.requiredSignatures, 1, 1, 5),
    predictedBurn: clampInt(record.predictedBurn, 1200, 1, 5_000_000),
    enabled: typeof record.enabled === "boolean" ? record.enabled : true,
    createdAt: normalizeTimestamp(record.createdAt, now),
    updatedAt: normalizeTimestamp(record.updatedAt, now),
    ...(typeof record.lastRunAt === "string" ? { lastRunAt: record.lastRunAt } : {})
  };
}

function scheduleKey(scheduleId: string) {
  return `${SCHEDULE_KEY_PREFIX}${scheduleId}`;
}

function addCadence(date: Date, cadence: MissionCadence) {
  const next = new Date(date);
  if (cadence === "WEEKLY") {
    next.setDate(next.getDate() + 7);
    return next;
  }
  if (cadence === "MONTHLY") {
    next.setMonth(next.getMonth() + 1);
    return next;
  }
  next.setDate(next.getDate() + 1);
  return next;
}

export function computeNextRunAt(currentIso: string, cadence: MissionCadence) {
  const base = new Date(currentIso);
  const normalizedBase = Number.isNaN(base.getTime()) ? new Date() : base;
  return addCadence(normalizedBase, cadence).toISOString();
}

export function isMissionScheduleDue(schedule: MissionSchedule, now = new Date()) {
  if (!schedule.enabled) {
    return false;
  }
  const nextRun = new Date(schedule.nextRunAt);
  if (Number.isNaN(nextRun.getTime())) {
    return true;
  }
  return nextRun.getTime() <= now.getTime();
}

export async function listMissionSchedules(orgId: string) {
  const rows = await prisma.memoryEntry.findMany({
    where: {
      orgId,
      tier: MemoryTier.ORG,
      key: {
        startsWith: SCHEDULE_KEY_PREFIX
      },
      redactedAt: null
    },
    orderBy: {
      updatedAt: "desc"
    },
    take: 300
  });

  return rows.map((row) => parseSchedule(row.value));
}

export async function listDueMissionSchedules(orgId: string, now = new Date()) {
  const schedules = await listMissionSchedules(orgId);
  return schedules.filter((schedule) => isMissionScheduleDue(schedule, now));
}

export async function getMissionSchedule(orgId: string, scheduleId: string) {
  const row = await prisma.memoryEntry.findFirst({
    where: {
      orgId,
      tier: MemoryTier.ORG,
      key: scheduleKey(scheduleId),
      redactedAt: null
    }
  });
  if (!row) {
    return null;
  }
  return parseSchedule(row.value);
}

export async function createMissionSchedule(orgId: string, input: CreateMissionScheduleInput) {
  const now = new Date().toISOString();
  const schedule: MissionSchedule = {
    id: randomUUID(),
    title: input.title.trim() || "Scheduled Mission",
    direction: input.direction.trim(),
    ...(input.directionId?.trim() ? { directionId: input.directionId.trim() } : {}),
    cadence: normalizeCadence(input.cadence),
    nextRunAt: normalizeTimestamp(input.nextRunAt, new Date()),
    timezone: input.timezone?.trim() || "UTC",
    swarmDensity: clampInt(input.swarmDensity, 24, 1, 100),
    requiredSignatures: clampInt(input.requiredSignatures, 1, 1, 5),
    predictedBurn: clampInt(input.predictedBurn, 1200, 1, 5_000_000),
    enabled: input.enabled ?? true,
    createdAt: now,
    updatedAt: now
  };

  await prisma.memoryEntry.create({
    data: {
      orgId,
      tier: MemoryTier.ORG,
      key: scheduleKey(schedule.id),
      value: schedule as unknown as Prisma.InputJsonValue
    }
  });

  return schedule;
}

export async function updateMissionSchedule(
  orgId: string,
  scheduleId: string,
  patch: UpdateMissionScheduleInput
) {
  const existingRow = await prisma.memoryEntry.findFirst({
    where: {
      orgId,
      tier: MemoryTier.ORG,
      key: scheduleKey(scheduleId),
      redactedAt: null
    }
  });

  if (!existingRow) {
    return null;
  }

  const current = parseSchedule(existingRow.value);
  const next: MissionSchedule = {
    ...current,
    ...(typeof patch.title === "string" ? { title: patch.title.trim() || current.title } : {}),
    ...(typeof patch.direction === "string"
      ? { direction: patch.direction.trim() || current.direction }
      : {}),
    ...(typeof patch.directionId === "string"
      ? { directionId: patch.directionId.trim() || undefined }
      : {}),
    ...(patch.cadence ? { cadence: normalizeCadence(patch.cadence) } : {}),
    ...(typeof patch.nextRunAt === "string"
      ? { nextRunAt: normalizeTimestamp(patch.nextRunAt, new Date()) }
      : {}),
    ...(typeof patch.timezone === "string" ? { timezone: patch.timezone.trim() || "UTC" } : {}),
    ...(typeof patch.swarmDensity === "number"
      ? { swarmDensity: clampInt(patch.swarmDensity, current.swarmDensity, 1, 100) }
      : {}),
    ...(typeof patch.requiredSignatures === "number"
      ? { requiredSignatures: clampInt(patch.requiredSignatures, current.requiredSignatures, 1, 5) }
      : {}),
    ...(typeof patch.predictedBurn === "number"
      ? { predictedBurn: clampInt(patch.predictedBurn, current.predictedBurn, 1, 5_000_000) }
      : {}),
    ...(typeof patch.enabled === "boolean" ? { enabled: patch.enabled } : {}),
    ...(typeof patch.lastRunAt === "string"
      ? { lastRunAt: normalizeTimestamp(patch.lastRunAt, new Date()) }
      : {}),
    updatedAt: new Date().toISOString()
  };

  await prisma.memoryEntry.update({
    where: { id: existingRow.id },
    data: {
      value: next as unknown as Prisma.InputJsonValue
    }
  });

  return next;
}

export async function deleteMissionSchedule(orgId: string, scheduleId: string) {
  const row = await prisma.memoryEntry.findFirst({
    where: {
      orgId,
      tier: MemoryTier.ORG,
      key: scheduleKey(scheduleId),
      redactedAt: null
    }
  });

  if (!row) {
    return false;
  }

  await prisma.memoryEntry.update({
    where: { id: row.id },
    data: {
      redactedAt: new Date(),
      value: Prisma.DbNull
    }
  });

  return true;
}
