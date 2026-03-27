"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ChatHeader } from "@/components/chat-ui/chat-header";
import { ChatInput } from "@/components/chat-ui/chat-input";
import { ChatWindow } from "@/components/chat-ui/chat-window";
import { CollaborationPanel } from "@/components/chat-ui/collaboration-panel";
import { Sidebar } from "@/components/chat-ui/sidebar";
import { StringPanel } from "@/components/chat-ui/string-panel";
import type {
  ChatAttachment,
  ChatAudience,
  ChatMessage,
  ChatMention,
  ChatString,
  Collaborator,
  CollaboratorKind,
  DirectionPayload,
  MessageRouting,
  StringMode,
  Team
} from "@/components/chat-ui/types";

const DEFAULT_CHAT_TITLE = "New string";
const HISTORY_LIMIT = 10;
const COFOUNDER_MANAGER_NAME = "Main Agent";
const COFOUNDER_MANAGER_ROLE = "Organization interface";
const STRINGS_UPDATED_EVENT = "vx:strings-updated";
const DEFAULT_CHAT_AUDIENCE: ChatAudience = { kind: "everyone" };

interface MentionableEntity {
  id: string;
  label: string;
  handle: string;
  kind: "team" | "person";
  collaboratorKind?: CollaboratorKind;
}

interface AudienceOption {
  value: string;
  label: string;
  group: "General" | "Teams" | "People";
}

interface JsonEnvelope {
  ok?: boolean;
  message?: string;
}

interface HubFileUploadResponse extends JsonEnvelope {
  file?: {
    id: string;
    name: string;
    url: string;
    size: string;
  };
}

interface PreparedAttachment {
  file: File;
  preview: string;
}

interface StringApiResponse extends JsonEnvelope {
  strings?: ChatString[];
  string?: ChatString;
}

interface DirectionRecord {
  id: string;
  title: string;
  summary: string;
  direction: string;
  updatedAt: string;
  createdAt: string;
}

interface PlanPrimary {
  summary?: string;
  detailScore?: number;
  workflows?: Array<{
    title?: string;
    ownerRole?: string;
    tasks?: Array<{ title?: string }>;
    deliverables?: string[];
    successMetrics?: string[];
  }>;
}

interface PlanRecord {
  id: string;
  title: string;
  summary: string;
  direction: string;
  directionId: string | null;
  primaryPlan?: PlanPrimary;
  updatedAt: string;
  createdAt: string;
}

interface DirectionsResponse extends JsonEnvelope {
  directions?: DirectionRecord[];
}

interface PlansResponse extends JsonEnvelope {
  plans?: PlanRecord[];
}

interface HubTeamRecord {
  id: string;
  name: string;
  description?: string;
  memberUserIds?: string[];
  personnelIds?: string[];
  createdAt: string;
  updatedAt: string;
}

interface HubMemberRecord {
  userId: string;
  username: string;
  email: string;
  roleLabel?: string;
  isActiveOrganization?: boolean;
}

interface HubPersonnelRecord {
  id: string;
  name: string;
  type: "HUMAN" | "AI";
  role: string;
  status: string;
}

type OrgActorRole = "FOUNDER" | "ADMIN" | "EMPLOYEE" | "INTERNAL";

interface HubOrganizationResponse extends JsonEnvelope {
  actor?: {
    userId?: string;
    activeTeamId?: string | null;
    role?: OrgActorRole | null;
  };
  members?: HubMemberRecord[];
  personnel?: HubPersonnelRecord[];
  collaboration?: {
    teams?: HubTeamRecord[];
  };
}

interface StringActionApiResponse extends JsonEnvelope {
  result?: {
    flowIds?: string[];
    flowsAborted?: number;
    tasksAborted?: number;
    locksReleased?: number;
  };
  activeFlowIds?: string[];
}

interface DirectionChatApiResponse extends JsonEnvelope {
  reply?: string;
  directionCandidate?: string;
  intentRouting?: {
    route: "CHAT_RESPONSE" | "PLAN_REQUIRED";
    reason?: string;
    toolkitHints?: string[];
  };
  tokenUsage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  } | null;
  model?: {
    provider?: string | null;
    name?: string | null;
    source?: string | null;
  } | null;
}

interface DirectionPlanApiResponse extends JsonEnvelope {
  analysis?: string;
  directionGiven?: string;
  primaryPlan?: PlanPrimary;
  requiredToolkits?: string[];
  requestCount?: number;
  directionRecord?: {
    id: string;
  } | null;
  planRecord?: {
    id: string;
  } | null;
  tokenUsage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  } | null;
  model?: {
    provider?: string | null;
    name?: string | null;
    source?: string | null;
  } | null;
}

interface ParticipantRepliesApiResponse extends JsonEnvelope {
  replies?: ChatMessage[];
}

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;
}

function modeLabel(mode: StringMode) {
  return mode === "direction" ? "Direction" : "Discussion";
}

function createTimelineEventMessage(input: {
  title: string;
  message: string;
  content?: string;
  eventName: string;
  scope: "MODE" | "MEMBERSHIP" | "PLANNING" | "EXECUTION" | "COLLABORATION";
  status?: string;
  createdAt?: string;
}): ChatMessage {
  const createdAt = input.createdAt ?? nowIso();
  const timestamp = new Date(createdAt).getTime();

  return {
    id: createId("timeline"),
    role: "system",
    content: input.content?.trim() || input.title,
    createdAt,
    authorName: "System",
    authorRole: "Timeline update",
    meta: {
      kind: "thread_event",
      title: input.title,
      message: input.message,
      eventName: input.eventName,
      scope: input.scope,
      ...(input.status ? { status: input.status } : {}),
      ...(Number.isFinite(timestamp) && timestamp > 0 ? { timestamp } : {})
    }
  };
}

function memberKey(userId: string) {
  return `member:${userId}`;
}

function toMs(value: string | undefined) {
  const parsed = new Date(value ?? "").getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function sortChats(chats: ChatString[]) {
  return [...chats].sort((left, right) => toMs(right.updatedAt) - toMs(left.updatedAt));
}

function trimTitle(value: string, fallback = DEFAULT_CHAT_TITLE) {
  const next = value.replace(/\s+/g, " ").trim();
  if (!next) {
    return fallback;
  }
  return next.length > 56 ? `${next.slice(0, 53)}...` : next;
}

function titleFromMessage(content: string) {
  return trimTitle(content, DEFAULT_CHAT_TITLE);
}

function truncateText(value: string, max: number, fallback = DEFAULT_CHAT_TITLE) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return fallback;
  }
  return normalized.length > max ? `${normalized.slice(0, Math.max(0, max - 3))}...` : normalized;
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function clipAttachmentText(value: string, max: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length > max
    ? `${normalized.slice(0, Math.max(0, max - 3)).trimEnd()}...`
    : normalized;
}

function hasPreviewableText(file: File) {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return (
    type.startsWith("text/") ||
    type.includes("json") ||
    type.includes("xml") ||
    name.endsWith(".md") ||
    name.endsWith(".txt") ||
    name.endsWith(".csv") ||
    name.endsWith(".ts") ||
    name.endsWith(".tsx") ||
    name.endsWith(".js") ||
    name.endsWith(".jsx")
  );
}

async function prepareAttachment(file: File): Promise<PreparedAttachment> {
  if (!hasPreviewableText(file)) {
    return {
      file,
      preview: ""
    };
  }

  try {
    const preview = clipAttachmentText(await file.text(), 480);
    return {
      file,
      preview
    };
  } catch {
    return {
      file,
      preview: ""
    };
  }
}

function attachmentContextLine(attachment: ChatAttachment, preview = "") {
  const header = `- ${attachment.name}${attachment.sizeLabel ? ` (${attachment.sizeLabel})` : ""}`;
  const ref = `  Hub ref: ${attachment.url}`;
  const body = preview ? `  Preview: ${preview}` : "";
  return [header, ref, body].filter(Boolean).join("\n");
}

function buildAttachmentRequestContent(
  content: string,
  attachments: ChatAttachment[],
  prepared: PreparedAttachment[]
) {
  if (attachments.length === 0) {
    return content;
  }

  const baseContent =
    content.trim() || `Please review the attached file${attachments.length === 1 ? "" : "s"}.`;
  const lines = attachments.map((attachment, index) =>
    attachmentContextLine(attachment, prepared[index]?.preview ?? "")
  );
  return `${baseContent}\n\nAttached files:\n${lines.join("\n")}`.trim();
}

function summarizeMessageForHistory(message: ChatMessage) {
  const base = message.content.trim();
  if (!message.attachments?.length) {
    return base;
  }

  const attachmentSummary = `Attached files: ${message.attachments
    .map((attachment) => attachment.name)
    .join(", ")}`;
  return [base, attachmentSummary].filter(Boolean).join("\n");
}

function fallbackEmail(name: string, id: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
  return `${slug || `member-${id.slice(-6)}`}@workspace.local`;
}

function createEmptyChat(team: Team | null): ChatString {
  const timestamp = nowIso();

  return {
    id: createId("string"),
    title: DEFAULT_CHAT_TITLE,
    mode: "discussion",
    updatedAt: timestamp,
    createdAt: timestamp,
    selectedTeamId: team?.id ?? null,
    selectedTeamLabel: team?.name ?? null,
    activeAudience: DEFAULT_CHAT_AUDIENCE,
    source: "workspace",
    persisted: false,
    messages: []
  };
}

