"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MarkerType, type Edge, type Node } from "reactflow";
import ReactFlow, { Background, Controls, MiniMap } from "reactflow";
import "reactflow/dist/style.css";

import {
  type ApprovalCheckpointItem,
  type ControlThreadHistoryItem,
  type DirectionPlanTask,
  type DirectionPlanWorkflow,
  type EditableStringDraft,
  type PermissionRequestItem,
  type SteerLaneTab,
  type StringScoreRecord,
  buildDraftDeliverableCards,
  buildStringCollaborationSnapshot,
  buildStringDiscussionTurns,
  compactTaskTitle,
  controlThreadDisplayTitle,
  getScopedApprovalCheckpointsForString,
  getScopedPermissionRequestsForString,
  resolveEditableStringDraft,
  splitDraftLines,
  workflowAgentLabelFromTaskTrace
} from "@/components/vorldx-shell/shared";

interface StringBlueprintCanvasSurfaceProps {
  themeStyle: {
    accent?: string;
    accentSoft?: string;
    border: string;
  };
  calendarDate?: string | null;
  stringItem: ControlThreadHistoryItem | null;
  allStringItems: ControlThreadHistoryItem[];
  permissionRequests: PermissionRequestItem[];
  approvalCheckpoints: ApprovalCheckpointItem[];
  draftsByString?: Record<string, EditableStringDraft>;
  scoreByString?: Record<string, StringScoreRecord[]>;
  steerDecisions: Record<string, SteerLaneTab>;
  selectedStringId?: string | null;
  onSelectedStringChange?: (value: string | null) => void;
}

type CanvasSection =
  | "STRING"
  | "DISCUSSION"
  | "DIRECTION"
  | "PLAN"
  | "WORKFLOW"
  | "TASK"
  | "WORKING"
  | "APPROVAL"
  | "COLLABORATION";

type CanvasNodeStatus =
  | "IDLE"
  | "PLANNED"
  | "RUNNING"
  | "QUEUED"
  | "PAUSED"
  | "COMPLETED"
  | "FAILED"
  | "BLOCKED";

interface CanvasNodeMeta {
  id: string;
  stringId: string;
  stringTitle: string;
  section: CanvasSection;
  heading: string;
  summary: string;
  badge: string;
  items: string[];
  links: string[];
  status: CanvasNodeStatus;
  timeLabel?: string;
  workflowTitle?: string;
  taskTitle?: string;
  executionFocus?: boolean;
}

interface BlueprintRow {
  item: ControlThreadHistoryItem;
  stringTitle: string;
  draft: EditableStringDraft;
  discussionTurns: ReturnType<typeof buildStringDiscussionTurns>;
  detailScore: number | null;
  deliverableCount: number;
  workflowCount: number;
  pathwayCount: number;
  milestoneCount: number;
  approvalCount: number;
  pendingApprovalCount: number;
  scoreActivityCount: number;
  approvedDeliverables: number;
  rethinkDeliverables: number;
  collaboration: ReturnType<typeof buildStringCollaborationSnapshot>;
  permissionRequests: PermissionRequestItem[];
  approvalCheckpoints: ApprovalCheckpointItem[];
}

interface RuntimePathwayDetails {
  workflowTitle: string;
  taskTitle: string;
  ownerRole: string;
  executionMode: string;
  trigger: string;
  dueWindow: string;
  dependsOn: string[];
}

interface RuntimeTaskRecord {
  id: string;
  flowId: string;
  flowStatus: string;
  prompt: string;
  status: CanvasNodeStatus;
  stage: "PLANNING" | "EXECUTION" | "UNKNOWN";
  stepIndex: number | null;
  totalSteps: number | null;
  agentLabel: string;
  createdAt: string;
  updatedAt: string;
  pathway: RuntimePathwayDetails | null;
}

interface RuntimeFlowRecord {
  id: string;
  status: string;
  progress: number;
  createdAt: string;
  updatedAt: string;
  tasks: RuntimeTaskRecord[];
}

interface RowRuntimeModel {
  flows: RuntimeFlowRecord[];
  planningStatus: CanvasNodeStatus;
  currentStepLabel: string;
  latestUpdatedAt: string;
  focusTaskKeys: Set<string>;
  executionTaskByKey: Map<string, RuntimeTaskRecord>;
  executionTaskById: Map<string, RuntimeTaskRecord>;
  workflowStatusByTitle: Map<string, CanvasNodeStatus>;
}

const COLUMN_X = {
  STRING: 36,
  DISCUSSION: 320,
  DIRECTION: 604,
  PLAN: 888,
  WORKFLOW: 1172,
  TASK: 1464,
  WORKING: 1756,
  APPROVAL: 2048,
  COLLABORATION: 2340
} as const;

const SECTION_THEME: Record<CanvasSection, { border: string; background: string; badge: string }> = {
  STRING: {
    border: "rgba(34,211,238,0.5)",
    background: "rgba(8,47,73,0.36)",
    badge: "text-cyan-200"
  },
  DISCUSSION: {
    border: "rgba(45,212,191,0.46)",
    background: "rgba(17,94,89,0.3)",
    badge: "text-teal-200"
  },
  DIRECTION: {
    border: "rgba(56,189,248,0.46)",
    background: "rgba(7,89,133,0.3)",
    badge: "text-sky-200"
  },
  PLAN: {
    border: "rgba(59,130,246,0.44)",
    background: "rgba(30,64,175,0.26)",
    badge: "text-blue-200"
  },
  WORKFLOW: {
    border: "rgba(96,165,250,0.44)",
    background: "rgba(30,41,59,0.88)",
    badge: "text-blue-100"
  },
  TASK: {
    border: "rgba(148,163,184,0.36)",
    background: "rgba(15,23,42,0.94)",
    badge: "text-slate-100"
  },
  WORKING: {
    border: "rgba(245,158,11,0.46)",
    background: "rgba(120,53,15,0.26)",
    badge: "text-amber-100"
  },
  APPROVAL: {
    border: "rgba(251,191,36,0.5)",
    background: "rgba(120,53,15,0.34)",
    badge: "text-amber-50"
  },
  COLLABORATION: {
    border: "rgba(34,197,94,0.44)",
    background: "rgba(20,83,45,0.3)",
    badge: "text-emerald-100"
  }
};

const STATUS_THEME: Record<
  CanvasNodeStatus,
  { border: string; glow: string; badge: string; label: string }
> = {
  IDLE: {
    border: "rgba(148,163,184,0.35)",
    glow: "0 12px 28px rgba(2,6,23,0.34)",
    badge: "text-slate-300",
    label: "Idle"
  },
  PLANNED: {
    border: "rgba(96,165,250,0.45)",
    glow: "0 12px 28px rgba(30,64,175,0.22)",
    badge: "text-blue-200",
    label: "Planned"
  },
  RUNNING: {
    border: "rgba(34,211,238,0.82)",
    glow: "0 0 0 1px rgba(34,211,238,0.4), 0 0 24px rgba(34,211,238,0.18)",
    badge: "text-cyan-200",
    label: "Running"
  },
  QUEUED: {
    border: "rgba(96,165,250,0.7)",
    glow: "0 12px 28px rgba(59,130,246,0.24)",
    badge: "text-blue-100",
    label: "Queued"
  },
  PAUSED: {
    border: "rgba(251,191,36,0.76)",
    glow: "0 12px 28px rgba(251,191,36,0.18)",
    badge: "text-amber-100",
    label: "Paused"
  },
  COMPLETED: {
    border: "rgba(52,211,153,0.75)",
    glow: "0 12px 28px rgba(16,185,129,0.2)",
    badge: "text-emerald-100",
    label: "Completed"
  },
  FAILED: {
    border: "rgba(251,113,133,0.78)",
    glow: "0 12px 28px rgba(244,63,94,0.2)",
    badge: "text-rose-200",
    label: "Failed"
  },
  BLOCKED: {
    border: "rgba(250,204,21,0.82)",
    glow: "0 12px 28px rgba(250,204,21,0.18)",
    badge: "text-yellow-100",
    label: "Blocked"
  }
};

const STATUS_PRIORITY: Record<CanvasNodeStatus, number> = {
  RUNNING: 8,
  BLOCKED: 7,
  PAUSED: 6,
  FAILED: 5,
  QUEUED: 4,
  COMPLETED: 3,
  PLANNED: 2,
  IDLE: 1
};

function parseDetailScore(value: string | null | undefined, fallback?: number | null) {
  const parsed = Number.parseInt((value ?? "").trim(), 10);
  if (Number.isFinite(parsed)) {
    return Math.max(0, Math.min(100, parsed));
  }
  if (typeof fallback === "number" && Number.isFinite(fallback)) {
    return Math.max(0, Math.min(100, Math.floor(fallback)));
  }
  return null;
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeKeyPart(value: string) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.slice(0, 48) || "node";
}

