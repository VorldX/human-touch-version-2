"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { useVorldXStore } from "@/lib/store/vorldx-store";

interface DirectionRecord {
  id: string;
  title: string;
  summary: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  ownerEmail: string | null;
  updatedAt: string;
}

interface DirectionWorkflow {
  id: string;
  status: string;
  progress: number;
  taskCount: number;
  updatedAt: string;
}

interface DirectionalHubProps {
  orgId: string;
  themeStyle: {
    border: string;
  };
}

export function DirectionalHub({ orgId, themeStyle }: DirectionalHubProps) {
  const notify = useVorldXStore((state) => state.pushNotification);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
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
        const payload = (await response.json()) as {
          ok?: boolean;
          message?: string;
          directions?: DirectionRecord[];
        };
        if (!response.ok || !payload.ok || !payload.directions) {
          throw new Error(payload.message ?? "Failed loading directions.");
        }
        setDirections(payload.directions);
        if (!selectedId && payload.directions[0]) {
          setSelectedId(payload.directions[0].id);
        }
      } catch (error) {
        notify({
          title: "Directional Hub",
          message: error instanceof Error ? error.message : "Unable to load direction data.",
          type: "error"
        });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [notify, orgId, selectedId]
  );

  const loadDirectionWorkflows = useCallback(
    async (directionId: string) => {
      const response = await fetch(
        `/api/directions/${directionId}/workflows?orgId=${encodeURIComponent(orgId)}`,
        { cache: "no-store" }
      );
      const payload = (await response.json()) as {
        ok?: boolean;
        message?: string;
        workflows?: DirectionWorkflow[];
      };
      if (!response.ok || !payload.ok || !payload.workflows) {
        throw new Error(payload.message ?? "Failed loading direction workflows.");
      }
      setWorkflows(payload.workflows);
    },
    [orgId]
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">Directional Hub</p>
        <button
          onClick={() => void loadDirections(true)}
          className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-300"
        >
          {refreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Refresh
        </button>
      </div>

      <div className="grid gap-3 2xl:grid-cols-[1fr_1fr]">
        <div className={`vx-panel rounded-2xl p-3 ${themeStyle.border}`}>
          {loading ? (
            <div className="inline-flex items-center gap-2 text-sm text-slate-400">
              <Loader2 size={14} className="animate-spin" />
              Loading directions...
            </div>
          ) : directions.length === 0 ? (
            <p className="text-xs text-slate-500">No directions in organization yet.</p>
          ) : (
            <div className="space-y-2">
              {directions.map((direction) => (
                <button
                  key={direction.id}
                  onClick={() => setSelectedId(direction.id)}
                  className={`w-full rounded-xl border p-3 text-left ${
                    selectedId === direction.id
                      ? "border-emerald-500/40 bg-emerald-500/10"
                      : "border-white/10 bg-black/25"
                  }`}
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white">
                    {direction.title}
                  </p>
                  <p className="line-clamp-2 text-xs text-slate-400">{direction.summary}</p>
                  <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                    {direction.status} | {direction.ownerEmail ?? "unassigned"}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={`vx-panel rounded-2xl p-3 ${themeStyle.border}`}>
          <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
            Workflows Created For Selected Direction
          </p>
          <div className="mt-2 space-y-2">
            {selectedId === null ? (
              <p className="text-xs text-slate-500">Select a direction.</p>
            ) : workflows.length === 0 ? (
              <p className="text-xs text-slate-500">No workflows linked to this direction.</p>
            ) : (
              workflows.map((workflow) => (
                <article key={workflow.id} className="rounded-xl border border-white/10 bg-black/25 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white">
                    Workflow {workflow.id.slice(0, 8)}
                  </p>
                  <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                    {workflow.status} | Progress {workflow.progress}% | Tasks {workflow.taskCount}
                  </p>
                  <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                    Updated {new Date(workflow.updatedAt).toLocaleString()}
                  </p>
                </article>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