function normalizeAudience(
  audience: ChatAudience | null | undefined,
  teams: Team[],
  collaborators: Collaborator[]
): ChatAudience {
  if (!audience || audience.kind === "everyone") {
    return DEFAULT_CHAT_AUDIENCE;
  }

  if (audience.kind === "team") {
    const team = teams.find((item) => item.id === audience.id) ?? null;
    return team
      ? {
          kind: "team",
          id: team.id,
          label: team.name
        }
      : DEFAULT_CHAT_AUDIENCE;
  }

  const collaborator = collaborators.find((item) => item.id === audience.id) ?? null;
  return collaborator
    ? {
        kind: "person",
        id: collaborator.id,
        label: collaborator.name
      }
    : DEFAULT_CHAT_AUDIENCE;
}

function audienceToValue(audience: ChatAudience | null | undefined) {
  if (audience?.kind === "team" && audience.id) {
    return `team:${audience.id}`;
  }
  if (audience?.kind === "person" && audience.id) {
    return `person:${audience.id}`;
  }
  return "everyone";
}

function buildAudienceOptions(input: {
  teams: Team[];
  collaborators: Collaborator[];
  actorMemberId: string | null;
}): AudienceOption[] {
  const options: AudienceOption[] = [
    {
      value: "everyone",
      label: "Everyone",
      group: "General"
    }
  ];

  options.push(
    ...input.teams.map((team) => ({
      value: `team:${team.id}`,
      label: team.name,
      group: "Teams" as const
    }))
  );

  options.push(
    ...input.collaborators
      .filter((collaborator) => collaborator.id !== input.actorMemberId)
      .map((collaborator) => ({
        value: `person:${collaborator.id}`,
        label: collaborator.name,
        group: "People" as const
      }))
  );

  return options;
}

function slugifyHandle(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

function uniqueHandle(baseLabel: string, used: Set<string>, fallbackPrefix: string) {
  const base = slugifyHandle(baseLabel) || fallbackPrefix;
  let candidate = base;
  let counter = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  used.add(candidate);
  return candidate;
}

function buildMentionables(input: {
  teams: Team[];
  collaborators: Collaborator[];
}): MentionableEntity[] {
  const usedHandles = new Set<string>();
  const teamMentionables = input.teams.map((team) => ({
    id: team.id,
    label: team.name,
    handle: uniqueHandle(team.name, usedHandles, "team"),
    kind: "team" as const
  }));
  const collaboratorMentionables = input.collaborators.map((collaborator) => ({
    id: collaborator.id,
    label: collaborator.name,
    handle: uniqueHandle(collaborator.name, usedHandles, collaborator.kind === "AI" ? "agent" : "person"),
    kind: "person" as const,
    ...(collaborator.kind ? { collaboratorKind: collaborator.kind } : {})
  }));

  return [...teamMentionables, ...collaboratorMentionables];
}

function currentMentionQuery(value: string) {
  const match = value.match(/(?:^|\s)@([a-z0-9._-]*)$/i);
  return match ? match[1].toLowerCase() : null;
}

function resolveMentions(value: string, mentionables: MentionableEntity[]): ChatMention[] {
  const matches = [...value.matchAll(/(?:^|\s)@([a-z0-9][a-z0-9._-]*)/gi)];
  const byHandle = new Map(mentionables.map((item) => [item.handle.toLowerCase(), item] as const));
  const seen = new Set<string>();

  return matches
    .map((match) => match[1]?.toLowerCase() ?? "")
    .filter((handle) => {
      if (!handle || seen.has(handle)) {
        return false;
      }
      seen.add(handle);
      return true;
    })
    .map((handle) => {
      const entity = byHandle.get(handle);
      if (!entity) {
        return null;
      }
      return {
        id: entity.id,
        label: entity.label,
        handle: entity.handle,
        kind: entity.kind,
        ...(entity.collaboratorKind ? { collaboratorKind: entity.collaboratorKind } : {})
      } satisfies ChatMention;
    })
    .filter((item): item is ChatMention => Boolean(item));
}

function insertMention(value: string, handle: string) {
  const nextToken = `@${handle} `;
  if (!value.trim()) {
    return nextToken;
  }
  if (/(?:^|\s)@([a-z0-9._-]*)$/i.test(value)) {
    return value.replace(/(?:^|\s)@([a-z0-9._-]*)$/i, (match) => {
      const prefix = match.startsWith(" ") ? " " : "";
      return `${prefix}${nextToken}`;
    });
  }
  return `${value}${value.endsWith(" ") ? "" : " "}${nextToken}`;
}

function buildParticipantHistory(messages: ChatMessage[]) {
  return messages
    .filter((message) => message.meta?.kind !== "thread_event" && message.meta?.kind !== "workflow_event")
    .slice(-HISTORY_LIMIT)
    .map((message) => ({
      role: message.role,
      content: summarizeMessageForHistory(message).slice(0, 1200),
      ...(message.authorName ? { authorName: message.authorName } : {}),
      ...(message.authorRole ? { authorRole: message.authorRole } : {}),
      ...(message.teamLabel ? { teamLabel: message.teamLabel } : {})
    }));
}

function toDirectionPayload(
  objective: string,
  primary: PlanPrimary,
  requiredToolkits?: string[],
  approvalCount?: number,
  teamName?: string | null
): DirectionPayload {
  const workflows = Array.isArray(primary.workflows) ? primary.workflows : [];
  const steps = workflows.slice(0, 6).map((workflow, index) => {
    const tasks = (workflow.tasks ?? [])
      .map((task) => task.title?.trim() || "")
      .filter(Boolean)
      .slice(0, 5);
    const actions = [...(workflow.deliverables ?? []), ...(workflow.successMetrics ?? [])]
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 4);

    return {
      id: createId("step"),
      title: truncateText(workflow.title || "Execution workflow", 72, "Execution workflow"),
      owner: workflow.ownerRole?.trim() || "Owner",
      status: (index === 0 ? "in_progress" : "todo") as "in_progress" | "todo",
      tasks: tasks.length > 0 ? tasks : ["Break the work into executable tasks"],
      actions: actions.length > 0 ? actions : ["Review output against the objective"]
    };
  });

  return {
    objective: truncateText(objective, 220, "Structured direction"),
    ...(primary.summary ? { summary: primary.summary } : {}),
    ...(teamName ? { teamName } : {}),
    ...(typeof primary.detailScore === "number"
      ? { detailScore: Math.max(0, Math.min(100, Math.floor(primary.detailScore))) }
      : {}),
    ...(requiredToolkits && requiredToolkits.length > 0
      ? { requiredToolkits: requiredToolkits.slice(0, 10) }
      : {}),
    ...(typeof approvalCount === "number" ? { approvalCount: Math.max(0, approvalCount) } : {}),
    nextAction:
      steps[0]?.title
        ? `Start with "${steps[0].title}" and confirm the owner.`
        : "Confirm the first owner and execution checkpoint.",
    steps:
      steps.length > 0
        ? steps
        : [
            {
              id: createId("step"),
              title: "Execution planning",
              owner: "Owner",
              status: "in_progress",
              tasks: ["Define the first workflow"],
              actions: ["Review checkpoints"]
            }
          ]
  };
}

function toHistory(messages: ChatMessage[]) {
  return messages
    .filter((message) => message.meta?.kind !== "thread_event" && message.meta?.kind !== "workflow_event")
    .slice(-HISTORY_LIMIT)
    .map((message) => ({
      role: message.role === "user" ? "owner" : "organization",
      content: summarizeMessageForHistory(message).slice(0, 1200)
    }));
}

async function parseResponse<T>(response: Response) {
  const rawText = await response.text();
  let payload: T | null = null;

  if (rawText) {
    try {
      payload = JSON.parse(rawText) as T;
    } catch {
      payload = null;
    }
  }

  return { payload, rawText };
}

function failMsg(
  status: number,
  fallback: string,
  payloadMessage?: string,
  rawText?: string
) {
  if (payloadMessage?.trim()) {
    return payloadMessage;
  }
  if (rawText?.trim()) {
    return `${fallback} (${status}): ${rawText.slice(0, 160)}`;
  }
  return `${fallback} (${status}).`;
}

function mapCollaborationWorkspace(payload: HubOrganizationResponse) {
  const members = Array.isArray(payload.members) ? payload.members : [];
  const personnel = Array.isArray(payload.personnel) ? payload.personnel : [];
  const teamRows = Array.isArray(payload.collaboration?.teams) ? payload.collaboration?.teams : [];
  const teamNamesByMemberId = new Map<string, string[]>();

  for (const team of teamRows) {
    const memberIds = [
      ...(team.memberUserIds ?? []).map((userId) => memberKey(userId)),
      ...(team.personnelIds ?? [])
    ];

    for (const memberId of memberIds) {
      const current = teamNamesByMemberId.get(memberId) ?? [];
      if (!current.includes(team.name)) {
        teamNamesByMemberId.set(memberId, [...current, team.name]);
      }
    }
  }

  const collaborators: Collaborator[] = [
    ...members.map((member) => ({
      id: memberKey(member.userId),
      name: member.username,
      email: member.email,
      role: member.roleLabel || "Member",
      kind: "HUMAN" as const,
      online: member.isActiveOrganization ?? true,
      source: "presence" as const,
      ...(teamNamesByMemberId.get(memberKey(member.userId))?.length
        ? { teamNames: teamNamesByMemberId.get(memberKey(member.userId)) }
        : {})
    })),
    ...personnel.map((person) => ({
      id: person.id,
      name: person.name,
      email: fallbackEmail(person.name, person.id),
      role: person.role,
      kind: person.type === "AI" ? ("AI" as const) : ("HUMAN" as const),
      online: person.status !== "DISABLED",
      source: "squad" as const,
      ...(teamNamesByMemberId.get(person.id)?.length
        ? { teamNames: teamNamesByMemberId.get(person.id) }
        : {})
    }))
  ];

  const teams: Team[] = teamRows.map((team) => ({
    id: team.id,
    name: team.name,
    type: "team",
    memberIds: [
      ...(team.memberUserIds ?? []).map((userId) => memberKey(userId)),
      ...(team.personnelIds ?? [])
    ],
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
    focus: team.description || "Workforce collaboration"
  }));

  return {
    collaborators,
    teams,
    actorUserId: payload.actor?.userId?.trim() || null,
    actorMemberId: payload.actor?.userId ? memberKey(payload.actor.userId) : null,
    actorRole: payload.actor?.role ?? null,
    activeTeamId: payload.actor?.activeTeamId ?? null
  };
}

