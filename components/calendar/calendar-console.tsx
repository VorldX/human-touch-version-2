"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Loader2,
  PlusCircle,
  RefreshCw,
  Trash2
} from "lucide-react";

import { parseJsonResponse } from "@/lib/http/json-response";
import { getRealtimeClient } from "@/lib/realtime/client";

type CalendarScope = "ORG" | "USER";
type CalendarActorFilter = "ALL" | "HUMAN" | "AI";
type CalendarTemporalFilter = "ALL" | "PAST" | "FUTURE";

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

interface CalendarTimelineEvent {
  id: string;
  orgId: string;
  scope: CalendarScope;
  ownerUserId: string | null;
  title: string;
  detail: string;
  startsAt: string;
  endsAt: string | null;
  actorType: "HUMAN" | "AI";
  actorLabel: string;
  sourceKind:
    | "manual"
    | "command"
    | "plan"
    | "pathway"
    | "flow"
    | "task"
    | "approval"
    | "schedule"
    | "log";
  sourceLabel: string;
  sourceId: string | null;
  live: boolean;
  tags: string[];
  pathway: CalendarPathwayStepRef | null;
  references: {
    directionId?: string;
    planId?: string;
    flowId?: string;
    taskId?: string;
    requestId?: string;
    scheduleId?: string;
  };
}

interface CalendarTimelineSummary {
  total: number;
  live: number;
  human: number;
  ai: number;
  past: number;
  future: number;
}

interface CalendarApiPayload {
  ok?: boolean;
  message?: string;
  month?: string;
  events?: CalendarTimelineEvent[];
  summary?: CalendarTimelineSummary;
}

interface CalendarConsoleProps {
  orgId: string;
  themeStyle: {
    accent: string;
    accentSoft: string;
    border: string;
  };
}

function toMonthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function toDateKey(iso: string) {
  return iso.slice(0, 10);
}

function todayDateKey() {
  return toDateKey(new Date().toISOString());
}

