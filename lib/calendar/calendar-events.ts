import "server-only";

import { randomUUID } from "node:crypto";

import { FlowStatus, MemoryTier, Prisma, TaskStatus } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { listDirections } from "@/lib/direction/directions";
import { type PlanRecord, listPlans } from "@/lib/plans/plans";
import { listOrgPermissionRequests } from "@/lib/requests/permission-requests";
import { listMissionSchedules } from "@/lib/schedule/mission-schedules";

export type CalendarScope = "ORG" | "USER";
export type CalendarActorType = "HUMAN" | "AI";
export type CalendarActorFilter = "ALL" | "HUMAN" | "AI";
export type CalendarTemporalFilter = "ALL" | "PAST" | "FUTURE";

type CalendarSourceKind =
  | "manual"
  | "command"
  | "plan"
  | "pathway"
  | "flow"
  | "task"
  | "approval"
  | "schedule"
  | "log";

interface CalendarPathwayStepRef {
  stepId: string;
  line: number;
  workflowTitle: string;
  taskTitle: string;
  ownerRole: string;
  executionMode: "HUMAN" | "AGENT" | "HYBRID";
  trigger: string;
  dueWindow: string;
  dependsOn: string[];
}

interface CalendarEventReferences {
  directionId?: string;
  planId?: string;
  flowId?: string;
  taskId?: string;
  requestId?: string;
  scheduleId?: string;
}

export interface CalendarTimelineEvent {
  id: string;
  orgId: string;
  scope: CalendarScope;
  ownerUserId: string | null;
  title: string;
  detail: string;
  startsAt: string;
  endsAt: string | null;
  actorType: CalendarActorType;
  actorLabel: string;
  sourceKind: CalendarSourceKind;
  sourceLabel: string;
  sourceId: string | null;
  live: boolean;
  tags: string[];
  pathway: CalendarPathwayStepRef | null;
  references: CalendarEventReferences;
}

export interface CalendarTimelineSummary {
  total: number;
  live: number;
  human: number;
  ai: number;
  past: number;
  future: number;
}

export interface CalendarTimelineResult {
  events: CalendarTimelineEvent[];
  summary: CalendarTimelineSummary;
}

interface ListCalendarTimelineEventsInput {
  orgId: string;
  userId?: string;
  scope: CalendarScope;
  rangeStart: string;
  rangeEnd: string;
  actor: CalendarActorFilter;
  temporal: CalendarTemporalFilter;
  liveOnly: boolean;
}

interface ManualCalendarEventRecord {
  id: string;
  orgId: string;
  scope: CalendarScope;
  userId: string | null;
  title: string;
  detail: string;
  startsAt: string;
  endsAt: string | null;
  actorType: CalendarActorType;
  actorLabel: string;
  tags: string[];
  createdByUserId: string | null;
  createdByEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CreateManualCalendarEventInput {
  orgId: string;
  actorUserId: string;
  actorEmail: string;
  isInternal: boolean;
  scope: CalendarScope;
  title: string;
  detail?: string;
  startsAt: string;
  endsAt?: string | null;
  actorType?: CalendarActorType;
  actorLabel?: string;
  tags?: string[];
}

interface UpdateManualCalendarEventInput {
  orgId: string;
  eventId: string;
  actorUserId: string;
  isInternal: boolean;
  patch: {
    title?: string;
    detail?: string;
    startsAt?: string;
    endsAt?: string | null;
    scope?: CalendarScope;
    actorType?: CalendarActorType;
    actorLabel?: string;
    tags?: string[];
  };
}

interface DeleteManualCalendarEventInput {
  orgId: string;
  eventId: string;
  actorUserId: string;
  isInternal: boolean;
}

type UpdateManualEventResult =
  | { status: "NOT_FOUND" | "FORBIDDEN" }
  | { status: "UPDATED"; event: CalendarTimelineEvent };

type DeleteManualEventResult = "OK" | "NOT_FOUND" | "FORBIDDEN";

const MANUAL_EVENT_KEY_PREFIX = "calendar.event.";

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function compactText(value: unknown) {
  return cleanText(value).replace(/\s+/g, " ");
}

function clampText(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}

function normalizeTimestamp(value: unknown, fallback: string) {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate) {
    return fallback;
  }
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }
  return parsed.toISOString();
}

