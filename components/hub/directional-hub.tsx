"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Loader2, RefreshCw } from "lucide-react";

import type { ChatMessage, ChatString } from "@/components/chat-ui/types";
import { parseJsonResponse } from "@/lib/http/json-response";
import { useVorldXStore } from "@/lib/store/vorldx-store";

interface DirectionRecord {
  id: string;
  title: string;
  summary: string;
  direction: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  ownerEmail: string | null;
  ownerName?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PlanPrimary {
  detailScore?: number;
  workflows?: Array<{
    title?: string;
    tasks?: Array<{ title?: string }>;
  }>;
}

interface PlanRecord {
  id: string;
  title: string;
  summary: string;
  direction: string;
  directionId: string | null;
  createdAt: string;
  updatedAt: string;
  primaryPlan?: PlanPrimary;
}

interface DirectionWorkflow {
  id: string;
  status: string;
  progress: number;
  taskCount: number;
  pausedTaskCount?: number;
  prompt?: string;
  updatedAt: string;
  createdAt?: string;
}

interface StringsResponse {
  ok?: boolean;
  message?: string;
  strings?: ChatString[];
}

interface DirectionsResponse {
  ok?: boolean;
  message?: string;
  directions?: DirectionRecord[];
}

interface PlansResponse {
  ok?: boolean;
  message?: string;
  plans?: PlanRecord[];
}

interface WorkflowsResponse {
  ok?: boolean;
  message?: string;
  workflows?: DirectionWorkflow[];
}

interface HubStringRecord {
  id: string;
  title: string;
  summary: string;
  directionBody: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  ownerLabel: string;
  mode: "discussion" | "direction";
  source: "workspace" | "direction" | "plan";
  selectedTeamLabel: string | null;
  createdAt: string;
  updatedAt: string;
  directionId: string | null;
  planId: string | null;
  workflowCount: number;
  taskCount: number;
  detailScore: number | null;
}

interface DirectionalHubProps {
  orgId: string;
  themeStyle: {
    border: string;
  };
}

function monthKey(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : `${date.getFullYear()}-${date.getMonth() + 1}`;
}

function monthLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown"
    : date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function dayLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown"
    : date.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

function nowIso() {
  return new Date().toISOString();
}

function toMs(value: string | undefined) {
  const parsed = new Date(value ?? "").getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizeText(value: string | null | undefined) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function trimTitle(value: string, fallback: string) {
  const next = normalizeText(value);
  if (!next) {
    return fallback;
  }
  return next.length > 72 ? `${next.slice(0, 69)}...` : next;
}

function buildDraftSummary(state: ChatString["workspaceState"] | undefined) {
  const editableDraft =
    state?.editableDraft &&
    typeof state.editableDraft === "object" &&
    !Array.isArray(state.editableDraft)
      ? (state.editableDraft as Record<string, unknown>)
      : null;
  const plan =
    editableDraft?.plan &&
    typeof editableDraft.plan === "object" &&
    !Array.isArray(editableDraft.plan)
      ? (editableDraft.plan as Record<string, unknown>)
      : null;
  return normalizeText(typeof plan?.summary === "string" ? plan.summary : "");
}

function buildDraftDirection(state: ChatString["workspaceState"] | undefined) {
  const editableDraft =
    state?.editableDraft &&
    typeof state.editableDraft === "object" &&
    !Array.isArray(state.editableDraft)
      ? (state.editableDraft as Record<string, unknown>)
      : null;
  return normalizeText(typeof editableDraft?.direction === "string" ? editableDraft.direction : "");
}

function buildDraftDetailScore(state: ChatString["workspaceState"] | undefined) {
  const editableDraft =
    state?.editableDraft &&
    typeof state.editableDraft === "object" &&
    !Array.isArray(state.editableDraft)
      ? (state.editableDraft as Record<string, unknown>)
      : null;
  const scoring =
    editableDraft?.scoring &&
    typeof editableDraft.scoring === "object" &&
    !Array.isArray(editableDraft.scoring)
      ? (editableDraft.scoring as Record<string, unknown>)
      : null;
  const raw = normalizeText(typeof scoring?.detailScore === "string" ? scoring.detailScore : "");
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.max(0, Math.min(100, parsed));
}

function buildMessageSummary(messages: ChatMessage[]) {
  return [...messages]
    .reverse()
    .map((message) =>
      normalizeText(message.direction?.summary || message.direction?.objective || message.content)
    )
    .find(Boolean);
}

function buildDerivedStrings(strings: ChatString[], directions: DirectionRecord[], plans: PlanRecord[]) {
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

      return {
        id: `direction:${direction.id}`,
        title: trimTitle(direction.title || direction.direction || "Direction", "Direction"),
        mode: "direction",
        updatedAt,
        createdAt,
        directionId: direction.id,
        planId: linkedPlan?.id ?? null,
        source: linkedPlan ? "plan" : "direction",
        persisted: true,
        messages: []
      };
    });