function formatTimeLabel(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function toInputDateTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function actorBadge(actor: "HUMAN" | "AI") {
  return actor === "HUMAN"
    ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-200"
    : "border-cyan-500/35 bg-cyan-500/10 text-cyan-200";
}

export function CalendarConsole({ orgId, themeStyle }: CalendarConsoleProps) {
  const [monthCursor, setMonthCursor] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(todayDateKey());
  const [scope, setScope] = useState<CalendarScope>("ORG");
  const [actorFilter, setActorFilter] = useState<CalendarActorFilter>("ALL");
  const [temporalFilter, setTemporalFilter] = useState<CalendarTemporalFilter>("ALL");
  const [liveOnly, setLiveOnly] = useState(false);
  const [events, setEvents] = useState<CalendarTimelineEvent[]>([]);
  const [summary, setSummary] = useState<CalendarTimelineSummary>({
    total: 0,
    live: 0,
    human: 0,
    ai: 0,
    past: 0,
    future: 0
  });
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [draftTitle, setDraftTitle] = useState("");
  const [draftDetail, setDraftDetail] = useState("");
  const [draftStartsAt, setDraftStartsAt] = useState(() =>
    toInputDateTime(new Date(Date.now() + 30 * 60 * 1000).toISOString())
  );
  const [draftScope, setDraftScope] = useState<CalendarScope>("ORG");
  const [draftSubmitting, setDraftSubmitting] = useState(false);
  const [deleteInFlightEventId, setDeleteInFlightEventId] = useState<string | null>(null);

  const monthKey = useMemo(() => toMonthKey(monthCursor), [monthCursor]);

  useEffect(() => {
    if (selectedDate.startsWith(monthKey)) {
      return;
    }
    const today = todayDateKey();
    setSelectedDate(today.startsWith(monthKey) ? today : `${monthKey}-01`);
  }, [monthKey, selectedDate]);

  const loadEvents = useCallback(
    async (silent?: boolean) => {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);
      try {
        const response = await fetch(
          `/api/calendar/events?orgId=${encodeURIComponent(orgId)}&month=${encodeURIComponent(monthKey)}&scope=${scope}&actor=${actorFilter}&temporal=${temporalFilter}&live=${liveOnly ? "1" : "0"}`,
          { cache: "no-store" }
        );
        const { payload, rawText } = await parseJsonResponse<CalendarApiPayload>(response);
        if (!response.ok || !payload?.ok) {
          throw new Error(
            payload?.message ??
              (rawText
                ? `Failed loading calendar (${response.status}): ${rawText.slice(0, 160)}`
                : "Failed loading calendar.")
          );
        }
        setEvents(payload.events ?? []);
        setSummary(
          payload.summary ?? {
            total: 0,
            live: 0,
            human: 0,
            ai: 0,
            past: 0,
            future: 0
          }
        );
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed loading calendar.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [actorFilter, liveOnly, monthKey, orgId, scope, temporalFilter]
  );

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    const socket = getRealtimeClient();
    if (!socket) {
      return;
    }
    const refresh = () => {
      void loadEvents(true);
    };
    const eventNames = [
      "flow.created",
      "flow.updated",
      "flow.progress",
      "agent.delegated",
      "task.paused",
      "task.resumed",
      "task.completed",
      "task.failed",
      "flow.rewound",
      "kill-switch.triggered"
    ];
    for (const eventName of eventNames) {
      socket.on(eventName, refresh);
    }
    return () => {
      for (const eventName of eventNames) {
        socket.off(eventName, refresh);
      }
    };
  }, [loadEvents]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const event of events) {
      const key = toDateKey(event.startsAt);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [events]);

  const selectedDayEvents = useMemo(
    () =>
      events
        .filter((event) => toDateKey(event.startsAt) === selectedDate)
        .sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime()),
    [events, selectedDate]
  );

  const monthGridDays = useMemo(() => {
    const year = monthCursor.getUTCFullYear();
    const month = monthCursor.getUTCMonth();
    const monthStart = new Date(Date.UTC(year, month, 1));
    const gridStart = new Date(monthStart);
    gridStart.setUTCDate(1 - monthStart.getUTCDay());
    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(gridStart);
      day.setUTCDate(gridStart.getUTCDate() + index);
      return day;
    });
  }, [monthCursor]);

  const submitManualEvent = useCallback(async () => {
    const title = draftTitle.trim();
    if (!title || !draftStartsAt) {
      return;
    }
    setDraftSubmitting(true);
    setError(null);
    try {
      const startsAtIso = new Date(draftStartsAt).toISOString();
      const response = await fetch("/api/calendar/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          orgId,
          title,
          detail: draftDetail.trim(),
          startsAt: startsAtIso,
          scope: draftScope,
          actorType: "HUMAN"
        })
      });
      const { payload, rawText } = await parseJsonResponse<{ ok?: boolean; message?: string }>(response);
      if (!response.ok || !payload?.ok) {
        throw new Error(
          payload?.message ??
            (rawText
              ? `Failed creating event (${response.status}): ${rawText.slice(0, 150)}`
              : "Failed creating event.")
        );
      }
      setDraftTitle("");
      setDraftDetail("");
      void loadEvents(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed creating event.");
    } finally {
      setDraftSubmitting(false);
    }
  }, [draftDetail, draftScope, draftStartsAt, draftTitle, loadEvents, orgId]);

  const deleteManualEvent = useCallback(
    async (event: CalendarTimelineEvent) => {
      if (event.sourceKind !== "manual" || !event.sourceId) {
        return;
      }
      setDeleteInFlightEventId(event.id);
      setError(null);
      try {
        const response = await fetch(
          `/api/calendar/events/${encodeURIComponent(event.sourceId)}?orgId=${encodeURIComponent(orgId)}`,
          {
            method: "DELETE"
          }
        );
        const { payload, rawText } = await parseJsonResponse<{ ok?: boolean; message?: string }>(response);
        if (!response.ok || !payload?.ok) {
          throw new Error(
            payload?.message ??
              (rawText
                ? `Failed deleting event (${response.status}): ${rawText.slice(0, 140)}`
                : "Failed deleting event.")
          );
        }
        void loadEvents(true);
      } catch (deleteError) {
        setError(deleteError instanceof Error ? deleteError.message : "Failed deleting event.");
      } finally {
        setDeleteInFlightEventId(null);
      }
    },
    [loadEvents, orgId]
  );

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/25 p-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Calendar</p>
          <h2 className="mt-1 inline-flex items-center gap-2 text-xl font-semibold text-white">
            <CalendarDays size={20} className={themeStyle.accent} />
            Timeline + Pathway
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Human + AI history, live activity, and scheduled execution windows.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadEvents(true)}
          className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10"
        >
          {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          Refresh
        </button>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(300px,360px)_1fr]">
        <div className={`vx-panel rounded-2xl border p-3 ${themeStyle.border}`}>
          <div className="mb-3 grid gap-2">
            <div className="inline-flex rounded-full border border-white/15 bg-black/35 p-1">
              <button
                onClick={() => setScope("ORG")}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold ${scope === "ORG" ? "bg-cyan-500/20 text-cyan-100" : "text-slate-300"}`}
              >
                Org
              </button>
              <button
                onClick={() => setScope("USER")}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold ${scope === "USER" ? "bg-cyan-500/20 text-cyan-100" : "text-slate-300"}`}
              >
                My
              </button>
            </div>

            <div className="inline-flex rounded-full border border-white/15 bg-black/35 p-1">
              {(["ALL", "HUMAN", "AI"] as const).map((entry) => (
                <button
                  key={entry}
                  onClick={() => setActorFilter(entry)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ${actorFilter === entry ? "bg-cyan-500/20 text-cyan-100" : "text-slate-300"}`}
                >
                  {entry}
                </button>
              ))}
            </div>

            <div className="inline-flex rounded-full border border-white/15 bg-black/35 p-1">
              {(["ALL", "PAST", "FUTURE"] as const).map((entry) => (
                <button
                  key={entry}
                  onClick={() => setTemporalFilter(entry)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ${temporalFilter === entry ? "bg-cyan-500/20 text-cyan-100" : "text-slate-300"}`}
                >
                  {entry}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setLiveOnly((value) => !value)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${liveOnly ? "border-cyan-400/40 bg-cyan-500/15 text-cyan-100" : "border-white/20 bg-white/5 text-slate-300"}`}
            >
              Live Now {liveOnly ? "On" : "Off"}
            </button>
          </div>

          <div className="mb-3 rounded-xl border border-white/10 bg-black/35 p-2.5 text-xs text-slate-300">
            Total {summary.total} | Live {summary.live} | Human {summary.human} | AI {summary.ai}
          </div>

          <div className="rounded-xl border border-white/10 bg-black/30 p-2">
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setMonthCursor((prev) => new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth() - 1, 1)))}
                className="rounded-full border border-white/20 p-1.5 text-slate-300 transition hover:bg-white/10"
              >
                <ChevronLeft size={14} />
              </button>
              <p className="text-sm font-semibold text-slate-100">
                {monthCursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
              </p>
              <button
                type="button"
                onClick={() => setMonthCursor((prev) => new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth() + 1, 1)))}
                className="rounded-full border border-white/20 p-1.5 text-slate-300 transition hover:bg-white/10"
              >
                <ChevronRight size={14} />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center text-[10px] uppercase tracking-[0.14em] text-slate-500">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {monthGridDays.map((day) => {
                const dayIso = day.toISOString();
                const dayKey = toDateKey(dayIso);
                const isCurrentMonth = day.getUTCMonth() === monthCursor.getUTCMonth();
                const isSelected = selectedDate === dayKey;
                const count = eventsByDay.get(dayKey) ?? 0;
                return (
                  <button
                    key={dayIso}
                    type="button"
                    onClick={() => setSelectedDate(dayKey)}
                    className={`rounded-lg border px-1 py-1.5 text-xs transition ${isSelected ? "border-cyan-400/45 bg-cyan-500/15 text-cyan-100" : isCurrentMonth ? "border-white/10 text-slate-200 hover:bg-white/10" : "border-transparent text-slate-500 hover:bg-white/5"}`}
                  >
                    <div>{day.getUTCDate()}</div>
                    {count > 0 ? (
                      <div className="mt-1 text-[10px] text-cyan-300">{count}</div>
                    ) : (
                      <div className="mt-1 text-[10px] text-transparent">0</div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="vx-panel flex min-h-[560px] flex-col rounded-2xl border border-white/10 bg-black/25 p-3">
          <div className="grid gap-2 rounded-xl border border-white/10 bg-black/30 p-2.5 md:grid-cols-[1fr_1fr_auto]">
            <input
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              placeholder="Add reminder / task title"
              className="w-full rounded-lg border border-white/15 bg-black/35 px-3 py-2 text-sm text-slate-100 outline-none"
            />
            <input
              type="datetime-local"
              value={draftStartsAt}
              onChange={(event) => setDraftStartsAt(event.target.value)}
              className="w-full rounded-lg border border-white/15 bg-black/35 px-3 py-2 text-sm text-slate-100 outline-none"
            />
            <div className="inline-flex rounded-full border border-white/15 bg-black/35 p-1">
              <button
                onClick={() => setDraftScope("ORG")}
                className={`rounded-full px-2 py-1 text-xs ${draftScope === "ORG" ? "bg-cyan-500/20 text-cyan-100" : "text-slate-300"}`}
              >
                Org
              </button>
              <button
                onClick={() => setDraftScope("USER")}
                className={`rounded-full px-2 py-1 text-xs ${draftScope === "USER" ? "bg-cyan-500/20 text-cyan-100" : "text-slate-300"}`}
              >
                My
              </button>
            </div>
            <textarea
              value={draftDetail}
              onChange={(event) => setDraftDetail(event.target.value)}
              placeholder="Optional detail"
              className="md:col-span-2 h-20 w-full resize-none rounded-lg border border-white/15 bg-black/35 px-3 py-2 text-sm text-slate-100 outline-none"
            />
            <button
              type="button"
              onClick={() => void submitManualEvent()}
              disabled={draftSubmitting || !draftTitle.trim() || !draftStartsAt}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-cyan-400/40 bg-cyan-500/15 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-500/25 disabled:opacity-60"
            >
              {draftSubmitting ? <Loader2 size={13} className="animate-spin" /> : <PlusCircle size={13} />}
              Add
            </button>
          </div>

          <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
            <p className="mb-2 text-xs uppercase tracking-[0.16em] text-slate-500">
              Timeline: {selectedDate}
            </p>

            {loading ? (
              <div className="flex h-52 items-center justify-center text-slate-400">
                <Loader2 size={18} className="mr-2 animate-spin" />
                Loading timeline...
              </div>
            ) : selectedDayEvents.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-black/25 p-4 text-sm text-slate-400">
                No events on this date.
              </div>
            ) : (
              <div className="space-y-2">
                {selectedDayEvents.map((event) => (
                  <div key={event.id} className="rounded-xl border border-white/10 bg-black/30 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-100">{event.title}</p>
                        <p className="mt-0.5 text-xs text-slate-400">
                          {formatTimeLabel(event.startsAt)} | {event.sourceLabel}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${actorBadge(event.actorType)}`}>
                          {event.actorType}
                        </span>
                        {event.live ? (
                          <span className="rounded-full border border-cyan-500/35 bg-cyan-500/10 px-2 py-0.5 text-[11px] font-semibold text-cyan-200">
                            LIVE
                          </span>
                        ) : null}
                        {event.sourceKind === "manual" ? (
                          <button
                            type="button"
                            onClick={() => void deleteManualEvent(event)}
                            disabled={deleteInFlightEventId === event.id}
                            className="rounded-full border border-red-500/35 bg-red-500/10 p-1 text-red-200 transition hover:bg-red-500/20 disabled:opacity-60"
                            title="Delete event"
                          >
                            {deleteInFlightEventId === event.id ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <Trash2 size={12} />
                            )}
                          </button>
                        ) : null}
                      </div>
                    </div>

                    {event.detail ? (
                      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-200">{event.detail}</p>
                    ) : null}

                    {event.pathway ? (
                      <div className="mt-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-2 text-xs text-cyan-100">
                        Pathway L{event.pathway.line} | {event.pathway.workflowTitle}{" -> "}
                        {event.pathway.taskTitle} | Owner {event.pathway.ownerRole}
                      </div>
                    ) : null}

                    {event.tags.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {event.tags.slice(0, 6).map((tag) => (
                          <span
                            key={`${event.id}-${tag}`}
                            className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] text-slate-300"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-500/35 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      ) : null}
    </div>
  );
}
