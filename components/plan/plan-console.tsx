"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Save } from "lucide-react";

import { useVorldXStore } from "@/lib/store/vorldx-store";

type PlanStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";
type PlanSource = "MANUAL" | "CHAT" | "SYSTEM";
type PlanViewTab = "primary" | "fallback";

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

interface PlanTaskView {
  title: string;
  ownerRole: string;
  subtasks: string[];
  tools: string[];
  requiresApproval: boolean;
  approvalRole: string;
  approvalReason: string;
}

interface PlanWorkflowView {
  title: string;
  goal: string;
  tasks: PlanTaskView[];
}

interface ExecutionPlanView {
  summary: string;
  workflows: PlanWorkflowView[];
  risks: string[];
  successMetrics: string[];
}

interface PlanStepView extends PlanTaskView {
  workflowTitle: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asTrimmedText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asBoolean(value: unknown) {
  return value === true;
}

function asStringList(value: unknown, limit = 12) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeTask(value: unknown): PlanTaskView {
  const record = asRecord(value);
  const ownerRole =
    asTrimmedText(record.ownerRole) ||
    asTrimmedText(record.agentRole) ||
    asTrimmedText(record.agent) ||
    asTrimmedText(record.owner) ||
    "Main Agent";

  return {
    title: asTrimmedText(record.title) || "Untitled task",
    ownerRole,
    subtasks: asStringList(record.subtasks, 10),
    tools: asStringList(record.tools, 10),
    requiresApproval: asBoolean(record.requiresApproval),
    approvalRole: asTrimmedText(record.approvalRole) || "Admin",
    approvalReason: asTrimmedText(record.approvalReason)
  };
}

function normalizeExecutionPlan(value: Record<string, unknown> | null): ExecutionPlanView {
  const record = asRecord(value);
  const workflowRows = Array.isArray(record.workflows) ? record.workflows : [];

  return {
    summary: asTrimmedText(record.summary),
    workflows: workflowRows.slice(0, 12).map((workflow, index) => {
      const workflowRecord = asRecord(workflow);
      const tasks = Array.isArray(workflowRecord.tasks) ? workflowRecord.tasks : [];
      return {
        title: asTrimmedText(workflowRecord.title) || `Workflow ${index + 1}`,
        goal: asTrimmedText(workflowRecord.goal),
        tasks: tasks.slice(0, 24).map((task) => normalizeTask(task))
      };
    }),
    risks: asStringList(record.risks, 12),
    successMetrics: asStringList(record.successMetrics, 12)
  };
}

function flattenPlanSteps(plan: ExecutionPlanView): PlanStepView[] {
  return plan.workflows.flatMap((workflow) =>
    workflow.tasks.map((task) => ({
      ...task,
      workflowTitle: workflow.title
    }))
  );
}

function tryParseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
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
  const [planViewTab, setPlanViewTab] = useState<PlanViewTab>("primary");

  const selectedPlan = useMemo(
    () => plans.find((item) => item.id === selectedPlanId) ?? null,
    [plans, selectedPlanId]
  );
  const parsedPrimaryDraft = useMemo(() => tryParseJsonObject(primaryPlanDraft), [primaryPlanDraft]);
  const parsedFallbackDraft = useMemo(() => tryParseJsonObject(fallbackPlanDraft), [fallbackPlanDraft]);
  const primaryPlanView = useMemo(
    () =>
      normalizeExecutionPlan(
        parsedPrimaryDraft ?? (selectedPlan ? (selectedPlan.primaryPlan as Record<string, unknown>) : null)
      ),
    [parsedPrimaryDraft, selectedPlan]
  );
  const fallbackPlanView = useMemo(
    () =>
      normalizeExecutionPlan(
        parsedFallbackDraft ?? (selectedPlan ? (selectedPlan.fallbackPlan as Record<string, unknown>) : null)
      ),
    [parsedFallbackDraft, selectedPlan]
  );
  const primarySteps = useMemo(() => flattenPlanSteps(primaryPlanView), [primaryPlanView]);
  const fallbackSteps = useMemo(() => flattenPlanSteps(fallbackPlanView), [fallbackPlanView]);
  const activePlanView = planViewTab === "primary" ? primaryPlanView : fallbackPlanView;
  const activeSteps = planViewTab === "primary" ? primarySteps : fallbackSteps;

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
    setPlanViewTab("primary");
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
          <h2 className="font-display text-3xl font-black tracking-tight md:text-4xl">Plan</h2>
          <p className="text-xs text-slate-500">Human + AI editable plans</p>
        </div>
        <button
          onClick={() => void loadPlans(true)}
          className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200"
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
          <p className="text-sm font-semibold text-slate-300">Plan history</p>
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
                  <p className="line-clamp-1 text-sm font-semibold text-white">{item.title}</p>
                  <p className="line-clamp-2 text-xs text-slate-400">
                    {item.summary || item.direction}
                  </p>
                  <p className="text-xs text-slate-500">
                    {item.status} | {item.source} | {new Date(item.updatedAt).toLocaleString()}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>

