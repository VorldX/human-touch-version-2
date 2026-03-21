"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  GitBranchPlus,
  Link2,
  Loader2,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  TerminalSquare,
  X
} from "lucide-react";
import type { Edge, Node } from "reactflow";

import { AutopsyBlueprint } from "@/components/autopsy/autopsy-blueprint";
import { parseJsonResponse } from "@/lib/http/json-response";
import { getRealtimeClient } from "@/lib/realtime/client";
import { useVorldXStore } from "@/lib/store/vorldx-store";

type FlowStatus = "DRAFT" | "QUEUED" | "ACTIVE" | "PAUSED" | "COMPLETED" | "ABORTED" | "FAILED";
type TaskStatus = "QUEUED" | "RUNNING" | "PAUSED" | "COMPLETED" | "FAILED" | "ABORTED";

interface FlowListItem {
  id: string;
  prompt: string;
  status: FlowStatus;
  progress: number;
  predictedBurn: number;
  humanTouchRequired: boolean;
  createdAt?: string;
  updatedAt: string;
  taskCounts: { total: number; paused: number };
}

interface FlowTask {
  id: string;
  prompt: string;
  status: TaskStatus;
  isPausedForInput: boolean;
  humanInterventionReason: string | null;
  executionTrace: unknown;
  agent: { name: string; role: string } | null;
}

interface FlowApprovalEntry {
  id: string;
  timestamp: string;
  user: {
    id: string;
    username: string;
    email: string;
  };
}

interface FlowDetail {
  id: string;
  status: FlowStatus;
  progress: number;
  predictedBurn: number;
  requiredSignatures: number;
  approvals?: FlowApprovalEntry[];
  tasks: FlowTask[];
}

interface FlowLog {
  id: string;
  type: string;
  actor: string;
  message: string;
  timestamp: string;
}

interface WorkflowConsoleProps {
  orgId: string;
  themeStyle: {
    accent: string;
    accentSoft: string;
    border: string;
  };
  dateFilter?: string | null;
  flowIdFilter?: string[] | null;
  stringFilterLabel?: string | null;
  onTaskNeedsInput?: (input: {
    taskId: string;
    flowId: string | null;
    reason: string;
  }) => void;
}

interface IntegrationErrorTrace {
  code: "INTEGRATION_NOT_CONNECTED";
  toolkit: string;
  action: string;
  connectUrl?: string;
}

interface AgentRuntimeTrace {
  agentRunId?: string;
  logicalAgentId?: string;
  logicalRole?: string;
  parentAgentId?: string;
  decisionType?: string;
  decisionReason?: string;
  executionMode?: string;
  estimatedSelfCostUsd?: number;
  estimatedDelegationCostUsd?: number;
  budgetSnapshot?: {
    remainingBudgetUsd?: number;
    currentSpendUsd?: number;
    monthlyBudgetUsd?: number;
  };
}

function parseIntegrationError(trace: unknown): IntegrationErrorTrace | null {
  if (!trace || typeof trace !== "object" || Array.isArray(trace)) {
    return null;
  }
  const record = trace as Record<string, unknown>;
  if (!record.integrationError || typeof record.integrationError !== "object") {
    return null;
  }
  const raw = record.integrationError as Record<string, unknown>;
  if (raw.code !== "INTEGRATION_NOT_CONNECTED") {
    return null;
  }
  const toolkit = typeof raw.toolkit === "string" ? raw.toolkit.trim().toLowerCase() : "";
  const action = typeof raw.action === "string" ? raw.action.trim() : "TASK_EXECUTION";
  const connectUrl = typeof raw.connectUrl === "string" ? raw.connectUrl.trim() : "";
  if (!toolkit) {
    return null;
  }
  return {
    code: "INTEGRATION_NOT_CONNECTED",
    toolkit,
    action,
    ...(connectUrl ? { connectUrl } : {})
  };
}