function normalizeNullableTimestamp(value: unknown) {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate) {
    return null;
  }
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function normalizeActorType(value: unknown, fallback: CalendarActorType = "HUMAN"): CalendarActorType {
  if (value === "AI") {
    return "AI";
  }
  if (value === "HUMAN") {
    return "HUMAN";
  }
  return fallback;
}

function normalizeScope(value: unknown, fallback: CalendarScope = "ORG"): CalendarScope {
  if (value === "USER") {
    return "USER";
  }
  if (value === "ORG") {
    return "ORG";
  }
  return fallback;
}

function normalizeTags(value: unknown, limit = 12) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }
  const normalized = value
    .map((item) => compactText(item).toLowerCase())
    .filter(Boolean);
  return [...new Set(normalized)].slice(0, limit);
}

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function manualEventKey(eventId: string) {
  return `${MANUAL_EVENT_KEY_PREFIX}${eventId}`;
}

function parsePathwayStep(raw: unknown, index: number): CalendarPathwayStepRef | null {
  const record = asRecord(raw);
  const workflowTitle = compactText(record.workflowTitle);
  const taskTitle = compactText(record.taskTitle);
  if (!workflowTitle || !taskTitle) {
    return null;
  }

  const parsedLine = Number(record.line);
  const line =
    Number.isFinite(parsedLine) && parsedLine > 0
      ? Math.floor(parsedLine)
      : index + 1;
  const executionModeRaw = cleanText(record.executionMode).toUpperCase();
  const executionMode =
    executionModeRaw === "HUMAN"
      ? "HUMAN"
      : executionModeRaw === "AGENT"
        ? "AGENT"
        : "HYBRID";

  return {
    stepId: compactText(record.stepId) || `pathway-step-${line}`,
    line,
    workflowTitle,
    taskTitle,
    ownerRole: compactText(record.ownerRole) || "EMPLOYEE",
    executionMode,
    trigger: compactText(record.trigger) || (line === 1 ? "Immediate after approval" : "After previous step"),
    dueWindow: compactText(record.dueWindow) || "Execution window",
    dependsOn: Array.isArray(record.dependsOn)
      ? record.dependsOn
          .map((item) => compactText(item))
          .filter(Boolean)
          .slice(0, 12)
      : []
  };
}

function extractPathwayFromPlan(plan: PlanRecord) {
  const root = asRecord(plan.primaryPlan);
  const rawPathway = Array.isArray(root.pathway) ? root.pathway : [];
  return rawPathway
    .map((entry, index) => parsePathwayStep(entry, index))
    .filter((entry): entry is CalendarPathwayStepRef => Boolean(entry))
    .sort((left, right) => left.line - right.line)
    .slice(0, 150);
}

function parsePathwayFromExecutionTrace(trace: Prisma.JsonValue | null) {
  if (!trace || typeof trace !== "object" || Array.isArray(trace)) {
    return null;
  }
  const root = trace as Record<string, unknown>;
  return parsePathwayStep(root.pathway, 0);
}

function parseInitiatedByUserId(trace: Prisma.JsonValue | null) {
  if (!trace || typeof trace !== "object" || Array.isArray(trace)) {
    return null;
  }
  const root = trace as Record<string, unknown>;
  const initiatedByUserId = cleanText(root.initiatedByUserId);
  return initiatedByUserId || null;
}