function normalizeLookup(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function matchesText(left: string | null | undefined, right: string | null | undefined) {
  const normalizedLeft = normalizeLookup(left ?? "");
  const normalizedRight = normalizeLookup(right ?? "");
  return Boolean(normalizedLeft) && Boolean(normalizedRight) && normalizedLeft === normalizedRight;
}

function pathwayKey(workflowTitle: string, taskTitle: string) {
  return `${normalizeLookup(workflowTitle)}::${normalizeLookup(taskTitle)}`;
}

function formatDateLabel(value: string | null | undefined) {
  const timestamp = Date.parse(value ?? "");
  if (!Number.isFinite(timestamp)) {
    return "";
  }
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function taskStatusFromValue(value: unknown): CanvasNodeStatus {
  const normalized = normalizeText(value).toUpperCase();
  if (normalized === "RUNNING" || normalized === "ACTIVE") return "RUNNING";
  if (normalized === "PAUSED") return "PAUSED";
  if (normalized === "FAILED" || normalized === "ABORTED") return "FAILED";
  if (normalized === "QUEUED" || normalized === "DRAFT") return "QUEUED";
  if (normalized === "COMPLETED") return "COMPLETED";
  return "PLANNED";
}

function aggregateStatus(statuses: CanvasNodeStatus[]) {
  if (statuses.length === 0) {
    return "IDLE" as const;
  }
  if (statuses.includes("RUNNING")) return "RUNNING" as const;
  if (statuses.includes("BLOCKED")) return "BLOCKED" as const;
  if (statuses.includes("PAUSED")) return "PAUSED" as const;
  if (statuses.includes("FAILED")) return "FAILED" as const;
  if (statuses.includes("QUEUED")) return "QUEUED" as const;
  if (statuses.every((status) => status === "COMPLETED")) return "COMPLETED" as const;
  if (statuses.includes("COMPLETED")) return "COMPLETED" as const;
  if (statuses.includes("PLANNED")) return "PLANNED" as const;
  return "IDLE" as const;
}

function compareRuntimeTasks(left: RuntimeTaskRecord, right: RuntimeTaskRecord) {
  const statusGap = STATUS_PRIORITY[left.status] - STATUS_PRIORITY[right.status];
  if (statusGap !== 0) {
    return statusGap;
  }
  const leftStep = left.stepIndex ?? Number.MAX_SAFE_INTEGER;
  const rightStep = right.stepIndex ?? Number.MAX_SAFE_INTEGER;
  if (leftStep !== rightStep) {
    return rightStep - leftStep;
  }
  return Date.parse(left.updatedAt || "") - Date.parse(right.updatedAt || "");
}

function resolveFocusTaskKeys(tasks: RuntimeTaskRecord[]) {
  const pick = (status: CanvasNodeStatus) => tasks.filter((task) => task.status === status);
  const running = pick("RUNNING");
  if (running.length > 0) {
    return new Set(
      running
        .filter((task) => task.pathway)
        .map((task) => pathwayKey(task.pathway!.workflowTitle, task.pathway!.taskTitle))
    );
  }

  const blocked = [...pick("BLOCKED"), ...pick("PAUSED")];
  if (blocked.length > 0) {
    return new Set(
      blocked
        .filter((task) => task.pathway)
        .map((task) => pathwayKey(task.pathway!.workflowTitle, task.pathway!.taskTitle))
    );
  }

  const queued = [...pick("QUEUED")].sort((left, right) => {
    const leftStep = left.stepIndex ?? Number.MAX_SAFE_INTEGER;
    const rightStep = right.stepIndex ?? Number.MAX_SAFE_INTEGER;
    if (leftStep !== rightStep) {
      return leftStep - rightStep;
    }
    return Date.parse(left.createdAt || "") - Date.parse(right.createdAt || "");
  });
  if (queued[0]?.pathway) {
    return new Set([pathwayKey(queued[0].pathway.workflowTitle, queued[0].pathway.taskTitle)]);
  }

  const failed = pick("FAILED");
  if (failed[0]?.pathway) {
    return new Set([pathwayKey(failed[0].pathway.workflowTitle, failed[0].pathway.taskTitle)]);
  }

  const completed = [...pick("COMPLETED")].sort((left, right) => {
    return Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || "");
  });
  if (completed[0]?.pathway) {
    return new Set([
      pathwayKey(completed[0].pathway.workflowTitle, completed[0].pathway.taskTitle)
    ]);
  }

  return new Set<string>();
}

function fallbackWorkflowPlan(workflow: EditableStringDraft["workflows"][number]): DirectionPlanWorkflow {
  const tasks = splitDraftLines(workflow.taskSummary).map((taskTitle) => ({
    title: taskTitle,
    ownerRole: workflow.ownerRole || "",
    subtasks: [],
    tools: [],
    requiresApproval: false,
    approvalRole: "",
    approvalReason: ""
  }));

  return {
    title: workflow.title || "Workflow",
    goal: workflow.goal || "",
    ownerRole: workflow.ownerRole || "",
    deliverables: splitDraftLines(workflow.deliverablesText),
    tasks
  };
}

function resolveWorkflowPlans(row: BlueprintRow) {
  const planned = row.item.planningResult?.primaryPlan?.workflows ?? [];
  if (planned.length > 0) {
    return planned;
  }
  return row.draft.workflows.map((workflow) => fallbackWorkflowPlan(workflow));
}

function resolveTaskList(workflow: DirectionPlanWorkflow, row: BlueprintRow) {
  if (workflow.tasks.length > 0) {
    return workflow.tasks;
  }

  const draftMatch =
    row.draft.workflows.find((entry) => matchesText(entry.title, workflow.title)) ?? null;
  if (!draftMatch) {
    return [] as DirectionPlanTask[];
  }

  return splitDraftLines(draftMatch.taskSummary).map((taskTitle) => ({
    title: taskTitle,
    ownerRole: draftMatch.ownerRole || workflow.ownerRole || "",
    subtasks: [],
    tools: [],
    requiresApproval: false,
    approvalRole: "",
    approvalReason: ""
  }));
}

function buildRowRuntimeModel(flows: RuntimeFlowRecord[]) {
  if (flows.length === 0) {
    return null;
  }

  const planningStatuses: CanvasNodeStatus[] = [];
  const executionTaskByKey = new Map<string, RuntimeTaskRecord>();
  const executionTaskById = new Map<string, RuntimeTaskRecord>();
  const workflowStatusBucket = new Map<string, CanvasNodeStatus[]>();
  const executionTasks: RuntimeTaskRecord[] = [];
  let latestUpdatedAt = "";

  flows.forEach((flow) => {
    if (
      !latestUpdatedAt ||
      Date.parse(flow.updatedAt || "") > Date.parse(latestUpdatedAt || "")
    ) {
      latestUpdatedAt = flow.updatedAt;
    }

    flow.tasks.forEach((task) => {
      if (task.stage === "PLANNING") {
        planningStatuses.push(task.status);
        return;
      }

      if (!task.pathway) {
        return;
      }

      const key = pathwayKey(task.pathway.workflowTitle, task.pathway.taskTitle);
      const existing = executionTaskByKey.get(key);
      if (!existing || compareRuntimeTasks(task, existing) > 0) {
        executionTaskByKey.set(key, task);
      }
      executionTaskById.set(task.id, task);
      executionTasks.push(task);

      const workflowKey = normalizeLookup(task.pathway.workflowTitle);
      const bucket = workflowStatusBucket.get(workflowKey) ?? [];
      bucket.push(task.status);
      workflowStatusBucket.set(workflowKey, bucket);
    });
  });

  const workflowStatusByTitle = new Map<string, CanvasNodeStatus>();
  workflowStatusBucket.forEach((statuses, key) => {
    workflowStatusByTitle.set(key, aggregateStatus(statuses));
  });

  const focusTaskKeys = resolveFocusTaskKeys(executionTasks);
  const focusTask = [...focusTaskKeys]
    .map((key) => executionTaskByKey.get(key) ?? null)
    .find((task): task is RuntimeTaskRecord => Boolean(task));

  return {
    flows,
    planningStatus: aggregateStatus(planningStatuses),
    currentStepLabel: focusTask?.pathway
      ? `${focusTask.pathway.workflowTitle} -> ${focusTask.pathway.taskTitle}`
      : planningStatuses.length > 0
        ? "Plan orchestration"
        : "Execution not started",
    latestUpdatedAt,
    focusTaskKeys,
    executionTaskByKey,
    executionTaskById,
    workflowStatusByTitle
  } satisfies RowRuntimeModel;
}

function mapRuntimeTask(task: Record<string, unknown>, flowId: string, flowStatus: string) {
  const trace = asRecord(task.executionTrace);
  const pathwayRecord = asRecord(trace?.pathway);
  const orchestratorRecord = asRecord(trace?.orchestrator);
  const stageText = normalizeText(orchestratorRecord?.stage).toUpperCase();
  const pathway =
    pathwayRecord && normalizeText(pathwayRecord.workflowTitle) && normalizeText(pathwayRecord.taskTitle)
      ? {
          workflowTitle: normalizeText(pathwayRecord.workflowTitle),
          taskTitle: normalizeText(pathwayRecord.taskTitle),
          ownerRole: normalizeText(pathwayRecord.ownerRole),
          executionMode: normalizeText(pathwayRecord.executionMode) || "HYBRID",
          trigger: normalizeText(pathwayRecord.trigger),
          dueWindow: normalizeText(pathwayRecord.dueWindow),
          dependsOn: Array.isArray(pathwayRecord.dependsOn)
            ? pathwayRecord.dependsOn
                .map((entry) => normalizeText(entry))
                .filter(Boolean)
            : []
        }
      : null;

  return {
    id: normalizeText(task.id),
    flowId,
    flowStatus,
    prompt: normalizeText(task.prompt),
    status: taskStatusFromValue(task.status),
    stage:
      stageText === "PLANNING" ? "PLANNING" : stageText === "EXECUTION" ? "EXECUTION" : "UNKNOWN",
    stepIndex:
      typeof orchestratorRecord?.stepIndex === "number" && Number.isFinite(orchestratorRecord.stepIndex)
        ? Math.floor(orchestratorRecord.stepIndex)
        : null,
    totalSteps:
      typeof orchestratorRecord?.totalSteps === "number" &&
      Number.isFinite(orchestratorRecord.totalSteps)
        ? Math.floor(orchestratorRecord.totalSteps)
        : null,
    agentLabel: workflowAgentLabelFromTaskTrace({
      agent: asRecord(task.agent)
        ? {
            name: normalizeText(asRecord(task.agent)?.name),
            role: normalizeText(asRecord(task.agent)?.role)
          }
        : null,
      executionTrace: task.executionTrace
    }) ?? "Unassigned",
    createdAt: normalizeText(task.createdAt),
    updatedAt: normalizeText(task.updatedAt),
    pathway
  } satisfies RuntimeTaskRecord;
}

function mapRuntimeFlow(value: unknown) {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const id = normalizeText(record.id);
  if (!id) {
    return null;
  }

  return {
    id,
    status: normalizeText(record.status),
    progress: typeof record.progress === "number" && Number.isFinite(record.progress) ? record.progress : 0,
    createdAt: normalizeText(record.createdAt),
    updatedAt: normalizeText(record.updatedAt),
    tasks: Array.isArray(record.tasks)
      ? record.tasks
          .map((task) => {
            const mapped = asRecord(task);
            return mapped ? mapRuntimeTask(mapped, id, normalizeText(record.status)) : null;
          })
          .filter((task): task is RuntimeTaskRecord => Boolean(task))
      : []
  } satisfies RuntimeFlowRecord;
}

function buildCanvasNode(input: {
  id: string;
  x: number;
  y: number;
  meta: Omit<CanvasNodeMeta, "id">;
  width?: number;
  minHeight?: number;
}) {
  const theme = SECTION_THEME[input.meta.section];
  const statusTheme = STATUS_THEME[input.meta.status];
  const borderColor = input.meta.executionFocus ? "rgba(34,211,238,0.92)" : statusTheme.border;

  return {
    id: input.id,
    position: { x: input.x, y: input.y },
    data: {
      label: (
        <div className="space-y-2 text-left">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                {input.meta.section}
              </p>
              <p className="mt-1 text-xs font-semibold leading-5 text-slate-100">
                {input.meta.heading}
              </p>
            </div>
            <div className="text-right">
              <p className={`text-[10px] font-semibold ${theme.badge}`}>{input.meta.badge}</p>
              {input.meta.timeLabel ? (
                <p className="mt-1 text-[9px] uppercase tracking-[0.12em] text-slate-500">
                  {input.meta.timeLabel}
                </p>
              ) : null}
            </div>
          </div>
          <p className="text-[11px] leading-5 text-slate-400">{input.meta.summary}</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${statusTheme.badge}`}>
              {statusTheme.label}
            </span>
            {input.meta.executionFocus ? (
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-200">
                Execution Focus
              </span>
            ) : null}
          </div>
        </div>
      )
    },
    draggable: false,
    selectable: true,
    style: {
      width: input.width ?? 240,
      minHeight: input.minHeight ?? 122,
      borderRadius: 20,
      border: `1px solid ${borderColor}`,
      background: `linear-gradient(180deg, ${theme.background}, rgba(2,6,23,0.96))`,
      color: "#e2e8f0",
      boxShadow: input.meta.executionFocus
        ? "0 0 0 1px rgba(34,211,238,0.4), 0 0 28px rgba(34,211,238,0.16)"
        : statusTheme.glow,
      padding: 12
    }
  } satisfies Node;
}

function buildEdge(input: {
  source: string;
  target: string;
  label?: string;
  active?: boolean;
  animated?: boolean;
  stroke?: string;
  dashed?: boolean;
}) {
  const stroke = input.stroke ?? (input.active ? "rgba(34,211,238,0.82)" : "rgba(94,234,212,0.45)");
  return {
    id: `edge:${input.source}:${input.target}:${input.label ?? "link"}`,
    source: input.source,
    target: input.target,
    label: input.label,
    animated: input.animated ?? input.active ?? false,
    style: {
      stroke,
      strokeWidth: input.active ? 1.9 : 1.2,
      strokeDasharray: input.dashed ? "5 4" : undefined
    },
    labelStyle: {
      fill: "rgba(148,163,184,0.9)",
      fontSize: 9
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: stroke
    }
  } satisfies Edge;
}

function buildCanvasGraph(input: {
  rows: BlueprintRow[];
  runtimeByStringId: Record<string, RowRuntimeModel>;
  calendarDate: string | null | undefined;
  expandedMode: boolean;
  steerDecisions: Record<string, SteerLaneTab>;
}) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const nodeMeta = new Map<string, CanvasNodeMeta>();
  let rowCursorY = 40;

  input.rows.forEach((row) => {
    const runtime = input.runtimeByStringId[row.item.id] ?? null;
    const workflowPlans = resolveWorkflowPlans(row);
    const visibleWorkflowPlans = input.expandedMode ? workflowPlans : workflowPlans.slice(0, 4);
    const visibleDiscussionTurns = input.expandedMode
      ? row.discussionTurns.slice(-6)
      : row.discussionTurns.slice(-2);
    const visiblePlanApprovals = input.expandedMode
      ? row.draft.approvals.filter((approval) => approval.status === "PLAN")
      : row.draft.approvals.filter((approval) => approval.status === "PLAN").slice(0, 2);
    const collaborationParticipants = input.expandedMode
      ? row.collaboration.participants
      : row.collaboration.participants.slice(0, 3);
    const collaborationWorkforce = input.expandedMode
      ? row.collaboration.workforce
      : row.collaboration.workforce.slice(0, 4);
    const collaborationCreated = input.expandedMode
      ? row.collaboration.autoSquad?.created ?? []
      : (row.collaboration.autoSquad?.created ?? []).slice(0, 3);
    const collaborationRequested = input.expandedMode
      ? row.collaboration.autoSquad?.requestedRoles ?? []
      : (row.collaboration.autoSquad?.requestedRoles ?? []).slice(0, 3);

    const stringNodeId = `${row.item.id}:string`;
    const discussionNodeId = `${row.item.id}:discussion`;
    const directionNodeId = `${row.item.id}:direction`;
    const planNodeId = `${row.item.id}:plan`;
    const stringStatus =
      runtime?.focusTaskKeys.size || row.item.launchScope?.flowIds.length
        ? "RUNNING"
        : row.workflowCount > 0
          ? "PLANNED"
          : "IDLE";
    const stringMetaBase = {
      stringId: row.item.id,
      stringTitle: row.stringTitle
    };

    const stringMeta: CanvasNodeMeta = {
      id: stringNodeId,
      ...stringMetaBase,
      section: "STRING",
      heading: row.stringTitle,
      summary: input.calendarDate
        ? `Canvas scope ${new Date(`${input.calendarDate}T00:00:00`).toLocaleDateString()}`
        : "Canvas scope all visible dates",
      badge: row.item.mode,
      items: [
        `Updated ${new Date(row.item.updatedAt).toLocaleString()}`,
        `Mode ${row.item.mode}`,
        row.item.directionGiven.trim() || "No string objective captured yet.",
        runtime?.currentStepLabel ? `Execution focus: ${runtime.currentStepLabel}` : "Execution has not started."
      ],
      links: ["Discussion", "Direction", "Plan"],
      status: stringStatus,
      timeLabel: formatDateLabel(runtime?.latestUpdatedAt || new Date(row.item.updatedAt).toISOString())
    };
    nodes.push(
      buildCanvasNode({
        id: stringNodeId,
        x: COLUMN_X.STRING,
        y: rowCursorY,
        meta: stringMeta,
        width: 232
      })
    );
    nodeMeta.set(stringNodeId, stringMeta);

    const discussionMeta: CanvasNodeMeta = {
      id: discussionNodeId,
      ...stringMetaBase,
      section: "DISCUSSION",
      heading: `${row.draft.discussion.length} discussion turn(s)`,
      summary:
        row.draft.discussion[row.draft.discussion.length - 1]?.content.trim() ||
        "No discussion captured yet.",
      badge: `${row.draft.discussion.length}`,
      items:
        visibleDiscussionTurns.length > 0
          ? visibleDiscussionTurns.map(
              (turn, index) =>
                `${index + 1}. ${turn.actorLabel} | ${new Date(turn.timestamp).toLocaleString()} | ${turn.content.trim() || "Empty turn"}`
            )
          : ["No discussion captured yet."],
      links: ["String", "Direction"],
      status: row.draft.discussion.length > 0 ? "COMPLETED" : "IDLE",
      timeLabel: visibleDiscussionTurns[visibleDiscussionTurns.length - 1]
        ? formatDateLabel(
            new Date(
              visibleDiscussionTurns[visibleDiscussionTurns.length - 1]!.timestamp
            ).toISOString()
          )
        : undefined
    };
    nodes.push(
      buildCanvasNode({
        id: discussionNodeId,
        x: COLUMN_X.DISCUSSION,
        y: rowCursorY,
        meta: discussionMeta,
        width: 240
      })
    );
    nodeMeta.set(discussionNodeId, discussionMeta);

    const directionText = row.draft.direction.trim();
    const directionMeta: CanvasNodeMeta = {
      id: directionNodeId,
      ...stringMetaBase,
      section: "DIRECTION",
      heading: directionText || "Direction not captured yet.",
      summary: directionText
        ? compactTaskTitle(directionText, directionText)
        : "No direction captured yet.",
      badge: directionText ? "Ready" : "Empty",
      items: [directionText || "No direction captured yet."],
      links: ["Discussion", "Plan"],
      status: directionText ? "COMPLETED" : "IDLE"
    };
    nodes.push(
      buildCanvasNode({
        id: directionNodeId,
        x: COLUMN_X.DIRECTION,
        y: rowCursorY,
        meta: directionMeta,
        width: 248
      })
    );
    nodeMeta.set(directionNodeId, directionMeta);

    const planMeta: CanvasNodeMeta = {
      id: planNodeId,
      ...stringMetaBase,
      section: "PLAN",
      heading: row.draft.plan.summary.trim() || "Plan summary unavailable.",
      summary: `${row.workflowCount} workflow(s) | ${row.pathwayCount} pathway step(s) | ${row.deliverableCount} deliverable(s)`,
      badge: row.detailScore === null ? "N/A" : `${row.detailScore}/100`,
      items: [
        row.draft.plan.summary.trim() || "No plan summary captured yet.",
        ...splitDraftLines(row.draft.plan.deliverablesText)
          .slice(0, input.expandedMode ? 6 : 3)
          .map((entry) => `Deliverable: ${entry}`),
        runtime?.planningStatus && runtime.planningStatus !== "IDLE"
          ? `Planning runtime: ${STATUS_THEME[runtime.planningStatus].label}`
          : "Planning runtime not visible."
      ],
      links: ["Direction", "Workflow branches", "Plan approvals"],
      status:
        runtime?.planningStatus && runtime.planningStatus !== "IDLE"
          ? runtime.planningStatus
          : row.workflowCount > 0
            ? "PLANNED"
            : "IDLE",
      timeLabel: runtime?.planningStatus && runtime?.latestUpdatedAt ? formatDateLabel(runtime.latestUpdatedAt) : undefined
    };
    nodes.push(
      buildCanvasNode({
        id: planNodeId,
        x: COLUMN_X.PLAN,
        y: rowCursorY,
        meta: planMeta,
        width: 260
      })
    );
    nodeMeta.set(planNodeId, planMeta);

    edges.push(buildEdge({ source: stringNodeId, target: discussionNodeId, label: "discussion" }));
    edges.push(buildEdge({ source: discussionNodeId, target: directionNodeId, label: "direction" }));
    edges.push(buildEdge({ source: directionNodeId, target: planNodeId, label: "plan" }));

    visibleDiscussionTurns.forEach((turn, turnIndex) => {
      const turnNodeId = `${row.item.id}:discussion-turn:${turn.id}`;
      const turnMeta: CanvasNodeMeta = {
        id: turnNodeId,
        ...stringMetaBase,
        section: "DISCUSSION",
        heading: turn.actorLabel,
        summary: compactTaskTitle(turn.content, "Discussion turn"),
        badge: turn.actorType,
        items: [
          `Actor ${turn.actorLabel}`,
          `Type ${turn.actorType}`,
          `Time ${new Date(turn.timestamp).toLocaleString()}`,
          turn.content.trim() || "Empty turn"
        ],
        links: [row.stringTitle, "Direction"],
        status: turn.actorType === "HUMAN" ? "COMPLETED" : "PLANNED",
        timeLabel: formatDateLabel(new Date(turn.timestamp).toISOString())
      };
      nodes.push(
        buildCanvasNode({
          id: turnNodeId,
          x: COLUMN_X.DISCUSSION,
          y: rowCursorY + 132 + turnIndex * 96,
          meta: turnMeta,
          width: 240,
          minHeight: 110
        })
      );
      nodeMeta.set(turnNodeId, turnMeta);
      edges.push(buildEdge({ source: discussionNodeId, target: turnNodeId, label: "turn" }));
    });

    visiblePlanApprovals.forEach((approval, approvalIndex) => {
      const approvalNodeId = `${row.item.id}:plan-approval:${approval.id}`;
      const approvalMeta: CanvasNodeMeta = {
        id: approvalNodeId,
        ...stringMetaBase,
        section: "APPROVAL",
        heading: approval.title.trim() || "Plan approval gate",
        summary: approval.reason.trim() || "Approval detail not captured yet.",
        badge: approval.status,
        items: [
          `Owner ${approval.owner || "Unassigned"}`,
          `Status ${approval.status}`,
          approval.reason.trim() || "No reason captured."
        ],
        links: ["Plan"],
        status: approval.status === "PLAN" ? "BLOCKED" : "PLANNED"
      };
      nodes.push(
        buildCanvasNode({
          id: approvalNodeId,
          x: COLUMN_X.PLAN,
          y: rowCursorY + 132 + approvalIndex * 92,
          meta: approvalMeta,
          width: 260,
          minHeight: 104
        })
      );
      nodeMeta.set(approvalNodeId, approvalMeta);
      edges.push(buildEdge({ source: planNodeId, target: approvalNodeId, label: "gate" }));
    });

    const taskNodeIdByTaskTitle = new Map<string, string>();
    const workflowNodeIds = new Map<string, string>();
    const dependencyQueue: Array<{ fromTask: string; targetNodeId: string }> = [];
    let workflowCursorY = rowCursorY;

    visibleWorkflowPlans.forEach((workflow, workflowIndex) => {
      const workflowKey = normalizeLookup(workflow.title);
      const workflowNodeId = `${row.item.id}:workflow:${normalizeKeyPart(workflow.title || `workflow-${workflowIndex + 1}`)}`;
      workflowNodeIds.set(workflowKey, workflowNodeId);

      const pathwaySteps =
        (row.item.planningResult?.primaryPlan?.pathway ?? []).filter((step) =>
          matchesText(step.workflowTitle, workflow.title)
        );
      const taskList = resolveTaskList(workflow, row);
      const derivedTasks =
        pathwaySteps.length > 0
          ? pathwaySteps.map((step) => ({
              title: step.taskTitle,
              ownerRole: step.ownerRole || workflow.ownerRole || "",
              subtasks: [],
              tools: [],
              requiresApproval: false,
              approvalRole: "",
              approvalReason: ""
            }))
          : taskList;
      const visibleTasks = input.expandedMode ? derivedTasks : derivedTasks.slice(0, 4);

      const workflowDeliverables = buildDraftDeliverableCards({
        stringItem: row.item,
        draft: row.draft
      }).filter((card) => matchesText(card.workflowTitle, workflow.title));
      const visibleWorkflowDeliverables = input.expandedMode
        ? workflowDeliverables
        : workflowDeliverables.slice(0, 3);
      const workflowMilestones = row.draft.milestones.filter((milestone) =>
        matchesText(milestone.ownerRole, workflow.ownerRole)
      );
      const visibleWorkflowMilestones = input.expandedMode
        ? workflowMilestones
        : workflowMilestones.slice(0, 2);

      const workflowRuntimeTasks = runtime
        ? [...runtime.executionTaskByKey.values()].filter((task) =>
            matchesText(task.pathway?.workflowTitle, workflow.title)
          )
        : [];
      const workflowStatus =
        runtime?.workflowStatusByTitle.get(workflowKey) ??
        (workflowRuntimeTasks.length > 0
          ? aggregateStatus(workflowRuntimeTasks.map((task) => task.status))
          : "PLANNED");

      const clusterHeight =
        Math.max(
          132,
          visibleTasks.length * 96,
          Math.max(
            visibleWorkflowDeliverables.length + visibleWorkflowMilestones.length,
            1
          ) * 88
        ) + 32;

      const workflowMeta: CanvasNodeMeta = {
        id: workflowNodeId,
        ...stringMetaBase,
        section: "WORKFLOW",
        heading: workflow.title || `Workflow ${workflowIndex + 1}`,
        summary:
          workflow.goal.trim() ||
          `${derivedTasks.length} task(s) | ${workflowDeliverables.length} deliverable(s)`,
        badge: `${derivedTasks.length} task(s)`,
        items: [
          `Owner ${workflow.ownerRole || "Unassigned"}`,
          workflow.goal.trim() || "No workflow goal captured yet.",
          ...(workflow.deliverables ?? []).slice(0, 4).map((entry) => `Deliverable: ${entry}`),
          ...(workflow.dependencies ?? []).slice(0, 3).map((entry) => `Depends on: ${entry}`),
          workflowRuntimeTasks.length > 0
            ? `Runtime tasks ${workflowRuntimeTasks.length}`
            : "No runtime task linked yet."
        ],
        links: ["Plan", "Execution tasks", "Working outputs"],
        status: workflowStatus,
        timeLabel:
          workflowRuntimeTasks[0]?.updatedAt
            ? formatDateLabel(
                workflowRuntimeTasks
                  .map((task) => task.updatedAt)
                  .sort((left, right) => Date.parse(right) - Date.parse(left))[0]
              )
            : undefined,
        workflowTitle: workflow.title
      };
      nodes.push(
        buildCanvasNode({
          id: workflowNodeId,
          x: COLUMN_X.WORKFLOW,
          y: workflowCursorY,
          meta: workflowMeta,
          width: 252
        })
      );
      nodeMeta.set(workflowNodeId, workflowMeta);
      edges.push(
        buildEdge({
          source: planNodeId,
          target: workflowNodeId,
          label: workflowIndex === 0 ? "launches" : "branches",
          active: workflowStatus === "RUNNING" || workflowStatus === "QUEUED"
        })
      );

      let previousTaskNodeId: string | null = null;
      visibleTasks.forEach((task, taskIndex) => {
        const plannedStep = pathwaySteps.find((step) => matchesText(step.taskTitle, task.title)) ?? null;
        const runtimeTask =
          runtime?.executionTaskByKey.get(pathwayKey(workflow.title, task.title)) ?? null;
        const matchingPermissionRequests = row.permissionRequests.filter(
          (request) =>
            matchesText(request.workflowTitle, workflow.title) &&
            matchesText(request.taskTitle, task.title)
        );
        const matchingApprovalCheckpoints = row.approvalCheckpoints.filter(
          (checkpoint) => runtimeTask && checkpoint.taskId === runtimeTask.id
        );
        const hasPendingGate =
          matchingPermissionRequests.some((request) => request.status === "PENDING") ||
          matchingApprovalCheckpoints.some((checkpoint) => checkpoint.status === "PENDING");
        const derivedStatus = hasPendingGate
          ? runtimeTask?.status === "RUNNING"
            ? "RUNNING"
            : "BLOCKED"
          : runtimeTask?.status ??
            (plannedStep ? "PLANNED" : task.title.trim() ? "PLANNED" : "IDLE");
        const focusKey = pathwayKey(workflow.title, task.title);
        const taskNodeId = `${row.item.id}:task:${normalizeKeyPart(workflow.title)}:${normalizeKeyPart(task.title || `task-${taskIndex + 1}`)}`;
        taskNodeIdByTaskTitle.set(normalizeLookup(task.title), taskNodeId);
        const taskMeta: CanvasNodeMeta = {
          id: taskNodeId,
          ...stringMetaBase,
          section: "TASK",
          heading: task.title || `Task ${taskIndex + 1}`,
          summary:
            runtimeTask?.prompt ||
            plannedStep?.trigger ||
            compactTaskTitle(task.title || "", "Task"),
          badge: plannedStep?.executionMode || runtimeTask?.pathway?.executionMode || "TASK",
          items: [
            `Workflow ${workflow.title}`,
            `Owner ${runtimeTask?.agentLabel || task.ownerRole || workflow.ownerRole || "Unassigned"}`,
            plannedStep?.dueWindow
              ? `Window ${plannedStep.dueWindow}`
              : runtimeTask?.pathway?.dueWindow
                ? `Window ${runtimeTask.pathway.dueWindow}`
                : "No due window captured.",
            plannedStep?.trigger
              ? `Trigger ${plannedStep.trigger}`
              : runtimeTask?.pathway?.trigger
                ? `Trigger ${runtimeTask.pathway.trigger}`
                : "No trigger captured.",
            ...(task.subtasks ?? []).slice(0, 3).map((entry) => `Subtask: ${entry}`),
            ...(task.tools ?? []).slice(0, 3).map((entry) => `Tool: ${entry}`),
            ...(plannedStep?.dependsOn ?? runtimeTask?.pathway?.dependsOn ?? []).map(
              (entry) => `Depends on: ${entry}`
            ),
            ...matchingPermissionRequests.map(
              (request) => `Permission ${request.status} | ${request.area} | ${request.reason}`
            ),
            ...matchingApprovalCheckpoints.map(
              (checkpoint) => `Checkpoint ${checkpoint.status} | ${checkpoint.reason}`
            ),
            runtimeTask?.updatedAt
              ? `Updated ${new Date(runtimeTask.updatedAt).toLocaleString()}`
              : "Runtime has not touched this task yet."
          ],
          links: ["Workflow", "Working", "Approvals"],
          status: derivedStatus,
          timeLabel: runtimeTask?.updatedAt
            ? formatDateLabel(runtimeTask.updatedAt)
            : plannedStep?.dueWindow || runtimeTask?.pathway?.dueWindow || undefined,
          workflowTitle: workflow.title,
          taskTitle: task.title,
          executionFocus: runtime?.focusTaskKeys.has(focusKey)
        };
        nodes.push(
          buildCanvasNode({
            id: taskNodeId,
            x: COLUMN_X.TASK,
            y: workflowCursorY + taskIndex * 96,
            meta: taskMeta,
            width: 260,
            minHeight: 116
          })
        );
        nodeMeta.set(taskNodeId, taskMeta);

        edges.push(
          buildEdge({
            source: workflowNodeId,
            target: taskNodeId,
            label: plannedStep?.executionMode || runtimeTask?.pathway?.executionMode || "exec",
            active: taskMeta.executionFocus || derivedStatus === "RUNNING"
          })
        );

        if (previousTaskNodeId) {
          edges.push(
            buildEdge({
              source: previousTaskNodeId,
              target: taskNodeId,
              label: "next",
              dashed: true,
              stroke: "rgba(148,163,184,0.52)"
            })
          );
        }
        previousTaskNodeId = taskNodeId;

        [...(plannedStep?.dependsOn ?? runtimeTask?.pathway?.dependsOn ?? [])].forEach((dependency) => {
          dependencyQueue.push({
            fromTask: dependency,
            targetNodeId: taskNodeId
          });
        });

        const taskApprovals = [
          ...matchingPermissionRequests.map((request) => ({
            id: `request-${request.id}`,
            heading: `${request.area} | ${request.status}`,
            summary: request.reason,
            badge: request.status,
            status: request.status === "APPROVED" ? "COMPLETED" : request.status === "REJECTED" ? "FAILED" : "BLOCKED",
            timeLabel: formatDateLabel(request.updatedAt),
            items: [
              `Workflow ${request.workflowTitle || workflow.title}`,
              `Task ${request.taskTitle || task.title}`,
              `Requested by ${request.requestedByEmail || request.targetRole}`,
              request.reason
            ]
          })),
          ...matchingApprovalCheckpoints.map((checkpoint) => ({
            id: `checkpoint-${checkpoint.id}`,
            heading: `Checkpoint | ${checkpoint.status}`,
            summary: checkpoint.reason,
            badge: checkpoint.status,
            status:
              checkpoint.status === "APPROVED"
                ? "COMPLETED"
                : checkpoint.status === "REJECTED"
                  ? "FAILED"
                  : "BLOCKED",
            timeLabel: formatDateLabel(checkpoint.resolvedAt || checkpoint.requestedAt),
            items: [
              `Task ${task.title}`,
              `Status ${checkpoint.status}`,
              `Requested ${new Date(checkpoint.requestedAt).toLocaleString()}`,
              checkpoint.reason
            ]
          }))
        ];

        taskApprovals.forEach((approval, approvalIndex) => {
          const approvalNodeId = `${taskNodeId}:approval:${approval.id}`;
          const approvalMeta: CanvasNodeMeta = {
            id: approvalNodeId,
            ...stringMetaBase,
            section: "APPROVAL",
            heading: approval.heading,
            summary: approval.summary,
            badge: approval.badge,
            items: approval.items,
            links: [workflow.title, task.title],
            status: approval.status as CanvasNodeStatus,
            timeLabel: approval.timeLabel,
            workflowTitle: workflow.title,
            taskTitle: task.title
          };
          nodes.push(
            buildCanvasNode({
              id: approvalNodeId,
              x: COLUMN_X.APPROVAL,
              y: workflowCursorY + taskIndex * 96 + approvalIndex * 80,
              meta: approvalMeta,
              width: 246,
              minHeight: 100
            })
          );
          nodeMeta.set(approvalNodeId, approvalMeta);
          edges.push(
            buildEdge({
              source: taskNodeId,
              target: approvalNodeId,
              label: "approval",
              active: approval.status === "BLOCKED"
            })
          );
        });
      });

      const workingEntries = [
        ...visibleWorkflowDeliverables.map((card) => ({
          id: `deliverable:${card.id}`,
          heading: card.text,
          summary: `${card.source} output for ${workflow.title || "workflow"}`,
          badge: card.source,
          status:
            input.steerDecisions[card.id] === "APPROVED"
              ? ("COMPLETED" as const)
              : input.steerDecisions[card.id] === "RETHINK"
                ? ("BLOCKED" as const)
                : ("PLANNED" as const),
          items: [
            `Source ${card.source}`,
            card.workflowTitle ? `Workflow ${card.workflowTitle}` : `Workflow ${workflow.title}`,
            `String ${row.stringTitle}`
          ]
        })),
        ...visibleWorkflowMilestones.map((milestone) => ({
          id: `milestone:${milestone.id}`,
          heading: milestone.title || milestone.deliverable || "Milestone",
          summary: milestone.successSignal || milestone.deliverable || "Milestone output",
          badge: "MILESTONE",
          status: "PLANNED" as const,
          items: [
            `Owner ${milestone.ownerRole || "Unassigned"}`,
            `Window ${milestone.dueWindow || "No due window"}`,
            `Deliverable ${milestone.deliverable || "Not captured"}`,
            `Success ${milestone.successSignal || "Not captured"}`
          ]
        }))
      ];

      const visibleWorkingEntries =
        workingEntries.length > 0
          ? workingEntries
          : [{
              id: `placeholder:${workflowNodeId}`,
              heading: "No working items captured yet.",
              summary: "Deliverables and milestones will appear here once mapped.",
              badge: "EMPTY",
              status: "IDLE" as const,
              items: [`Workflow ${workflow.title || `Workflow ${workflowIndex + 1}`}`]
            }];

      visibleWorkingEntries.forEach((entry, entryIndex) => {
        const workingNodeId = `${workflowNodeId}:working:${normalizeKeyPart(entry.id)}`;
        const workingMeta: CanvasNodeMeta = {
          id: workingNodeId,
          ...stringMetaBase,
          section: "WORKING",
          heading: entry.heading,
          summary: entry.summary,
          badge: entry.badge,
          items: entry.items,
          links: [workflow.title || `Workflow ${workflowIndex + 1}`],
          status: entry.status,
          workflowTitle: workflow.title
        };
        nodes.push(
          buildCanvasNode({
            id: workingNodeId,
            x: COLUMN_X.WORKING,
            y: workflowCursorY + entryIndex * 88,
            meta: workingMeta,
            width: 248,
            minHeight: 108
          })
        );
        nodeMeta.set(workingNodeId, workingMeta);
        edges.push(
          buildEdge({
            source: workflowNodeId,
            target: workingNodeId,
            label: "output",
            active: entry.status === "COMPLETED"
          })
        );
      });

      workflowCursorY += clusterHeight;
    });

    dependencyQueue.forEach((dependency) => {
      const sourceNodeId =
        taskNodeIdByTaskTitle.get(normalizeLookup(dependency.fromTask)) ?? null;
      if (!sourceNodeId) {
        return;
      }
      edges.push(
        buildEdge({
          source: sourceNodeId,
          target: dependency.targetNodeId,
          label: "depends on",
          dashed: true,
          stroke: "rgba(248,250,252,0.36)"
        })
      );
    });

    collaborationParticipants.forEach((participant, index) => {
      const collaboratorNodeId = `${row.item.id}:participant:${normalizeKeyPart(participant.id)}`;
      const collaboratorMeta: CanvasNodeMeta = {
        id: collaboratorNodeId,
        ...stringMetaBase,
        section: "COLLABORATION",
        heading: participant.actorLabel,
        summary: `${participant.actorType} collaborator with ${participant.turnCount} turn(s)`,
        badge: participant.actorType,
        items: [
          `Actor ${participant.actorLabel}`,
          `Turns ${participant.turnCount}`,
          `Type ${participant.actorType}`,
          `String ${row.stringTitle}`
        ],
        links: [row.stringTitle, "Discussion"],
        status: participant.actorType === "HUMAN" ? "COMPLETED" : "PLANNED"
      };
      nodes.push(
        buildCanvasNode({
          id: collaboratorNodeId,
          x: COLUMN_X.COLLABORATION,
          y: rowCursorY + index * 88,
          meta: collaboratorMeta,
          width: 248,
          minHeight: 104
        })
      );
      nodeMeta.set(collaboratorNodeId, collaboratorMeta);
      edges.push(buildEdge({ source: stringNodeId, target: collaboratorNodeId, label: "collab" }));
    });

    const collaborationBaseY =
      rowCursorY + Math.max(collaborationParticipants.length, 1) * 88 + 16;

    collaborationWorkforce.forEach((resource, index) => {
      const collaboratorNodeId = `${row.item.id}:workforce:${normalizeKeyPart(`${resource.role}-${index}`)}`;
      const collaboratorMeta: CanvasNodeMeta = {
        id: collaboratorNodeId,
        ...stringMetaBase,
        section: "COLLABORATION",
        heading: resource.role,
        summary: resource.responsibility || "Resource plan assignment",
        badge: `${resource.capacityPct}%`,
        items: [
          `Workforce ${resource.workforceType}`,
          `Capacity ${resource.capacityPct}%`,
          ...(resource.tools ?? []).slice(0, 4).map((tool) => `Tool: ${tool}`),
          resource.responsibility || "No responsibility captured."
        ],
        links: ["Plan", "Workflow"],
        status: "PLANNED"
      };
      const collaboratorY = collaborationBaseY + index * 88;
      nodes.push(
        buildCanvasNode({
          id: collaboratorNodeId,
          x: COLUMN_X.COLLABORATION,
          y: collaboratorY,
          meta: collaboratorMeta,
          width: 248,
          minHeight: 104
        })
      );
      nodeMeta.set(collaboratorNodeId, collaboratorMeta);

      const matchingWorkflow = visibleWorkflowPlans.find(
        (workflow) =>
          matchesText(workflow.ownerRole, resource.role) ||
          resolveTaskList(workflow, row).some((task) => matchesText(task.ownerRole, resource.role))
      );
      const matchingWorkflowNodeId = matchingWorkflow
        ? workflowNodeIds.get(normalizeLookup(matchingWorkflow.title))
        : null;
      edges.push(
        buildEdge({
          source: matchingWorkflowNodeId ?? planNodeId,
          target: collaboratorNodeId,
          label: matchingWorkflowNodeId ? "owned by" : "resource"
        })
      );
    });

    const autoSquadBaseY =
      collaborationBaseY + Math.max(collaborationWorkforce.length, 1) * 88 + 16;

    collaborationCreated.forEach((member, index) => {
      const collaboratorNodeId = `${row.item.id}:auto-created:${normalizeKeyPart(member.id || `${member.role}-${index}`)}`;
      const collaboratorMeta: CanvasNodeMeta = {
        id: collaboratorNodeId,
        ...stringMetaBase,
        section: "COLLABORATION",
        heading: member.name || member.role || "Auto squad member",
        summary: member.role || "Auto-created specialist",
        badge: "AUTO",
        items: [
          `Role ${member.role || "Unassigned"}`,
          `Name ${member.name || "Unnamed specialist"}`,
          "Created from auto squad planning."
        ],
        links: ["Plan", "Workflow"],
        status: "PLANNED"
      };
      nodes.push(
        buildCanvasNode({
          id: collaboratorNodeId,
          x: COLUMN_X.COLLABORATION,
          y: autoSquadBaseY + index * 88,
          meta: collaboratorMeta,
          width: 248,
          minHeight: 104
        })
      );
      nodeMeta.set(collaboratorNodeId, collaboratorMeta);
      edges.push(buildEdge({ source: planNodeId, target: collaboratorNodeId, label: "auto squad" }));
    });

    const requestedRoleBaseY =
      autoSquadBaseY + Math.max(collaborationCreated.length, 1) * 88 + 16;

    collaborationRequested.forEach((role, index) => {
      const collaboratorNodeId = `${row.item.id}:auto-requested:${normalizeKeyPart(role)}`;
      const collaboratorMeta: CanvasNodeMeta = {
        id: collaboratorNodeId,
        ...stringMetaBase,
        section: "COLLABORATION",
        heading: role,
        summary: "Requested collaborator role for this string.",
        badge: "REQUEST",
        items: [`Role ${role}`, "Pending workforce alignment."],
        links: ["Plan"],
        status: "BLOCKED"
      };
      nodes.push(
        buildCanvasNode({
          id: collaboratorNodeId,
          x: COLUMN_X.COLLABORATION,
          y: requestedRoleBaseY + index * 88,
          meta: collaboratorMeta,
          width: 248,
          minHeight: 96
        })
      );
      nodeMeta.set(collaboratorNodeId, collaboratorMeta);
      edges.push(buildEdge({ source: planNodeId, target: collaboratorNodeId, label: "requested" }));
    });

    const discussionBottom = rowCursorY + 132 + visibleDiscussionTurns.length * 96;
    const planApprovalBottom = rowCursorY + 132 + visiblePlanApprovals.length * 92;
    const collaborationBottom =
      requestedRoleBaseY + Math.max(collaborationRequested.length, 1) * 88;
    rowCursorY =
      Math.max(
        workflowCursorY,
        discussionBottom,
        planApprovalBottom,
        collaborationBottom,
        rowCursorY + 140
      ) + 72;
  });

  return { nodes, edges, nodeMeta };
}

export function StringBlueprintCanvasSurface({
  themeStyle,
  calendarDate,
  stringItem,
  allStringItems,
  permissionRequests,
  approvalCheckpoints,
  draftsByString = {},
  scoreByString = {},
  steerDecisions,
  selectedStringId,
  onSelectedStringChange
}: StringBlueprintCanvasSurfaceProps) {
  const [internalSelectedStringId, setInternalSelectedStringId] = useState<string | null>(
    stringItem?.id ?? null
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [runtimeByStringId, setRuntimeByStringId] = useState<Record<string, RowRuntimeModel>>({});

  useEffect(() => {
    if (selectedStringId !== undefined) {
      return;
    }
    setInternalSelectedStringId(stringItem?.id ?? null);
  }, [selectedStringId, stringItem?.id]);

  const activeSelectedStringId =
    selectedStringId !== undefined ? selectedStringId : internalSelectedStringId;

  const handleStringScopeChange = useCallback(
    (value: string | null) => {
      if (onSelectedStringChange) {
        onSelectedStringChange(value);
        return;
      }
      setInternalSelectedStringId(value);
    },
    [onSelectedStringChange]
  );

  const permissionRequestsByString = useMemo(
    () =>
      new Map(
        allStringItems.map((item) => [
          item.id,
          getScopedPermissionRequestsForString(item, permissionRequests)
        ])
      ),
    [allStringItems, permissionRequests]
  );

  const approvalCheckpointsByString = useMemo(
    () =>
      new Map(
        allStringItems.map((item) => [
          item.id,
          getScopedApprovalCheckpointsForString(item, approvalCheckpoints)
        ])
      ),
    [allStringItems, approvalCheckpoints]
  );

  const rows = useMemo<BlueprintRow[]>(
    () =>
      allStringItems
        .map((item) => {
          const scopedPermissionRequests = permissionRequestsByString.get(item.id) ?? [];
          const scopedApprovalCheckpoints = approvalCheckpointsByString.get(item.id) ?? [];
          const draft = resolveEditableStringDraft({
            draft: draftsByString[item.id],
            stringItem: item,
            permissionRequests: scopedPermissionRequests,
            approvalCheckpoints: scopedApprovalCheckpoints
          });
          const deliverables = buildDraftDeliverableCards({
            stringItem: item,
            draft
          });
          const detailScore = parseDetailScore(
            draft.scoring.detailScore,
            item.planningResult?.primaryPlan?.detailScore ?? null
          );
          const scoreRecords = scoreByString[item.id] ?? [];
          const approvedDeliverables = deliverables.filter(
            (card) => steerDecisions[card.id] === "APPROVED"
          ).length;
          const rethinkDeliverables = deliverables.filter(
            (card) => steerDecisions[card.id] === "RETHINK"
          ).length;

          return {
            item,
            stringTitle: controlThreadDisplayTitle(item),
            draft,
            discussionTurns: buildStringDiscussionTurns(item),
            detailScore,
            deliverableCount: deliverables.length,
            workflowCount: draft.workflows.length,
            pathwayCount: draft.pathway.length,
            milestoneCount: draft.milestones.length,
            approvalCount: draft.approvals.length,
            pendingApprovalCount: draft.approvals.filter(
              (approval) => approval.status === "PENDING" || approval.status === "PLAN"
            ).length,
            scoreActivityCount: scoreRecords.length,
            approvedDeliverables,
            rethinkDeliverables,
            collaboration: buildStringCollaborationSnapshot({
              draft,
              stringItem: item
            }),
            permissionRequests: scopedPermissionRequests,
            approvalCheckpoints: scopedApprovalCheckpoints
          };
        })
        .sort((left, right) => right.item.updatedAt - left.item.updatedAt),
    [
      allStringItems,
      approvalCheckpointsByString,
      draftsByString,
      permissionRequestsByString,
      scoreByString,
      steerDecisions
    ]
  );

  const visibleRows = useMemo(
    () =>
      activeSelectedStringId
        ? rows.filter((row) => row.item.id === activeSelectedStringId)
        : rows,
    [activeSelectedStringId, rows]
  );

  const runtimeScopeKey = useMemo(
    () =>
      visibleRows
        .map((row) =>
          [
            row.item.id,
            ...(row.item.launchScope?.flowIds ?? [])
              .map((value) => value.trim())
              .filter(Boolean)
              .sort()
          ].join(":")
        )
        .join("|"),
    [visibleRows]
  );

  useEffect(() => {
    setSelectedNodeId(null);
  }, [activeSelectedStringId, visibleRows.length]);

  useEffect(() => {
    let active = true;

    const loadRuntime = async () => {
      const targetRows = visibleRows.filter(
        (row) => (row.item.launchScope?.flowIds ?? []).filter((value) => value.trim()).length > 0
      );

      if (targetRows.length === 0) {
        if (active) {
          setRuntimeByStringId({});
        }
        return;
      }

      const nextState: Record<string, RowRuntimeModel> = {};
      await Promise.all(
        targetRows.map(async (row) => {
          const flowIds = [
            ...new Set(
              (row.item.launchScope?.flowIds ?? []).map((value) => value.trim()).filter(Boolean)
            )
          ];
          const flows = await Promise.all(
            flowIds.map(async (flowId) => {
              try {
                const response = await fetch(`/api/flows/${encodeURIComponent(flowId)}`, {
                  cache: "no-store"
                });
                const payload = (await response.json().catch(() => null)) as
                  | { ok?: boolean; flow?: unknown }
                  | null;
                if (!response.ok || !payload?.ok || !payload.flow) {
                  return null;
                }
                return mapRuntimeFlow(payload.flow);
              } catch {
                return null;
              }
            })
          );

          const runtimeModel = buildRowRuntimeModel(
            flows.filter((flow): flow is RuntimeFlowRecord => Boolean(flow))
          );
          if (runtimeModel) {
            nextState[row.item.id] = runtimeModel;
          }
        })
      );

      if (active) {
        setRuntimeByStringId(nextState);
      }
    };

    void loadRuntime();
    const timer = window.setInterval(() => {
      void loadRuntime();
    }, 15000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [runtimeScopeKey, visibleRows]);

  const expandedMode = visibleRows.length <= 1;

  const graph = useMemo(
    () =>
      buildCanvasGraph({
        rows: visibleRows,
        runtimeByStringId,
        calendarDate,
        expandedMode,
        steerDecisions
      }),
    [calendarDate, expandedMode, runtimeByStringId, steerDecisions, visibleRows]
  );

  const selectedMeta = selectedNodeId ? graph.nodeMeta.get(selectedNodeId) ?? null : null;
  const selectedRelations = useMemo(() => {
    if (!selectedMeta) {
      return { upstream: [] as string[], downstream: [] as string[] };
    }

    const upstream = graph.edges
      .filter((edge) => edge.target === selectedMeta.id)
      .map((edge) => graph.nodeMeta.get(edge.source)?.heading ?? edge.source);
    const downstream = graph.edges
      .filter((edge) => edge.source === selectedMeta.id)
      .map((edge) => graph.nodeMeta.get(edge.target)?.heading ?? edge.target);

    return { upstream, downstream };
  }, [graph.edges, graph.nodeMeta, selectedMeta]);

  const totalWorkflows = visibleRows.reduce((sum, row) => sum + row.workflowCount, 0);
  const totalPathway = visibleRows.reduce((sum, row) => sum + row.pathwayCount, 0);
  const totalDeliverables = visibleRows.reduce((sum, row) => sum + row.deliverableCount, 0);
  const totalPendingApprovals = visibleRows.reduce((sum, row) => sum + row.pendingApprovalCount, 0);
  const liveExecutionCount = Object.values(runtimeByStringId).reduce(
    (sum, runtime) => sum + runtime.focusTaskKeys.size,
    0
  );
  const executionFocusText =
    visibleRows.length === 1
      ? runtimeByStringId[visibleRows[0]?.item.id ?? ""]?.currentStepLabel ?? "Plan blueprint"
      : liveExecutionCount > 0
        ? `${liveExecutionCount} live execution focus point(s)`
        : "Plan blueprint";

  return (
    <div className="space-y-4">
      <header className={`rounded-3xl border border-white/10 bg-black/35 p-4 ${themeStyle.border}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">String Blueprint</p>
            <h2 className="text-lg font-semibold text-slate-100">Canvas For String Path, Branches, And Execution</h2>
            <p className="text-xs text-slate-400">
              Workflow branches, child steps, approvals, outputs, and collaborators now render on the canvas instead of hiding inside one side panel.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1.5 text-[11px] text-cyan-100">
              {executionFocusText}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-slate-300">
              {calendarDate
                ? `Date ${new Date(`${calendarDate}T00:00:00`).toLocaleDateString()}`
                : "All visible dates"}
            </span>
            <select
              value={activeSelectedStringId ?? "ALL"}
              onChange={(event) =>
                handleStringScopeChange(event.target.value === "ALL" ? null : event.target.value)
              }
              className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-xs text-slate-200"
            >
              <option value="ALL">All Strings</option>
              {rows.map((row) => (
                <option key={row.item.id} value={row.item.id}>
                  {row.stringTitle}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-6">
          <div className="rounded-xl border border-white/10 bg-black/35 px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Visible Strings</p>
            <p className="mt-1 text-sm font-semibold text-slate-100">{visibleRows.length}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/35 px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Workflows</p>
            <p className="mt-1 text-sm font-semibold text-slate-100">{totalWorkflows}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/35 px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Pathway Steps</p>
            <p className="mt-1 text-sm font-semibold text-slate-100">{totalPathway}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/35 px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Working Items</p>
            <p className="mt-1 text-sm font-semibold text-slate-100">{totalDeliverables}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/35 px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Pending Gates</p>
            <p className="mt-1 text-sm font-semibold text-slate-100">{totalPendingApprovals}</p>
          </div>
          <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-[0.14em] text-cyan-200">Live Focus</p>
            <p className="mt-1 text-sm font-semibold text-cyan-50">{liveExecutionCount}</p>
          </div>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(340px,1fr)]">
        <section className={`rounded-3xl border border-white/10 bg-black/35 p-3 ${themeStyle.border}`}>
          {graph.nodes.length === 0 ? (
            <div className="flex h-[62vh] items-center justify-center rounded-2xl border border-dashed border-white/10 bg-[#02060d] px-6 text-center text-sm text-slate-500">
              No string blueprint is available in this scope yet.
            </div>
          ) : (
            <div className="h-[62vh] rounded-2xl border border-white/10 bg-[#02060d]">
              <ReactFlow
                nodes={graph.nodes}
                edges={graph.edges}
                fitView
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable
                onNodeClick={(_, node) => setSelectedNodeId(node.id)}
                onPaneClick={() => setSelectedNodeId(null)}
                defaultEdgeOptions={{
                  markerEnd: {
                    type: MarkerType.ArrowClosed
                  }
                }}
              >
                <Background color="rgba(148,163,184,0.18)" gap={22} size={0.8} />
                <MiniMap
                  nodeColor={(node) => {
                    const meta = graph.nodeMeta.get(node.id);
                    return meta?.executionFocus
                      ? "rgba(34,211,238,0.8)"
                      : meta?.status === "BLOCKED"
                        ? "rgba(250,204,21,0.7)"
                        : meta?.status === "COMPLETED"
                          ? "rgba(52,211,153,0.7)"
                          : "rgba(56,189,248,0.35)";
                  }}
                  maskColor="rgba(2,6,23,0.5)"
                  style={{ backgroundColor: "rgba(2,6,23,0.6)" }}
                />
                <Controls />
              </ReactFlow>
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <section className={`rounded-3xl border border-white/10 bg-black/35 p-4 ${themeStyle.border}`}>
            <h3 className="text-sm font-semibold text-slate-100">Selected Canvas Node</h3>
            {!selectedMeta ? (
              <p className="mt-2 text-xs text-slate-400">
                Select any node to inspect its branch, timing, dependencies, and collaboration context.
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                      {selectedMeta.section}
                    </p>
                    <span className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${STATUS_THEME[selectedMeta.status].badge}`}>
                      {STATUS_THEME[selectedMeta.status].label}
                    </span>
                    {selectedMeta.executionFocus ? (
                      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-200">
                        Execution Focus
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm font-semibold text-slate-100">{selectedMeta.stringTitle}</p>
                  <p className="mt-2 text-xs leading-5 text-slate-300">{selectedMeta.heading}</p>
                  <p className="mt-2 text-[11px] leading-5 text-slate-500">{selectedMeta.summary}</p>
                  {selectedMeta.timeLabel ? (
                    <p className="mt-2 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                      {selectedMeta.timeLabel}
                    </p>
                  ) : null}
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Details</p>
                  <div className="mt-3 max-h-[28vh] space-y-2 overflow-y-auto pr-1">
                    {selectedMeta.items.map((item, index) => (
                      <div
                        key={`${selectedMeta.id}-item-${index}`}
                        className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2"
                      >
                        <p className="text-xs leading-5 text-slate-200">{item}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Upstream Links</p>
                    <div className="mt-3 space-y-2">
                      {selectedRelations.upstream.length === 0 ? (
                        <p className="text-xs text-slate-500">No upstream link.</p>
                      ) : (
                        selectedRelations.upstream.map((entry) => (
                          <div key={`${selectedMeta.id}-up-${entry}`} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-200">
                            {entry}
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Downstream Links</p>
                    <div className="mt-3 space-y-2">
                      {selectedRelations.downstream.length === 0 ? (
                        <p className="text-xs text-slate-500">No downstream link.</p>
                      ) : (
                        selectedRelations.downstream.map((entry) => (
                          <div key={`${selectedMeta.id}-down-${entry}`} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-200">
                            {entry}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className={`rounded-3xl border border-white/10 bg-black/35 p-4 ${themeStyle.border}`}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-100">String Scope</h3>
              <button
                type="button"
                onClick={() => handleStringScopeChange(null)}
                className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:bg-white/10"
              >
                All Strings
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {rows.length === 0 ? (
                <p className="text-xs text-slate-500">No strings are visible in this scope.</p>
              ) : (
                rows.map((row) => {
                  const isActive = row.item.id === activeSelectedStringId;
                  const runtime = runtimeByStringId[row.item.id] ?? null;
                  return (
                    <button
                      key={row.item.id}
                      type="button"
                      onClick={() => handleStringScopeChange(isActive ? null : row.item.id)}
                      className={`block w-full rounded-2xl border px-3 py-3 text-left transition ${
                        isActive
                          ? "border-cyan-400/40 bg-cyan-500/10"
                          : "border-white/10 bg-black/20 hover:bg-white/5"
                      }`}
                    >
                      <p className="text-xs font-semibold text-slate-100">{row.stringTitle}</p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        {row.workflowCount} workflow(s) | {row.pathwayCount} pathway step(s) | {row.deliverableCount} deliverable(s)
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {runtime?.currentStepLabel ?? "Plan blueprint"}
                      </p>
                    </button>
                  );
                })
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
