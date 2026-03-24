"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ChatHeader } from "@/components/chat-ui/chat-header";
import { ChatInput } from "@/components/chat-ui/chat-input";
import { ChatWindow } from "@/components/chat-ui/chat-window";
import { CollaborationPanel } from "@/components/chat-ui/collaboration-panel";
import { Sidebar } from "@/components/chat-ui/sidebar";
import { StringPanel } from "@/components/chat-ui/string-panel";
import type {
  ChatMessage,
  ChatString,
  Collaborator,
  DirectionPayload,
  MessageRouting,
  StringMode,
  Team
} from "@/components/chat-ui/types";

const DEFAULT_CHAT_TITLE = "New string";
const HISTORY_LIMIT = 10;
const COFOUNDER_MANAGER_NAME = "Co-Founder Manager";
const COFOUNDER_MANAGER_ROLE = "Organization lead";
const STRINGS_UPDATED_EVENT = "vx:strings-updated";

interface JsonEnvelope {
  ok?: boolean;
  message?: string;
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

interface HubOrganizationResponse extends JsonEnvelope {
  actor?: {
    userId?: string;
    activeTeamId?: string | null;
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

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;
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
    source: "workspace",
    persisted: false,
    messages: []
  };
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
  return messages.slice(-HISTORY_LIMIT).map((message) => ({
    role: message.role === "user" ? "owner" : "organization",
    content: message.content.slice(0, 1200)
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

  const collaborators: Collaborator[] = [
    ...members.map((member) => ({
      id: memberKey(member.userId),
      name: member.username,
      email: member.email,
      role: member.roleLabel || "Member",
      kind: "HUMAN" as const,
      online: member.isActiveOrganization ?? true,
      source: "presence" as const
    })),
    ...personnel.map((person) => ({
      id: person.id,
      name: person.name,
      email: fallbackEmail(person.name, person.id),
      role: person.role,
      kind: person.type === "AI" ? ("AI" as const) : ("HUMAN" as const),
      online: person.status !== "DISABLED",
      source: "squad" as const
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
    focus: team.description || "Collaboration routing"
  }));

  return {
    collaborators,
    teams,
    actorUserId: payload.actor?.userId?.trim() || null,
    actorMemberId: payload.actor?.userId ? memberKey(payload.actor.userId) : null,
    activeTeamId: payload.actor?.activeTeamId ?? null
  };
}

function buildDerivedStrings(
  strings: ChatString[],
  directions: DirectionRecord[],
  plans: PlanRecord[]
) {
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
    source: value.source ?? "workspace",
    persisted: value.persisted ?? true,
    messages: Array.isArray(value.messages) ? value.messages : []
  };
}

function normalizeText(value: string | null | undefined) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
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
  onOpenAddMember,
  onOpenCreateTeam,
  stringPanelOpen,
  onStringPanelOpenChange,
  collaborationPanelOpen,
  onCollaborationPanelOpenChange
}: {
  embedded?: boolean;
  orgId?: string | null;
  onOpenAddMember?: () => void;
  onOpenCreateTeam?: () => void;
  stringPanelOpen?: boolean;
  onStringPanelOpenChange?: (open: boolean) => void;
  collaborationPanelOpen?: boolean;
  onCollaborationPanelOpenChange?: (open: boolean) => void;
}) {
  const [chats, setChats] = useState<ChatString[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [mode, setMode] = useState<StringMode>("discussion");
  const [draft, setDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
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
  const canManageActiveString = Boolean(
    activeChat?.persisted &&
      currentActorUserId &&
      activeChat.createdByUserId &&
      activeChat.createdByUserId === currentActorUserId
  );
  const canKillActiveStringProcess = Boolean(
    canManageActiveString && (activeChat?.directionId || activeChat?.planId)
  );
  const stringParticipants = useMemo(() => {
    const byParticipant = new Map<string, Collaborator>();
    const addParticipant = (participant: Collaborator | null | undefined) => {
      if (!participant) {
        return;
      }
      const key =
        participant.id ||
        participant.email.trim().toLowerCase() ||
        participant.name.trim().toLowerCase();
      if (!key || byParticipant.has(key)) {
        return;
      }
      byParticipant.set(key, participant);
    };
    const routedTeam =
      teams.find((team) => team.id === activeChat?.selectedTeamId) ?? selectedTeam ?? null;

    routedTeam?.memberIds.forEach((memberId) => {
      addParticipant(collaborators.find((participant) => participant.id === memberId));
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

      const authorName = normalizeText(message.authorName);
      if (!authorName) {
        return;
      }

      const matchedCollaborator =
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

    return [...byParticipant.values()].sort((left, right) =>
      left.name.localeCompare(right.name)
    );
  }, [activeChat, actorMemberId, collaborators, selectedTeam, teams]);

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

    if (activeChat.selectedTeamId && activeChat.selectedTeamId !== selectedTeamId) {
      setSelectedTeamId(activeChat.selectedTeamId);
      return;
    }

    if (!activeChat.selectedTeamId && !selectedTeamId && teams.length > 0) {
      setSelectedTeamId(teams[0]?.id ?? null);
    }
  }, [activeChat, selectedTeamId, teams]);

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
      const hydratedStrings = buildDerivedStrings(persistedStrings, directions, plans);
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
        source: chat.source ?? "workspace",
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

  function handleSelectChat(chatId: string) {
    setActiveChatId(chatId);
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
    setDraft("");
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

    const nextChat = {
      ...activeChat,
      mode: nextMode,
      updatedAt: nowIso()
    };
    replaceChat(nextChat);
    void persistChat(nextChat).catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : "Failed to save string mode.");
    });
  }