function parseAgentRuntime(trace: unknown): AgentRuntimeTrace | null {
  if (!trace || typeof trace !== "object" || Array.isArray(trace)) {
    return null;
  }
  const record = trace as Record<string, unknown>;
  if (!record.agentRuntime || typeof record.agentRuntime !== "object") {
    return null;
  }
  const runtime = record.agentRuntime as Record<string, unknown>;
  const agentRunId = typeof runtime.agentRunId === "string" ? runtime.agentRunId : undefined;
  const logicalAgentId = typeof runtime.logicalAgentId === "string" ? runtime.logicalAgentId : undefined;
  const logicalRole = typeof runtime.logicalRole === "string" ? runtime.logicalRole : undefined;
  const parentAgentId = typeof runtime.parentAgentId === "string" ? runtime.parentAgentId : undefined;
  const decisionType = typeof runtime.decisionType === "string" ? runtime.decisionType : undefined;
  const decisionReason =
    typeof runtime.decisionReason === "string" ? runtime.decisionReason.trim() : undefined;
  const executionMode =
    typeof runtime.executionMode === "string" ? runtime.executionMode.trim() : undefined;
  const estimatedSelfCostUsd =
    typeof runtime.estimatedSelfCostUsd === "number"
      ? runtime.estimatedSelfCostUsd
      : typeof runtime.estimatedSelfCostUsd === "string"
        ? Number(runtime.estimatedSelfCostUsd)
        : undefined;
  const estimatedDelegationCostUsd =
    typeof runtime.estimatedDelegationCostUsd === "number"
      ? runtime.estimatedDelegationCostUsd
      : typeof runtime.estimatedDelegationCostUsd === "string"
        ? Number(runtime.estimatedDelegationCostUsd)
        : undefined;
  const rawBudget =
    runtime.budgetSnapshot && typeof runtime.budgetSnapshot === "object"
      ? (runtime.budgetSnapshot as Record<string, unknown>)
      : null;
  const budgetSnapshot = rawBudget
    ? {
        remainingBudgetUsd:
          typeof rawBudget.remainingBudgetUsd === "number"
            ? rawBudget.remainingBudgetUsd
            : typeof rawBudget.remainingBudgetUsd === "string"
              ? Number(rawBudget.remainingBudgetUsd)
              : undefined,
        currentSpendUsd:
          typeof rawBudget.currentSpendUsd === "number"
            ? rawBudget.currentSpendUsd
            : typeof rawBudget.currentSpendUsd === "string"
              ? Number(rawBudget.currentSpendUsd)
              : undefined,
        monthlyBudgetUsd:
          typeof rawBudget.monthlyBudgetUsd === "number"
            ? rawBudget.monthlyBudgetUsd
            : typeof rawBudget.monthlyBudgetUsd === "string"
              ? Number(rawBudget.monthlyBudgetUsd)
              : undefined
      }
    : undefined;

  if (
    !agentRunId &&
    !logicalAgentId &&
    !logicalRole &&
    !parentAgentId &&
    !decisionType &&
    !decisionReason &&
    !executionMode &&
    typeof estimatedSelfCostUsd !== "number" &&
    typeof estimatedDelegationCostUsd !== "number" &&
    !budgetSnapshot
  ) {
    return null;
  }

  return {
    agentRunId,
    logicalAgentId,
    logicalRole,
    parentAgentId,
    decisionType,
    decisionReason,
    executionMode,
    estimatedSelfCostUsd:
      typeof estimatedSelfCostUsd === "number" && Number.isFinite(estimatedSelfCostUsd)
        ? estimatedSelfCostUsd
        : undefined,
    estimatedDelegationCostUsd:
      typeof estimatedDelegationCostUsd === "number" &&
      Number.isFinite(estimatedDelegationCostUsd)
        ? estimatedDelegationCostUsd
        : undefined,
    budgetSnapshot
  };
}

function shortId(value: string | undefined, size = 8) {
  if (!value) return "";
  return value.slice(0, size);
}

function formatUsd(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a";
  }
  return `$${value.toFixed(2)}`;
}