function buildDerivedStrings(
  strings: ChatString[],
  directions: DirectionRecord[],
  plans: PlanRecord[],
  options?: {
    includeStandaloneDerived?: boolean;
  }
) {
  if (!options?.includeStandaloneDerived) {
    return sortChats(strings);
  }

  const knownDirectionIds = new Set(
    strings
      .flatMap((item) => [
        item.directionId ?? "",
        item.id.startsWith("direction:") ? item.id.slice("direction:".length) : ""
      ])
      .filter(Boolean)
  );
  const knownPlanIds = new Set(
    strings
      .flatMap((item) => [
        item.planId ?? "",
        item.id.startsWith("plan:") ? item.id.slice("plan:".length) : ""
      ])
      .filter(Boolean)
  );

  const latestPlanByDirection = new Map<string, PlanRecord>();
  for (const plan of plans) {
    if (!plan.directionId) {
      continue;
    }
    const existing = latestPlanByDirection.get(plan.directionId);
    if (!existing || toMs(plan.updatedAt) > toMs(existing.updatedAt)) {
      latestPlanByDirection.set(plan.directionId, plan);
    }
  }

  const directionStrings = directions
    .filter((direction) => !knownDirectionIds.has(direction.id))
    .map<ChatString>((direction) => {
      const linkedPlan = latestPlanByDirection.get(direction.id) ?? null;
      const createdAt = direction.createdAt || nowIso();
      const updatedAt = linkedPlan?.updatedAt || direction.updatedAt || createdAt;
      const messages: ChatMessage[] = [
        {
          id: createId("message"),
          role: "system",
          content: direction.summary || direction.direction || "Direction loaded.",
          createdAt,
          authorName: COFOUNDER_MANAGER_NAME,
          authorRole: COFOUNDER_MANAGER_ROLE
        }
      ];

      if (linkedPlan?.primaryPlan) {
        messages.push({
          id: createId("message"),
          role: "system",
          content: linkedPlan.summary || "Execution plan linked to this direction.",
          createdAt: linkedPlan.createdAt || updatedAt,
          authorName: COFOUNDER_MANAGER_NAME,
          authorRole: "Direction lead",
          direction: toDirectionPayload(direction.direction || direction.title, linkedPlan.primaryPlan),
          routing: {
            route: "PLAN_REQUIRED",
            reason: "Execution plan loaded from backend."
          }
        });
      }

      return {
        id: `direction:${direction.id}`,
        title: truncateText(direction.title || direction.direction || "Direction", 72, "Direction"),
        mode: "direction",
        updatedAt,
        createdAt,
        directionId: direction.id,
        planId: linkedPlan?.id ?? null,
        source: linkedPlan ? "plan" : "direction",
        persisted: true,
        messages
      };
    });

  const orphanPlanStrings = plans
    .filter((plan) => !plan.directionId && !knownPlanIds.has(plan.id))
    .map<ChatString>((plan) => ({
      id: `plan:${plan.id}`,
      title: truncateText(plan.title || plan.direction || "Execution plan", 72, "Execution plan"),
      mode: "direction",
      updatedAt: plan.updatedAt || plan.createdAt || nowIso(),
      createdAt: plan.createdAt || nowIso(),
      planId: plan.id,
      source: "plan",
      persisted: true,
      messages: [
        {
          id: createId("message"),
          role: "system",
          content: plan.summary || "Execution plan loaded.",
          createdAt: plan.createdAt || nowIso(),
          authorName: COFOUNDER_MANAGER_NAME,
          authorRole: "Direction lead",
          direction: toDirectionPayload(plan.direction || plan.title, plan.primaryPlan || {})
        }
      ]
    }));

  return sortChats([...strings, ...directionStrings, ...orphanPlanStrings]);
}

function normalizeChatString(value: ChatString): ChatString {
  return {
    ...value,
    title: trimTitle(value.title || DEFAULT_CHAT_TITLE),
    mode: value.mode === "direction" ? "direction" : "discussion",
    updatedAt: value.updatedAt || nowIso(),
    createdAt: value.createdAt || value.updatedAt || nowIso(),
    selectedTeamId: value.selectedTeamId ?? null,
    selectedTeamLabel: value.selectedTeamLabel ?? null,
    activeAudience: value.activeAudience ?? DEFAULT_CHAT_AUDIENCE,
    source: value.source ?? "workspace",
    persisted: value.persisted ?? true,
    messages: Array.isArray(value.messages) ? value.messages : []
  };
}

function normalizeText(value: string | null | undefined) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizeIdList(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const next: string[] = [];

  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    next.push(normalized);
  }

  return next;
}

function readStringMembership(chat: ChatString | null) {
  const state = chat?.workspaceState;

  return {
    linkedTeamIds: Array.isArray(state?.linkedTeamIds)
      ? normalizeIdList(state.linkedTeamIds)
      : [],
    linkedParticipantIds: Array.isArray(state?.linkedParticipantIds)
      ? normalizeIdList(state.linkedParticipantIds)
      : [],
    excludedParticipantIds: Array.isArray(state?.excludedParticipantIds)
      ? normalizeIdList(state.excludedParticipantIds)
      : []
  };
}

function buildWorkspaceStateWithMembership(
  chat: ChatString,
  membership: {
    linkedTeamIds: string[];
    linkedParticipantIds: string[];
    excludedParticipantIds: string[];
  }
) {
  const current = chat.workspaceState;
  const nextState: NonNullable<ChatString["workspaceState"]> = {
    ...(current?.editableDraft ? { editableDraft: current.editableDraft } : {}),
    ...(current?.scoreRecords?.length ? { scoreRecords: current.scoreRecords } : {}),
    ...(current?.steerDecisions && Object.keys(current.steerDecisions).length > 0
      ? { steerDecisions: current.steerDecisions }
      : {}),
    ...(membership.linkedTeamIds.length > 0 ? { linkedTeamIds: membership.linkedTeamIds } : {}),
    ...(membership.linkedParticipantIds.length > 0
      ? { linkedParticipantIds: membership.linkedParticipantIds }
      : {}),
    ...(membership.excludedParticipantIds.length > 0
      ? { excludedParticipantIds: membership.excludedParticipantIds }
      : {})
  };

  return Object.keys(nextState).length > 0 ? nextState : undefined;
}

function buildStringDescription(chat: ChatString | null) {
  if (!chat) {
    return "";
  }

  const directionSummary = [...chat.messages]
    .reverse()
    .map((message) => normalizeText(message.direction?.summary))
    .find(Boolean);
  const directionObjective = [...chat.messages]
    .reverse()
    .map((message) => normalizeText(message.direction?.objective))
    .find(Boolean);
  const latestOrganizationTurn = [...chat.messages]
    .reverse()
    .filter((message) => message.meta?.kind !== "thread_event" && message.meta?.kind !== "workflow_event")
    .map((message) => normalizeText(message.content))
    .find(Boolean);
  const firstOwnerTurn = chat.messages
    .map((message) => (message.role === "user" ? normalizeText(message.content) : ""))
    .find(Boolean);

  return directionSummary || directionObjective || firstOwnerTurn || latestOrganizationTurn || "";
}

