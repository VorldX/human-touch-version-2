"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Loader2, LogOut, RefreshCw } from "lucide-react";

import { useFirebaseAuth } from "@/components/auth/firebase-auth-provider";
import { ChatHeader } from "@/components/chat-ui/chat-header";
import { ChatInput } from "@/components/chat-ui/chat-input";
import { ChatWindow } from "@/components/chat-ui/chat-window";
import { CreateGroupModal } from "@/components/chat-ui/create-group-modal";
import { InviteModal } from "@/components/chat-ui/invite-modal";
import { Sidebar } from "@/components/chat-ui/sidebar";
import { TeamPanel } from "@/components/chat-ui/team-panel";
import type { ChatMessage, ChatString, Collaborator, CollaboratorGroup, CollaboratorKind, DirectionPayload, MessageRouting, StringMode } from "@/components/chat-ui/types";
import type { ActiveUser, OrgContext } from "@/lib/store/vorldx-store";
import { useVorldXStore } from "@/lib/store/vorldx-store";

const COLORS = ["bg-cyan-500", "bg-emerald-500", "bg-blue-500", "bg-amber-500", "bg-rose-500", "bg-violet-500"];
const STRINGS_KEY = "vx.chat.strings.v2";
const GROUPS_KEY = "vx.chat.groups.v2";
const HISTORY_LIMIT = 10;

interface OrgListResponse {
  ok?: boolean;
  message?: string;
  activeOrgId?: string | null;
  orgs?: OrgContext[];
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
  primaryPlan: PlanPrimary;
  updatedAt: string;
  createdAt: string;
}

interface JsonEnvelope<T> {
  ok?: boolean;
  message?: string;
  [key: string]: unknown;
}