        <form onSubmit={savePlan} className={`vx-panel space-y-4 rounded-3xl p-4 ${themeStyle.border}`}>
          {!selectedPlan ? (
            <p className="text-sm text-slate-400">Select a plan from history.</p>
          ) : (
            <>
              <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_220px_auto] xl:items-end">
                <label className="space-y-1">
                  <span className="text-xs text-slate-500">Plan title</span>
                  <input
                    value={titleDraft}
                    onChange={(event) => setTitleDraft(event.target.value)}
                    placeholder="Plan title"
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-slate-500">Status</span>
                  <select
                    value={statusDraft}
                    onChange={(event) => setStatusDraft(event.target.value as PlanStatus)}
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="DRAFT">DRAFT</option>
                    <option value="ARCHIVED">ARCHIVED</option>
                  </select>
                </label>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex h-[42px] items-center justify-center gap-2 rounded-full bg-white px-5 text-xs font-semibold text-black transition hover:bg-emerald-500 hover:text-white disabled:opacity-60"
                >
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  Save Plan
                </button>
              </div>

              <div className="grid gap-3 xl:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs text-slate-500">Summary</span>
                  <textarea
                    value={summaryDraft}
                    onChange={(event) => setSummaryDraft(event.target.value)}
                    placeholder="Plan summary"
                    className="h-24 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-slate-500">Direction</span>
                  <textarea
                    value={directionDraft}
                    onChange={(event) => setDirectionDraft(event.target.value)}
                    placeholder="Direction"
                    className="h-24 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                  />
                </label>
              </div>

              <label className="space-y-1">
                <span className="text-xs text-slate-500">Human plan notes</span>
                <textarea
                  value={humanPlanDraft}
                  onChange={(event) => setHumanPlanDraft(event.target.value)}
                  placeholder="Human editable plan"
                  className="h-28 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                />
              </label>

              <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-3">
                <div className="inline-flex max-w-full flex-wrap rounded-full border border-white/15 bg-black/45 p-1">
                  <button
                    type="button"
                    onClick={() => setPlanViewTab("primary")}
                    className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
                      planViewTab === "primary"
                        ? "bg-gradient-to-r from-cyan-200 to-white text-slate-950"
                        : "text-slate-300 hover:bg-white/10"
                    }`}
                  >
                    Primary
                  </button>
                  <button
                    type="button"
                    onClick={() => setPlanViewTab("fallback")}
                    className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
                      planViewTab === "fallback"
                        ? "bg-gradient-to-r from-amber-200 to-white text-slate-950"
                        : "text-slate-300 hover:bg-white/10"
                    }`}
                  >
                    Fallback
                  </button>
                </div>

                <section
                  className={`space-y-3 rounded-2xl p-3 ${
                    planViewTab === "primary"
                      ? "border border-cyan-500/25 bg-cyan-500/8"
                      : "border border-amber-500/25 bg-amber-500/8"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p
                      className={`text-xs font-semibold ${
                        planViewTab === "primary" ? "text-cyan-200" : "text-amber-200"
                      }`}
                    >
                      {planViewTab === "primary" ? "Primary execution plan" : "Fallback execution plan"}
                    </p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        planViewTab === "primary"
                          ? "border border-cyan-500/35 bg-cyan-500/12 text-cyan-100"
                          : "border border-amber-500/35 bg-amber-500/12 text-amber-100"
                      }`}
                    >
                      {activeSteps.length} steps
                    </span>
                  </div>

                  {activePlanView.summary ? (
                    <p className={planViewTab === "primary" ? "text-sm text-cyan-100" : "text-sm text-amber-100"}>
                      {activePlanView.summary}
                    </p>
                  ) : null}

                  {activeSteps.length === 0 ? (
                    <p className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-400">
                      {planViewTab === "primary"
                        ? "No ordered steps available in primary plan JSON."
                        : "No ordered fallback steps available."}
                    </p>
                  ) : (
                    <ol className="space-y-2.5">
                      {activeSteps.map((step, index) => (
                        <li
                          key={`${planViewTab}-step-${index}`}
                          className="rounded-xl border border-white/10 bg-black/25 p-3"
                        >
                          <p className="text-xs text-slate-500">
                            Step {index + 1} | {step.workflowTitle}
                          </p>
                          <p className="mt-1 text-sm font-semibold text-white">{step.title}</p>
                          <p
                            className={`mt-1 text-xs ${
                              planViewTab === "primary" ? "text-cyan-100" : "text-amber-100"
                            }`}
                          >
                            Agent: <span className="font-semibold">{step.ownerRole}</span>
                          </p>

                          {step.subtasks.length > 0 ? (
                            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-300">
                              {step.subtasks.map((subtask, subtaskIndex) => (
                                <li key={`${planViewTab}-step-${index}-subtask-${subtaskIndex}`}>{subtask}</li>
                              ))}
                            </ul>
                          ) : null}

                          {planViewTab === "primary" && step.tools.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {step.tools.map((tool, toolIndex) => (
                                <span
                                  key={`${planViewTab}-step-${index}-tool-${toolIndex}`}
                                  className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-100"
                                >
                                  {tool}
                                </span>
                              ))}
                            </div>
                          ) : null}

                          {planViewTab === "primary" && step.requiresApproval ? (
                            <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-100">
                              Approval: {step.approvalRole}
                              {step.approvalReason ? ` | ${step.approvalReason}` : ""}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  )}

                  {planViewTab === "primary" && primaryPlanView.risks.length > 0 ? (
                    <div className="rounded-xl border border-red-500/25 bg-red-500/8 p-3">
                      <p className="text-xs text-red-200">Risks</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-red-100">
                        {primaryPlanView.risks.map((risk, index) => (
                          <li key={`primary-risk-${index}`}>{risk}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {planViewTab === "primary" && primaryPlanView.successMetrics.length > 0 ? (
                    <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/8 p-3">
                      <p className="text-xs text-emerald-200">Success metrics</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-emerald-100">
                        {primaryPlanView.successMetrics.map((metric, index) => (
                          <li key={`primary-metric-${index}`}>{metric}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </section>
              </div>

              <details className="rounded-2xl border border-white/10 bg-black/20 p-3">
                <summary className="cursor-pointer text-xs font-semibold text-slate-300">
                  Advanced: raw plan JSON
                </summary>
                <div className="mt-3 space-y-2">
                  {!parsedPrimaryDraft ? (
                    <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-200">
                      Primary plan JSON is invalid.
                    </p>
                  ) : null}
                  {!parsedFallbackDraft ? (
                    <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-200">
                      Fallback plan JSON is invalid.
                    </p>
                  ) : null}
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-xs text-slate-500">AI primary plan JSON</span>
                    <textarea
                      value={primaryPlanDraft}
                      onChange={(event) => setPrimaryPlanDraft(event.target.value)}
                      className="h-72 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-slate-100 outline-none"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs text-slate-500">AI fallback plan JSON</span>
                    <textarea
                      value={fallbackPlanDraft}
                      onChange={(event) => setFallbackPlanDraft(event.target.value)}
                      className="h-72 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-slate-100 outline-none"
                    />
                  </label>
                </div>
              </details>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
