"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Loader2, RefreshCw } from "lucide-react";

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
  tags?: string[];
  impactScore?: number;
  createdAt: string;
  updatedAt: string;
  lastExecutedAt?: string;
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

export function DirectionalHub({ orgId, themeStyle }: DirectionalHubProps) {
  const notify = useVorldXStore((state) => state.pushNotification);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [directions, setDirections] = useState<DirectionRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [workflows, setWorkflows] = useState<DirectionWorkflow[]>([]);

  const loadDirections = useCallback(
    async (silent?: boolean) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        const response = await fetch(`/api/directions?orgId=${encodeURIComponent(orgId)}`, {
          cache: "no-store"
        });
        const { payload, rawText } = await parseJsonResponse<{
          ok?: boolean;
          message?: string;
          directions?: DirectionRecord[];
        }>(response);
        if (!response.ok || !payload?.ok || !payload?.directions) {
          throw new Error(
            payload?.message ??
              (rawText
                ? `Failed loading strings (${response.status}): ${rawText.slice(0, 180)}`
                : "Failed loading strings.")
          );
        }

        const nextDirections = payload.directions.sort(
          (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
        );
        setDirections(nextDirections);
        setSelectedId((current) =>
          current && nextDirections.some((item) => item.id === current)
            ? current
            : nextDirections[0]?.id ?? null
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

  const loadDirectionWorkflows = useCallback(
    async (directionId: string) => {
      setDetailLoading(true);
      try {
        const response = await fetch(
          `/api/directions/${directionId}/workflows?orgId=${encodeURIComponent(orgId)}`,
          { cache: "no-store" }
        );
        const { payload, rawText } = await parseJsonResponse<{
          ok?: boolean;
          message?: string;
          workflows?: DirectionWorkflow[];
        }>(response);
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
    void loadDirections();
    const timer = setInterval(() => void loadDirections(true), 12000);
    return () => clearInterval(timer);
  }, [loadDirections]);

  useEffect(() => {
    if (!selectedId) {
      setWorkflows([]);
      return;
    }
    void loadDirectionWorkflows(selectedId);
    const timer = setInterval(() => void loadDirectionWorkflows(selectedId), 12000);
    return () => clearInterval(timer);
  }, [loadDirectionWorkflows, selectedId]);

  const selectedDirection = useMemo(
    () => directions.find((direction) => direction.id === selectedId) ?? null,
    [directions, selectedId]
  );

  const groupedDirections = useMemo(() => {
    const groups = new Map<string, { label: string; items: DirectionRecord[] }>();
    for (const direction of directions) {
      const key = monthKey(direction.updatedAt);
      const current = groups.get(key);
      if (current) current.items.push(direction);
      else groups.set(key, { label: monthLabel(direction.updatedAt), items: [direction] });
    }

    return [...groups.entries()]
      .sort((left, right) => right[0].localeCompare(left[0]))
      .map(([, value]) => ({
        label: value.label,
        items: value.items.sort(
          (left, right) =>
            new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
        )
      }));
  }, [directions]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">Strings Hub</p>
          <p className="text-xs text-slate-500">
            Timeline gallery for strings with linked workflow context.
          </p>
        </div>
        <button
          onClick={() => void loadDirections(true)}
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
          ) : groupedDirections.length === 0 ? (
            <p className="rounded-2xl border border-white/10 bg-black/25 px-4 py-4 text-sm text-slate-500">
              No strings in this organization yet.
            </p>
          ) : (
            <div className="space-y-5">
              {groupedDirections.map((group) => (
                <section key={group.label} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <CalendarDays size={13} className="text-slate-500" />
                    <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                      {group.label}
                    </p>
                  </div>
                  <div className="vx-scrollbar flex gap-3 overflow-x-auto pb-2">
                    {group.items.map((direction) => (
                      <button
                        key={direction.id}
                        onClick={() => setSelectedId(direction.id)}
                        className={`min-w-[250px] max-w-[280px] flex-none rounded-3xl border p-4 text-left transition ${
                          selectedId === direction.id
                            ? "border-emerald-500/40 bg-emerald-500/10"
                            : "border-white/10 bg-black/25 hover:bg-white/5"
                        }`}
                      >
                        <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                          {dayLabel(direction.updatedAt)}
                        </p>
                        <p className="mt-2 line-clamp-2 text-sm font-semibold text-slate-100">
                          {direction.title}
                        </p>
                        <p className="mt-2 line-clamp-3 text-xs text-slate-400">
                          {direction.summary || direction.direction || "No summary added yet."}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-300">
                            {direction.status}
                          </span>
                          {typeof direction.impactScore === "number" ? (
                            <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-cyan-300">
                              Impact {(direction.impactScore * 100).toFixed(0)}%
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
          {selectedDirection ? (
            <div className="space-y-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                  Selected String
                </p>
                <h3 className="mt-2 text-xl font-semibold text-slate-100">
                  {selectedDirection.title}
                </h3>
                <p className="mt-2 text-sm text-slate-400">
                  {selectedDirection.summary || "No short summary available for this string."}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Status</p>
                  <p className="mt-1 text-sm font-semibold text-slate-100">{selectedDirection.status}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Owner</p>
                  <p className="mt-1 text-sm font-semibold text-slate-100">
                    {selectedDirection.ownerName || selectedDirection.ownerEmail || "Unassigned"}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Created</p>
                  <p className="mt-1 text-sm font-semibold text-slate-100">
                    {new Date(selectedDirection.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Updated</p>
                  <p className="mt-1 text-sm font-semibold text-slate-100">
                    {new Date(selectedDirection.updatedAt).toLocaleString()}
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                  Direction Context
                </p>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-300">
                  {selectedDirection.direction || "No long-form direction body available."}
                </p>
                {selectedDirection.tags && selectedDirection.tags.length > 0 ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {selectedDirection.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-300"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                  Linked Workflows
                </p>
                <div className="mt-3 space-y-2">
                  {detailLoading ? (
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