interface DirectionChatApiResponse {
  ok?: boolean;
  message?: string;
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

interface DirectionPlanApiResponse {
  ok?: boolean;
  message?: string;
  analysis?: string;
  directionGiven?: string;
  primaryPlan?: PlanPrimary;
  requiredToolkits?: string[];
  requestCount?: number;
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

function rid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function tr(value: string, max = 96) {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return "Untitled String";
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function toMs(value: string) {
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function ccolor(seed: string) {
  const hash = Array.from(seed).reduce((n, ch) => n + ch.charCodeAt(0), 0);
  return COLORS[hash % COLORS.length];
}

function fallbackEmail(name: string, id: string) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
  return `${slug || `member-${id.slice(-6)}`}@platform.local`;
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
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

function failMsg(status: number, fallback: string, payloadMessage?: string, rawText?: string) {
  if (payloadMessage?.trim()) return payloadMessage;
  if (rawText?.trim()) return `${fallback} (${status}): ${rawText.slice(0, 160)}`;
  return `${fallback} (${status}).`;
}

function blankString(): ChatString {
  const t = nowIso();
  return { id: rid("str"), title: "New String", mode: "discussion", updatedAt: t, messages: [] };
}

function toDirectionPayload(objective: string, primary: PlanPrimary, requiredToolkits?: string[], approvalCount?: number): DirectionPayload {
  const workflows = Array.isArray(primary.workflows) ? primary.workflows : [];
  const steps = workflows.slice(0, 6).map((wf, index) => {
    const tasks = (wf.tasks ?? []).map((task) => task.title?.trim() || "").filter(Boolean).slice(0, 5);
    const actions = [...(wf.deliverables ?? []), ...(wf.successMetrics ?? [])].map((x) => x.trim()).filter(Boolean).slice(0, 4);
    return {
      id: rid("step"),
      title: tr(wf.title || "Execution Workflow", 72),
      owner: wf.ownerRole?.trim() || "Owner",
      status: (index === 0 ? "in_progress" : "todo") as "in_progress" | "todo",
      tasks: tasks.length > 0 ? tasks : ["Break down work into executable tasks"],
      actions: actions.length > 0 ? actions : ["Review output against objective"]
    };
  });
  if (steps.length === 0) {
    steps.push({ id: rid("step"), title: "Execution Planning", owner: "Owner", status: "in_progress", tasks: ["Define first workflow"], actions: ["Review checkpoints"] });
  }
  return {
    objective: tr(objective, 220),
    ...(primary.summary ? { summary: primary.summary } : {}),
    ...(typeof primary.detailScore === "number" ? { detailScore: Math.max(0, Math.min(100, Math.floor(primary.detailScore))) } : {}),
    ...(requiredToolkits?.length ? { requiredToolkits: requiredToolkits.slice(0, 10) } : {}),
    ...(typeof approvalCount === "number" ? { approvalCount: Math.max(0, Math.floor(approvalCount)) } : {}),
    steps
  };
}

function toHistory(messages: ChatMessage[]) {
  return messages.slice(-HISTORY_LIMIT).map((m) => ({ role: m.role === "user" ? "owner" : "organization", content: m.content.slice(0, 1200) }));
}

function mergeStrings(localStrings: ChatString[], serverStrings: ChatString[]) {
  const map = new Map<string, ChatString>();
  for (const item of serverStrings) map.set(item.id, item);
  for (const local of localStrings) {
    const existing = map.get(local.id);
    if (!existing) {
      map.set(local.id, local);
      continue;
    }
    map.set(local.id, {
      ...existing,
      title: local.title || existing.title,
      mode: local.mode,
      updatedAt: toMs(local.updatedAt) > toMs(existing.updatedAt) ? local.updatedAt : existing.updatedAt,
      messages: local.messages.length >= existing.messages.length ? local.messages : existing.messages
    });
  }
  return [...map.values()].sort((a, b) => toMs(b.updatedAt) - toMs(a.updatedAt));
}

export function StringChatShell({ embedded = false }: { embedded?: boolean }) {
  const { user, signOutCurrentUser } = useFirebaseAuth();

  const orgs = useVorldXStore((state) => state.orgs);
  const currentOrg = useVorldXStore((state) => state.currentOrg);
  const setOrgs = useVorldXStore((state) => state.setOrgs);
  const setCurrentOrg = useVorldXStore((state) => state.setCurrentOrg);
  const activeUsers = useVorldXStore((state) => state.activeUsers);
  const setActiveUsers = useVorldXStore((state) => state.setActiveUsers);
  const upsertActiveUsers = useVorldXStore((state) => state.upsertActiveUsers);
  const removeActiveUser = useVorldXStore((state) => state.removeActiveUser);

  const [strings, setStrings] = useState<ChatString[]>([]);
  const [selectedString, setSelectedString] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mode, setMode] = useState<StringMode>("discussion");
  const [teamPanelOpen, setTeamPanelOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [groups, setGroups] = useState<CollaboratorGroup[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [draft, setDraft] = useState("");

  const [loadingOrgs, setLoadingOrgs] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [sending, setSending] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeOrg = currentOrg ?? orgs[0] ?? null;
  const selected = useMemo(() => strings.find((item) => item.id === selectedString) ?? null, [selectedString, strings]);
  const filteredStrings = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return strings;
    return strings.filter((item) => item.title.toLowerCase().includes(q) || item.mode.toLowerCase().includes(q) || item.messages.some((m) => m.content.toLowerCase().includes(q)));
  }, [searchQuery, strings]);
  const collaborators = useMemo<Collaborator[]>(() => activeUsers.filter((x) => x.source !== "system").map((x) => ({ id: x.id, name: x.name, email: x.email ?? fallbackEmail(x.name, x.id), role: x.role, kind: x.kind ?? "HUMAN", online: x.online, source: x.source })), [activeUsers]);
  const workforceMembers = useMemo(() => collaborators.filter((x) => x.source === "squad"), [collaborators]);
  const latestMetrics = useMemo(() => [...(selected?.messages ?? [])].reverse().find((m) => m.metrics)?.metrics ?? null, [selected]);

  const loadWorkforce = useCallback(async (orgId: string) => {
    const response = await fetch(`/api/squad/personnel?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store", credentials: "include" });
    const { payload, rawText } = await parseResponse<JsonEnvelope<{ personnel?: ActiveUser[] }> & { personnel?: Array<{ id: string; name: string; role: string; type: "HUMAN" | "AI"; status: string }> }>(response);
    if (!response.ok || !payload?.ok) {
      throw new Error(failMsg(response.status, "Failed to load workforce", payload?.message, rawText));
    }
    const personnel = Array.isArray(payload.personnel) ? payload.personnel : [];
    const mapped: ActiveUser[] = personnel.map((item) => ({
      id: item.id,
      name: item.name,
      email: fallbackEmail(item.name, item.id),
      role: item.role,
      kind: item.type === "AI" ? "AI" : "HUMAN",
      color: ccolor(item.id),
      online: item.status !== "DISABLED",
      source: "squad"
    }));
    setActiveUsers(mapped);
    return mapped.length;
  }, [setActiveUsers]);

  const hydrateWorkspace = useCallback(async (orgId: string) => {
    setSyncing(true);
    setError(null);
    try {
      const [directionsResp, plansResp, workforceCount] = await Promise.all([
        fetch(`/api/directions?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store", credentials: "include" }),
        fetch(`/api/plans?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store", credentials: "include" }),
        loadWorkforce(orgId)
      ]);
      const [{ payload: directionsPayload, rawText: directionsRaw }, { payload: plansPayload, rawText: plansRaw }] = await Promise.all([
        parseResponse<JsonEnvelope<{ directions?: DirectionRecord[] }> & { directions?: DirectionRecord[] }>(directionsResp),
        parseResponse<JsonEnvelope<{ plans?: PlanRecord[] }> & { plans?: PlanRecord[] }>(plansResp)
      ]);
      if (!directionsResp.ok || !directionsPayload?.ok) throw new Error(failMsg(directionsResp.status, "Failed to load directions", directionsPayload?.message, directionsRaw));
      if (!plansResp.ok || !plansPayload?.ok) throw new Error(failMsg(plansResp.status, "Failed to load plans", plansPayload?.message, plansRaw));

      const directions = Array.isArray(directionsPayload.directions) ? directionsPayload.directions : [];
      const plans = Array.isArray(plansPayload.plans) ? plansPayload.plans : [];
      const planByDirection = new Map<string, PlanRecord>();
      for (const plan of plans) {
        if (!plan.directionId) continue;
        const existing = planByDirection.get(plan.directionId);
        if (!existing || toMs(plan.updatedAt) > toMs(existing.updatedAt)) planByDirection.set(plan.directionId, plan);
      }
      const directionStrings: ChatString[] = directions.map((direction) => {
        const linkedPlan = planByDirection.get(direction.id) ?? null;
        const createdAt = direction.createdAt || nowIso();
        const updatedAt = direction.updatedAt || createdAt;
        const messages: ChatMessage[] = [{ id: rid("msg"), role: "system", content: direction.summary || direction.direction || "Direction loaded.", createdAt }];
        if (linkedPlan?.primaryPlan) {
          messages.push({ id: rid("msg"), role: "system", content: linkedPlan.summary || "Execution plan linked to this direction.", createdAt: linkedPlan.createdAt || updatedAt, direction: toDirectionPayload(direction.direction || direction.title, linkedPlan.primaryPlan) });
        }
        return { id: `direction:${direction.id}`, title: tr(direction.title || direction.direction || "Direction", 72), mode: "direction", updatedAt, messages };
      });
      const orphanPlanStrings: ChatString[] = plans.filter((plan) => !plan.directionId).map((plan) => ({ id: `plan:${plan.id}`, title: tr(plan.title || plan.direction || "Execution Plan", 72), mode: "direction", updatedAt: plan.updatedAt || plan.createdAt || nowIso(), messages: [{ id: rid("msg"), role: "system", content: plan.summary || "Execution plan loaded.", createdAt: plan.createdAt || nowIso(), direction: toDirectionPayload(plan.direction || plan.title, plan.primaryPlan || {}) }] }));
      const localStrings = readJson<ChatString[]>(`${STRINGS_KEY}:${orgId}`, []);
      const merged = mergeStrings(localStrings, [...directionStrings, ...orphanPlanStrings]);
      const nextStrings = merged.length > 0 ? merged : [blankString()];
      setStrings(nextStrings);
      setSelectedString((current) => (current && nextStrings.some((x) => x.id === current) ? current : nextStrings[0]?.id ?? null));
      setStatusText(`Synced ${nextStrings.length} strings and ${workforceCount} workforce members.`);
    } catch (e) {
      setStrings((prev) => (prev.length > 0 ? prev : [blankString()]));
      setError(e instanceof Error ? e.message : "Unable to sync workspace.");
    } finally {
      setSyncing(false);
    }
  }, [loadWorkforce]);

  const loadOrganizations = useCallback(async () => {
    if (!user?.uid || !user.email) {
      setOrgs([]);
      setCurrentOrg(null);
      setStrings([]);
      setSelectedString(null);
      setActiveUsers([]);
      return;
    }
    setLoadingOrgs(true);
    setError(null);
    try {
      const response = await fetch("/api/orgs", { cache: "no-store", credentials: "include" });
      const { payload, rawText } = await parseResponse<OrgListResponse>(response);
      if (!response.ok || !payload?.ok) throw new Error(failMsg(response.status, "Unable to load organizations", payload?.message, rawText));
      const nextOrgs = Array.isArray(payload.orgs) ? payload.orgs : [];
      setOrgs(nextOrgs);
      if (nextOrgs.length === 0) {
        setCurrentOrg(null);
        setStrings([blankString()]);
        setSelectedString(null);
        setStatusText("No organization access found.");
        return;
      }
      const nextOrg = nextOrgs.find((x) => x.id === payload.activeOrgId) ?? currentOrg ?? nextOrgs[0] ?? null;
      setCurrentOrg(nextOrg);
      setStatusText(nextOrg ? `Connected to ${nextOrg.name}.` : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load organizations.");
    } finally {
      setLoadingOrgs(false);
    }
  }, [currentOrg, setActiveUsers, setCurrentOrg, setOrgs, user?.email, user?.uid]);

  useEffect(() => {
    void loadOrganizations();
  }, [loadOrganizations]);

  useEffect(() => {
    if (!activeOrg?.id) return;
    void hydrateWorkspace(activeOrg.id);
  }, [activeOrg?.id, hydrateWorkspace]);

  useEffect(() => {
    if (!activeOrg?.id) {
      setGroups([]);
      return;
    }
    setGroups(readJson<CollaboratorGroup[]>(`${GROUPS_KEY}:${activeOrg.id}`, []));
  }, [activeOrg?.id]);

  useEffect(() => {
    if (!activeOrg?.id) return;
    writeJson(`${GROUPS_KEY}:${activeOrg.id}`, groups);
  }, [activeOrg?.id, groups]);

  useEffect(() => {
    if (!activeOrg?.id) return;
    writeJson(`${STRINGS_KEY}:${activeOrg.id}`, strings);
  }, [activeOrg?.id, strings]);

  useEffect(() => {
    const syncSidebarByViewport = () => {
      if (window.innerWidth >= 1024) setSidebarOpen(true);
    };
    syncSidebarByViewport();
    window.addEventListener("resize", syncSidebarByViewport);
    return () => window.removeEventListener("resize", syncSidebarByViewport);
  }, []);

  useEffect(() => {
    if (selected) setMode(selected.mode);
  }, [selected]);

  useEffect(() => {
    if (selectedString || strings.length === 0) return;
    setSelectedString(strings[0]?.id ?? null);
  }, [selectedString, strings]);

  const handleSelectString = (stringId: string) => {
    setSelectedString(stringId);
    const next = strings.find((item) => item.id === stringId);
    if (next) setMode(next.mode);
    if (typeof window !== "undefined" && window.innerWidth < 1024) setSidebarOpen(false);
  };

  const handleNewString = () => {
    const newString = blankString();
    setStrings((prev) => [newString, ...prev]);
    setSelectedString(newString.id);
    setMode("discussion");
    setDraft("");
    if (typeof window !== "undefined" && window.innerWidth < 1024) setSidebarOpen(false);
  };

  const handleTitleChange = (value: string) => {
    if (!selected) return;
    setStrings((prev) => prev.map((item) => (item.id === selected.id ? { ...item, title: tr(value, 72), updatedAt: nowIso() } : item)));
  };

  const handleModeChange = (nextMode: StringMode) => {
    setMode(nextMode);
    if (!selected) return;
    setStrings((prev) => prev.map((item) => (item.id === selected.id ? { ...item, mode: nextMode, updatedAt: nowIso() } : item)));
  };

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    const orgId = activeOrg?.id;
    if (!text || !selected || !orgId || sending) return;

    const threadId = selected.id;
    const selectedMode = mode;
    const userMessage: ChatMessage = { id: rid("msg"), role: "user", content: text, createdAt: nowIso() };
    const baseHistory = [...selected.messages, userMessage];

    setStrings((prev) => prev.map((item) => item.id === threadId ? { ...item, mode: selectedMode, updatedAt: nowIso(), messages: [...item.messages, userMessage] } : item));
    setDraft("");
    setSending(true);
    setError(null);

    if (selected.title === "New String" || selected.title === "Untitled String") {
      setStrings((prev) => prev.map((item) => item.id === threadId ? { ...item, title: tr(text, 72), updatedAt: nowIso() } : item));
    }

    try {
      const chatStart = performance.now();
      const chatResponse = await fetch("/api/control/direction-chat", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, message: text, history: toHistory(baseHistory) })
      });
      const chatLatency = Math.round(performance.now() - chatStart);
      const { payload: chatPayload, rawText: chatRaw } = await parseResponse<JsonEnvelope<DirectionChatApiResponse> & DirectionChatApiResponse>(chatResponse);
      if (!chatResponse.ok || !chatPayload?.ok || !chatPayload.reply) {
        throw new Error(failMsg(chatResponse.status, "Organization chat failed", chatPayload?.message, chatRaw));
      }

      const routing: MessageRouting | undefined = chatPayload.intentRouting
        ? {
            route: chatPayload.intentRouting.route,
            ...(chatPayload.intentRouting.reason ? { reason: chatPayload.intentRouting.reason } : {}),
            ...(Array.isArray(chatPayload.intentRouting.toolkitHints) ? { toolkitHints: chatPayload.intentRouting.toolkitHints } : {})
          }
        : undefined;

      const systemMessage: ChatMessage = {
        id: rid("msg"),
        role: "system",
        content: chatPayload.reply,
        createdAt: nowIso(),
        metrics: {
          latencyMs: Math.max(0, chatLatency),
          ...(typeof chatPayload.tokenUsage?.promptTokens === "number" ? { promptTokens: chatPayload.tokenUsage.promptTokens } : {}),
          ...(typeof chatPayload.tokenUsage?.completionTokens === "number" ? { completionTokens: chatPayload.tokenUsage.completionTokens } : {}),
          ...(typeof chatPayload.tokenUsage?.totalTokens === "number" ? { totalTokens: chatPayload.tokenUsage.totalTokens } : {}),
          ...(chatPayload.model?.provider ? { provider: chatPayload.model.provider } : {}),
          ...(chatPayload.model?.name ? { model: chatPayload.model.name } : {}),
          ...(chatPayload.model?.source ? { source: chatPayload.model.source } : {})
        },
        ...(routing ? { routing } : {})
      };

      const followUps: ChatMessage[] = [systemMessage];
      const shouldPlan = selectedMode === "direction" || chatPayload.intentRouting?.route === "PLAN_REQUIRED";
      const directionText = (chatPayload.directionCandidate || text).trim();

      if (shouldPlan && directionText) {
        const planStart = performance.now();
        const planResponse = await fetch("/api/control/direction-plan", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orgId, direction: directionText, history: toHistory([...baseHistory, systemMessage]), humanPlan: "" })
        });
        const planLatency = Math.round(performance.now() - planStart);
        const { payload: planPayload, rawText: planRaw } = await parseResponse<JsonEnvelope<DirectionPlanApiResponse> & DirectionPlanApiResponse>(planResponse);

        if (planResponse.ok && planPayload?.ok && planPayload.primaryPlan) {
          followUps.push({
            id: rid("msg"),
            role: "system",
            content: planPayload.analysis || "Execution plan generated and linked.",
            createdAt: nowIso(),
            direction: toDirectionPayload(planPayload.directionGiven || directionText, planPayload.primaryPlan, planPayload.requiredToolkits, planPayload.requestCount),
            metrics: {
              latencyMs: Math.max(0, planLatency),
              ...(typeof planPayload.tokenUsage?.promptTokens === "number" ? { promptTokens: planPayload.tokenUsage.promptTokens } : {}),
              ...(typeof planPayload.tokenUsage?.completionTokens === "number" ? { completionTokens: planPayload.tokenUsage.completionTokens } : {}),
              ...(typeof planPayload.tokenUsage?.totalTokens === "number" ? { totalTokens: planPayload.tokenUsage.totalTokens } : {}),
              ...(planPayload.model?.provider ? { provider: planPayload.model.provider } : {}),
              ...(planPayload.model?.name ? { model: planPayload.model.name } : {}),
              ...(planPayload.model?.source ? { source: planPayload.model.source } : {})
            },
            routing: { route: "PLAN_REQUIRED", reason: "Direction plan generated from this message.", toolkitHints: planPayload.requiredToolkits ?? [] }
          });
        } else {
          followUps.push({ id: rid("msg"), role: "system", content: failMsg(planResponse.status, "Planning step failed", planPayload?.message, planRaw), createdAt: nowIso(), error: true });
        }
      }

      setStrings((prev) => prev.map((item) => item.id === threadId ? { ...item, mode: selectedMode, updatedAt: nowIso(), messages: [...item.messages, ...followUps] } : item));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to send message.";
      setError(msg);
      setStrings((prev) => prev.map((item) => item.id === threadId ? { ...item, mode: selectedMode, updatedAt: nowIso(), messages: [...item.messages, { id: rid("msg"), role: "system", content: msg, createdAt: nowIso(), error: true }] } : item));
    } finally {
      setSending(false);
    }
  }, [activeOrg?.id, draft, mode, selected, sending]);

  const handleInvite = useCallback(async (input: { value: string; kind: CollaboratorKind }) => {
    const orgId = activeOrg?.id;
    if (!orgId) return;
    const defaultRole = input.kind === "AI" ? "AI Agent" : "Employee";
    const name = tr(input.value.includes("@") ? input.value.split("@")[0] || input.value : input.value, 48);
    const email = input.value.includes("@") ? input.value : `${input.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "team"}@team.local`;
    setError(null);
    setStatusText(`Inviting ${name}...`);
    try {
      const response = await fetch("/api/squad/personnel", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, type: input.kind === "AI" ? "AI" : "HUMAN", name, role: defaultRole })
      });
      const { payload, rawText } = await parseResponse<JsonEnvelope<Record<string, unknown>>>(response);
      if (!response.ok || !payload?.ok) throw new Error(failMsg(response.status, "Unable to invite collaborator", payload?.message, rawText));
      await loadWorkforce(orgId);
      upsertActiveUsers([{ id: `invite:${email.toLowerCase()}`, name, email, role: defaultRole, kind: input.kind, color: ccolor(email.toLowerCase()), online: true, source: "team" }]);
      setStatusText(`${name} added to workforce.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to invite collaborator.");
    }
  }, [activeOrg?.id, loadWorkforce, upsertActiveUsers]);

  const handleCreateGroup = (input: { name: string; memberIds: string[] }) => {
    const groupName = input.name.trim();
    if (!groupName || input.memberIds.length === 0) return;
    setGroups((prev) => [{ id: rid("grp"), name: groupName, type: "team", memberIds: Array.from(new Set(input.memberIds)), createdAt: nowIso() }, ...prev]);
  };

  const handleUseGroupInChat = (groupId: string) => {
    const group = groups.find((item) => item.id === groupId);
    if (!group) return;
    const prefix = `@team:${group.name} `;
    setDraft((prev) => (prev.trim() ? `${prev.trim()}\n${prefix}` : prefix));
    setTeamPanelOpen(false);
  };

  const handleOrgSwitch = (orgId: string) => {
    const next = orgs.find((item) => item.id === orgId) ?? null;
    setCurrentOrg(next);
    if (next) setStatusText(`Switched to ${next.name}.`);
  };

  const handleRefresh = async () => {
    await loadOrganizations();
    if (activeOrg?.id) await hydrateWorkspace(activeOrg.id);
  };

  if (!user) return null;

  if (loadingOrgs && !activeOrg) {
    return <main className="flex min-h-screen items-center justify-center bg-[#070b10] text-slate-200"><div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/30 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em]"><Loader2 size={14} className="animate-spin" />Loading Workspace</div></main>;
  }

  if (!activeOrg) {
    return <main className="flex min-h-screen items-center justify-center bg-[#070b10] p-4 text-slate-100"><div className="w-full max-w-xl rounded-3xl border border-white/15 bg-[#0d131b]/95 p-6 shadow-[0_20px_60px_rgba(0,0,0,0.42)]"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Organization</p><h1 className="mt-2 text-2xl font-semibold text-slate-100">No organization found</h1><p className="mt-2 text-sm text-slate-400">This account has no organization access yet. Join or create an organization, then refresh.</p>{error ? <p className="mt-3 rounded-xl border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</p> : null}<div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={handleRefresh} className="inline-flex items-center gap-2 rounded-full border border-cyan-500/35 bg-cyan-500/15 px-4 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-500/25"><RefreshCw size={14} />Refresh</button><button type="button" onClick={signOutCurrentUser} className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/30 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:bg-black/45"><LogOut size={14} />Sign Out</button></div></div></main>;
  }

  return (
    <div className={`relative overflow-hidden bg-[#090d12] text-slate-100 ${embedded ? "h-full rounded-[28px] border border-white/10" : "h-[100dvh]"}`}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_14%_8%,rgba(6,182,212,0.16),transparent_48%),radial-gradient(circle_at_86%_96%,rgba(16,185,129,0.09),transparent_42%)]" />
      <div className="relative flex h-full min-w-0 flex-col">
        <header className="border-b border-white/10 bg-[#0a1119]/80 px-4 py-3 backdrop-blur sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0"><p className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-slate-400"><Building2 size={12} />VorldX String Console</p><p className="truncate text-sm font-semibold text-slate-100">{activeOrg.name}</p></div>
            <div className="flex flex-wrap items-center gap-2"><label className="rounded-full border border-white/15 bg-black/25 px-3 py-1.5 text-xs text-slate-300"><span className="mr-2 text-slate-500">Org</span><select value={activeOrg.id} onChange={(e) => handleOrgSwitch(e.target.value)} className="bg-transparent text-xs font-semibold text-slate-100 outline-none">{orgs.map((org) => <option key={org.id} value={org.id} className="bg-[#0f141b] text-slate-100">{org.name}</option>)}</select></label><button type="button" onClick={handleRefresh} disabled={syncing || loadingOrgs} className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/35 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-500/20 disabled:opacity-55">{syncing || loadingOrgs ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}Sync</button><button type="button" onClick={signOutCurrentUser} className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-black/35 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-black/45"><LogOut size={13} />Sign Out</button></div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">{statusText ? <span>{statusText}</span> : null}{latestMetrics ? <span className="rounded-full border border-white/10 bg-black/30 px-2 py-0.5">{typeof latestMetrics.totalTokens === "number" ? `${latestMetrics.totalTokens} tokens` : "No token data"} | {latestMetrics.latencyMs} ms</span> : null}</div>
          {error ? <p className="mt-2 rounded-lg border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</p> : null}
        </header>

        <div className="relative flex min-h-0 flex-1">
          <Sidebar sidebarOpen={sidebarOpen} searchQuery={searchQuery} strings={filteredStrings} selectedStringId={selectedString} onSearchQueryChange={setSearchQuery} onSelectString={handleSelectString} onNewString={handleNewString} onCloseMobile={() => setSidebarOpen(false)} />
          <div className="flex min-w-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              <ChatHeader title={selected?.title ?? "No String Selected"} mode={mode} teamPanelOpen={teamPanelOpen} onTitleChange={handleTitleChange} onModeChange={handleModeChange} onToggleSidebar={() => setSidebarOpen((prev) => !prev)} onToggleTeamPanel={() => setTeamPanelOpen((prev) => !prev)} />
              {selected ? <ChatWindow mode={mode} messages={selected.messages} /> : <div className="flex flex-1 items-center justify-center p-6"><div className="rounded-2xl border border-dashed border-white/15 bg-black/25 px-6 py-10 text-center"><p className="text-sm font-semibold text-slate-200">No string selected</p><p className="mt-2 text-sm text-slate-500">Create your first string to start discussion or direction mode.</p><button type="button" onClick={handleNewString} className="mt-4 rounded-full border border-cyan-500/35 bg-cyan-500/12 px-4 py-2 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-500/20">Create String</button></div></div>}
              {selected ? <ChatInput mode={mode} value={draft} disabled={sending || syncing} submitting={sending} onValueChange={setDraft} onSend={handleSend} /> : null}
            </div>
            <TeamPanel open={teamPanelOpen} collaborators={collaborators} groups={groups} onInvite={() => setInviteOpen(true)} onCreateGroup={() => setCreateGroupOpen(true)} onRemove={(id) => removeActiveUser(id)} onRemoveGroup={(id) => setGroups((prev) => prev.filter((item) => item.id !== id))} onUseGroup={handleUseGroupInChat} onCloseMobile={() => setTeamPanelOpen(false)} />
          </div>
        </div>
      </div>

      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} onInvite={handleInvite} />
      <CreateGroupModal open={createGroupOpen} collaborators={workforceMembers} onClose={() => setCreateGroupOpen(false)} onCreate={handleCreateGroup} />
    </div>
  );
}