function openCenteredPopup(url: string, name: string) {
  const width = Math.max(720, Math.min(980, window.outerWidth - 80));
  const height = Math.max(620, Math.min(760, window.outerHeight - 90));
  const left = Math.max(0, window.screenX + Math.round((window.outerWidth - width) / 2));
  const top = Math.max(0, window.screenY + Math.round((window.outerHeight - height) / 2));

  return window.open(
    url,
    name,
    `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
  );
}

function badgeClass(status: FlowStatus | TaskStatus) {
  if (status === "COMPLETED") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  if (status === "ACTIVE" || status === "RUNNING")
    return "border-cyan-500/40 bg-cyan-500/10 text-cyan-300";
  if (status === "PAUSED") return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  if (status === "FAILED" || status === "ABORTED")
    return "border-red-500/40 bg-red-500/10 text-red-300";
  return "border-white/20 bg-white/5 text-slate-300";
}

function normalizeTaskReason(reason: string | null | undefined) {
  return typeof reason === "string" ? reason.trim() : "";
}

function taskNeedsHumanInput(task: FlowTask) {
  if (parseIntegrationError(task.executionTrace)) {
    return true;
  }
  const reason = normalizeTaskReason(task.humanInterventionReason).toLowerCase();
  if (!reason) {
    return false;
  }

  return /missing|please provide|input required|human touch|not connected|requires .*input|needs .*input|provide/.test(
    reason
  );
}

function resolveHumanInputReason(task: FlowTask) {
  const integrationError = parseIntegrationError(task.executionTrace);
  if (integrationError) {
    return `Connect ${integrationError.toolkit} integration before resuming this task.`;
  }
  const reason = normalizeTaskReason(task.humanInterventionReason);
  if (reason) {
    return reason;
  }
  return "This task requires additional human input before resume.";
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

function buildAutopsy(task?: FlowTask | null) {
  if (!task) return { nodes: [] as Node[], edges: [] as Edge[] };
  const runtime = parseAgentRuntime(task.executionTrace);
  const agentLabel = runtime?.logicalRole
    ? `${runtime.logicalRole} (${runtime.logicalAgentId?.slice(0, 8) ?? "logical"})${runtime.parentAgentId ? ` <- ${runtime.parentAgentId.slice(0, 8)}` : ""}`
    : task.agent
      ? `${task.agent.name} (${task.agent.role})`
      : "Unassigned Agent";

  const nodes: Node[] = [
    {
      id: "task",
      position: { x: 20, y: 100 },
      data: { label: `Task ${task.id.slice(0, 8)}` },
      type: "input",
      style: { border: "1px solid rgba(59,130,246,0.5)", background: "#0f172a", color: "#e2e8f0" }
    },
    {
      id: "agent",
      position: { x: 300, y: 100 },
      data: { label: agentLabel },
      style: { border: "1px solid rgba(16,185,129,0.5)", background: "#052e2b", color: "#d1fae5" }
    },
    {
      id: "status",
      position: { x: 580, y: 100 },
      data: { label: `Status: ${task.status}` },
      style: { border: "1px solid rgba(245,158,11,0.5)", background: "#451a03", color: "#fef3c7" }
    }
  ];
  const edges: Edge[] = [
    { id: "task-agent", source: "task", target: "agent", animated: true },
    { id: "agent-status", source: "agent", target: "status" }
  ];

  const trace =
    task.executionTrace && typeof task.executionTrace === "object"
      ? (task.executionTrace as Record<string, unknown>)
      : null;
  const entries = trace ? Object.entries(trace).slice(0, 5) : [];
  if (entries.length === 0) {
    nodes.push({
      id: "trace-none",
      position: { x: 320, y: 260 },
      data: { label: "No execution trace available." },
      style: { border: "1px solid rgba(148,163,184,0.4)", background: "#111827", color: "#cbd5e1" }
    });
    edges.push({ id: "status-trace-none", source: "status", target: "trace-none" });
  } else {
    entries.forEach(([key, value], i) => {
      const nodeId = `trace-${i}`;
      nodes.push({
        id: nodeId,
        position: { x: 120 + i * 170, y: 260 },
        data: {
          label:
            typeof value === "string"
              ? `${key}: ${value.slice(0, 34)}`
              : `${key}: ${typeof value === "object" ? "structured" : String(value)}`
        },
        style: { border: "1px solid rgba(249,115,22,0.5)", background: "#431407", color: "#ffedd5" }
      });
      edges.push({ id: `status-${nodeId}`, source: "status", target: nodeId });
    });
  }
  return { nodes, edges };
}

export function WorkflowConsole({
  orgId,
  themeStyle,
  dateFilter = null,
  flowIdFilter = null,
  stringFilterLabel = null,
  onTaskNeedsInput
}: WorkflowConsoleProps) {
  const notify = useVorldXStore((s) => s.pushNotification);
  const realtimeRefreshTimerRef = useRef<number | null>(null);
  const surfacedInputTasksRef = useRef<Set<string>>(new Set());
  const [flows, setFlows] = useState<FlowListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flowId, setFlowId] = useState<string | null>(null);
  const [detail, setDetail] = useState<FlowDetail | null>(null);
  const [logs, setLogs] = useState<FlowLog[]>([]);
  const [detailTab, setDetailTab] = useState<"agent" | "human" | "autopsy" | "scoring">("agent");
  const [taskId, setTaskId] = useState<string>("");
  const [fileUrl, setFileUrl] = useState("");
  const [overridePrompt, setOverridePrompt] = useState("");
  const [note, setNote] = useState("");
  const [rewindPrompt, setRewindPrompt] = useState("");
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [signatureActionInFlight, setSignatureActionInFlight] = useState(false);

  const loadFlows = useCallback(async (silent?: boolean) => {
    if (!silent) setLoading(true);
    try {
      const response = await fetch(`/api/flows?orgId=${encodeURIComponent(orgId)}&limit=100`, {
        cache: "no-store"
      });
      const { payload, rawText } = await parseJsonResponse<{
        ok?: boolean;
        message?: string;
        flows?: FlowListItem[];
      }>(response);
      if (!response.ok || !payload?.ok || !payload.flows) {
        setError(
          payload?.message ??
            (rawText
              ? `Failed to load workflows (${response.status}): ${rawText.slice(0, 180)}`
              : "Failed to load workflows.")
        );
        return;
      }
      setError(null);
      setFlows(payload.flows);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Flow fetch failed.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [orgId]);

  const loadDetail = useCallback(async (id: string, silent?: boolean) => {
    if (!silent) setDetail(null);
    const response = await fetch(`/api/flows/${id}`, { cache: "no-store" });
    const { payload, rawText } = await parseJsonResponse<{
      ok?: boolean;
      message?: string;
      flow?: FlowDetail;
      logs?: FlowLog[];
    }>(response);
    if (!response.ok || !payload?.ok || !payload.flow) {
      notify({
        title: "Deep Dive",
        message:
          payload?.message ??
          (rawText
            ? `Unable to load flow details (${response.status}): ${rawText.slice(0, 180)}`
            : "Unable to load flow details."),
        type: "error"
      });
      return;
    }
    setDetail(payload.flow);
    setLogs(payload.logs ?? []);
    const paused = payload.flow.tasks.find((t) => t.isPausedForInput || t.status === "PAUSED");
    setTaskId(paused?.id ?? payload.flow.tasks[0]?.id ?? "");
  }, [notify]);

  useEffect(() => {
    void loadFlows();
    const interval = setInterval(() => void loadFlows(true), 7000);
    return () => clearInterval(interval);
  }, [loadFlows]);

  useEffect(() => {
    if (!flowId) return;
    void loadDetail(flowId);
    const interval = setInterval(() => void loadDetail(flowId, true), 7000);
    return () => clearInterval(interval);
  }, [flowId, loadDetail]);

  const visibleFlows = useMemo(() => {
    const normalizedFlowIds = new Set(
      (flowIdFilter ?? []).map((item) => item.trim()).filter(Boolean)
    );
    return flows.filter((flow) => {
      if (!matchesDateFilter(dateFilter, flow.createdAt, flow.updatedAt)) {
        return false;
      }
      if (normalizedFlowIds.size > 0 && !normalizedFlowIds.has(flow.id)) {
        return false;
      }
      return true;
    });
  }, [dateFilter, flowIdFilter, flows]);

  useEffect(() => {
    if (!flowId) {
      return;
    }
    if (visibleFlows.some((flow) => flow.id === flowId)) {
      return;
    }
    setFlowId(null);
    setDetail(null);
    setLogs([]);
  }, [flowId, visibleFlows]);

  useEffect(() => {
    if (!detail) {
      return;
    }

    const surfaced = surfacedInputTasksRef.current;
    for (const task of detail.tasks) {
      const stillPaused = task.status === "PAUSED" || task.isPausedForInput;
      if (!stillPaused) {
        surfaced.delete(task.id);
      }
    }

    if (!onTaskNeedsInput) {
      return;
    }

    const candidate = detail.tasks.find((task) => {
      const paused = task.status === "PAUSED" || task.isPausedForInput;
      return paused && taskNeedsHumanInput(task) && !surfaced.has(task.id);
    });

    if (!candidate) {
      return;
    }

    surfaced.add(candidate.id);
    onTaskNeedsInput({
      taskId: candidate.id,
      flowId: detail.id,
      reason: resolveHumanInputReason(candidate)
    });
  }, [detail, onTaskNeedsInput]);

  const queueRealtimeRefresh = useCallback(
    (candidateFlowId?: string) => {
      if (typeof window === "undefined") {
        return;
      }

      if (realtimeRefreshTimerRef.current) {
        window.clearTimeout(realtimeRefreshTimerRef.current);
      }

      realtimeRefreshTimerRef.current = window.setTimeout(() => {
        void loadFlows(true);
        const targetFlowId = flowId ?? candidateFlowId;
        if (targetFlowId) {
          void loadDetail(targetFlowId, true);
        }
        realtimeRefreshTimerRef.current = null;
      }, 250);
    },
    [flowId, loadDetail, loadFlows]
  );

  useEffect(() => {
    const socket = getRealtimeClient();
    if (!socket) {
      return;
    }

    const sessionId = `wf-${Math.random().toString(36).slice(2, 10)}`;
    const joinOrg = () => {
      socket.emit("org:join", {
        orgId,
        user: {
          id: sessionId,
          name: "Workflow Console",
          color: "bg-cyan-500"
        }
      });
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
    ] as const;

    const handlers: Array<{ name: (typeof eventNames)[number]; fn: (payload: any) => void }> = [];
    for (const name of eventNames) {
      const fn = (payload: any) => {
        if (payload?.orgId && payload.orgId !== orgId) {
          return;
        }

        const incomingFlowId =
          typeof payload?.payload?.flowId === "string"
            ? payload.payload.flowId
            : typeof payload?.payload?.branchFlowId === "string"
              ? payload.payload.branchFlowId
              : undefined;

        queueRealtimeRefresh(incomingFlowId);

        if (name === "kill-switch.triggered") {
          notify({
            title: "Kill Switch",
            message: "All active missions were aborted for this organization.",
            type: "warning"
          });
        } else if (name === "agent.delegated") {
          const role =
            typeof payload?.payload?.toRole === "string" ? payload.payload.toRole : "worker";
          notify({
            title: "Delegation",
            message: `Task delegated to ${role.toLowerCase()} agent.`,
            type: "info"
          });
        }
      };

      socket.on(name, fn);
      handlers.push({ name, fn });
    }

    socket.on("connect", joinOrg);
    if (socket.connected) {
      joinOrg();
    }

    return () => {
      socket.off("connect", joinOrg);
      for (const entry of handlers) {
        socket.off(entry.name, entry.fn);
      }
      if (realtimeRefreshTimerRef.current) {
        window.clearTimeout(realtimeRefreshTimerRef.current);
        realtimeRefreshTimerRef.current = null;
      }
    };
  }, [notify, orgId, queueRealtimeRefresh]);

  const lanes = useMemo(() => {
    const queued: FlowListItem[] = [];
    const active: FlowListItem[] = [];
    const completed: FlowListItem[] = [];
    const human: FlowListItem[] = [];
    visibleFlows.forEach((flow) => {
      if (flow.humanTouchRequired || flow.status === "PAUSED") human.push(flow);
      else if (flow.status === "ACTIVE") active.push(flow);
      else if (flow.status === "COMPLETED" || flow.status === "FAILED" || flow.status === "ABORTED")
        completed.push(flow);
      else queued.push(flow);
    });
    return [
      { id: "queued", title: "Queued", flows: queued },
      { id: "active", title: "Active", flows: active },
      { id: "completed", title: "Completed", flows: completed },
      { id: "human", title: "Human Intervention Required", flows: human }
    ];
  }, [visibleFlows]);

  const selectedTask = detail?.tasks.find((t) => t.id === taskId) ?? detail?.tasks[0] ?? null;
  const autopsy = useMemo(() => buildAutopsy(selectedTask), [selectedTask]);
  const selectedTaskIntegrationError = useMemo(
    () => parseIntegrationError(selectedTask?.executionTrace),
    [selectedTask?.executionTrace]
  );
  const detailScoring = useMemo(() => {
    const tasks = detail?.tasks ?? [];
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter((task) => task.status === "COMPLETED").length;
    const failedTasks = tasks.filter((task) => task.status === "FAILED" || task.status === "ABORTED").length;
    const pausedTasks = tasks.filter((task) => task.status === "PAUSED" || task.isPausedForInput).length;
    const completionScore =
      totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    const reliabilityScore =
      totalTasks > 0 ? Math.max(0, Math.round(100 - (failedTasks / totalTasks) * 100)) : 100;
    const interventionScore =
      totalTasks > 0 ? Math.max(0, Math.round(100 - (pausedTasks / totalTasks) * 100)) : 100;
    const progressScore = detail?.progress ?? 0;
    const totalScore = Math.round(
      completionScore * 0.35 +
      reliabilityScore * 0.25 +
      interventionScore * 0.2 +
      progressScore * 0.2
    );

    return {
      totalScore,
      completionScore,
      reliabilityScore,
      interventionScore,
      progressScore,
      totalTasks,
      completedTasks,
      failedTasks,
      pausedTasks
    };
  }, [detail]);

  const openIntegrationSetup = useCallback((integrationError: IntegrationErrorTrace) => {
    const target =
      integrationError.connectUrl ||
      `/app?tab=hub&hubScope=TOOLS&toolkit=${encodeURIComponent(integrationError.toolkit)}`;
    const popup = openCenteredPopup(target, `integrations-${integrationError.toolkit}`);
    if (!popup) {
      window.location.assign(target);
      return;
    }

    const timer = window.setInterval(() => {
      if (popup.closed) {
        window.clearInterval(timer);
        void loadFlows(true);
        if (flowId) {
          void loadDetail(flowId, true);
        }
      }
    }, 600);
  }, [flowId, loadDetail, loadFlows]);

  const runAction = useCallback(async (id: string, action: "pause" | "resume" | "rewind") => {
    setActionKey(`${action}:${id}`);
    try {
      if (action === "resume") {
        const task = detail?.tasks.find((candidate) => candidate.id === id) ?? null;
        const hasInlineInput =
          fileUrl.trim().length > 0 || overridePrompt.trim().length > 0 || note.trim().length > 0;
        if (task && taskNeedsHumanInput(task) && !hasInlineInput) {
          onTaskNeedsInput?.({
            taskId: task.id,
            flowId: detail?.id ?? null,
            reason: resolveHumanInputReason(task)
          });
          setDetailTab("human");
          notify({
            title: "Human Input Required",
            message: "Provide required input before resuming this task.",
            type: "warning"
          });
          return;
        }
      }

      const endpoint = `/api/tasks/${id}/${action === "rewind" ? "rewind" : action}`;
      const body =
        action === "pause"
          ? { orgId, reason: note || "Manual Human Touch pause." }
          : action === "resume"
            ? {
                orgId,
                fileUrl: fileUrl || undefined,
                overridePrompt: overridePrompt || undefined,
                note: note || undefined
              }
            : { orgId, overridePrompt: rewindPrompt || undefined };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const { payload, rawText } = await parseJsonResponse<{
        ok?: boolean;
        message?: string;
        warning?: string;
        branch?: { id: string };
      }>(response);
      if (!response.ok || !payload?.ok) {
        notify({
          title: "Action Failed",
          message:
            payload?.message ??
            (rawText
              ? `Request failed (${response.status}): ${rawText.slice(0, 180)}`
              : "Request failed."),
          type: "error"
        });
        return;
      }
      notify({
        title: "Action Completed",
        message: payload.warning ?? (action === "rewind" ? "Branch created." : "Task updated."),
        type: payload.warning ? "warning" : "success"
      });
      if (action === "rewind" && payload.branch?.id) {
        setFlowId(payload.branch.id);
      } else if (flowId) {
        await loadDetail(flowId, true);
      }
      await loadFlows(true);
    } finally {
      setActionKey(null);
    }
  }, [detail, fileUrl, flowId, loadDetail, loadFlows, note, notify, onTaskNeedsInput, orgId, overridePrompt, rewindPrompt]);

  const captureFlowSignature = useCallback(async () => {
    if (!detail || signatureActionInFlight) {
      return;
    }

    setSignatureActionInFlight(true);
    try {
      const response = await fetch(`/api/flows/${detail.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId })
      });
      const { payload, rawText } = await parseJsonResponse<{
        ok?: boolean;
        message?: string;
        warning?: string;
        flow?: {
          status?: string;
          approvalsProvided?: number;
          requiredSignatures?: number;
          launchTriggered?: boolean;
        };
        signatureRecorded?: boolean;
      }>(response);

      if (!response.ok || !payload?.ok) {
        notify({
          title: "Signature Capture Failed",
          message:
            payload?.message ??
            (rawText
              ? `Request failed (${response.status}): ${rawText.slice(0, 180)}`
              : "Request failed."),
          type: "error"
        });
        return;
      }

      const approvalsProvided = payload.flow?.approvalsProvided ?? 0;
      const requiredSignatures = payload.flow?.requiredSignatures ?? detail.requiredSignatures;
      const launchTriggered = payload.flow?.launchTriggered === true;
      notify({
        title: "Signature Captured",
        message: launchTriggered
          ? `Signature threshold reached (${approvalsProvided}/${requiredSignatures}). Flow queued.`
          : `Flow signatures: ${approvalsProvided}/${requiredSignatures}.`,
        type: payload.warning ? "warning" : "success"
      });

      if (flowId) {
        await loadDetail(flowId, true);
      }
      await loadFlows(true);
    } finally {
      setSignatureActionInFlight(false);
    }
  }, [detail, flowId, loadDetail, loadFlows, notify, orgId, signatureActionInFlight]);

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
        <div>
          <h2 className="font-display text-3xl font-black tracking-tight md:text-4xl">Workflow</h2>
          <p className="text-xs text-slate-500">Kanban + deep dive console</p>
          {dateFilter ? (
            <p className="mt-1 text-[11px] text-cyan-300">
              Filtered to {new Date(`${dateFilter}T00:00:00`).toLocaleDateString()}
            </p>
          ) : null}
          {stringFilterLabel ? (
            <p className="mt-1 text-[11px] text-emerald-300">String: {stringFilterLabel}</p>
          ) : null}
        </div>
        <button
          onClick={() => void loadFlows()}
          className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200"
        >
          <RefreshCw size={13} />
          Refresh
        </button>
      </div>

      {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}

      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
        {lanes.map((lane) => (
          <div key={lane.id} className={`vx-panel min-h-[420px] rounded-3xl p-4 ${themeStyle.border}`}>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-200">{lane.title}</p>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-300">
                {lane.flows.length}
              </span>
            </div>
            <div className="space-y-3">
              {loading ? (
                <div className="inline-flex items-center gap-2 text-sm text-slate-400">
                  <Loader2 size={14} className="animate-spin" /> Loading...
                </div>
              ) : lane.flows.length === 0 ? (
                <p className="text-xs text-slate-500">
                  {flowIdFilter?.length
                    ? "No workflows linked to the selected string."
                    : dateFilter
                      ? "No workflows for selected date."
                      : "Empty lane"}
                </p>
              ) : (
                lane.flows.map((flow) => (
                  <button
                    key={flow.id}
                    onClick={() => {
                      setDetailTab("agent");
                      setFlowId(flow.id);
                    }}
                    className="w-full rounded-2xl border border-white/10 bg-black/30 p-3 text-left"
                  >
                    <p className="line-clamp-2 text-sm text-slate-200">{flow.prompt}</p>
                    <div className="mt-2 h-1.5 rounded-full bg-white/10">
                      <div className="h-1.5 rounded-full bg-emerald-400" style={{ width: `${Math.max(4, flow.progress)}%` }} />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
                      <span>{flow.status}</span>
                      <span>{new Date(flow.updatedAt).toLocaleTimeString()}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        ))}
      </div>

      {flowId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="vx-panel flex h-[90dvh] w-full max-w-7xl flex-col overflow-hidden rounded-[34px] border border-white/15">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <h3 className="font-display text-2xl font-black">Deep Dive Console</h3>
              <button onClick={() => setFlowId(null)} className="rounded-full border border-white/20 p-2">
                <X size={16} />
              </button>
            </div>

            <div className="flex items-center gap-2 border-b border-white/10 px-6 py-3">
              {[{ id: "agent", label: "Agent", icon: Bot }, { id: "human", label: "Human", icon: TerminalSquare }, { id: "autopsy", label: "Autopsy", icon: GitBranchPlus }, { id: "scoring", label: "Scoring", icon: Sparkles }].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setDetailTab(tab.id as "agent" | "human" | "autopsy" | "scoring")}
                  className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold ${
                    detailTab === tab.id
                      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                      : "border-white/20 bg-white/5 text-slate-300"
                  }`}
                >
                  <tab.icon size={14} />
                  {tab.label}
                </button>
              ))}
              <span className="ml-auto inline-flex items-center gap-1 text-xs text-amber-300">
                <ShieldAlert size={12} />
                {detail?.tasks.filter((t) => t.isPausedForInput || t.status === "PAUSED").length ?? 0} paused
              </span>
            </div>

            <div className="vx-scrollbar flex-1 overflow-y-auto p-6">
              {!detail ? (
                <div className="inline-flex items-center gap-2 text-sm text-slate-400">
                  <Loader2 size={16} className="animate-spin" /> Loading details...
                </div>
              ) : (
                <>
                  {detailTab === "agent" && (
                    <div className="space-y-3">
                      <div className="grid gap-3 md:grid-cols-4">
                        <Stat label="Status" value={detail.status} className={badgeClass(detail.status)} />
                        <Stat label="Progress" value={`${detail.progress}%`} />
                        <Stat label="Burn" value={detail.predictedBurn.toLocaleString()} />
                        <Stat
                          label="Signatures"
                          value={`${detail.approvals?.length ?? 0}/${detail.requiredSignatures}`}
                        />
                      </div>
                      {detail.status === "DRAFT" ? (
                        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                          <span className="text-xs text-amber-200">
                            Flow is in draft until signature threshold is met.
                          </span>
                          <button
                            onClick={() => void captureFlowSignature()}
                            className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-100"
                          >
                            {signatureActionInFlight ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <ShieldAlert size={12} />
                            )}
                            Sign Flow
                          </button>
                        </div>
                      ) : null}
                      <div className="space-y-2 rounded-2xl border border-white/10 bg-black/25 p-3">
                        {detail.tasks.map((task) => {
                          const integrationError = parseIntegrationError(task.executionTrace);
                          const runtime = parseAgentRuntime(task.executionTrace);
                          const isSelected = task.id === taskId;
                          const runtimeLabel = runtime?.logicalRole
                            ? `${runtime.logicalRole} | ${runtime.logicalAgentId?.slice(0, 8) ?? "logical"}`
                            : null;
                          return (
                            <div
                              key={task.id}
                              className={`rounded-xl border px-3 py-2 ${
                                isSelected
                                  ? "border-cyan-500/40 bg-cyan-500/8"
                                  : "border-white/10 bg-black/30"
                              }`}
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={`rounded-full border px-2 py-0.5 text-xs ${badgeClass(task.status)}`}>
                                  {task.status}
                                </span>
                                <span className="text-xs text-slate-200">
                                  {runtimeLabel ?? (task.agent ? `${task.agent.name} | ${task.agent.role}` : "Unassigned")}
                                </span>
                                <button
                                  onClick={() => setTaskId(task.id)}
                                  className={`ml-auto rounded-full border px-2 py-0.5 text-xs ${
                                    isSelected
                                      ? "border-cyan-500/45 bg-cyan-500/10 text-cyan-200"
                                      : "border-white/20 text-slate-300"
                                  }`}
                                >
                                  {isSelected ? "Selected" : "Inspect"}
                                </button>
                              </div>
                              <p className="mt-1 text-xs text-slate-400">{task.prompt}</p>

                              {integrationError ? (
                                <span className="mt-1 inline-flex rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300">
                                  {integrationError.toolkit} not connected
                                </span>
                              ) : null}

                              {isSelected ? (
                                <div className="mt-2 space-y-2">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    {runtime?.decisionType ? (
                                      <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-300">
                                        {runtime.decisionType}
                                      </span>
                                    ) : null}
                                    {runtime?.executionMode ? (
                                      <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-xs text-indigo-200">
                                        {runtime.executionMode}
                                      </span>
                                    ) : null}
                                    {runtime?.parentAgentId ? (
                                      <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-xs text-violet-200">
                                        Parent {shortId(runtime.parentAgentId)}
                                      </span>
                                    ) : null}
                                    {typeof runtime?.estimatedSelfCostUsd === "number" ? (
                                      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-200">
                                        Est Self {formatUsd(runtime.estimatedSelfCostUsd)}
                                      </span>
                                    ) : null}
                                    {typeof runtime?.budgetSnapshot?.remainingBudgetUsd === "number" ? (
                                      <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-200">
                                        Rem {formatUsd(runtime.budgetSnapshot.remainingBudgetUsd)}
                                      </span>
                                    ) : null}
                                  </div>

                                  <div className="flex flex-wrap items-center gap-2">
                                    {integrationError ? (
                                      <button
                                        onClick={() => openIntegrationSetup(integrationError)}
                                        className="inline-flex items-center gap-1 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-300"
                                      >
                                        <Link2 size={12} />
                                        Connect {integrationError.toolkit}
                                      </button>
                                    ) : null}
                                    {task.status === "PAUSED" || task.isPausedForInput ? (
                                      <button
                                        onClick={() => void runAction(task.id, "resume")}
                                        className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300"
                                      >
                                        {actionKey === `resume:${task.id}` ? (
                                          <Loader2 size={12} className="animate-spin" />
                                        ) : (
                                          <PlayCircle size={12} />
                                        )}{" "}
                                        Resume
                                      </button>
                                    ) : (
                                      <button
                                        onClick={() => void runAction(task.id, "pause")}
                                        className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300"
                                      >
                                        {actionKey === `pause:${task.id}` ? (
                                          <Loader2 size={12} className="animate-spin" />
                                        ) : (
                                          <PauseCircle size={12} />
                                        )}{" "}
                                        Pause
                                      </button>
                                    )}
                                    {(task.status === "COMPLETED" ||
                                      task.status === "FAILED" ||
                                      task.status === "ABORTED") && (
                                      <button
                                        onClick={() => void runAction(task.id, "rewind")}
                                        className="inline-flex items-center gap-1 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-300"
                                      >
                                        {actionKey === `rewind:${task.id}` ? (
                                          <Loader2 size={12} className="animate-spin" />
                                        ) : (
                                          <GitBranchPlus size={12} />
                                        )}{" "}
                                        Rewind & Fork Here
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ) : null}

                              {runtime?.decisionReason ? (
                                <p className="mt-1 text-[11px] text-slate-400">Decision: {runtime.decisionReason}</p>
                              ) : null}
                              {task.humanInterventionReason ? (
                                <p className="mt-1 text-[11px] text-amber-200">Human Touch: {task.humanInterventionReason}</p>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {detailTab === "human" && (
                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="space-y-3 rounded-2xl border border-white/10 bg-black/25 p-3">
                        <p className="text-xs font-medium text-slate-500">Human intervention terminal</p>
                        <select value={taskId} onChange={(e) => setTaskId(e.target.value)} className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm">
                          {detail.tasks.map((task) => (
                            <option key={task.id} value={task.id}>
                              {task.id.slice(0, 10)} | {task.status}
                            </option>
                          ))}
                        </select>
                        {selectedTaskIntegrationError ? (
                          <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2">
                            <p className="text-xs text-amber-200">
                              This task requires {selectedTaskIntegrationError.toolkit} integration.
                            </p>
                            <button
                              onClick={() => openIntegrationSetup(selectedTaskIntegrationError)}
                              className="mt-2 inline-flex items-center gap-1 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-200"
                            >
                              <Link2 size={12} />
                              Connect {selectedTaskIntegrationError.toolkit}
                            </button>
                          </div>
                        ) : null}
                        <input value={fileUrl} onChange={(e) => setFileUrl(e.target.value)} placeholder="File URL (S3/Blob)" className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm" />
                        <textarea value={overridePrompt} onChange={(e) => setOverridePrompt(e.target.value)} placeholder="Override prompt / logic rewrite" className="h-24 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm" />
                        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Human note" className="h-20 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm" />
                        <div className="flex gap-2">
                          <button onClick={() => taskId && void runAction(taskId, "resume")} className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-300">Resume</button>
                          <button onClick={() => taskId && void runAction(taskId, "pause")} className="rounded-full border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs font-semibold text-amber-300">Pause</button>
                        </div>
                      </div>
                      <div className="space-y-3 rounded-2xl border border-white/10 bg-black/25 p-3">
                        <p className="text-xs font-medium text-slate-500">Temporal branching</p>
                        <textarea value={rewindPrompt} onChange={(e) => setRewindPrompt(e.target.value)} placeholder="Branch prompt override" className="h-24 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm" />
                        {detail.tasks.filter((t) => t.status === "COMPLETED" || t.status === "FAILED" || t.status === "ABORTED").map((t) => (
                          <div key={t.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-black/30 px-3 py-2">
                            <span className="text-xs text-slate-200">{t.id.slice(0, 10)} | {t.status}</span>
                            <button onClick={() => void runAction(t.id, "rewind")} className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-300">Rewind & Fork</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {detailTab === "autopsy" && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-3 py-2">
                        <span className="text-xs text-slate-500">Task</span>
                        <select value={taskId} onChange={(e) => setTaskId(e.target.value)} className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs">
                          {detail.tasks.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.id.slice(0, 10)} | {t.status}
                            </option>
                          ))}
                        </select>
                      </div>
                      <AutopsyBlueprint
                        title="Workflow Task Autopsy"
                        subtitle="Dependency + Trace Blueprint"
                        nodes={autopsy.nodes}
                        edges={autopsy.edges}
                        className="h-[520px]"
                      />
                      <div className="max-h-36 space-y-2 overflow-y-auto rounded-2xl border border-white/10 bg-black/25 p-3">
                        {logs.length === 0 ? (
                          <p className="text-xs text-slate-500">No logs for this flow.</p>
                        ) : (
                          logs.map((log) => (
                            <div key={log.id} className="rounded-xl border border-white/10 bg-black/30 px-3 py-2">
                              <p className="text-xs text-slate-500">
                                {log.type} | {new Date(log.timestamp).toLocaleTimeString()}
                              </p>
                              <p className="text-xs text-slate-300">
                                [{log.actor}] {log.message}
                              </p>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}

                  {detailTab === "scoring" && (
                    <div className="space-y-3">
                      <div className="grid gap-3 md:grid-cols-5">
                        <Stat label="Overall" value={`${detailScoring.totalScore}`} className="text-cyan-200" />
                        <Stat label="Completion" value={`${detailScoring.completionScore}`} className="text-emerald-200" />
                        <Stat label="Reliability" value={`${detailScoring.reliabilityScore}`} className="text-violet-200" />
                        <Stat label="Intervention" value={`${detailScoring.interventionScore}`} className="text-amber-200" />
                        <Stat label="Progress" value={`${detailScoring.progressScore}`} className="text-sky-200" />
                      </div>

                      <div className="grid gap-3 md:grid-cols-4">
                        <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                          <p className="text-xs text-slate-500">Tasks total</p>
                          <p className="mt-1 text-lg font-bold text-slate-100">{detailScoring.totalTasks}</p>
                        </div>
                        <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-3">
                          <p className="text-xs text-emerald-200">Completed</p>
                          <p className="mt-1 text-lg font-bold text-emerald-100">{detailScoring.completedTasks}</p>
                        </div>
                        <div className="rounded-xl border border-red-500/35 bg-red-500/10 p-3">
                          <p className="text-xs text-red-200">Failed/aborted</p>
                          <p className="mt-1 text-lg font-bold text-red-100">{detailScoring.failedTasks}</p>
                        </div>
                        <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3">
                          <p className="text-xs text-amber-200">Paused / human touch</p>
                          <p className="mt-1 text-lg font-bold text-amber-100">{detailScoring.pausedTasks}</p>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                        <p className="text-xs font-medium text-slate-500">Task scoring detail</p>
                        <div className="mt-2 space-y-2">
                          {detail.tasks.map((task) => {
                            const integrationError = parseIntegrationError(task.executionTrace);
                            const runtime = parseAgentRuntime(task.executionTrace);
                            const taskScoreBase =
                              task.status === "COMPLETED"
                                ? 100
                                : task.status === "RUNNING"
                                  ? 70
                                  : task.status === "QUEUED"
                                    ? 45
                                    : task.status === "PAUSED"
                                      ? 35
                                      : 15;
                            const taskScore = Math.max(
                              0,
                              Math.min(
                                100,
                                taskScoreBase -
                                  (task.isPausedForInput ? 10 : 0) -
                                  (integrationError ? 20 : 0)
                              )
                            );
                            return (
                              <div
                                key={task.id}
                                className="rounded-xl border border-white/10 bg-black/25 px-3 py-2"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="text-xs text-slate-100">{task.prompt}</p>
                                  <span className="rounded-full border border-cyan-500/35 bg-cyan-500/10 px-2 py-0.5 text-[11px] font-semibold text-cyan-200">
                                    Score {taskScore}
                                  </span>
                                </div>
                                <p className="mt-1 text-[11px] text-slate-500">
                                  Status: {task.status}
                                  {runtime?.logicalRole ? ` | Role: ${runtime.logicalRole}` : ""}
                                  {task.isPausedForInput ? " | Human input pending" : ""}
                                  {integrationError ? ` | ${integrationError.toolkit} not connected` : ""}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/25 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-sm font-bold ${className ?? "text-white"}`}>{value}</p>
    </div>
  );
}
