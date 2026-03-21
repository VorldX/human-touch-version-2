"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Flag,
  Layers3,
  Loader2,
  RefreshCw,
  Save,
  ShieldAlert,
  Sparkles,
  Workflow as WorkflowIcon
} from "lucide-react";

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
  dateFilter?: string | null;
  planIdFilter?: string | null;
  directionIdFilter?: string | null;
  stringFilterLabel?: string | null;
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
  ownerRole: string;
  ownerType: string;
  dependencies: string[];
  deliverables: string[];
  tools: string[];
  entryCriteria: string[];
  exitCriteria: string[];
  successMetrics: string[];
  estimatedHours: number;
  tasks: PlanTaskView[];
}

interface PlanMilestoneView {
  title: string;
  ownerRole: string;
  dueWindow: string;
  deliverable: string;
  successSignal: string;
}

interface PlanResourceAllocationView {
  workforceType: string;
  role: string;
  responsibility: string;
  capacityPct: number;
  tools: string[];
}

interface PlanApprovalCheckpointView {
  name: string;
  trigger: string;
  requiredRole: string;
  reason: string;
}

interface PlanDependencyView {
  fromWorkflow: string;
  toWorkflow: string;
  reason: string;
}

interface PlanPathwayStepView {
  stepId: string;
  line: number;
  workflowTitle: string;
  taskTitle: string;
  ownerRole: string;
  executionMode: string;
  trigger: string;
  dueWindow: string;
  dependsOn: string[];
}

interface ExecutionPlanView {
  objective: string;
  organizationFitSummary: string;
  summary: string;
  deliverables: string[];
  milestones: PlanMilestoneView[];
  resourcePlan: PlanResourceAllocationView[];
  approvalCheckpoints: PlanApprovalCheckpointView[];
  dependencies: PlanDependencyView[];
  pathway: PlanPathwayStepView[];
  workflows: PlanWorkflowView[];
  risks: string[];
  successMetrics: string[];
  detailScore: number;
}