  function handleSelectTeam(teamId: string) {
    const nextTeam = teams.find((team) => team.id === teamId) ?? null;

    setSelectedTeamId(teamId);

    if (activeChat) {
      const nextChat = {
        ...activeChat,
        selectedTeamId: nextTeam?.id ?? null,
        selectedTeamLabel: nextTeam?.name ?? null,
        updatedAt: nowIso()
      };
      replaceChat(nextChat);
      void persistChat(nextChat).catch((nextError) => {
        setError(nextError instanceof Error ? nextError.message : "Failed to save team routing.");
      });
    }

    if (!actorMemberId || nextTeam?.memberIds.includes(actorMemberId)) {
      void persistActiveTeam(teamId).catch((nextError) => {
        setError(nextError instanceof Error ? nextError.message : "Failed to update active team.");
      });
    }
  }

  async function sendMessage(teamId = selectedTeamId) {
    const targetChat = activeChat;
    const content = draft.trim();

    if (!orgId || !targetChat || !content || sending) {
      return;
    }

    const targetTeam = teams.find((team) => team.id === teamId) ?? null;
    const timestamp = nowIso();
    const selectedMode = mode;
    const userMessage: ChatMessage = {
      id: createId("message"),
      role: "user",
      content,
      createdAt: timestamp,
      teamId: targetTeam?.id ?? null,
      teamLabel: targetTeam?.name ?? null
    };

    const optimisticChat: ChatString = {
      ...targetChat,
      title: targetChat.title === DEFAULT_CHAT_TITLE ? titleFromMessage(content) : targetChat.title,
      mode: selectedMode,
      updatedAt: timestamp,
      selectedTeamId: targetTeam?.id ?? targetChat.selectedTeamId ?? null,
      selectedTeamLabel: targetTeam?.name ?? targetChat.selectedTeamLabel ?? null,
      messages: [...targetChat.messages, userMessage]
    };

    replaceChat(optimisticChat);
    setDraft("");
    setSending(true);
    handleStringPanelOpenChange(false);
    handleCollaborationPanelOpenChange(false);
    setError(null);

    const userPersistPromise = persistChat(optimisticChat).catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : "Failed to save string.");
      return optimisticChat;
    });

    try {
      const chatStartedAt = performance.now();
      const chatResponse = await fetch("/api/control/direction-chat", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          orgId,
          message: content,
          history: toHistory(optimisticChat.messages)
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

      const routing: MessageRouting | undefined = chatPayload.intentRouting
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

      const followUps: ChatMessage[] = [
        {
          id: createId("message"),
          role: "system",
          content: chatPayload.reply,
          createdAt: nowIso(),
          authorName: COFOUNDER_MANAGER_NAME,
          authorRole: COFOUNDER_MANAGER_ROLE,
          teamId: targetTeam?.id ?? null,
          teamLabel: targetTeam?.name ?? null,
          ...(routing ? { routing } : {}),
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
        }
      ];

      let directionId = optimisticChat.directionId ?? null;
      let planId = optimisticChat.planId ?? null;
      const shouldPlan =
        selectedMode === "direction" || chatPayload.intentRouting?.route === "PLAN_REQUIRED";
      const directionText = (chatPayload.directionCandidate || content).trim();

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
            authorName: COFOUNDER_MANAGER_NAME,
            authorRole: "Direction lead",
            teamId: targetTeam?.id ?? null,
            teamLabel: targetTeam?.name ?? null,
            direction: toDirectionPayload(
              planPayload.directionGiven || directionText,
              planPayload.primaryPlan,
              planPayload.requiredToolkits,
              planPayload.requestCount,
              targetTeam?.name ?? null
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
            teamId: targetTeam?.id ?? null,
            teamLabel: targetTeam?.name ?? null,
            error: true
          });
        }
      }

      await userPersistPromise;

      const finalChat: ChatString = {
        ...optimisticChat,
        updatedAt: followUps[followUps.length - 1]?.createdAt ?? nowIso(),
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
            teamId: targetTeam?.id ?? null,
            teamLabel: targetTeam?.name ?? null,
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

    if (!draft.trim() && selectedTeam) {
      setDraft(`Discuss with ${selectedTeam.name}: `);
    }
  }

  function handleSetDirection() {
    handleModeChange("direction");
    handleStringPanelOpenChange(false);
    handleCollaborationPanelOpenChange(false);

    if (!draft.trim() && selectedTeam) {
      setDraft(`Direction for ${selectedTeam.name}: `);
    }
  }

  function handleOpenAddMember() {
    handleStringPanelOpenChange(false);
    handleCollaborationPanelOpenChange(false);
    onOpenAddMember?.();
  }

  function handleOpenCreateTeam() {
    handleStringPanelOpenChange(false);
    handleCollaborationPanelOpenChange(false);
    onOpenCreateTeam?.();
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
              disabled={!activeChat || sending || loading}
              sending={sending}
              onValueChange={setDraft}
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
              onSelectTeam={handleSelectTeam}
              onClose={() => handleStringPanelOpenChange(false)}
              canManageString={canManageActiveString}
              canKillProcess={canKillActiveStringProcess}
              actionInFlight={stringActionInFlight}
              onDeleteString={() => void handleDeleteString()}
              onKillProcess={() => void handleKillStringProcess()}
              onSendToTeam={() => void sendMessage(selectedTeamId)}
              onDiscussWithTeam={handleDiscussWithTeam}
              onSetDirection={handleSetDirection}
              onOpenAddMember={handleOpenAddMember}
              onOpenCreateTeam={handleOpenCreateTeam}
              canSendToTeam={Boolean(draft.trim()) && Boolean(selectedTeamId)}
              sending={sending}
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
          onSelectTeam={handleSelectTeam}
          onClose={() => handleStringPanelOpenChange(false)}
          canManageString={canManageActiveString}
          canKillProcess={canKillActiveStringProcess}
          actionInFlight={stringActionInFlight}
          onDeleteString={() => void handleDeleteString()}
          onKillProcess={() => void handleKillStringProcess()}
          onSendToTeam={() => void sendMessage(selectedTeamId)}
          onDiscussWithTeam={handleDiscussWithTeam}
          onSetDirection={handleSetDirection}
          onOpenAddMember={handleOpenAddMember}
          onOpenCreateTeam={handleOpenCreateTeam}
          canSendToTeam={Boolean(draft.trim()) && Boolean(selectedTeamId)}
          sending={sending}
        />
        <CollaborationPanel
          open={resolvedCollaborationPanelOpen}
          collaborators={collaborators}
          teams={teams}
          selectedTeamId={selectedTeamId}
          onSelectTeam={handleSelectTeam}
          onClose={() => handleCollaborationPanelOpenChange(false)}
          onSendToTeam={() => void sendMessage(selectedTeamId)}
          onDiscussWithTeam={handleDiscussWithTeam}
          onSetDirection={handleSetDirection}
          onOpenAddMember={handleOpenAddMember}
          onOpenCreateTeam={handleOpenCreateTeam}
          canSendToTeam={Boolean(draft.trim()) && Boolean(selectedTeamId)}
          sending={sending}
        />
      </div>
    </div>
  );
}