function extractDateFromFreeText(value: string) {
  const text = value.trim();
  if (!text) {
    return null;
  }
  const direct = new Date(text);
  if (!Number.isNaN(direct.getTime())) {
    return direct.toISOString();
  }
  const isoLike = text.match(/\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?)?/);
  if (!isoLike) {
    return null;
  }
  const parsed = new Date(isoLike[0]);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function derivePathwayStartAt(step: CalendarPathwayStepRef, index: number, baseIso: string) {
  const fromDueWindow = extractDateFromFreeText(step.dueWindow);
  if (fromDueWindow) {
    return fromDueWindow;
  }
  const base = new Date(baseIso);
  if (Number.isNaN(base.getTime())) {
    return new Date(Date.now() + index * 30 * 60 * 1000).toISOString();
  }
  base.setMinutes(base.getMinutes() + index * 30);
  return base.toISOString();
}

function temporalState(
  event: Pick<CalendarTimelineEvent, "startsAt" | "endsAt" | "live">,
  nowMs: number
) {
  if (event.live) {
    return "LIVE" as const;
  }
  const startMs = new Date(event.startsAt).getTime();
  const endMs = event.endsAt ? new Date(event.endsAt).getTime() : startMs;
  if (startMs <= nowMs && endMs >= nowMs) {
    return "LIVE" as const;
  }
  if (endMs < nowMs) {
    return "PAST" as const;
  }
  return "FUTURE" as const;
}

function eventIntersectsRange(event: CalendarTimelineEvent, fromMs: number, toMs: number) {
  const startMs = new Date(event.startsAt).getTime();
  const endMs = event.endsAt ? new Date(event.endsAt).getTime() : startMs;
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return false;
  }
  return endMs >= fromMs && startMs <= toMs;
}

function computeSummary(events: CalendarTimelineEvent[]) {
  const nowMs = Date.now();
  const summary: CalendarTimelineSummary = {
    total: events.length,
    live: 0,
    human: 0,
    ai: 0,
    past: 0,
    future: 0
  };

  for (const event of events) {
    if (event.actorType === "HUMAN") {
      summary.human += 1;
    } else {
      summary.ai += 1;
    }
    const temporal = temporalState(event, nowMs);
    if (temporal === "LIVE") {
      summary.live += 1;
    } else if (temporal === "PAST") {
      summary.past += 1;
    } else {
      summary.future += 1;
    }
  }

  return summary;
}

function parseManualEventRecord(raw: unknown, orgId: string): ManualCalendarEventRecord {
  const record = asRecord(raw);
  const now = new Date().toISOString();
  const id = cleanText(record.id) || randomUUID();
  return {
    id,
    orgId,
    scope: normalizeScope(record.scope, "ORG"),
    userId: cleanText(record.userId) || null,
    title: clampText(cleanText(record.title) || `Calendar Event ${id.slice(0, 8)}`, 160),
    detail: clampText(cleanText(record.detail), 2500),
    startsAt: normalizeTimestamp(record.startsAt, now),
    endsAt: normalizeNullableTimestamp(record.endsAt),
    actorType: normalizeActorType(record.actorType, "HUMAN"),
    actorLabel: clampText(cleanText(record.actorLabel) || "Manual", 80),
    tags: normalizeTags(record.tags),
    createdByUserId: cleanText(record.createdByUserId) || null,
    createdByEmail: cleanText(record.createdByEmail).toLowerCase() || null,
    createdAt: normalizeTimestamp(record.createdAt, now),
    updatedAt: normalizeTimestamp(record.updatedAt, now)
  };
}

function manualEventToTimelineEvent(record: ManualCalendarEventRecord): CalendarTimelineEvent {
  const nowMs = Date.now();
  const startMs = new Date(record.startsAt).getTime();
  const endMs = record.endsAt ? new Date(record.endsAt).getTime() : startMs;
  const isLive = startMs <= nowMs && endMs >= nowMs;

  return {
    id: `manual-${record.id}`,
    orgId: record.orgId,
    scope: record.scope,
    ownerUserId: record.userId ?? record.createdByUserId,
    title: record.title,
    detail: record.detail,
    startsAt: record.startsAt,
    endsAt: record.endsAt,
    actorType: record.actorType,
    actorLabel: record.actorLabel,
    sourceKind: "manual",
    sourceLabel: "Manual Event",
    sourceId: record.id,
    live: isLive,
    tags: record.tags,
    pathway: null,
    references: {}
  };
}