  const orphanPlanStrings = plans
    .filter((plan) => !plan.directionId && !knownPlanIds.has(plan.id))
    .map<ChatString>((plan) => ({
      id: `plan:${plan.id}`,
      title: trimTitle(plan.title || plan.direction || "Execution plan", "Execution plan"),
      mode: "direction",
      updatedAt: plan.updatedAt || plan.createdAt || nowIso(),
      createdAt: plan.createdAt || nowIso(),
      planId: plan.id,
      source: "plan",
      persisted: true,
      messages: []
    }));

  return [...strings, ...directionStrings, ...orphanPlanStrings].sort(
    (left, right) => toMs(right.updatedAt) - toMs(left.updatedAt)
  );
}

function buildHubStrings(strings: ChatString[], directions: DirectionRecord[], plans: PlanRecord[]) {
  const directionById = new Map(directions.map((item) => [item.id, item] as const));
  const planById = new Map(plans.map((item) => [item.id, item] as const));

  return buildDerivedStrings(strings, directions, plans).map<HubStringRecord>((string) => {
    const linkedDirection = string.directionId ? directionById.get(string.directionId) ?? null : null;
    const linkedPlan = string.planId ? planById.get(string.planId) ?? null : null;
    const draftSummary = buildDraftSummary(string.workspaceState);
    const draftDirection = buildDraftDirection(string.workspaceState);
    const messageSummary = buildMessageSummary(string.messages);
    const detailScore =
      buildDraftDetailScore(string.workspaceState) ??
      (typeof linkedPlan?.primaryPlan?.detailScore === "number"
        ? Math.max(0, Math.min(100, Math.floor(linkedPlan.primaryPlan.detailScore)))
        : null);
    const workflows = Array.isArray(linkedPlan?.primaryPlan?.workflows)
      ? linkedPlan?.primaryPlan?.workflows ?? []
      : [];

    return {
      id: string.id,
      title: trimTitle(
        string.title || linkedDirection?.title || linkedPlan?.title || "String",
        "String"
      ),
      summary:
        draftSummary ||
        normalizeText(linkedPlan?.summary) ||
        normalizeText(linkedDirection?.summary) ||
        messageSummary ||
        "No summary added yet.",
      directionBody:
        draftDirection ||
        normalizeText(linkedDirection?.direction) ||
        normalizeText(linkedPlan?.direction) ||
        messageSummary ||
        "No direction context captured yet.",
      status: linkedDirection?.status ?? (linkedPlan ? "ACTIVE" : "DRAFT"),
      ownerLabel:
        linkedDirection?.ownerName ||
        linkedDirection?.ownerEmail ||
        (string.updatedByUserId ? `User ${string.updatedByUserId.slice(0, 8)}` : "Shared string"),
      mode: string.mode === "direction" ? "direction" : "discussion",
      source: string.source ?? "workspace",
      selectedTeamLabel: string.selectedTeamLabel ?? null,
      createdAt: string.createdAt || string.updatedAt || nowIso(),
      updatedAt: string.updatedAt || string.createdAt || nowIso(),
      directionId: string.directionId ?? null,
      planId: string.planId ?? null,
      workflowCount: workflows.length,
      taskCount: workflows.reduce(
        (total, workflow) => total + (Array.isArray(workflow.tasks) ? workflow.tasks.length : 0),
        0
      ),
      detailScore
    };
  });
}

