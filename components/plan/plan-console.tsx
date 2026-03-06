"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Save } from "lucide-react";

import { useVorldXStore } from "@/lib/store/vorldx-store";

type PlanStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";
type PlanSource = "MANUAL" | "CHAT" | "SYSTEM";

interface PlanRecord {
  id: string;
  orgId: string;
  title: string;
  summary: string;
  direction: string;
  directionId: string | null;
  humanPlan: string;
  primaryPlan: Record<string, unknown>;
  fallbackPlan: Record<string, unknown>;
  status: PlanStatus;
  source: PlanSource;
  ownerEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PlanConsoleProps {
  orgId: string;
  themeStyle: {
    accent?: string;
    accentSoft?: string;
    border: string;
  };
}

function toPrettyJson(value: Record<string, unknown>) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "{}";
  }
}

function parseJsonObject(raw: string, label: string) {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    throw new Error(`${label} must be a JSON object.`);
  } catch (error) {
    throw new Error(
      error instanceof Error ? `${label}: ${error.message}` : `${label}: invalid JSON.`
    );
  }
}

async function parseJsonResponse<T>(response: Response): Promise<{
  payload: T | null;
  rawText: string;
}> {
  const rawText = await response.text();
  if (!rawText) {
    return { payload: null, rawText: "" };
  }
  try {
    return {
      payload: JSON.parse(rawText) as T,
      rawText
    };
  } catch {
    return {
      payload: null,
      rawText
    };
  }
}