async function listManualEventRows(input: {
  orgId: string;
  userId?: string;
  scope: CalendarScope;
}) {
  const where: Prisma.MemoryEntryWhereInput = {
    orgId: input.orgId,
    key: {
      startsWith: MANUAL_EVENT_KEY_PREFIX
    },
    redactedAt: null
  };

  if (input.scope === "ORG") {
    where.tier = MemoryTier.ORG;
  } else if (input.userId) {
    where.OR = [
      {
        tier: MemoryTier.ORG
      },
      {
        tier: MemoryTier.USER,
        userId: input.userId
      }
    ];
  } else {
    where.tier = MemoryTier.ORG;
  }

  return prisma.memoryEntry.findMany({
    where,
    orderBy: {
      updatedAt: "desc"
    },
    take: 500
  });
}

function manualEventAccessAllowed(input: {
  event: ManualCalendarEventRecord;
  actorUserId: string;
  isInternal: boolean;
}) {
  if (input.isInternal) {
    return true;
  }
  if (input.event.scope === "ORG") {
    return true;
  }
  return input.event.userId === input.actorUserId || input.event.createdByUserId === input.actorUserId;
}

export async function createManualCalendarEvent(
  input: CreateManualCalendarEventInput
) {
  const now = new Date().toISOString();
  const eventId = randomUUID();
  const scope = normalizeScope(input.scope, "ORG");
  const startsAt = normalizeTimestamp(input.startsAt, now);
  const endsAt = normalizeNullableTimestamp(input.endsAt);

  const record: ManualCalendarEventRecord = {
    id: eventId,
    orgId: input.orgId,
    scope,
    userId: scope === "USER" && !input.isInternal ? input.actorUserId : null,
    title: clampText(cleanText(input.title) || "Calendar entry", 160),
    detail: clampText(cleanText(input.detail), 2500),
    startsAt,
    endsAt,
    actorType: normalizeActorType(input.actorType, "HUMAN"),
    actorLabel: clampText(cleanText(input.actorLabel) || input.actorEmail || "Manual", 80),
    tags: normalizeTags(input.tags),
    createdByUserId: input.isInternal ? null : input.actorUserId,
    createdByEmail: input.isInternal ? "internal@vorldx.local" : input.actorEmail.toLowerCase(),
    createdAt: now,
    updatedAt: now
  };

  await prisma.memoryEntry.create({
    data: {
      orgId: input.orgId,
      userId: record.scope === "USER" ? record.userId : null,
      tier: record.scope === "USER" ? MemoryTier.USER : MemoryTier.ORG,
      key: manualEventKey(eventId),
      value: toInputJsonValue(record)
    }
  });

  return manualEventToTimelineEvent(record);
}