export function DirectionalHub({ orgId, themeStyle }: DirectionalHubProps) {
  const notify = useVorldXStore((state) => state.pushNotification);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [strings, setStrings] = useState<HubStringRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [workflows, setWorkflows] = useState<DirectionWorkflow[]>([]);

  const loadStrings = useCallback(
    async (silent?: boolean) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        const [stringsResponse, directionsResponse, plansResponse] = await Promise.all([
          fetch(`/api/strings?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" }),
          fetch(`/api/directions?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" }),
          fetch(`/api/plans?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" })
        ]);

        const [
          { payload: stringsPayload, rawText: stringsRaw },
          { payload: directionsPayload, rawText: directionsRaw },
          { payload: plansPayload, rawText: plansRaw }
        ] = await Promise.all([
          parseJsonResponse<StringsResponse>(stringsResponse),
          parseJsonResponse<DirectionsResponse>(directionsResponse),
          parseJsonResponse<PlansResponse>(plansResponse)
        ]);

        if (!stringsResponse.ok || !stringsPayload?.ok) {
          throw new Error(
            stringsPayload?.message ??
              (stringsRaw
                ? `Failed loading strings (${stringsResponse.status}): ${stringsRaw.slice(0, 180)}`
                : "Failed loading strings.")
          );
        }
        if (!directionsResponse.ok || !directionsPayload?.ok) {
          throw new Error(
            directionsPayload?.message ??
              (directionsRaw
                ? `Failed loading directions (${directionsResponse.status}): ${directionsRaw.slice(0, 180)}`
                : "Failed loading directions.")
          );
        }
        if (!plansResponse.ok || !plansPayload?.ok) {
          throw new Error(
            plansPayload?.message ??
              (plansRaw
                ? `Failed loading plans (${plansResponse.status}): ${plansRaw.slice(0, 180)}`
                : "Failed loading plans.")
          );
        }

        const nextStrings = buildHubStrings(
          Array.isArray(stringsPayload.strings) ? stringsPayload.strings : [],
          Array.isArray(directionsPayload.directions) ? directionsPayload.directions : [],
          Array.isArray(plansPayload.plans) ? plansPayload.plans : []
        );

        setStrings(nextStrings);
        setSelectedId((current) =>
          current && nextStrings.some((item) => item.id === current)
            ? current
            : nextStrings[0]?.id ?? null
        );
      } catch (error) {
        notify({
          title: "Strings Hub",
          message: error instanceof Error ? error.message : "Unable to load string data.",
          type: "error"
        });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [notify, orgId]
  );

  const loadStringWorkflows = useCallback(
    async (stringRecord: HubStringRecord) => {
      if (!stringRecord.directionId) {
        setWorkflows([]);
        return;
      }

      setDetailLoading(true);
      try {
        const response = await fetch(
          `/api/directions/${stringRecord.directionId}/workflows?orgId=${encodeURIComponent(orgId)}`,
          { cache: "no-store" }
        );
        const { payload, rawText } = await parseJsonResponse<WorkflowsResponse>(response);
        if (!response.ok || !payload?.ok || !payload?.workflows) {
          throw new Error(
            payload?.message ??
              (rawText
                ? `Failed loading string workflows (${response.status}): ${rawText.slice(0, 180)}`
                : "Failed loading string workflows.")
          );
        }
        setWorkflows(payload.workflows);
      } catch (error) {
        notify({
          title: "Strings Hub",
          message: error instanceof Error ? error.message : "Unable to load workflow details.",
          type: "error"
        });
      } finally {
        setDetailLoading(false);
      }
    },
    [notify, orgId]
  );

  useEffect(() => {
    void loadStrings();
    const timer = setInterval(() => void loadStrings(true), 12000);
    return () => clearInterval(timer);
  }, [loadStrings]);

  const selectedString = useMemo(
    () => strings.find((string) => string.id === selectedId) ?? null,
    [selectedId, strings]
  );

  useEffect(() => {
    if (!selectedString) {
      setWorkflows([]);
      return;
    }
    void loadStringWorkflows(selectedString);
    const timer = setInterval(() => void loadStringWorkflows(selectedString), 12000);
    return () => clearInterval(timer);
  }, [loadStringWorkflows, selectedString]);

  const groupedStrings = useMemo(() => {
    const groups = new Map<string, { label: string; items: HubStringRecord[] }>();
    for (const string of strings) {
      const key = monthKey(string.updatedAt);
      const current = groups.get(key);
      if (current) current.items.push(string);
      else groups.set(key, { label: monthLabel(string.updatedAt), items: [string] });
    }

    return [...groups.entries()]
      .sort((left, right) => right[0].localeCompare(left[0]))
      .map(([, value]) => ({
        label: value.label,
        items: value.items.sort((left, right) => toMs(right.updatedAt) - toMs(left.updatedAt))
      }));
  }, [strings]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">Strings Hub</p>
          <p className="text-xs text-slate-500">
            Shared strings with linked direction, plan, and workflow outcomes.
          </p>
        </div>
        <button
          onClick={() => void loadStrings(true)}
          className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-300"
        >
          {refreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Refresh
        </button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className={`vx-panel rounded-3xl p-4 ${themeStyle.border}`}>
          {loading ? (
            <div className="inline-flex items-center gap-2 text-sm text-slate-400">
              <Loader2 size={14} className="animate-spin" />
              Loading strings...
            </div>
          ) : groupedStrings.length === 0 ? (
            <p className="rounded-2xl border border-white/10 bg-black/25 px-4 py-4 text-sm text-slate-500">
              No strings in this organization yet.
            </p>
          ) : (
            <div className="space-y-5">
              {groupedStrings.map((group) => (
                <section key={group.label} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <CalendarDays size={13} className="text-slate-500" />
                    <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                      {group.label}
                    </p>
                  </div>
                  <div className="vx-scrollbar flex gap-3 overflow-x-auto pb-2">
                    {group.items.map((string) => (
                      <button
                        key={string.id}
                        onClick={() => setSelectedId(string.id)}
                        className={`min-w-[250px] max-w-[290px] flex-none rounded-3xl border p-4 text-left transition ${
                          selectedId === string.id
                            ? "border-emerald-500/40 bg-emerald-500/10"
                            : "border-white/10 bg-black/25 hover:bg-white/5"
                        }`}
                      >
                        <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                          {dayLabel(string.updatedAt)}
                        </p>
                        <p className="mt-2 line-clamp-2 text-sm font-semibold text-slate-100">
                          {string.title}
                        </p>
                        <p className="mt-2 line-clamp-3 text-xs text-slate-400">{string.summary}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-300">
                            {string.status}
                          </span>
                          <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-300">
                            {string.mode}
                          </span>
                          {string.workflowCount > 0 ? (
                            <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-cyan-300">
                              {string.workflowCount} workflow{string.workflowCount === 1 ? "" : "s"}
                            </span>
                          ) : null}
                          {typeof string.detailScore === "number" ? (
                            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-emerald-300">
                              Detail {string.detailScore}
                            </span>
                          ) : null}
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        <div className={`vx-panel rounded-3xl p-4 ${themeStyle.border}`}>
          {selectedString ? (
            <div className="space-y-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                  Selected String
                </p>
                <h3 className="mt-2 text-xl font-semibold text-slate-100">{selectedString.title}</h3>
                <p className="mt-2 text-sm text-slate-400">{selectedString.summary}</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Status</p>
                  <p className="mt-1 text-sm font-semibold text-slate-100">{selectedString.status}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Owner</p>
                  <p className="mt-1 text-sm font-semibold text-slate-100">{selectedString.ownerLabel}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Created</p>
                  <p className="mt-1 text-sm font-semibold text-slate-100">
                    {new Date(selectedString.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Updated</p>
                  <p className="mt-1 text-sm font-semibold text-slate-100">
                    {new Date(selectedString.updatedAt).toLocaleString()}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Source</p>
                  <p className="mt-1 text-sm font-semibold text-slate-100">{selectedString.source}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Team</p>
                  <p className="mt-1 text-sm font-semibold text-slate-100">
                    {selectedString.selectedTeamLabel || "No team linked"}
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                  Direction Context
                </p>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-300">
                  {selectedString.directionBody}
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                  Linked Workflows
                </p>
                <div className="mt-3 space-y-2">
                  {!selectedString.directionId ? (
                    <p className="text-sm text-slate-500">
                      No direction record is linked to this string yet.
                    </p>
                  ) : detailLoading ? (
                    <div className="inline-flex items-center gap-2 text-sm text-slate-400">
                      <Loader2 size={14} className="animate-spin" />
                      Loading workflow links...
                    </div>
                  ) : workflows.length === 0 ? (
                    <p className="text-sm text-slate-500">No workflows linked to this string yet.</p>
                  ) : (
                    workflows.map((workflow) => (
                      <article key={workflow.id} className="rounded-2xl border border-white/10 bg-black/35 p-3">
                        <p className="text-sm font-semibold text-slate-100">
                          Workflow {workflow.id.slice(0, 8)}
                        </p>
                        <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                          {workflow.status} | Progress {workflow.progress}% | Tasks {workflow.taskCount}
                          {typeof workflow.pausedTaskCount === "number"
                            ? ` | Paused ${workflow.pausedTaskCount}`
                            : ""}
                        </p>
                        {workflow.prompt ? (
                          <p className="mt-2 line-clamp-3 text-xs text-slate-400">{workflow.prompt}</p>
                        ) : null}
                      </article>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : (
            <p className="rounded-2xl border border-white/10 bg-black/25 px-4 py-4 text-sm text-slate-500">
              Select a string from the timeline gallery.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