interface PlanTaskDetailView extends PlanTaskView {
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

function asBoundedNumber(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function normalizeMilestone(value: unknown): PlanMilestoneView | null {
  const record = asRecord(value);
  const title = asTrimmedText(record.title);
  if (!title) return null;
  return {
    title,
    ownerRole: asTrimmedText(record.ownerRole) || "EMPLOYEE",
    dueWindow: asTrimmedText(record.dueWindow) || "TBD",
    deliverable: asTrimmedText(record.deliverable) || title,
    successSignal: asTrimmedText(record.successSignal) || "Deliverable accepted"
  };
}

function normalizeResourcePlanItem(value: unknown): PlanResourceAllocationView | null {
  const record = asRecord(value);
  const role = asTrimmedText(record.role);
  if (!role) return null;
  return {
    workforceType: asTrimmedText(record.workforceType) || "HYBRID",
    role,
    responsibility: asTrimmedText(record.responsibility) || "Execution support",
    capacityPct: asBoundedNumber(record.capacityPct, 20, 1, 100),
    tools: asStringList(record.tools, 12)
  };
}

function normalizeApprovalCheckpoint(value: unknown): PlanApprovalCheckpointView | null {
  const record = asRecord(value);
  const name = asTrimmedText(record.name);
  if (!name) return null;
  return {
    name,
    trigger: asTrimmedText(record.trigger) || "Before stage transition",
    requiredRole: asTrimmedText(record.requiredRole) || "ADMIN",
    reason: asTrimmedText(record.reason) || "Approval required"
  };
}

function normalizeDependency(value: unknown): PlanDependencyView | null {
  const record = asRecord(value);
  const fromWorkflow = asTrimmedText(record.fromWorkflow);
  const toWorkflow = asTrimmedText(record.toWorkflow);
  if (!fromWorkflow || !toWorkflow) return null;
  return {
    fromWorkflow,
    toWorkflow,
    reason: asTrimmedText(record.reason) || "Dependency mapping"
  };
}

function normalizePathwayStep(value: unknown, index: number): PlanPathwayStepView | null {
  const record = asRecord(value);
  const workflowTitle = asTrimmedText(record.workflowTitle);
  const taskTitle = asTrimmedText(record.taskTitle);
  if (!workflowTitle || !taskTitle) return null;
  const parsedLine =
    typeof record.line === "number"
      ? record.line
      : typeof record.line === "string"
        ? Number.parseInt(record.line, 10)
        : Number.NaN;
  const line = Number.isFinite(parsedLine) && parsedLine > 0 ? Math.floor(parsedLine) : index + 1;
  return {
    stepId: asTrimmedText(record.stepId) || `pathway-step-${line}`,
    line,
    workflowTitle,
    taskTitle,
    ownerRole: asTrimmedText(record.ownerRole) || "EMPLOYEE",
    executionMode: asTrimmedText(record.executionMode) || "HYBRID",
    trigger: asTrimmedText(record.trigger) || "After previous step completion",
    dueWindow: asTrimmedText(record.dueWindow) || "Execution window",
    dependsOn: asStringList(record.dependsOn, 10)
  };
}

function normalizeExecutionPlan(value: Record<string, unknown> | null): ExecutionPlanView {
  const record = asRecord(value);
  const workflowRows = Array.isArray(record.workflows) ? record.workflows : [];
  const milestoneRows = Array.isArray(record.milestones) ? record.milestones : [];
  const resourceRows = Array.isArray(record.resourcePlan) ? record.resourcePlan : [];
  const approvalRows = Array.isArray(record.approvalCheckpoints) ? record.approvalCheckpoints : [];
  const dependencyRows = Array.isArray(record.dependencies) ? record.dependencies : [];
  const pathwayRows = Array.isArray(record.pathway) ? record.pathway : [];

  return {
    objective: asTrimmedText(record.objective),
    organizationFitSummary: asTrimmedText(record.organizationFitSummary),
    summary: asTrimmedText(record.summary),
    deliverables: asStringList(record.deliverables, 16),
    milestones: milestoneRows
      .map((item) => normalizeMilestone(item))
      .filter((item): item is PlanMilestoneView => Boolean(item))
      .slice(0, 20),
    resourcePlan: resourceRows
      .map((item) => normalizeResourcePlanItem(item))
      .filter((item): item is PlanResourceAllocationView => Boolean(item))
      .slice(0, 20),
    approvalCheckpoints: approvalRows
      .map((item) => normalizeApprovalCheckpoint(item))
      .filter((item): item is PlanApprovalCheckpointView => Boolean(item))
      .slice(0, 20),
    dependencies: dependencyRows
      .map((item) => normalizeDependency(item))
      .filter((item): item is PlanDependencyView => Boolean(item))
      .slice(0, 20),
    pathway: pathwayRows
      .map((item, index) => normalizePathwayStep(item, index))
      .filter((item): item is PlanPathwayStepView => Boolean(item))
      .sort((a, b) => a.line - b.line)
      .slice(0, 120),
    workflows: workflowRows.slice(0, 12).map((workflow, index) => {
      const workflowRecord = asRecord(workflow);
      const tasks = Array.isArray(workflowRecord.tasks) ? workflowRecord.tasks : [];
      return {
        title: asTrimmedText(workflowRecord.title) || `Workflow ${index + 1}`,
        goal: asTrimmedText(workflowRecord.goal),
        ownerRole: asTrimmedText(workflowRecord.ownerRole) || "EMPLOYEE",
        ownerType: asTrimmedText(workflowRecord.ownerType) || "HYBRID",
        dependencies: asStringList(workflowRecord.dependencies, 16),
        deliverables: asStringList(workflowRecord.deliverables, 16),
        tools: asStringList(workflowRecord.tools, 16),
        entryCriteria: asStringList(workflowRecord.entryCriteria, 16),
        exitCriteria: asStringList(workflowRecord.exitCriteria, 16),
        successMetrics: asStringList(workflowRecord.successMetrics, 16),
        estimatedHours: asBoundedNumber(workflowRecord.estimatedHours, 8, 1, 240),
        tasks: tasks.slice(0, 24).map((task) => normalizeTask(task))
      };
    }),
    risks: asStringList(record.risks, 12),
    successMetrics: asStringList(record.successMetrics, 12),
    detailScore: asBoundedNumber(record.detailScore, 0, 0, 100)
  };
}

function flattenPlanTasks(plan: ExecutionPlanView): PlanTaskDetailView[] {
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

function toConsoleDateKey(value: string | number | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function matchesDateFilter(dateFilter: string | null, ...values: Array<string | number | Date | null | undefined>) {
  if (!dateFilter) {
    return true;
  }
  return values.some((value) => {
    if (!value) {
      return false;
    }
    return toConsoleDateKey(value) === dateFilter;
  });
}

export function PlanConsole({
  orgId,
  themeStyle,
  dateFilter = null,
  planIdFilter = null,
  directionIdFilter = null,
  stringFilterLabel = null
}: PlanConsoleProps) {
  const notify = useVorldXStore((state) => state.pushNotification);
  const detailsFormRef = useRef<HTMLFormElement | null>(null);

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
  const [selectedWorkflowIndex, setSelectedWorkflowIndex] = useState(0);

  const visiblePlans = useMemo(() => {
    return plans.filter((item) => {
      if (!matchesDateFilter(dateFilter, item.createdAt, item.updatedAt)) {
        return false;
      }
      if (planIdFilter && item.id !== planIdFilter) {
        return false;
      }
      if (!planIdFilter && directionIdFilter && item.directionId !== directionIdFilter) {
        return false;
      }
      return true;
    });
  }, [dateFilter, directionIdFilter, planIdFilter, plans]);
  const selectedPlan = useMemo(
    () => visiblePlans.find((item) => item.id === selectedPlanId) ?? null,
    [selectedPlanId, visiblePlans]
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
  const primaryTasks = useMemo(() => flattenPlanTasks(primaryPlanView), [primaryPlanView]);
  const fallbackTasks = useMemo(() => flattenPlanTasks(fallbackPlanView), [fallbackPlanView]);
  const activePlanView = planViewTab === "primary" ? primaryPlanView : fallbackPlanView;
  const activeTasks = planViewTab === "primary" ? primaryTasks : fallbackTasks;
  const activeWorkflow =
    activePlanView.workflows[Math.max(0, Math.min(selectedWorkflowIndex, activePlanView.workflows.length - 1))] ??
    null;

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
    if (selectedPlanId && visiblePlans.some((item) => item.id === selectedPlanId)) {
      return;
    }
    setSelectedPlanId(visiblePlans[0]?.id ?? null);
  }, [selectedPlanId, visiblePlans]);

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
    setSelectedWorkflowIndex(0);
  }, [selectedPlan]);

  useEffect(() => {
    setSelectedWorkflowIndex(0);
  }, [planViewTab, selectedPlanId]);

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

  const primaryApprovalCount = useMemo(
    () => primaryTasks.filter((task) => task.requiresApproval).length,
    [primaryTasks]
  );
  const fallbackApprovalCount = useMemo(
    () => fallbackTasks.filter((task) => task.requiresApproval).length,
    [fallbackTasks]
  );
  const activeApprovalCount = planViewTab === "primary" ? primaryApprovalCount : fallbackApprovalCount;
  const activeToolCount = useMemo(() => {
    const tools = new Set<string>();
    activeTasks.forEach((task) => {
      task.tools.forEach((tool) => {
        if (tool.trim()) tools.add(tool.trim().toLowerCase());
      });
    });
    activePlanView.workflows.forEach((workflow) => {
      workflow.tools.forEach((tool) => {
        if (tool.trim()) tools.add(tool.trim().toLowerCase());
      });
    });
    return tools.size;
  }, [activePlanView.workflows, activeTasks]);
  const activeWorkflowCount = activePlanView.workflows.length;
  const activeRiskCount = activePlanView.risks.length;
  const activeMetricCount = activePlanView.successMetrics.length;
  const activeDeliverableCount = activePlanView.deliverables.length;
  const activeMilestoneCount = activePlanView.milestones.length;
  const activeResourceCount = activePlanView.resourcePlan.length;
  const activeCheckpointCount = activePlanView.approvalCheckpoints.length;
  const activePathwayCount = activePlanView.pathway.length;
  const selectedUpdatedAt = selectedPlan ? new Date(selectedPlan.updatedAt).toLocaleString() : "No plan selected";
  const planInsightsById = useMemo(() => {
    return visiblePlans.reduce<
      Record<
        string,
        {
          primaryWorkflowCount: number;
          primaryTaskCount: number;
          primaryApprovalCount: number;
          primaryDetailScore: number;
          primaryPathwayCount: number;
          fallbackWorkflowCount: number;
          fallbackTaskCount: number;
          fallbackDetailScore: number;
          fallbackPathwayCount: number;
        }
      >
    >((accumulator, item) => {
      const primary = normalizeExecutionPlan(item.primaryPlan as Record<string, unknown>);
      const fallback = normalizeExecutionPlan(item.fallbackPlan as Record<string, unknown>);
      const primaryPlanTasks = flattenPlanTasks(primary);
      const fallbackPlanTasks = flattenPlanTasks(fallback);
      accumulator[item.id] = {
        primaryWorkflowCount: primary.workflows.length,
        primaryTaskCount: primaryPlanTasks.length,
        primaryApprovalCount: primaryPlanTasks.filter((task) => task.requiresApproval).length,
        primaryDetailScore: primary.detailScore,
        primaryPathwayCount: primary.pathway.length,
        fallbackWorkflowCount: fallback.workflows.length,
        fallbackTaskCount: fallbackPlanTasks.length,
        fallbackDetailScore: fallback.detailScore,
        fallbackPathwayCount: fallback.pathway.length
      };
      return accumulator;
    }, {});
  }, [visiblePlans]);

  const handlePlanSelect = useCallback((planId: string) => {
    setSelectedPlanId(planId);
    if (typeof window !== "undefined" && window.innerWidth < 1536) {
      requestAnimationFrame(() => {
        detailsFormRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      });
    }
  }, []);

  return (
    <div className="mx-auto w-full max-w-[min(100%,1500px)] space-y-5 2xl:max-w-[min(95vw,1800px)] [@media(min-width:1920px)]:max-w-[min(94vw,2100px)]">
      <section className={`vx-panel relative overflow-hidden rounded-3xl p-5 ${themeStyle.border}`}>
        <div className="pointer-events-none absolute -top-24 right-0 h-52 w-52 rounded-full bg-cyan-500/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-24 h-48 w-48 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-cyan-100">
              <Sparkles size={12} />
              Plan Studio
            </p>
            <h2 className="mt-3 font-display text-3xl font-black tracking-tight text-white md:text-4xl">
              Orchestration Plans
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Human + AI editable plan graph with execution visibility and approval checkpoints.
            </p>
            {dateFilter ? (
              <p className="mt-2 text-[11px] text-cyan-300">
                Filtered to {new Date(`${dateFilter}T00:00:00`).toLocaleDateString()}
              </p>
            ) : null}
            {stringFilterLabel ? (
              <p className="mt-1 text-[11px] text-emerald-300">String: {stringFilterLabel}</p>
            ) : null}
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-right">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Latest update</p>
            <p className="mt-1 text-xs font-semibold text-slate-200">{selectedUpdatedAt}</p>
            <button
              onClick={() => void loadPlans(true)}
              className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-cyan-300/40 hover:bg-cyan-500/10"
            >
              {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              Refresh
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid gap-4 xl:items-start xl:grid-cols-[300px_minmax(0,1fr)] 2xl:grid-cols-[340px_minmax(0,1fr)]">
        <aside
          className={`vx-panel flex min-h-0 flex-col space-y-3 rounded-3xl p-4 xl:sticky xl:top-3 xl:max-h-[calc(100dvh-11.5rem)] ${themeStyle.border}`}
        >
          <div className="flex items-center justify-between">
            <p className="inline-flex items-center gap-2 text-sm font-semibold text-slate-200">
              <WorkflowIcon size={15} className="text-cyan-300" />
              Plan history
            </p>
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-slate-400">
              {visiblePlans.length}
            </span>
          </div>

          {loading ? (
            <div className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-400">
              <Loader2 size={12} className="animate-spin" />
              Loading plans...
            </div>
          ) : visiblePlans.length === 0 ? (
            <p className="rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-xs text-slate-500">
              {planIdFilter || directionIdFilter
                ? "No plans linked to the selected string."
                : dateFilter
                  ? "No plans found for the selected date."
                  : "No plans created yet. Generate from Control to Direction mode."}
            </p>
          ) : (
            <div className="vx-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {visiblePlans.map((item) => {
                const isSelected = selectedPlanId === item.id;
                const insight = planInsightsById[item.id];
                return (
                  <button
                    key={item.id}
                    onClick={() => handlePlanSelect(item.id)}
                    aria-pressed={isSelected}
                    className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                      isSelected
                        ? "border-cyan-400/45 bg-gradient-to-br from-cyan-500/18 to-emerald-500/10 shadow-[0_0_0_1px_rgba(56,189,248,0.08)]"
                        : "border-white/10 bg-black/20 hover:border-white/25 hover:bg-black/35"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="line-clamp-1 text-sm font-semibold text-white">{item.title}</p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          item.status === "ACTIVE"
                            ? "border border-emerald-500/35 bg-emerald-500/15 text-emerald-200"
                            : item.status === "DRAFT"
                              ? "border border-amber-500/35 bg-amber-500/12 text-amber-200"
                              : "border border-slate-400/35 bg-slate-500/10 text-slate-300"
                        }`}
                      >
                        {item.status}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-400">{item.summary || item.direction}</p>
                    <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                      <span>{item.source}</span>
                      <span className="line-clamp-1">{new Date(item.updatedAt).toLocaleString()}</span>
                    </div>
                    {isSelected && insight ? (
                      <div className="mt-2 space-y-2 rounded-xl border border-white/10 bg-black/30 p-2">
                        <p className="line-clamp-2 text-[11px] text-slate-300">
                          {item.direction || "No direction text for this plan yet."}
                        </p>
                        <div className="grid grid-cols-2 gap-1 text-[10px]">
                          <span className="rounded-lg border border-cyan-500/35 bg-cyan-500/12 px-1.5 py-1 text-cyan-100">
                            Primary: {insight.primaryWorkflowCount} wf / {insight.primaryTaskCount} tasks
                          </span>
                          <span className="rounded-lg border border-amber-500/35 bg-amber-500/12 px-1.5 py-1 text-amber-100">
                            Fallback: {insight.fallbackWorkflowCount} wf / {insight.fallbackTaskCount} tasks
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400">
                          Pathway:{" "}
                          <span className="font-semibold text-cyan-100">{insight.primaryPathwayCount}</span>
                          {" / "}
                          <span className="font-semibold text-amber-100">{insight.fallbackPathwayCount}</span>
                        </p>
                        <p className="text-[10px] text-slate-400">
                          Approvals required: <span className="font-semibold text-amber-100">{insight.primaryApprovalCount}</span>
                        </p>
                        <p className="text-[10px] text-slate-400">
                          Detail score:{" "}
                          <span className="font-semibold text-cyan-100">{insight.primaryDetailScore}</span>
                          {" / "}
                          <span className="font-semibold text-amber-100">{insight.fallbackDetailScore}</span>
                        </p>
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        <form
          ref={detailsFormRef}
          onSubmit={savePlan}
          className={`vx-panel space-y-4 rounded-3xl p-4 ${themeStyle.border}`}
        >
          {!selectedPlan ? (
            <p className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-slate-400">
              Select a plan from history.
            </p>
          ) : (
            <>
              <section className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_220px_auto] xl:items-end">
                  <label className="space-y-1">
                    <span className="text-xs text-slate-500">Plan title</span>
                    <input
                      value={titleDraft}
                      onChange={(event) => setTitleDraft(event.target.value)}
                      placeholder="Plan title"
                      className="w-full rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-300/40"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs text-slate-500">Status</span>
                    <select
                      value={statusDraft}
                      onChange={(event) => setStatusDraft(event.target.value as PlanStatus)}
                      className="w-full rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-300/40"
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
                <div className="flex flex-wrap gap-2 text-[11px]">
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-slate-300">
                    Source: {selectedPlan.source}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-slate-300">
                    Updated: {new Date(selectedPlan.updatedAt).toLocaleString()}
                  </span>
                  {selectedPlan.ownerEmail ? (
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-slate-300">
                      Owner: {selectedPlan.ownerEmail}
                    </span>
                  ) : null}
                  {selectedPlan.directionId ? (
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-slate-300">
                      Direction ID: {selectedPlan.directionId}
                    </span>
                  ) : null}
                </div>
              </section>

              <div className="grid gap-3 xl:grid-cols-2">
                <label className="space-y-1 rounded-2xl border border-white/10 bg-black/20 p-3">
                  <span className="inline-flex items-center gap-2 text-xs text-slate-400">
                    <Sparkles size={12} className="text-cyan-300" />
                    Summary
                  </span>
                  <textarea
                    value={summaryDraft}
                    onChange={(event) => setSummaryDraft(event.target.value)}
                    placeholder="Plan summary"
                    className="h-24 w-full resize-none rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-300/40"
                  />
                </label>
                <label className="space-y-1 rounded-2xl border border-white/10 bg-black/20 p-3">
                  <span className="inline-flex items-center gap-2 text-xs text-slate-400">
                    <Flag size={12} className="text-amber-300" />
                    Direction
                  </span>
                  <textarea
                    value={directionDraft}
                    onChange={(event) => setDirectionDraft(event.target.value)}
                    placeholder="Direction"
                    className="h-24 w-full resize-none rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-300/40"
                  />
                </label>
              </div>

              <label className="space-y-1 rounded-2xl border border-white/10 bg-black/20 p-3">
                <span className="text-xs text-slate-400">Human plan notes</span>
                <textarea
                  value={humanPlanDraft}
                  onChange={(event) => setHumanPlanDraft(event.target.value)}
                  placeholder="Human editable plan"
                  className="h-28 w-full resize-none rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-300/40"
                />
              </label>

              <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
                <div className="rounded-2xl border border-cyan-500/25 bg-cyan-500/10 p-3">
                  <p className="inline-flex items-center gap-2 text-[11px] text-cyan-200">
                    <Layers3 size={12} />
                    Workflows
                  </p>
                  <p className="mt-2 text-2xl font-black text-cyan-100">{activeWorkflowCount}</p>
                </div>
                <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-3">
                  <p className="inline-flex items-center gap-2 text-[11px] text-emerald-200">
                    <WorkflowIcon size={12} />
                    Tasks
                  </p>
                  <p className="mt-2 text-2xl font-black text-emerald-100">{activeTasks.length}</p>
                </div>
                <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-3">
                  <p className="inline-flex items-center gap-2 text-[11px] text-amber-200">
                    <ShieldAlert size={12} />
                    Approvals
                  </p>
                  <p className="mt-2 text-2xl font-black text-amber-100">{activeApprovalCount}</p>
                </div>
                <div className="rounded-2xl border border-indigo-500/25 bg-indigo-500/10 p-3">
                  <p className="inline-flex items-center gap-2 text-[11px] text-indigo-200">
                    <WorkflowIcon size={12} />
                    Pathway
                  </p>
                  <p className="mt-2 text-2xl font-black text-indigo-100">{activePathwayCount}</p>
                </div>
                <div className="rounded-2xl border border-violet-500/25 bg-violet-500/10 p-3">
                  <p className="inline-flex items-center gap-2 text-[11px] text-violet-200">
                    <CheckCircle2 size={12} />
                    Success metrics
                  </p>
                  <p className="mt-2 text-2xl font-black text-violet-100">{activeMetricCount}</p>
                </div>
                <div className="rounded-2xl border border-sky-500/25 bg-sky-500/10 p-3">
                  <p className="inline-flex items-center gap-2 text-[11px] text-sky-200">
                    <Flag size={12} />
                    Milestones
                  </p>
                  <p className="mt-2 text-2xl font-black text-sky-100">{activeMilestoneCount}</p>
                </div>
                <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 p-3">
                  <p className="inline-flex items-center gap-2 text-[11px] text-rose-200">
                    <Sparkles size={12} />
                    Detail score
                  </p>
                  <p className="mt-2 text-2xl font-black text-rose-100">{activePlanView.detailScore}</p>
                </div>
              </section>

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
                    Primary ({primaryTasks.length})
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
                    Fallback ({fallbackTasks.length})
                  </button>
                </div>

                <section
                  className={`space-y-3 rounded-2xl border p-3 ${
                    planViewTab === "primary"
                      ? "border-cyan-500/25 bg-cyan-500/8"
                      : "border-amber-500/25 bg-amber-500/8"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p
                        className={`text-xs font-semibold ${
                          planViewTab === "primary" ? "text-cyan-200" : "text-amber-200"
                        }`}
                      >
                        {planViewTab === "primary" ? "Primary execution plan" : "Fallback execution plan"}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {activeWorkflowCount} workflows, {activeTasks.length} total tasks, {activeToolCount} tool tags
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        planViewTab === "primary"
                          ? "border border-cyan-500/35 bg-cyan-500/12 text-cyan-100"
                          : "border border-amber-500/35 bg-amber-500/12 text-amber-100"
                      }`}
                    >
                      {activeWorkflow ? `${activeWorkflow.tasks.length} tasks in focus` : `${activeTasks.length} tasks in view`}
                    </span>
                  </div>

                  {activePlanView.objective ? (
                    <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                      <p className="text-[11px] uppercase tracking-[0.14em] text-slate-400">Objective</p>
                      <p className="mt-1 text-sm text-slate-100">{activePlanView.objective}</p>
                    </div>
                  ) : null}

                  {activePlanView.organizationFitSummary ? (
                    <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                      <p className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                        Organization Fit
                      </p>
                      <p className="mt-1 text-sm text-slate-100">{activePlanView.organizationFitSummary}</p>
                    </div>
                  ) : null}

                  {activePlanView.summary ? (
                    <p className={planViewTab === "primary" ? "text-sm text-cyan-100" : "text-sm text-amber-100"}>
                      {activePlanView.summary}
                    </p>
                  ) : null}

                  <div className="grid gap-3 xl:grid-cols-2">
                    <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                      <p className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                        Deliverables ({activeDeliverableCount})
                      </p>
                      {activePlanView.deliverables.length > 0 ? (
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-200">
                          {activePlanView.deliverables.map((item, index) => (
                            <li key={`${planViewTab}-deliverable-${index}`}>{item}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2 text-xs text-slate-500">No deliverables mapped.</p>
                      )}
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                      <p className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                        Milestones ({activeMilestoneCount})
                      </p>
                      {activePlanView.milestones.length > 0 ? (
                        <ul className="mt-2 space-y-2 text-xs text-slate-200">
                          {activePlanView.milestones.map((item, index) => (
                            <li key={`${planViewTab}-milestone-${index}`} className="rounded-lg border border-white/10 bg-black/20 p-2">
                              <p className="font-semibold text-slate-100">{item.title}</p>
                              <p className="mt-0.5 text-[11px] text-slate-400">
                                {item.ownerRole} | {item.dueWindow}
                              </p>
                              <p className="mt-1 text-[11px] text-slate-300">
                                {item.deliverable} | {item.successSignal}
                              </p>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2 text-xs text-slate-500">No milestones mapped.</p>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-3 xl:grid-cols-2">
                    <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                      <p className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                        Resource Plan ({activeResourceCount})
                      </p>
                      {activePlanView.resourcePlan.length > 0 ? (
                        <ul className="mt-2 space-y-2 text-xs text-slate-200">
                          {activePlanView.resourcePlan.map((item, index) => (
                            <li key={`${planViewTab}-resource-${index}`} className="rounded-lg border border-white/10 bg-black/20 p-2">
                              <p className="font-semibold text-slate-100">
                                {item.role} | {item.workforceType}
                              </p>
                              <p className="mt-0.5 text-[11px] text-slate-300">
                                {item.responsibility} | Capacity {item.capacityPct}%
                              </p>
                              {item.tools.length > 0 ? (
                                <p className="mt-1 text-[11px] text-slate-400">
                                  Tools: {item.tools.join(", ")}
                                </p>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2 text-xs text-slate-500">No resource allocations mapped.</p>
                      )}
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                      <p className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                        Approval Checkpoints ({activeCheckpointCount})
                      </p>
                      {activePlanView.approvalCheckpoints.length > 0 ? (
                        <ul className="mt-2 space-y-2 text-xs text-slate-200">
                          {activePlanView.approvalCheckpoints.map((item, index) => (
                            <li key={`${planViewTab}-checkpoint-${index}`} className="rounded-lg border border-white/10 bg-black/20 p-2">
                              <p className="font-semibold text-slate-100">{item.name}</p>
                              <p className="mt-0.5 text-[11px] text-slate-400">
                                {item.requiredRole} | {item.trigger}
                              </p>
                              <p className="mt-1 text-[11px] text-slate-300">{item.reason}</p>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2 text-xs text-slate-500">No approval checkpoints mapped.</p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                    Pathway ({activePathwayCount})
                    </p>
                    {activePlanView.pathway.length > 0 ? (
                      <ol className="mt-2 space-y-2">
                        {activePlanView.pathway.map((item, index) => (
                          <li
                            key={`${planViewTab}-pathway-${item.stepId}-${index}`}
                            className="rounded-lg border border-white/10 bg-black/20 p-2 text-xs text-slate-200"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="font-semibold text-slate-100">
                                {item.line}. {item.workflowTitle}{" -> "}{item.taskTitle}
                              </p>
                              <span className="rounded-full border border-white/15 bg-black/30 px-2 py-0.5 text-[10px] text-slate-300">
                                {item.ownerRole} | {item.executionMode}
                              </span>
                            </div>
                            <p className="mt-1 text-[11px] text-slate-400">
                              Trigger: {item.trigger} | Window: {item.dueWindow}
                            </p>
                            {item.dependsOn.length > 0 ? (
                              <p className="mt-1 text-[11px] text-slate-500">
                                Depends on: {item.dependsOn.join(", ")}
                              </p>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="mt-2 text-xs text-slate-500">
                        No pathway mapped for this plan view.
                      </p>
                    )}
                  </div>

                  {activePlanView.dependencies.length > 0 ? (
                    <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                      <p className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                        Workflow Dependencies
                      </p>
                      <ul className="mt-2 space-y-1 text-xs text-slate-200">
                        {activePlanView.dependencies.map((item, index) => (
                          <li key={`${planViewTab}-dependency-${index}`}>
                            {item.fromWorkflow}
                            {" -> "}
                            {item.toWorkflow}
                            {item.reason ? ` (${item.reason})` : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {activePlanView.workflows.length > 0 ? (
                    <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                      <p className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                        Workflow Details
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {activePlanView.workflows.map((workflow, index) => {
                          const selected = activeWorkflow?.title === workflow.title;
                          return (
                            <button
                              key={`${planViewTab}-workflow-chip-${index}`}
                              type="button"
                              onClick={() => setSelectedWorkflowIndex(index)}
                              className={`rounded-full border px-3 py-1.5 text-[11px] transition ${
                                selected
                                  ? "border-cyan-400/50 bg-cyan-500/15 text-cyan-100"
                                  : "border-white/15 bg-black/20 text-slate-300 hover:border-white/30"
                              }`}
                            >
                              {workflow.title}
                            </button>
                          );
                        })}
                      </div>
                      {activeWorkflow ? (
                        <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-slate-200">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-white">{activeWorkflow.title}</p>
                            <p className="text-[11px] text-slate-400">
                              {activeWorkflow.ownerRole} | {activeWorkflow.ownerType} | {activeWorkflow.estimatedHours}h
                            </p>
                          </div>
                          {activeWorkflow.goal ? <p className="mt-2 text-slate-300">{activeWorkflow.goal}</p> : null}
                          <div className="mt-2 grid gap-2 md:grid-cols-2">
                            <p className="rounded-lg border border-white/10 bg-black/20 px-2 py-1">
                              Entry: {activeWorkflow.entryCriteria.join(" | ") || "N/A"}
                            </p>
                            <p className="rounded-lg border border-white/10 bg-black/20 px-2 py-1">
                              Exit: {activeWorkflow.exitCriteria.join(" | ") || "N/A"}
                            </p>
                          </div>
                          {activeWorkflow.deliverables.length > 0 ? (
                            <p className="mt-2 text-[11px] text-slate-300">
                              Deliverables: {activeWorkflow.deliverables.join(", ")}
                            </p>
                          ) : null}
                          {activeWorkflow.dependencies.length > 0 ? (
                            <p className="mt-1 text-[11px] text-slate-400">
                              Depends on: {activeWorkflow.dependencies.join(", ")}
                            </p>
                          ) : null}
                          {activeWorkflow.tools.length > 0 ? (
                            <p className="mt-1 text-[11px] text-slate-400">
                              Tools: {activeWorkflow.tools.join(", ")}
                            </p>
                          ) : null}
                          {activeWorkflow.tasks.length > 0 ? (
                            <div className="mt-3 rounded-lg border border-white/10 bg-black/25 p-2">
                              <p className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                                Tasks ({activeWorkflow.tasks.length})
                              </p>
                              <ul className="mt-2 space-y-2">
                                {activeWorkflow.tasks.map((task, taskIndex) => (
                                  <li
                                    key={`${planViewTab}-workflow-${selectedWorkflowIndex}-task-${taskIndex}`}
                                    className="rounded-lg border border-white/10 bg-black/20 p-2"
                                  >
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                      <p className="text-sm font-semibold text-white">{task.title}</p>
                                      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">
                                        {task.ownerRole}
                                      </span>
                                    </div>
                                    {task.subtasks.length > 0 ? (
                                      <p className="mt-1 text-[11px] text-slate-400">
                                        Subtasks: {task.subtasks.join(" | ")}
                                      </p>
                                    ) : null}
                                    {task.tools.length > 0 ? (
                                      <p className="mt-1 text-[11px] text-slate-500">
                                        Tools: {task.tools.join(", ")}
                                      </p>
                                    ) : null}
                                    {task.requiresApproval ? (
                                      <p className="mt-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-100">
                                        Approval: {task.approvalRole}
                                        {task.approvalReason ? ` | ${task.approvalReason}` : ""}
                                      </p>
                                    ) : null}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {activeRiskCount > 0 ? (
                    <div className="rounded-xl border border-red-500/25 bg-red-500/8 p-3">
                      <p className="text-xs text-red-200">Risks</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-red-100">
                        {activePlanView.risks.map((risk, index) => (
                          <li key={`${planViewTab}-risk-${index}`}>{risk}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {activeMetricCount > 0 ? (
                    <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/8 p-3">
                      <p className="text-xs text-emerald-200">Success metrics</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-emerald-100">
                        {activePlanView.successMetrics.map((metric, index) => (
                          <li key={`${planViewTab}-metric-${index}`}>{metric}</li>
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