export function StringChatShell({
  embedded = false,
  orgId = null,
  stringPanelOpen,
  onStringPanelOpenChange,
  collaborationPanelOpen,
  onCollaborationPanelOpenChange
}: {
  embedded?: boolean;
  orgId?: string | null;
  stringPanelOpen?: boolean;
  onStringPanelOpenChange?: (open: boolean) => void;
  collaborationPanelOpen?: boolean;
  onCollaborationPanelOpenChange?: (open: boolean) => void;
}) {
  const [chats, setChats] = useState<ChatString[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [mode, setMode] = useState<StringMode>("discussion");
  const [draft, setDraft] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [activeAudience, setActiveAudience] = useState<ChatAudience>(DEFAULT_CHAT_AUDIENCE);
  const [teams, setTeams] = useState<Team[]>([]);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [currentActorUserId, setCurrentActorUserId] = useState<string | null>(null);
  const [actorMemberId, setActorMemberId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [internalStringPanelOpen, setInternalStringPanelOpen] = useState(false);
  const [internalCollaborationPanelOpen, setInternalCollaborationPanelOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [stringActionInFlight, setStringActionInFlight] = useState<"delete" | "kill" | null>(null);

  const loadVersionRef = useRef(0);
  const activeChat = chats.find((chat) => chat.id === activeChatId) ?? chats[0] ?? null;
  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? null;
  const resolvedAudience = useMemo(
    () => normalizeAudience(activeAudience, teams, collaborators),
    [activeAudience, collaborators, teams]
  );
  const isStringPanelControlled = typeof stringPanelOpen === "boolean";
  const resolvedStringPanelOpen = isStringPanelControlled
    ? Boolean(stringPanelOpen)
    : internalStringPanelOpen;
  const dockStringPanel = embedded;
  const isCollaborationPanelControlled = typeof collaborationPanelOpen === "boolean";
  const resolvedCollaborationPanelOpen = isCollaborationPanelControlled
    ? Boolean(collaborationPanelOpen)
    : internalCollaborationPanelOpen;
  const filteredChats = chats.filter((chat) => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return true;
    }

    return (
      chat.title.toLowerCase().includes(query) ||
      chat.messages.some((message) => message.content.toLowerCase().includes(query))
    );
  });
  const activeStringDescription = useMemo(
    () => buildStringDescription(activeChat),
    [activeChat]
  );
  const mentionables = useMemo(
    () =>
      buildMentionables({
        teams,
        collaborators
      }),
    [collaborators, teams]
  );
  const mentionQuery = useMemo(() => currentMentionQuery(draft), [draft]);
  const mentionSuggestions = useMemo(() => {
    if (mentionQuery === null) {
      return [];
    }

    return mentionables
      .filter(
        (item) =>
          mentionQuery.length === 0 ||
          item.handle.toLowerCase().includes(mentionQuery) ||
          item.label.toLowerCase().includes(mentionQuery)
      )
      .slice(0, 6);
  }, [mentionQuery, mentionables]);
  const audienceOptions = useMemo(
    () =>
      buildAudienceOptions({
        teams,
        collaborators,
        actorMemberId
      }),
    [actorMemberId, collaborators, teams]
  );
  const actorCollaborator = useMemo(
    () => collaborators.find((participant) => participant.id === actorMemberId) ?? null,
    [actorMemberId, collaborators]
  );
  const canManageActiveString = Boolean(
    activeChat?.persisted &&
      currentActorUserId &&
      activeChat.createdByUserId &&
      activeChat.createdByUserId === currentActorUserId
  );
  const canKillActiveStringProcess = Boolean(
    canManageActiveString && (activeChat?.directionId || activeChat?.planId)
  );
  const stringMembership = useMemo(() => readStringMembership(activeChat), [activeChat]);
  const linkedStringTeamIds = stringMembership.linkedTeamIds;
  const linkedStringParticipantIds = stringMembership.linkedParticipantIds;
  const excludedStringParticipantIds = stringMembership.excludedParticipantIds;
  const stringParticipants = useMemo(() => {
    const byParticipant = new Map<string, Collaborator>();
    const excludedParticipantIds = new Set(excludedStringParticipantIds);
    const addParticipant = (participant: Collaborator | null | undefined) => {
      if (!participant) {
        return;
      }
      const key =
        participant.id ||
        participant.email.trim().toLowerCase() ||
        participant.name.trim().toLowerCase();
      if (!key || excludedParticipantIds.has(key) || byParticipant.has(key)) {
        return;
      }
      byParticipant.set(key, participant);
    };
    const routedTeam = teams.find((team) => team.id === activeChat?.selectedTeamId) ?? null;
    const linkedTeams = linkedStringTeamIds
      .map((teamId) => teams.find((team) => team.id === teamId) ?? null)
      .filter((team): team is Team => Boolean(team));

    routedTeam?.memberIds.forEach((memberId) => {
      addParticipant(collaborators.find((participant) => participant.id === memberId));
    });
    linkedTeams.forEach((team) => {
      team.memberIds.forEach((memberId) => {
        addParticipant(collaborators.find((participant) => participant.id === memberId));
      });
    });
    linkedStringParticipantIds.forEach((participantId) => {
      addParticipant(collaborators.find((participant) => participant.id === participantId));
    });
    addParticipant(
      actorMemberId ? collaborators.find((participant) => participant.id === actorMemberId) : null
    );

    activeChat?.messages.forEach((message) => {
      if (message.role === "user") {
        if (!actorMemberId) {
          addParticipant({
            id: "string-owner",
            name: "You",
            email: "",
            role: "Owner",
            kind: "HUMAN",
            online: true,
            source: "system"
          });
        }
        return;
      }

      if (message.meta?.kind === "thread_event" || message.meta?.kind === "workflow_event") {
        return;
      }

      const authorName = normalizeText(message.authorName);
      if (!authorName) {
        return;
      }

      const matchedCollaborator =
        (message.authorId
          ? collaborators.find((participant) => participant.id === message.authorId)
          : null) ??
        collaborators.find(
          (participant) => participant.name.trim().toLowerCase() === authorName.toLowerCase()
        ) ??
        collaborators.find(
          (participant) => participant.email.trim().toLowerCase() === authorName.toLowerCase()
        );

      if (matchedCollaborator) {
        addParticipant(matchedCollaborator);
        return;
      }

      addParticipant({
        id: `string-participant:${authorName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        name: authorName,
        email: "",
        role:
          normalizeText(message.authorRole) ||
          (message.role === "assistant" ? "AI collaborator" : "Workspace system"),
        kind: message.role === "assistant" ? "AI" : "HUMAN",
        online: true,
        source: "system"
      });
    });

    activeChat?.messages.forEach((message) => {
      if (message.audience?.kind === "person" && message.audience.id) {
        addParticipant(collaborators.find((participant) => participant.id === message.audience?.id));
      }

      message.mentions?.forEach((mention) => {
        if (mention.kind === "person") {
          addParticipant(collaborators.find((participant) => participant.id === mention.id));
        }
      });
    });

    return [...byParticipant.values()].sort((left, right) =>
      left.name.localeCompare(right.name)
    );
  }, [
    activeChat,
    actorMemberId,
    collaborators,
    excludedStringParticipantIds,
    linkedStringParticipantIds,
    linkedStringTeamIds,
    teams
  ]);

  const handleStringPanelOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!isStringPanelControlled) {
        setInternalStringPanelOpen(nextOpen);
      }
      if (nextOpen) {
        if (!isCollaborationPanelControlled) {
          setInternalCollaborationPanelOpen(false);
        }
        onCollaborationPanelOpenChange?.(false);
      }
      onStringPanelOpenChange?.(nextOpen);
    },
    [
      isCollaborationPanelControlled,
      isStringPanelControlled,
      onCollaborationPanelOpenChange,
      onStringPanelOpenChange
    ]
  );

  const handleCollaborationPanelOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!isCollaborationPanelControlled) {
        setInternalCollaborationPanelOpen(nextOpen);
      }
      if (nextOpen) {
        if (!isStringPanelControlled) {
          setInternalStringPanelOpen(false);
        }
        onStringPanelOpenChange?.(false);
      }
      onCollaborationPanelOpenChange?.(nextOpen);
    },
    [
      isCollaborationPanelControlled,
      isStringPanelControlled,
      onCollaborationPanelOpenChange,
      onStringPanelOpenChange
    ]
  );

  useEffect(() => {
    if (!activeChat) {
      return;
    }

    setMode(activeChat.mode);
    setActiveAudience(normalizeAudience(activeChat.activeAudience, teams, collaborators));

    if (activeChat.selectedTeamId && activeChat.selectedTeamId !== selectedTeamId) {
      setSelectedTeamId(activeChat.selectedTeamId);
      return;
    }

    if (!activeChat.selectedTeamId && !selectedTeamId && teams.length > 0) {
      setSelectedTeamId(teams[0]?.id ?? null);
    }
  }, [activeChat, collaborators, selectedTeamId, teams]);

  useEffect(() => {
    if (activeChatId || chats.length === 0) {
      return;
    }

    setActiveChatId(chats[0].id);
  }, [activeChatId, chats]);

  useEffect(() => {
    if (!selectedTeamId) {
      return;
    }

    if (!teams.some((team) => team.id === selectedTeamId)) {
      setSelectedTeamId(teams[0]?.id ?? null);
    }
  }, [selectedTeamId, teams]);

  const loadWorkspace = useCallback(async () => {
    const currentLoadId = loadVersionRef.current + 1;
    loadVersionRef.current = currentLoadId;

    if (!orgId) {
      setChats([]);
      setActiveChatId(null);
      setTeams([]);
      setCollaborators([]);
      setCurrentActorUserId(null);
      setActorMemberId(null);
      setSelectedTeamId(null);
      setLoading(false);
      setSending(false);
      setStringActionInFlight(null);
      setError(null);
      setStatusText(null);
      return;
    }

    setLoading(true);
    setError(null);
    setStatusText("Switching string workspace...");
    setChats([]);
    setActiveChatId(null);
    setTeams([]);
    setCollaborators([]);
    setCurrentActorUserId(null);
    setActorMemberId(null);
    setSelectedTeamId(null);
    setMode("discussion");
    setDraft("");
    setSelectedFiles([]);
    setSearchQuery("");
    setSidebarOpen(false);
    handleStringPanelOpenChange(false);
    handleCollaborationPanelOpenChange(false);
    setSending(false);
    setStringActionInFlight(null);

    try {
      const [stringsResponse, directionsResponse, plansResponse, hubResponse] =
        await Promise.all([
          fetch(`/api/strings?orgId=${encodeURIComponent(orgId)}`, {
            cache: "no-store",
            credentials: "include"
          }),
          fetch(`/api/directions?orgId=${encodeURIComponent(orgId)}`, {
            cache: "no-store",
            credentials: "include"
          }),
          fetch(`/api/plans?orgId=${encodeURIComponent(orgId)}`, {
            cache: "no-store",
            credentials: "include"
          }),
          fetch(`/api/hub/organization?orgId=${encodeURIComponent(orgId)}`, {
            cache: "no-store",
            credentials: "include"
          })
        ]);

      const [
        { payload: stringsPayload, rawText: stringsRaw },
        { payload: directionsPayload, rawText: directionsRaw },
        { payload: plansPayload, rawText: plansRaw },
        { payload: hubPayload, rawText: hubRaw }
      ] = await Promise.all([
        parseResponse<StringApiResponse>(stringsResponse),
        parseResponse<DirectionsResponse>(directionsResponse),
        parseResponse<PlansResponse>(plansResponse),
        parseResponse<HubOrganizationResponse>(hubResponse)
      ]);

      if (!stringsResponse.ok || !stringsPayload?.ok) {
        throw new Error(
          failMsg(stringsResponse.status, "Failed to load strings", stringsPayload?.message, stringsRaw)
        );
      }
      if (!directionsResponse.ok || !directionsPayload?.ok) {
        throw new Error(
          failMsg(
            directionsResponse.status,
            "Failed to load directions",
            directionsPayload?.message,
            directionsRaw
          )
        );
      }
      if (!plansResponse.ok || !plansPayload?.ok) {
        throw new Error(
          failMsg(plansResponse.status, "Failed to load plans", plansPayload?.message, plansRaw)
        );
      }
      if (!hubResponse.ok || !hubPayload?.ok) {
        throw new Error(
          failMsg(hubResponse.status, "Failed to load collaboration", hubPayload?.message, hubRaw)
        );
      }

      if (loadVersionRef.current !== currentLoadId) {
        return;
      }

      const persistedStrings = Array.isArray(stringsPayload.strings)
        ? stringsPayload.strings.map((item) => normalizeChatString(item))
        : [];
      const directions = Array.isArray(directionsPayload.directions)
        ? directionsPayload.directions
        : [];
      const plans = Array.isArray(plansPayload.plans) ? plansPayload.plans : [];
      const collaborationWorkspace = mapCollaborationWorkspace(hubPayload);
      const hydratedStrings = buildDerivedStrings(persistedStrings, directions, plans, {
        includeStandaloneDerived: collaborationWorkspace.actorRole === "FOUNDER"
      });
      const initialTeam =
        collaborationWorkspace.teams.find(
          (team) => team.id === collaborationWorkspace.activeTeamId
        ) ??
        collaborationWorkspace.teams[0] ??
        null;
      const nextStrings =
        hydratedStrings.length > 0 ? hydratedStrings : [createEmptyChat(initialTeam)];

      setCollaborators(collaborationWorkspace.collaborators);
      setTeams(collaborationWorkspace.teams);
      setCurrentActorUserId(collaborationWorkspace.actorUserId);
      setActorMemberId(collaborationWorkspace.actorMemberId);
      setChats(nextStrings);
      setActiveChatId((current) =>
        current && nextStrings.some((item) => item.id === current)
          ? current
          : nextStrings[0]?.id ?? null
      );
      setSelectedTeamId(
        collaborationWorkspace.activeTeamId ?? nextStrings[0]?.selectedTeamId ?? initialTeam?.id ?? null
      );
      setStatusText(
        `Synced ${nextStrings.length} strings, ${collaborationWorkspace.collaborators.length} collaborators, and ${collaborationWorkspace.teams.length} teams.`
      );
    } catch (nextError) {
      if (loadVersionRef.current !== currentLoadId) {
        return;
      }

      const fallbackChat = createEmptyChat(null);
      setChats([fallbackChat]);
      setActiveChatId(fallbackChat.id);
      setTeams([]);
      setCollaborators([]);
      setCurrentActorUserId(null);
      setActorMemberId(null);
      setSelectedTeamId(null);
      setError(nextError instanceof Error ? nextError.message : "Failed to load string workspace.");
      setStatusText(null);
    } finally {
      if (loadVersionRef.current === currentLoadId) {
        setLoading(false);
      }
    }
  }, [handleCollaborationPanelOpenChange, handleStringPanelOpenChange, orgId]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  async function persistChat(chat: ChatString) {
    if (!orgId) {
      return chat;
    }

    const response = await fetch("/api/strings", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        orgId,
        id: chat.id,
        title: chat.title,
        mode: chat.mode,
        updatedAt: chat.updatedAt,
        createdAt: chat.createdAt,
        directionId: chat.directionId ?? null,
        planId: chat.planId ?? null,
        selectedTeamId: chat.selectedTeamId ?? null,
        selectedTeamLabel: chat.selectedTeamLabel ?? null,
        activeAudience: chat.activeAudience ?? DEFAULT_CHAT_AUDIENCE,
        source: chat.source ?? "workspace",
        workspaceState: chat.workspaceState ?? null,
        messages: chat.messages
      })
    });
    const { payload, rawText } = await parseResponse<StringApiResponse>(response);

    if (!response.ok || !payload?.ok || !payload.string) {
      throw new Error(failMsg(response.status, "Failed to save string", payload?.message, rawText));
    }

    const persisted = normalizeChatString(payload.string);
    setChats((current) =>
      sortChats(current.map((item) => (item.id === persisted.id ? persisted : item)))
    );

    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(STRINGS_UPDATED_EVENT, {
          detail: {
            orgId,
            stringId: persisted.id
          }
        })
      );
    }

    return persisted;
  }

  async function persistActiveTeam(teamId: string | null) {
    if (!orgId) {
      return;
    }

    const response = await fetch("/api/hub/organization", {
      method: "PATCH",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        orgId,
        collaborationAction: "SET_ACTIVE_TEAM",
        activeTeamId: teamId ?? ""
      })
    });
    const { payload, rawText } = await parseResponse<JsonEnvelope>(response);

    if (!response.ok || !payload?.ok) {
      throw new Error(
        failMsg(response.status, "Failed to update active team", payload?.message, rawText)
      );
    }
  }

  function replaceChat(nextChat: ChatString) {
    setChats((current) =>
      sortChats([
        normalizeChatString(nextChat),
        ...current.filter((item) => item.id !== nextChat.id)
      ])
    );
  }

  function updateStringMembership(
    updater: (current: {
      linkedTeamIds: string[];
      linkedParticipantIds: string[];
      excludedParticipantIds: string[];
    }) => {
      linkedTeamIds: string[];
      linkedParticipantIds: string[];
      excludedParticipantIds: string[];
      selectedTeamId?: string | null;
      selectedTeamLabel?: string | null;
      activeAudience?: ChatAudience;
    },
    timelineEvent?: {
      title: string;
      message: string;
      content?: string;
      eventName: string;
    }
  ) {
    if (!activeChat) {
      return;
    }

    const currentMembership = readStringMembership(activeChat);
    const nextMembership = updater(currentMembership);
    const updatedAt = nowIso();
    const timelineMessage = timelineEvent
      ? createTimelineEventMessage({
          ...timelineEvent,
          scope: "MEMBERSHIP",
          createdAt: updatedAt
        })
      : null;
    const nextChat: ChatString = {
      ...activeChat,
      ...(nextMembership.selectedTeamId !== undefined
        ? { selectedTeamId: nextMembership.selectedTeamId }
        : {}),
      ...(nextMembership.selectedTeamLabel !== undefined
        ? { selectedTeamLabel: nextMembership.selectedTeamLabel }
        : {}),
      ...(nextMembership.activeAudience !== undefined
        ? { activeAudience: nextMembership.activeAudience }
        : {}),
      workspaceState: buildWorkspaceStateWithMembership(activeChat, {
        linkedTeamIds: normalizeIdList(nextMembership.linkedTeamIds),
        linkedParticipantIds: normalizeIdList(nextMembership.linkedParticipantIds),
        excludedParticipantIds: normalizeIdList(nextMembership.excludedParticipantIds)
      }),
      updatedAt,
      messages: timelineMessage ? [...activeChat.messages, timelineMessage] : activeChat.messages
    };

    if (nextMembership.selectedTeamId !== undefined) {
      setSelectedTeamId(nextMembership.selectedTeamId ?? null);
    }
    if (nextMembership.activeAudience !== undefined) {
      setActiveAudience(nextMembership.activeAudience);
    }

    replaceChat(nextChat);
    void persistChat(nextChat).catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : "Failed to update string membership.");
    });
  }

  function updateActiveAudience(nextAudience: ChatAudience, options?: { syncTeam?: boolean }) {
    const normalized = normalizeAudience(nextAudience, teams, collaborators);
    setActiveAudience(normalized);

    if (!activeChat) {
      return normalized;
    }

    const routedTeam =
      normalized.kind === "team"
        ? teams.find((team) => team.id === normalized.id) ?? null
        : null;
    const nextChat: ChatString = {
      ...activeChat,
      activeAudience: normalized,
      ...(options?.syncTeam
        ? {
            selectedTeamId: routedTeam?.id ?? activeChat.selectedTeamId ?? null,
            selectedTeamLabel: routedTeam?.name ?? activeChat.selectedTeamLabel ?? null
          }
        : {}),
      updatedAt: nowIso()
    };

    replaceChat(nextChat);
    void persistChat(nextChat).catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : "Failed to save chat audience.");
    });

    return normalized;
  }

  async function fetchParticipantReplies(input: {
    message: string;
    history: ChatMessage[];
    audience: ChatAudience;
    mentions: ChatMention[];
    teamLabel?: string | null;
    threadId: string;
  }) {
    if (!orgId) {
      return [] as ChatMessage[];
    }

    const response = await fetch("/api/strings/participant-replies", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        orgId,
        threadId: input.threadId,
        message: input.message,
        history: buildParticipantHistory(input.history),
        audience: input.audience,
        mentions: input.mentions,
        teamLabel: input.teamLabel ?? ""
      })
    });
    const { payload, rawText } = await parseResponse<ParticipantRepliesApiResponse>(response);

    if (!response.ok || !payload?.ok) {
      throw new Error(
        failMsg(
          response.status,
          "AI teammate replies failed",
          payload?.message,
          rawText
        )
      );
    }

    return Array.isArray(payload.replies)
      ? payload.replies.map((reply) => ({
          ...reply,
          authorKind: "AI" as const
        }))
      : [];
  }

  function handleSelectChat(chatId: string) {
    setActiveChatId(chatId);
    setSelectedFiles([]);
    setSidebarOpen(false);
    handleStringPanelOpenChange(false);
    handleCollaborationPanelOpenChange(false);
  }

  function handleNewChat() {
    const baseTeam = teams.find((team) => team.id === selectedTeamId) ?? teams[0] ?? null;
    const nextChat = createEmptyChat(baseTeam);
    setChats((current) => sortChats([nextChat, ...current]));
    setActiveChatId(nextChat.id);
    setMode("discussion");
    setActiveAudience(DEFAULT_CHAT_AUDIENCE);
    setDraft("");
    setSelectedFiles([]);
    setSidebarOpen(false);
    handleStringPanelOpenChange(false);
    handleCollaborationPanelOpenChange(false);
    setError(null);
    void persistChat(nextChat).catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : "Failed to save string.");
    });
  }

  function handleTitleChange(value: string) {
    if (!activeChat) {
      return;
    }

    setChats((current) =>
      current.map((chat) =>
        chat.id === activeChat.id
          ? {
              ...chat,
              title: value
            }
          : chat
      )
    );
  }

  function handleTitleBlur() {
    if (!activeChat) {
      return;
    }

    const nextChat = {
      ...activeChat,
      title: trimTitle(activeChat.title),
      updatedAt: nowIso()
    };
    replaceChat(nextChat);
    void persistChat(nextChat).catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : "Failed to save string title.");
    });
  }

  function handleModeChange(nextMode: StringMode) {
    setMode(nextMode);

    if (!activeChat) {
      return;
    }

    if (activeChat.mode === nextMode) {
      return;
    }

    const updatedAt = nowIso();
    const timelineMessage = createTimelineEventMessage({
      title: `Moved To ${modeLabel(nextMode)}`,
      message: `String mode changed from ${modeLabel(activeChat.mode).toLowerCase()} to ${modeLabel(nextMode).toLowerCase()}.`,
      content: `Moved to ${modeLabel(nextMode).toLowerCase()}.`,
      eventName: nextMode === "direction" ? "thread.mode.direction" : "thread.mode.discussion",
      scope: "MODE",
      createdAt: updatedAt
    });

    const nextChat = {
      ...activeChat,
      mode: nextMode,
      updatedAt,
      messages: [...activeChat.messages, timelineMessage]
    };
    replaceChat(nextChat);
    setStatusText(`Moved to ${modeLabel(nextMode).toLowerCase()}.`);
    void persistChat(nextChat).catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : "Failed to save string mode.");
    });
  }

  function handleAddTeamToString(teamId: string) {
    const nextTeam = teams.find((team) => team.id === teamId) ?? null;
    if (!nextTeam || !activeChat) {
      return;
    }
    const current = readStringMembership(activeChat);
    if (current.linkedTeamIds.includes(nextTeam.id)) {
      return;
    }

    updateStringMembership((current) => ({
      linkedTeamIds: normalizeIdList([...current.linkedTeamIds, nextTeam.id]),
      linkedParticipantIds: current.linkedParticipantIds,
      excludedParticipantIds: current.excludedParticipantIds
    }), {
      title: "Team Added",
      message: `${nextTeam.name} was added to this string.`,
      content: `${nextTeam.name} added to this string.`,
      eventName: "thread.team.added"
    });
    setStatusText(`${nextTeam.name} added to this string.`);
  }

  function handleRemoveTeamFromString(teamId: string) {
    const team = teams.find((item) => item.id === teamId) ?? null;
    if (!activeChat) {
      return;
    }
    const current = readStringMembership(activeChat);
    if (!current.linkedTeamIds.includes(teamId)) {
      return;
    }
    const shouldClearSelectedTeam = activeChat?.selectedTeamId === teamId;
    const shouldClearAudience =
      activeChat?.activeAudience?.kind === "team" && activeChat.activeAudience.id === teamId;

    updateStringMembership((current) => ({
      linkedTeamIds: current.linkedTeamIds.filter((id) => id !== teamId),
      linkedParticipantIds: current.linkedParticipantIds,
      excludedParticipantIds: current.excludedParticipantIds,
      ...(shouldClearSelectedTeam ? { selectedTeamId: null, selectedTeamLabel: null } : {}),
      ...(shouldClearAudience ? { activeAudience: DEFAULT_CHAT_AUDIENCE } : {})
    }), {
      title: "Team Removed",
      message: `${team?.name ?? "Team"} was removed from this string.`,
      content: `${team?.name ?? "Team"} removed from this string.`,
      eventName: "thread.team.removed"
    });
    setStatusText(`${team?.name ?? "Team"} removed from this string.`);
  }

  function handleAddParticipantToString(participantId: string) {
    const participant = collaborators.find((item) => item.id === participantId) ?? null;
    if (!participant || !activeChat) {
      return;
    }
    const current = readStringMembership(activeChat);
    if (current.linkedParticipantIds.includes(participant.id)) {
      return;
    }

    updateStringMembership((current) => ({
      linkedTeamIds: current.linkedTeamIds,
      linkedParticipantIds: normalizeIdList([...current.linkedParticipantIds, participant.id]),
      excludedParticipantIds: current.excludedParticipantIds.filter((id) => id !== participant.id)
    }), {
      title: "Participant Added",
      message: `${participant.name} was added to this string.`,
      content: `${participant.name} added to this string.`,
      eventName: "thread.participant.added"
    });
    setStatusText(`${participant.name} added to this string.`);
  }

  function handleRemoveParticipantFromString(participantId: string) {
    if (!activeChat) {
      return;
    }
    const current = readStringMembership(activeChat);
    if (!current.linkedParticipantIds.includes(participantId)) {
      return;
    }
    const participant =
      stringParticipants.find((item) => item.id === participantId) ??
      collaborators.find((item) => item.id === participantId) ??
      null;
    const shouldClearAudience =
      activeChat?.activeAudience?.kind === "person" && activeChat.activeAudience.id === participantId;

    updateStringMembership((current) => ({
      linkedTeamIds: current.linkedTeamIds,
      linkedParticipantIds: current.linkedParticipantIds.filter((id) => id !== participantId),
      excludedParticipantIds: normalizeIdList([...current.excludedParticipantIds, participantId]),
      ...(shouldClearAudience ? { activeAudience: DEFAULT_CHAT_AUDIENCE } : {})
    }), {
      title: "Participant Removed",
      message: `${participant?.name ?? "Participant"} was removed from this string.`,
      content: `${participant?.name ?? "Participant"} removed from this string.`,
      eventName: "thread.participant.removed"
    });
    setStatusText(`${participant?.name ?? "Participant"} removed from this string.`);
  }

  function handleAudienceChange(value: string) {
    if (value === "everyone") {
      updateActiveAudience(DEFAULT_CHAT_AUDIENCE);
      return;
    }

    if (value.startsWith("team:")) {
      const teamId = value.slice("team:".length);
      const team = teams.find((item) => item.id === teamId) ?? null;
      if (!team) {
        updateActiveAudience(DEFAULT_CHAT_AUDIENCE);
        return;
      }
      setSelectedTeamId(team.id);
      updateActiveAudience(
        {
          kind: "team",
          id: team.id,
          label: team.name
        },
        { syncTeam: true }
      );
      if (!actorMemberId || team.memberIds.includes(actorMemberId)) {
        void persistActiveTeam(team.id).catch((nextError) => {
          setError(nextError instanceof Error ? nextError.message : "Failed to update active team.");
        });
      }
      return;
    }

    if (value.startsWith("person:")) {
      const collaboratorId = value.slice("person:".length);
      const collaborator = collaborators.find((item) => item.id === collaboratorId) ?? null;
      updateActiveAudience(
        collaborator
          ? {
              kind: "person",
              id: collaborator.id,
              label: collaborator.name
            }
          : DEFAULT_CHAT_AUDIENCE
      );
    }
  }

  function handleInsertMention(handle: string) {
    setDraft((current) => insertMention(current, handle));
  }

  async function uploadSelectedChatFiles(files: File[]) {
    if (!orgId || files.length === 0) {
      return [] as ChatAttachment[];
    }

    const uploaded: ChatAttachment[] = [];
    for (const file of files) {
      const formData = new FormData();
      formData.set("orgId", orgId);
      formData.set("type", "INPUT");
      formData.set("name", file.name);
      formData.set("isAmnesiaProtected", "false");
      formData.set("file", file);

      const response = await fetch("/api/hub/files", {
        method: "POST",
        credentials: "include",
        body: formData
      });
      const { payload, rawText } = await parseResponse<HubFileUploadResponse>(response);
      if (!response.ok || !payload?.ok || !payload.file) {
        throw new Error(
          failMsg(response.status, `Failed to upload ${file.name}`, payload?.message, rawText)
        );
      }

      uploaded.push({
        id: payload.file.id,
        name: payload.file.name,
        url: payload.file.url,
        sizeLabel: formatFileSize(Number(payload.file.size))
      });
    }

    return uploaded;
  }

  async function sendMessage(teamId = selectedTeamId, audienceOverride = resolvedAudience) {
    const targetChat = activeChat;
    const content = draft.trim();

    if (!orgId || !targetChat || (!content && selectedFiles.length === 0) || sending) {
      return;
    }

    const selectedMode = mode;
    const messageAudience = normalizeAudience(audienceOverride, teams, collaborators);
    const selectedRoutingTeam = teams.find((team) => team.id === teamId) ?? null;
    const audienceTeam =
      messageAudience.kind === "team"
        ? teams.find((team) => team.id === messageAudience.id) ?? selectedRoutingTeam
        : null;
    const resolvedMentions = resolveMentions(content, mentionables);
    const directAudienceCollaborator =
      messageAudience.kind === "person"
        ? collaborators.find((collaborator) => collaborator.id === messageAudience.id) ?? null
        : null;
    const hasDirectAiPersonMention = resolvedMentions.some(
      (mention) => mention.kind === "person" && mention.collaboratorKind === "AI"
    );
    const shouldRequestParticipantReplies =
      messageAudience.kind === "team" ||
      resolvedMentions.some(
        (mention) => mention.kind === "team" || mention.collaboratorKind === "AI"
      ) || directAudienceCollaborator?.kind === "AI";
    const shouldUseOrganizationReply =
      selectedMode === "direction" ||
      (messageAudience.kind === "everyone" && !hasDirectAiPersonMention);
    const visibleContent =
      content || `Shared ${selectedFiles.length} file${selectedFiles.length === 1 ? "" : "s"}.`;
    let optimisticChat: ChatString | null = null;

    setSending(true);
    handleStringPanelOpenChange(false);
    handleCollaborationPanelOpenChange(false);
    setError(null);

    try {
      const preparedAttachments = await Promise.all(selectedFiles.map((file) => prepareAttachment(file)));
      const uploadedAttachments = await uploadSelectedChatFiles(selectedFiles);
      const requestContent = buildAttachmentRequestContent(
        content,
        uploadedAttachments,
        preparedAttachments
      );
      const timestamp = nowIso();
      const userMessage: ChatMessage = {
      id: createId("message"),
      role: "user",
      content: visibleContent,
      createdAt: timestamp,
      ...(actorCollaborator?.id ? { authorId: actorCollaborator.id } : {}),
      ...(actorCollaborator?.name ? { authorName: actorCollaborator.name } : {}),
      ...(actorCollaborator?.role ? { authorRole: actorCollaborator.role } : {}),
      authorKind: actorCollaborator?.kind ?? "HUMAN",
      teamId: audienceTeam?.id ?? null,
      teamLabel: audienceTeam?.name ?? null,
      audience: messageAudience,
      ...(resolvedMentions.length > 0 ? { mentions: resolvedMentions } : {}),
      ...(uploadedAttachments.length > 0 ? { attachments: uploadedAttachments } : {})
    };

      optimisticChat = {
      ...targetChat,
      title:
        targetChat.title === DEFAULT_CHAT_TITLE
          ? titleFromMessage(content || uploadedAttachments[0]?.name || "Shared files")
          : targetChat.title,
      mode: selectedMode,
      updatedAt: timestamp,
      activeAudience: messageAudience,
      selectedTeamId: selectedRoutingTeam?.id ?? targetChat.selectedTeamId ?? null,
      selectedTeamLabel: selectedRoutingTeam?.name ?? targetChat.selectedTeamLabel ?? null,
      messages: [...targetChat.messages, userMessage]
      };

      replaceChat(optimisticChat);
      setDraft("");
      setSelectedFiles([]);
      setActiveAudience(messageAudience);

      const userPersistPromise = persistChat(optimisticChat).catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : "Failed to save string.");
      return optimisticChat;
      });

      const followUps: ChatMessage[] = [];
      let organizationRouting: MessageRouting | undefined;
      let directionId = optimisticChat.directionId ?? null;
      let planId = optimisticChat.planId ?? null;
      let directionText = "";

      if (shouldUseOrganizationReply) {
        const chatStartedAt = performance.now();
        const chatResponse = await fetch("/api/control/direction-chat", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            orgId,
            message: requestContent,
            history: toHistory(optimisticChat.messages),
            teamLabel: audienceTeam?.name ?? "",
            audienceLabel:
              messageAudience.kind === "everyone" ? "" : messageAudience.label ?? messageAudience.kind,
            mentionLabels: resolvedMentions.map((mention) => mention.label)
          })
        });
        const chatLatency = Math.round(performance.now() - chatStartedAt);
        const { payload: chatPayload, rawText: chatRaw } =
          await parseResponse<DirectionChatApiResponse>(chatResponse);

        if (!chatResponse.ok || !chatPayload?.ok || !chatPayload.reply) {
          throw new Error(
            failMsg(chatResponse.status, "Discussion request failed", chatPayload?.message, chatRaw)
          );
        }

        organizationRouting = chatPayload.intentRouting
          ? {
              route: chatPayload.intentRouting.route,
              ...(chatPayload.intentRouting.reason
                ? { reason: chatPayload.intentRouting.reason }
                : {}),
              ...(Array.isArray(chatPayload.intentRouting.toolkitHints)
                ? { toolkitHints: chatPayload.intentRouting.toolkitHints }
                : {})
            }
          : undefined;
        directionText = (chatPayload.directionCandidate || requestContent).trim();

        followUps.push({
          id: createId("message"),
          role: "system",
          content: chatPayload.reply,
          createdAt: nowIso(),
          authorId: "main-agent",
          authorName: COFOUNDER_MANAGER_NAME,
          authorRole: COFOUNDER_MANAGER_ROLE,
          authorKind: "AI",
          teamId: audienceTeam?.id ?? null,
          teamLabel: audienceTeam?.name ?? null,
          audience: messageAudience,
          ...(resolvedMentions.length > 0 ? { mentions: resolvedMentions } : {}),
          ...(organizationRouting ? { routing: organizationRouting } : {}),
          metrics: {
            latencyMs: Math.max(0, chatLatency),
            ...(typeof chatPayload.tokenUsage?.promptTokens === "number"
              ? { promptTokens: chatPayload.tokenUsage.promptTokens }
              : {}),
            ...(typeof chatPayload.tokenUsage?.completionTokens === "number"
              ? { completionTokens: chatPayload.tokenUsage.completionTokens }
              : {}),
            ...(typeof chatPayload.tokenUsage?.totalTokens === "number"
              ? { totalTokens: chatPayload.tokenUsage.totalTokens }
              : {}),
            ...(chatPayload.model?.provider ? { provider: chatPayload.model.provider } : {}),
            ...(chatPayload.model?.name ? { model: chatPayload.model.name } : {}),
            ...(chatPayload.model?.source ? { source: chatPayload.model.source } : {})
          }
        });
      }

      const participantReplies = shouldRequestParticipantReplies
        ? await fetchParticipantReplies({
            message: requestContent,
            history: [...optimisticChat.messages, ...followUps],
            audience: messageAudience,
            mentions: resolvedMentions,
            teamLabel: audienceTeam?.name ?? null,
            threadId: targetChat.id
          }).catch((nextError) => {
            setStatusText(
              nextError instanceof Error
              ? nextError.message
                : "AI teammate replies are unavailable right now."
            );
            return [] as ChatMessage[];
          })
        : [];
      followUps.push(...participantReplies);

      const shouldPlan =
        shouldUseOrganizationReply &&
        (selectedMode === "direction" || organizationRouting?.route === "PLAN_REQUIRED");

      if (shouldPlan && directionText) {
        const planStartedAt = performance.now();
        const planResponse = await fetch("/api/control/direction-plan", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            orgId,
            direction: directionText,
            threadId: targetChat.id,
            history: toHistory([...optimisticChat.messages, ...followUps]),
            humanPlan: ""
          })
        });
        const planLatency = Math.round(performance.now() - planStartedAt);
        const { payload: planPayload, rawText: planRaw } =
          await parseResponse<DirectionPlanApiResponse>(planResponse);

        if (planResponse.ok && planPayload?.ok && planPayload.primaryPlan) {
          directionId = planPayload.directionRecord?.id ?? directionId;
          planId = planPayload.planRecord?.id ?? planId;

          followUps.push({
            id: createId("message"),
            role: "system",
            content: planPayload.analysis || "Execution plan generated and linked.",
            createdAt: nowIso(),
            authorId: "main-agent",
            authorName: COFOUNDER_MANAGER_NAME,
            authorRole: "Direction lead",
            authorKind: "AI",
            teamId: audienceTeam?.id ?? null,
            teamLabel: audienceTeam?.name ?? null,
            audience: messageAudience,
            ...(resolvedMentions.length > 0 ? { mentions: resolvedMentions } : {}),
            direction: toDirectionPayload(
              planPayload.directionGiven || directionText,
              planPayload.primaryPlan,
              planPayload.requiredToolkits,
              planPayload.requestCount,
              audienceTeam?.name ?? null
            ),
            routing: {
              route: "PLAN_REQUIRED",
              reason: "Direction plan generated from this message.",
              toolkitHints: planPayload.requiredToolkits ?? []
            },
            metrics: {
              latencyMs: Math.max(0, planLatency),
              ...(typeof planPayload.tokenUsage?.promptTokens === "number"
                ? { promptTokens: planPayload.tokenUsage.promptTokens }
                : {}),
              ...(typeof planPayload.tokenUsage?.completionTokens === "number"
                ? { completionTokens: planPayload.tokenUsage.completionTokens }
                : {}),
              ...(typeof planPayload.tokenUsage?.totalTokens === "number"
                ? { totalTokens: planPayload.tokenUsage.totalTokens }
                : {}),
              ...(planPayload.model?.provider ? { provider: planPayload.model.provider } : {}),
              ...(planPayload.model?.name ? { model: planPayload.model.name } : {}),
              ...(planPayload.model?.source ? { source: planPayload.model.source } : {})
            }
          });
        } else {
          followUps.push({
            id: createId("message"),
            role: "system",
            content: failMsg(
              planResponse.status,
              "Direction planning failed",
              planPayload?.message,
              planRaw
            ),
            createdAt: nowIso(),
            authorName: "System",
            authorRole: "Workspace notice",
            teamId: audienceTeam?.id ?? null,
            teamLabel: audienceTeam?.name ?? null,
            audience: messageAudience,
            ...(resolvedMentions.length > 0 ? { mentions: resolvedMentions } : {}),
            error: true
          });
        }
      }

      await userPersistPromise;

      const finalChat: ChatString = {
        ...optimisticChat,
        updatedAt: followUps[followUps.length - 1]?.createdAt ?? optimisticChat.updatedAt,
        directionId,
        planId,
        messages: [...optimisticChat.messages, ...followUps]
      };
      replaceChat(finalChat);
      await persistChat(finalChat);
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : "Failed to send message.";
      setError(message);

      if (!optimisticChat) {
        return;
      }

      const failedChat: ChatString = {
        ...optimisticChat,
        updatedAt: nowIso(),
        messages: [
          ...optimisticChat.messages,
          {
            id: createId("message"),
            role: "system",
            content: message,
            createdAt: nowIso(),
            authorName: "System",
            authorRole: "Workspace notice",
            teamId: audienceTeam?.id ?? null,
            teamLabel: audienceTeam?.name ?? null,
            audience: messageAudience,
            ...(resolvedMentions.length > 0 ? { mentions: resolvedMentions } : {}),
            error: true
          }
        ]
      };
      replaceChat(failedChat);
      void persistChat(failedChat).catch(() => undefined);
    } finally {
      setSending(false);
    }
  }

  function handleDiscussWithTeam() {
    handleModeChange("discussion");
    handleStringPanelOpenChange(false);
    handleCollaborationPanelOpenChange(false);

    if (selectedTeam) {
      updateActiveAudience(
        {
          kind: "team",
          id: selectedTeam.id,
          label: selectedTeam.name
        },
        { syncTeam: true }
      );
    }

    if (!draft.trim() && selectedTeam) {
      setDraft(`Discuss with @${mentionables.find((item) => item.kind === "team" && item.id === selectedTeam.id)?.handle ?? selectedTeam.name}: `);
    }
  }

  function handleSetDirection() {
    handleModeChange("direction");
    handleStringPanelOpenChange(false);
    handleCollaborationPanelOpenChange(false);

    if (selectedTeam) {
      updateActiveAudience(
        {
          kind: "team",
          id: selectedTeam.id,
          label: selectedTeam.name
        },
        { syncTeam: true }
      );
    }

    if (!draft.trim() && selectedTeam) {
      setDraft(`Direction for @${mentionables.find((item) => item.kind === "team" && item.id === selectedTeam.id)?.handle ?? selectedTeam.name}: `);
    }
  }

  async function handleDeleteString() {
    if (!orgId || !activeChat || stringActionInFlight) {
      return;
    }

    if (
      typeof window !== "undefined" &&
      !window.confirm("Delete this string? If it has a linked running process, kill that process first.")
    ) {
      return;
    }

    setStringActionInFlight("delete");
    setError(null);

    try {
      const response = await fetch(
        `/api/strings/${encodeURIComponent(activeChat.id)}?orgId=${encodeURIComponent(orgId)}`,
        {
          method: "DELETE",
          credentials: "include"
        }
      );
      const { payload, rawText } = await parseResponse<StringActionApiResponse>(response);

      if (!response.ok || !payload?.ok) {
        throw new Error(failMsg(response.status, "Failed to delete string", payload?.message, rawText));
      }

      await loadWorkspace();
      setStatusText("String deleted.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to delete string.");
    } finally {
      setStringActionInFlight(null);
    }
  }

  async function handleKillStringProcess() {
    if (!orgId || !activeChat || stringActionInFlight) {
      return;
    }

    if (
      typeof window !== "undefined" &&
      !window.confirm("Kill the linked process for this string?")
    ) {
      return;
    }

    setStringActionInFlight("kill");
    setError(null);

    try {
      const response = await fetch(`/api/strings/${encodeURIComponent(activeChat.id)}`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          orgId,
          action: "KILL_PROCESS"
        })
      });
      const { payload, rawText } = await parseResponse<StringActionApiResponse>(response);

      if (!response.ok || !payload?.ok) {
        throw new Error(
          failMsg(response.status, "Failed to kill linked process", payload?.message, rawText)
        );
      }

      setStatusText(
        payload.message ??
          `Aborted ${payload.result?.flowsAborted ?? 0} linked process(es) for this string.`
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to kill linked process.");
    } finally {
      setStringActionInFlight(null);
    }
  }

  const headerStatusText = error
    ? error
    : loading
      ? "Syncing workspace..."
      : statusText?.startsWith("Synced ")
        ? null
        : statusText;
  const activeAudienceLabel =
    resolvedAudience.kind !== "everyone" ? resolvedAudience.label ?? resolvedAudience.kind : null;

  if (!orgId) {
    return (
      <div
        className={`relative overflow-hidden bg-[#0a0f1c] text-slate-100 ${
          embedded ? "flex h-full min-h-0 flex-1 rounded-[32px] border border-white/10" : "h-[100dvh]"
        }`}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.14),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(251,191,36,0.12),transparent_28%),linear-gradient(180deg,#0a0f1c_0%,#0b1220_48%,#09111d_100%)]" />
        <div className="relative flex h-full min-h-0 flex-1 items-center justify-center p-6">
          <div className="max-w-lg rounded-[32px] border border-dashed border-white/15 bg-black/20 px-6 py-10 text-center">
            <p className="text-sm font-semibold text-slate-200">Connect an organization to use Strings.</p>
            <p className="mt-2 text-sm text-slate-500">
              String history, collaboration teams, discussion, and direction all load from the active org workspace.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden bg-[#0a0f1c] text-slate-100 ${
        embedded
          ? "flex h-full min-h-0 flex-1 rounded-[24px] border border-white/[0.06]"
          : "h-[100dvh]"
      }`}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.08),transparent_24%),linear-gradient(180deg,#0a0f1c_0%,#0c1321_100%)]" />

      <div className="relative flex h-full min-h-0 w-full">
        <Sidebar
          open={sidebarOpen}
          searchQuery={searchQuery}
          chats={filteredChats}
          teams={teams}
          activeChatId={activeChat?.id ?? null}
          onSearchQueryChange={setSearchQuery}
          onSelectChat={handleSelectChat}
          onNewChat={handleNewChat}
          onClose={() => setSidebarOpen(false)}
        />

        <main
          className={`grid min-w-0 flex-1 overflow-hidden ${
            dockStringPanel
              ? "xl:grid-cols-[minmax(0,1fr)_clamp(320px,28vw,420px)] xl:gap-3 xl:p-3"
              : ""
          }`}
        >
          <div
            className={`flex h-full min-h-0 flex-1 flex-col bg-[#0f172a]/92 ${
              dockStringPanel
                ? "xl:overflow-hidden xl:rounded-[24px] xl:border xl:border-white/[0.06]"
                : ""
            }`}
          >
            <ChatHeader
              title={activeChat?.title ?? DEFAULT_CHAT_TITLE}
              mode={mode}
              stringPanelOpen={resolvedStringPanelOpen}
              stringPanelPinned={dockStringPanel}
              selectedTeamLabel={selectedTeam?.name ?? activeChat?.selectedTeamLabel ?? null}
              audienceLabel={activeAudienceLabel}
              audienceKind={resolvedAudience.kind}
              statusText={headerStatusText}
              statusTone={error ? "error" : "neutral"}
              onTitleChange={handleTitleChange}
              onTitleBlur={handleTitleBlur}
              onModeChange={handleModeChange}
              onToggleStringPanel={() => handleStringPanelOpenChange(!resolvedStringPanelOpen)}
              onOpenSidebar={() => setSidebarOpen(true)}
            />

            <ChatWindow
              mode={mode}
              messages={activeChat?.messages ?? []}
              isResponding={sending}
            />

            <ChatInput
              mode={mode}
              value={draft}
              files={selectedFiles}
              audienceValue={audienceToValue(resolvedAudience)}
              audienceOptions={audienceOptions}
              audienceLabel={activeAudienceLabel}
              mentionSuggestions={mentionSuggestions}
              disabled={!activeChat || sending || loading}
              sending={sending}
              onValueChange={setDraft}
              onFilesAdd={(files) => setSelectedFiles((current) => [...current, ...files])}
              onFileRemove={(index) =>
                setSelectedFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))
              }
              onAudienceChange={handleAudienceChange}
              onInsertMention={handleInsertMention}
              onSend={() => void sendMessage()}
            />
          </div>

          {dockStringPanel ? (
            <StringPanel
              open
              variant="docked"
              className="hidden xl:block"
              showCloseButton={false}
              chat={activeChat}
              stringDescription={activeStringDescription}
              stringParticipants={stringParticipants}
              collaborators={collaborators}
              teams={teams}
              selectedTeamId={selectedTeamId}
              linkedTeamIds={linkedStringTeamIds}
              linkedParticipantIds={linkedStringParticipantIds}
              onAddTeam={handleAddTeamToString}
              onRemoveTeam={handleRemoveTeamFromString}
              onAddParticipant={handleAddParticipantToString}
              onRemoveParticipant={handleRemoveParticipantFromString}
              onClose={() => handleStringPanelOpenChange(false)}
              canManageString={canManageActiveString}
              canKillProcess={canKillActiveStringProcess}
              actionInFlight={stringActionInFlight}
              onDeleteString={() => void handleDeleteString()}
              onKillProcess={() => void handleKillStringProcess()}
            />
          ) : null}
        </main>

        <StringPanel
          open={resolvedStringPanelOpen}
          className={dockStringPanel ? "xl:hidden" : ""}
          chat={activeChat}
          stringDescription={activeStringDescription}
          stringParticipants={stringParticipants}
          collaborators={collaborators}
          teams={teams}
          selectedTeamId={selectedTeamId}
          linkedTeamIds={linkedStringTeamIds}
          linkedParticipantIds={linkedStringParticipantIds}
          onAddTeam={handleAddTeamToString}
          onRemoveTeam={handleRemoveTeamFromString}
          onAddParticipant={handleAddParticipantToString}
          onRemoveParticipant={handleRemoveParticipantFromString}
          onClose={() => handleStringPanelOpenChange(false)}
          canManageString={canManageActiveString}
          canKillProcess={canKillActiveStringProcess}
          actionInFlight={stringActionInFlight}
          onDeleteString={() => void handleDeleteString()}
          onKillProcess={() => void handleKillStringProcess()}
        />
        <CollaborationPanel
          open={resolvedCollaborationPanelOpen}
          participants={stringParticipants}
          onClose={() => handleCollaborationPanelOpenChange(false)}
        />
      </div>
    </div>
  );
}