export async function updateManualCalendarEvent(
  input: UpdateManualCalendarEventInput
): Promise<UpdateManualEventResult> {
  const row = await prisma.memoryEntry.findFirst({
    where: {
      orgId: input.orgId,
      key: manualEventKey(input.eventId),
      redactedAt: null
    }
  });

  if (!row) {
    return { status: "NOT_FOUND" };
  }

  const current = parseManualEventRecord(row.value, input.orgId);
  if (
    !manualEventAccessAllowed({
      event: current,
      actorUserId: input.actorUserId,
      isInternal: input.isInternal
    })
  ) {
    return { status: "FORBIDDEN" };
  }

  const nextScope = normalizeScope(input.patch.scope, current.scope);
  const next: ManualCalendarEventRecord = {
    ...current,
    ...(input.patch.title !== undefined
      ? { title: clampText(cleanText(input.patch.title) || current.title, 160) }
      : {}),
    ...(input.patch.detail !== undefined
      ? { detail: clampText(cleanText(input.patch.detail), 2500) }
      : {}),
    ...(input.patch.startsAt !== undefined
      ? { startsAt: normalizeTimestamp(input.patch.startsAt, current.startsAt) }
      : {}),
    ...(input.patch.endsAt !== undefined
      ? { endsAt: normalizeNullableTimestamp(input.patch.endsAt) }
      : {}),
    ...(input.patch.actorType !== undefined
      ? { actorType: normalizeActorType(input.patch.actorType, current.actorType) }
      : {}),
    ...(input.patch.actorLabel !== undefined
      ? { actorLabel: clampText(cleanText(input.patch.actorLabel), 80) || current.actorLabel }
      : {}),
    ...(input.patch.tags !== undefined
      ? { tags: normalizeTags(input.patch.tags) }
      : {}),
    scope: nextScope,
    userId:
      nextScope === "USER"
        ? current.userId ?? (input.isInternal ? null : input.actorUserId)
        : null,
    updatedAt: new Date().toISOString()
  };

  await prisma.memoryEntry.update({
    where: {
      id: row.id
    },
    data: {
      tier: next.scope === "USER" ? MemoryTier.USER : MemoryTier.ORG,
      userId: next.scope === "USER" ? next.userId : null,
      value: toInputJsonValue(next)
    }
  });

  return {
    status: "UPDATED",
    event: manualEventToTimelineEvent(next)
  };
}

export async function deleteManualCalendarEvent(
  input: DeleteManualCalendarEventInput
): Promise<DeleteManualEventResult> {
  const row = await prisma.memoryEntry.findFirst({
    where: {
      orgId: input.orgId,
      key: manualEventKey(input.eventId),
      redactedAt: null
    }
  });

  if (!row) {
    return "NOT_FOUND";
  }

  const event = parseManualEventRecord(row.value, input.orgId);
  if (
    !manualEventAccessAllowed({
      event,
      actorUserId: input.actorUserId,
      isInternal: input.isInternal
    })
  ) {
    return "FORBIDDEN";
  }

  await prisma.memoryEntry.update({
    where: { id: row.id },
    data: {
      redactedAt: new Date(),
      value: Prisma.DbNull
    }
  });

  return "OK";
}