export function PlanConsole({ orgId, themeStyle }: PlanConsoleProps) {
  const notify = useVorldXStore((state) => state.pushNotification);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [titleDraft, setTitleDraft] = useState("");
  const [summaryDraft, setSummaryDraft] = useState("");
  const [directionDraft, setDirectionDraft] = useState("");
  const [humanPlanDraft, setHumanPlanDraft] = useState("");
  const [primaryPlanDraft, setPrimaryPlanDraft] = useState("{}");
  const [fallbackPlanDraft, setFallbackPlanDraft] = useState("{}");
  const [statusDraft, setStatusDraft] = useState<PlanStatus>("ACTIVE");

  const selectedPlan = useMemo(
    () => plans.find((item) => item.id === selectedPlanId) ?? null,
    [plans, selectedPlanId]
  );

  const loadPlans = useCallback(
    async (silent?: boolean) => {
      if (silent) setRefreshing(true);
      else setLoading(true);

      try {
        const response = await fetch(`/api/plans?orgId=${encodeURIComponent(orgId)}`, {
          cache: "no-store"
        });
        const { payload, rawText } = await parseJsonResponse<{
          ok?: boolean;
          message?: string;
          plans?: PlanRecord[];
        }>(response);
        if (!response.ok || !payload?.ok || !payload.plans) {
          throw new Error(
            payload?.message ??
              (rawText ? `Failed loading plans (${response.status}): ${rawText.slice(0, 180)}` : "Failed loading plans.")
          );
        }
        setPlans(payload.plans);
        setError(null);

        const hasSelected = Boolean(
          selectedPlanId && payload.plans.some((item) => item.id === selectedPlanId)
        );
        if (!hasSelected) {
          setSelectedPlanId(payload.plans[0]?.id ?? null);
        }
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Failed loading plans.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [orgId, selectedPlanId]
  );

  useEffect(() => {
    void loadPlans();
    const interval = setInterval(() => void loadPlans(true), 15000);
    return () => clearInterval(interval);
  }, [loadPlans]);

  useEffect(() => {
    if (!selectedPlan) return;
    setTitleDraft(selectedPlan.title);
    setSummaryDraft(selectedPlan.summary);
    setDirectionDraft(selectedPlan.direction);
    setHumanPlanDraft(selectedPlan.humanPlan);
    setPrimaryPlanDraft(toPrettyJson(selectedPlan.primaryPlan));
    setFallbackPlanDraft(toPrettyJson(selectedPlan.fallbackPlan));
    setStatusDraft(selectedPlan.status);
  }, [selectedPlan]);

  const savePlan = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!selectedPlanId) return;

      setSaving(true);
      try {
        const primary = parseJsonObject(primaryPlanDraft, "Primary plan JSON");
        const fallback = parseJsonObject(fallbackPlanDraft, "Fallback plan JSON");

        const response = await fetch(`/api/plans/${selectedPlanId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            orgId,
            title: titleDraft,
            summary: summaryDraft,
            direction: directionDraft,
            humanPlan: humanPlanDraft,
            primaryPlan: primary,
            fallbackPlan: fallback,
            status: statusDraft
          })
        });

        const { payload, rawText } = await parseJsonResponse<{
          ok?: boolean;
          message?: string;
          plan?: PlanRecord;
        }>(response);
        if (!response.ok || !payload?.ok || !payload.plan) {
          throw new Error(
            payload?.message ??
              (rawText ? `Save failed (${response.status}): ${rawText.slice(0, 180)}` : "Save failed.")
          );
        }

        notify({
          title: "Plan",
          message: "Plan updated.",
          type: "success"
        });
        await loadPlans(true);
      } catch (requestError) {
        notify({
          title: "Plan",
          message: requestError instanceof Error ? requestError.message : "Save failed.",
          type: "error"
        });
      } finally {
        setSaving(false);
      }
    },
    [
      directionDraft,
      fallbackPlanDraft,
      humanPlanDraft,
      loadPlans,
      notify,
      orgId,
      primaryPlanDraft,
      selectedPlanId,
      statusDraft,
      summaryDraft,
      titleDraft
    ]
  );

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
        <div>
          <h2 className="font-display text-3xl font-black uppercase tracking-tight md:text-4xl">Plan</h2>
          <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">
            Human + AI Editable Plans
          </p>
        </div>
        <button
          onClick={() => void loadPlans(true)}
          className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-200"
        >
          {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid gap-4 2xl:grid-cols-[360px_1fr]">
        <div className={`vx-panel space-y-2 rounded-3xl p-4 ${themeStyle.border}`}>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-300">Plan History</p>
          {loading ? (
            <div className="inline-flex items-center gap-2 text-xs text-slate-400">
              <Loader2 size={12} className="animate-spin" />
              Loading plans...
            </div>
          ) : plans.length === 0 ? (
            <p className="rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-xs text-slate-500">
              No plans created yet. Generate from Control to Direction mode.
            </p>
          ) : (
            <div className="space-y-2">
              {plans.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSelectedPlanId(item.id)}
                  className={`w-full rounded-2xl border p-3 text-left ${
                    selectedPlanId === item.id
                      ? "border-emerald-500/40 bg-emerald-500/10"
                      : "border-white/10 bg-black/25"
                  }`}
                >
                  <p className="line-clamp-1 text-xs font-semibold uppercase tracking-[0.14em] text-white">
                    {item.title}
                  </p>
                  <p className="line-clamp-2 text-xs text-slate-400">
                    {item.summary || item.direction}
                  </p>
                  <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                    {item.status} | {item.source} | {new Date(item.updatedAt).toLocaleString()}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>

        <form onSubmit={savePlan} className={`vx-panel space-y-3 rounded-3xl p-4 ${themeStyle.border}`}>
          {!selectedPlan ? (
            <p className="text-sm text-slate-400">Select a plan from history.</p>
          ) : (
            <>
              <div className="grid gap-2 md:grid-cols-2">
                <input
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  placeholder="Plan title"
                  className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                />
                <select
                  value={statusDraft}
                  onChange={(event) => setStatusDraft(event.target.value as PlanStatus)}
                  className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="DRAFT">DRAFT</option>
                  <option value="ARCHIVED">ARCHIVED</option>
                </select>
              </div>

              <textarea
                value={summaryDraft}
                onChange={(event) => setSummaryDraft(event.target.value)}
                placeholder="Plan summary"
                className="h-20 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
              />

              <textarea
                value={directionDraft}
                onChange={(event) => setDirectionDraft(event.target.value)}
                placeholder="Direction"
                className="h-24 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
              />

              <textarea
                value={humanPlanDraft}
                onChange={(event) => setHumanPlanDraft(event.target.value)}
                placeholder="Human editable plan"
                className="h-28 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
              />

              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                    AI Primary Plan JSON
                  </span>
                  <textarea
                    value={primaryPlanDraft}
                    onChange={(event) => setPrimaryPlanDraft(event.target.value)}
                    className="h-72 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-slate-100 outline-none"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                    AI Fallback Plan JSON
                  </span>
                  <textarea
                    value={fallbackPlanDraft}
                    onChange={(event) => setFallbackPlanDraft(event.target.value)}
                    className="h-72 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-slate-100 outline-none"
                  />
                </label>
              </div>

              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-black transition hover:bg-emerald-500 hover:text-white disabled:opacity-60"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                Save Plan
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