export async function listCalendarTimelineEvents(
  input: ListCalendarTimelineEventsInput
): Promise<CalendarTimelineResult> {
  const rangeStartIso = normalizeTimestamp(
    input.rangeStart,
    new Date(Date.now() - 7 * 86400000).toISOString()
  );
  const rangeEndIso = normalizeTimestamp(
    input.rangeEnd,
    new Date(Date.now() + 60 * 86400000).toISOString()
  );
  const rangeStartMs = new Date(rangeStartIso).getTime();
  const rangeEndMs = new Date(rangeEndIso).getTime();
  const flowDateRange = {
    gte: new Date(rangeStartMs - 45 * 86400000),
    lte: new Date(rangeEndMs + 45 * 86400000)
  };

  const [plans, directions, permissionRequests, schedules, flows, logs, manualRows] =
    await Promise.all([
      listPlans(input.orgId),
      listDirections(input.orgId),
      listOrgPermissionRequests(input.orgId),
      listMissionSchedules(input.orgId),
      prisma.flow.findMany({
        where: {
          orgId: input.orgId,
          OR: [{ createdAt: flowDateRange }, { updatedAt: flowDateRange }]
        },
        orderBy: { updatedAt: "desc" },
        take: 140,
        select: {
          id: true,
          prompt: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          tasks: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              prompt: true,
              status: true,
              createdAt: true,
              updatedAt: true,
              executionTrace: true,
              isPausedForInput: true,
              humanInterventionReason: true,
              agent: {
                select: {
                  id: true,
                  name: true,
                  role: true
                }
              }
            }
          }
        }
      }),
      prisma.log.findMany({
        where: {
          orgId: input.orgId,
          timestamp: flowDateRange
        },
        orderBy: { timestamp: "desc" },
        take: 240,
        select: {
          id: true,
          type: true,
          actor: true,
          message: true,
          timestamp: true
        }
      }),
      listManualEventRows({
        orgId: input.orgId,
        userId: input.userId,
        scope: input.scope
      })
    ]);

  const events: CalendarTimelineEvent[] = [];
  const seenEventIds = new Set<string>();
  const pushEvent = (event: CalendarTimelineEvent) => {
    if (seenEventIds.has(event.id)) {
      return;
    }
    seenEventIds.add(event.id);
    events.push(event);
  };

  for (const manualRow of manualRows) {
    const record = parseManualEventRecord(manualRow.value, input.orgId);
    pushEvent(manualEventToTimelineEvent(record));
  }

  for (const direction of directions) {
    const actorType = direction.source === "MANUAL" ? "HUMAN" : "AI";
    pushEvent({
      id: `command-${direction.id}`,
      orgId: input.orgId,
      scope: "ORG",
      ownerUserId: direction.ownerUserId,
      title: `Command: ${direction.title}`,
      detail: clampText(direction.summary || direction.direction, 1000),
      startsAt: direction.updatedAt,
      endsAt: null,
      actorType,
      actorLabel:
        direction.ownerName ||
        direction.ownerEmail ||
        (actorType === "HUMAN" ? "Human" : "AI Planner"),
      sourceKind: "command",
      sourceLabel: "Command",
      sourceId: direction.id,
      live: false,
      tags: ["command", direction.status.toLowerCase(), ...direction.tags.slice(0, 4)],
      pathway: null,
      references: {
        directionId: direction.id
      }
    });
  }

  for (const plan of plans) {
    const actorType = plan.source === "MANUAL" ? "HUMAN" : "AI";
    pushEvent({
      id: `plan-${plan.id}`,
      orgId: input.orgId,
      scope: "ORG",
      ownerUserId: null,
      title: `Plan: ${plan.title}`,
      detail: clampText(plan.summary || plan.direction, 1000),
      startsAt: plan.updatedAt,
      endsAt: null,
      actorType,
      actorLabel: actorType === "HUMAN" ? "Human Planner" : "AI Planner",
      sourceKind: "plan",
      sourceLabel: "Plan",
      sourceId: plan.id,
      live: false,
      tags: ["plan", plan.status.toLowerCase()],
      pathway: null,
      references: {
        planId: plan.id,
        directionId: plan.directionId ?? undefined
      }
    });

    const pathwaySteps = extractPathwayFromPlan(plan);
    for (const [index, step] of pathwaySteps.entries()) {
      pushEvent({
        id: `pathway-${plan.id}-${step.stepId}`,
        orgId: input.orgId,
        scope: "ORG",
        ownerUserId: null,
        title: `Pathway ${step.line}: ${step.taskTitle}`,
        detail: clampText(
          `Workflow: ${step.workflowTitle} | Owner: ${step.ownerRole} | Trigger: ${step.trigger} | Window: ${step.dueWindow}`,
          1000
        ),
        startsAt: derivePathwayStartAt(step, index, plan.updatedAt),
        endsAt: null,
        actorType: step.executionMode === "HUMAN" ? "HUMAN" : "AI",
        actorLabel: step.executionMode === "HUMAN" ? "Human Lane" : "Agent Lane",
        sourceKind: "pathway",
        sourceLabel: "Pathway",
        sourceId: `${plan.id}:${step.stepId}`,
        live: false,
        tags: [
          "pathway",
          step.executionMode.toLowerCase(),
          step.ownerRole.toLowerCase().replace(/\s+/g, "-")
        ],
        pathway: step,
        references: {
          planId: plan.id,
          directionId: plan.directionId ?? undefined
        }
      });
    }
  }

  for (const request of permissionRequests) {
    const isPending = request.status === "PENDING";
    pushEvent({
      id: `approval-request-${request.id}`,
      orgId: input.orgId,
      scope: "ORG",
      ownerUserId: request.requestedByUserId,
      title: `Approval Requested: ${request.area}`,
      detail: clampText(
        `${request.reason} | Workflow: ${request.workflowTitle || "N/A"} | Task: ${request.taskTitle || "N/A"}`,
        1000
      ),
      startsAt: request.createdAt,
      endsAt: null,
      actorType: "HUMAN",
      actorLabel: request.requestedByEmail || "Requester",
      sourceKind: "approval",
      sourceLabel: "Approval Request",
      sourceId: request.id,
      live: isPending,
      tags: ["approval", request.status.toLowerCase(), request.targetRole.toLowerCase()],
      pathway: null,
      references: {
        requestId: request.id,
        directionId: request.directionId ?? undefined,
        planId: request.planId ?? undefined
      }
    });

    if (request.decidedAt) {
      pushEvent({
        id: `approval-decision-${request.id}`,
        orgId: input.orgId,
        scope: "ORG",
        ownerUserId: request.decidedByUserId,
        title: `Approval ${request.status}: ${request.area}`,
        detail: clampText(request.decisionNote || request.reason, 900),
        startsAt: request.decidedAt,
        endsAt: null,
        actorType: "HUMAN",
        actorLabel: request.decidedByEmail || "Reviewer",
        sourceKind: "approval",
        sourceLabel: "Approval Decision",
        sourceId: request.id,
        live: false,
        tags: ["approval", request.status.toLowerCase()],
        pathway: null,
        references: {
          requestId: request.id,
          directionId: request.directionId ?? undefined,
          planId: request.planId ?? undefined
        }
      });
    }
  }

  for (const schedule of schedules) {
    pushEvent({
      id: `schedule-next-${schedule.id}`,
      orgId: input.orgId,
      scope: "ORG",
      ownerUserId: schedule.createdByUserId ?? null,
      title: `Scheduled Command: ${schedule.title}`,
      detail: clampText(
        `${schedule.direction} | Cadence: ${schedule.cadence} | Signatures: ${schedule.requiredSignatures} | Burn: ${schedule.predictedBurn}`,
        1000
      ),
      startsAt: schedule.nextRunAt,
      endsAt: null,
      actorType: "AI",
      actorLabel: "Scheduler",
      sourceKind: "schedule",
      sourceLabel: "Schedule",
      sourceId: schedule.id,
      live: schedule.enabled,
      tags: ["schedule", schedule.cadence.toLowerCase(), schedule.enabled ? "enabled" : "disabled"],
      pathway: null,
      references: {
        scheduleId: schedule.id,
        directionId: schedule.directionId
      }
    });

    if (schedule.lastRunAt) {
      pushEvent({
        id: `schedule-last-${schedule.id}`,
        orgId: input.orgId,
        scope: "ORG",
        ownerUserId: schedule.createdByUserId ?? null,
        title: `Schedule Executed: ${schedule.title}`,
        detail: clampText(schedule.direction, 900),
        startsAt: schedule.lastRunAt,
        endsAt: null,
        actorType: "AI",
        actorLabel: "Scheduler",
        sourceKind: "schedule",
        sourceLabel: "Schedule",
        sourceId: schedule.id,
        live: false,
        tags: ["schedule", "executed"],
        pathway: null,
        references: {
          scheduleId: schedule.id,
          directionId: schedule.directionId
        }
      });
    }
  }

  for (const flow of flows) {
    const flowOwnerFromTrace =
      flow.tasks
        .map((task) => parseInitiatedByUserId(task.executionTrace))
        .find((item): item is string => Boolean(item)) ?? null;
    const flowLive =
      flow.status === FlowStatus.ACTIVE ||
      flow.status === FlowStatus.QUEUED ||
      flow.status === FlowStatus.PAUSED;

    pushEvent({
      id: `flow-${flow.id}`,
      orgId: input.orgId,
      scope: "ORG",
      ownerUserId: flowOwnerFromTrace,
      title: `Workflow: ${clampText(compactText(flow.prompt) || `Flow ${flow.id.slice(0, 8)}`, 120)}`,
      detail: `Status: ${flow.status}. Tasks: ${flow.tasks.length}.`,
      startsAt: flow.createdAt.toISOString(),
      endsAt: flowLive ? null : flow.updatedAt.toISOString(),
      actorType: "AI",
      actorLabel: "Orchestrator",
      sourceKind: "flow",
      sourceLabel: "Workflow",
      sourceId: flow.id,
      live: flowLive,
      tags: ["workflow", flow.status.toLowerCase()],
      pathway: null,
      references: {
        flowId: flow.id
      }
    });

    for (const [index, task] of flow.tasks.slice(0, 40).entries()) {
      const taskPathway = parsePathwayFromExecutionTrace(task.executionTrace);
      const taskLive =
        task.status === TaskStatus.RUNNING ||
        task.status === TaskStatus.PAUSED ||
        task.status === TaskStatus.QUEUED ||
        task.isPausedForInput;
      const taskTime =
        task.status === TaskStatus.COMPLETED ||
        task.status === TaskStatus.FAILED ||
        task.status === TaskStatus.ABORTED
          ? task.updatedAt.toISOString()
          : task.createdAt.toISOString();
      const taskDetailParts = [
        clampText(compactText(task.prompt), 320),
        task.agent ? `Agent: ${task.agent.name} (${task.agent.role})` : "Agent: unassigned",
        task.humanInterventionReason ? `Human input: ${task.humanInterventionReason}` : ""
      ].filter(Boolean);

      pushEvent({
        id: `task-${task.id}`,
        orgId: input.orgId,
        scope: "ORG",
        ownerUserId: flowOwnerFromTrace,
        title:
          taskPathway?.taskTitle
            ? `Task: ${taskPathway.taskTitle}`
            : `Task ${index + 1} (${task.status.toLowerCase()})`,
        detail: clampText(taskDetailParts.join(" | "), 1200),
        startsAt: taskTime,
        endsAt: null,
        actorType: "AI",
        actorLabel: task.agent?.name || "Agent",
        sourceKind: "task",
        sourceLabel: "Task",
        sourceId: task.id,
        live: taskLive,
        tags: ["task", task.status.toLowerCase(), taskPathway ? "pathway" : "runtime"],
        pathway: taskPathway,
        references: {
          flowId: flow.id,
          taskId: task.id
        }
      });
    }
  }

  for (const log of logs) {
    const actorType = log.type === "USER" ? "HUMAN" : "AI";
    pushEvent({
      id: `log-${log.id}`,
      orgId: input.orgId,
      scope: "ORG",
      ownerUserId: null,
      title: `${log.actor || "System"} update`,
      detail: clampText(log.message, 900),
      startsAt: log.timestamp.toISOString(),
      endsAt: null,
      actorType,
      actorLabel: log.actor || "System",
      sourceKind: "log",
      sourceLabel: "Audit Log",
      sourceId: log.id,
      live: false,
      tags: ["log", log.type.toLowerCase()],
      pathway: null,
      references: {}
    });
  }

  const nowMs = Date.now();
  const filtered = events
    .filter((event) => eventIntersectsRange(event, rangeStartMs, rangeEndMs))
    .filter((event) => {
      if (input.scope === "ORG") {
        return event.scope === "ORG";
      }
      if (event.scope === "USER") {
        return !input.userId || event.ownerUserId === input.userId;
      }
      if (!input.userId) {
        return true;
      }
      return event.ownerUserId === null || event.ownerUserId === input.userId;
    })
    .filter((event) => {
      if (input.actor === "ALL") {
        return true;
      }
      return event.actorType === input.actor;
    })
    .filter((event) => {
      const temporal = temporalState(event, nowMs);
      if (input.liveOnly) {
        return temporal === "LIVE";
      }
      if (input.temporal === "ALL") {
        return true;
      }
      return temporal === input.temporal;
    })
    .sort((left, right) => {
      const leftMs = new Date(left.startsAt).getTime();
      const rightMs = new Date(right.startsAt).getTime();
      return leftMs - rightMs;
    });

  return {
    events: filtered,
    summary: computeSummary(filtered)
  };
}
