"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  GitBranchPlus,
  Loader2,
  PlayCircle,
  RefreshCw,
  Save,
  UserRoundPlus
} from "lucide-react";
import { MarkerType, type Edge, type Node } from "reactflow";
import ReactFlow, { Background, Controls, MiniMap } from "reactflow";
import "reactflow/dist/style.css";

import { parseJsonResponse } from "@/lib/http/json-response";
import { useVorldXStore } from "@/lib/store/vorldx-store";

type WorkforceType = "HUMAN" | "AI";
type SuggestionType =
  | "RESUME_PAUSED_TASK"
  | "REWIND_FAILED_TASK"
  | "ASSIGN_UNOWNED_TASK"
  | "REVIEW_PENDING_APPROVAL";

interface BlueprintConsoleProps {
  orgId: string;
  themeStyle: {
    accent?: string;
    accentSoft?: string;
    border: string;
  };
}

interface WorkforceItem {
  id: string;
  type: WorkforceType;
  name: string;
  role: string;
  status: string;
  autonomyScore: number;
  updatedAt: string;
}

interface FlowTaskItem {
  id: string;
  flowId: string;
  agentId: string | null;
  prompt: string;
  status: string;
  isPausedForInput: boolean;
  humanInterventionReason: string | null;
  blueprintOrder: number | null;
  createdAt: string;
  updatedAt: string;
}

interface FlowItem {
  id: string;
  prompt: string;
  status: string;
  progress: number;
  predictedBurn: number;
  requiredSignatures: number;
  parentFlowId: string | null;
  updatedAt: string;
  tasks: FlowTaskItem[];
}

interface ApprovalItem {
  id: string;
  flowId: string | null;
  taskId: string | null;
  agentId: string | null;
  reason: string;
  requestedAt: string;
}

interface DelegationItem {
  id: string;
  flowId: string | null;
  taskId: string | null;
  status: string;
  reason: string | null;
  createdAt: string;
  fromAgent: {
    id: string;
    name: string;
    role: string;
  };
  toAgent: {
    id: string;
    name: string;
    role: string;
  };
}

interface LockItem {
  id: string;
  fileId: string;
  taskId: string | null;
  agentId: string | null;
  acquiredAt: string;
  expiresAt: string | null;
  file: {
    id: string;
    name: string;
  };
  agent: {
    id: string;
    name: string;
  } | null;
}

interface BlueprintSuggestion {
  id: string;
  type: SuggestionType;
  severity: "LOW" | "MEDIUM" | "HIGH";
  title: string;
  detail: string;
  flowId?: string | null;
  taskId?: string | null;
  approvalCheckpointId?: string | null;
  recommendedAgentId?: string | null;
}

interface BlueprintSnapshot {
  generatedAt: string;
  metrics: {
    workforceTotal: number;
    humans: number;
    agents: number;
    activeFlows: number;
    queuedTasks: number;
    runningTasks: number;
    blockedTasks: number;
    pendingApprovals: number;
  };
  workforce: WorkforceItem[];
  flows: FlowItem[];
  approvals: ApprovalItem[];
  delegations: DelegationItem[];
  locks: LockItem[];
  suggestions: BlueprintSuggestion[];
  layout: {
    updatedAt: string | null;
    nodes: Array<{
      nodeId: string;
      x: number;
      y: number;
    }>;
  };
}

type NodeMeta =
  | { type: "workforce"; data: WorkforceItem }
  | { type: "flow"; data: FlowItem }
  | { type: "task"; data: FlowTaskItem }
  | { type: "approval"; data: ApprovalItem };

interface GraphModel {
  nodes: Node[];
  edges: Edge[];
  nodeMeta: Map<string, NodeMeta>;
}

function compactText(value: string, max = 84) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 3))}...`;
}

function sortedTasks(tasks: FlowTaskItem[], includeCompleted: boolean) {
  return [...tasks]
    .filter((task) => (includeCompleted ? true : task.status !== "COMPLETED"))
    .sort((a, b) => {
      const orderA = typeof a.blueprintOrder === "number" ? a.blueprintOrder : Number.MAX_SAFE_INTEGER;
      const orderB = typeof b.blueprintOrder === "number" ? b.blueprintOrder : Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
}

function taskNodeColor(task: FlowTaskItem) {
  if (task.status === "COMPLETED") return "rgba(16,185,129,0.18)";
  if (task.status === "RUNNING") return "rgba(6,182,212,0.2)";
  if (task.status === "PAUSED" || task.isPausedForInput) return "rgba(245,158,11,0.22)";
  if (task.status === "FAILED" || task.status === "ABORTED") return "rgba(244,63,94,0.2)";
  return "rgba(148,163,184,0.18)";
}

function buildGraphModel(input: {
  snapshot: BlueprintSnapshot | null;
  showHumans: boolean;
  showAgents: boolean;
  includeCompletedTasks: boolean;
  selectedFlowId: string;
  layoutMap: Map<string, { x: number; y: number }>;
}): GraphModel {
  const nodeMeta = new Map<string, NodeMeta>();
  if (!input.snapshot) {
    return {
      nodes: [],
      edges: [],
      nodeMeta
    };
  }

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const visibleWorkforce = input.snapshot.workforce.filter((member) => {
    if (member.type === "HUMAN" && !input.showHumans) return false;
    if (member.type === "AI" && !input.showAgents) return false;
    return true;
  });
  const visibleFlows = input.snapshot.flows.filter((flow) =>
    input.selectedFlowId === "ALL" ? true : flow.id === input.selectedFlowId
  );
  const allowedMemberIds = new Set(visibleWorkforce.map((member) => member.id));
  const approvalsByTaskId = new Map<string, ApprovalItem[]>();
  for (const approval of input.snapshot.approvals) {
    if (!approval.taskId) continue;
    const list = approvalsByTaskId.get(approval.taskId) ?? [];
    list.push(approval);
    approvalsByTaskId.set(approval.taskId, list);
  }

  for (let index = 0; index < visibleWorkforce.length; index += 1) {
    const member = visibleWorkforce[index]!;
    const nodeId = `workforce:${member.id}`;
    const fallback = {
      x: 40,
      y: 40 + index * 120
    };
    const position = input.layoutMap.get(nodeId) ?? fallback;
    const borderColor = member.type === "AI" ? "rgba(59,130,246,0.7)" : "rgba(34,197,94,0.7)";
    const bg = member.type === "AI" ? "rgba(30,58,138,0.2)" : "rgba(20,83,45,0.2)";
    nodes.push({
      id: nodeId,
      position,
      data: {
        label: (
          <div className="space-y-1 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-100">
              {compactText(member.name, 32)}
            </p>
            <p className="text-[9px] text-slate-300">{compactText(member.role, 30)}</p>
            <p className="text-[9px] text-slate-400">{member.type}</p>
          </div>
        )
      },
      style: {
        width: 168,
        minHeight: 84,
        borderRadius: 16,
        border: `1px solid ${borderColor}`,
        background: bg,
        color: "#e2e8f0",
        boxShadow: "0 6px 18px rgba(2,6,23,0.45)"
      }
    });
    nodeMeta.set(nodeId, { type: "workforce", data: member });
  }

  for (let flowIndex = 0; flowIndex < visibleFlows.length; flowIndex += 1) {
    const flow = visibleFlows[flowIndex]!;
    const flowNodeId = `flow:${flow.id}`;
    const flowFallback = {
      x: 360,
      y: 40 + flowIndex * 260
    };
    const flowPosition = input.layoutMap.get(flowNodeId) ?? flowFallback;
    nodes.push({
      id: flowNodeId,
      position: flowPosition,
      data: {
        label: (
          <div className="space-y-1 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100">
              {compactText(flow.id, 18)}
            </p>
            <p className="text-[9px] text-slate-100">{compactText(flow.prompt, 40)}</p>
            <p className="text-[9px] text-slate-400">{flow.status}</p>
          </div>
        )
      },
      style: {
        width: 210,
        minHeight: 92,
        borderRadius: 16,
        border: "1px solid rgba(34,211,238,0.5)",
        background: "rgba(8,47,73,0.24)",
        color: "#e2e8f0",
        boxShadow: "0 8px 20px rgba(8,47,73,0.45)"
      }
    });
    nodeMeta.set(flowNodeId, { type: "flow", data: flow });

    const tasks = sortedTasks(flow.tasks, input.includeCompletedTasks);
    let priorTaskNodeId: string | null = null;

    for (let taskIndex = 0; taskIndex < tasks.length; taskIndex += 1) {
      const task = tasks[taskIndex]!;
      const taskNodeId = `task:${task.id}`;
      const taskFallback = {
        x: 700,
        y: 40 + flowIndex * 260 + taskIndex * 116
      };
      const taskPosition = input.layoutMap.get(taskNodeId) ?? taskFallback;
      nodes.push({
        id: taskNodeId,
        position: taskPosition,
        data: {
          label: (
            <div className="space-y-1 text-left">
              <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-100">
                {compactText(task.id, 18)}
              </p>
              <p className="text-[10px] text-slate-100">{compactText(task.prompt, 56)}</p>
              <p className="text-[9px] text-slate-300">{task.status}</p>
            </div>
          )
        },
        style: {
          width: 246,
          minHeight: 92,
          borderRadius: 14,
          border: "1px solid rgba(148,163,184,0.35)",
          background: taskNodeColor(task),
          color: "#e2e8f0"
        }
      });
      nodeMeta.set(taskNodeId, { type: "task", data: task });

      edges.push({
        id: `edge-flow-task:${flow.id}:${task.id}`,
        source: flowNodeId,
        target: taskNodeId,
        animated: false,
        style: { stroke: "rgba(56,189,248,0.7)", strokeWidth: 1.6 }
      });

      if (priorTaskNodeId) {
        edges.push({
          id: `edge-task-sequence:${priorTaskNodeId}:${taskNodeId}`,
          source: priorTaskNodeId,
          target: taskNodeId,
          animated: true,
          style: { stroke: "rgba(148,163,184,0.55)", strokeWidth: 1.1, strokeDasharray: "4 4" }
        });
      }
      priorTaskNodeId = taskNodeId;

      if (task.agentId && allowedMemberIds.has(task.agentId)) {
        edges.push({
          id: `edge-assignee:${task.agentId}:${task.id}`,
          source: `workforce:${task.agentId}`,
          target: taskNodeId,
          animated: true,
          style: { stroke: "rgba(34,197,94,0.65)", strokeWidth: 1.2 }
        });
      }

      const approvals = approvalsByTaskId.get(task.id) ?? [];
      for (let approvalIndex = 0; approvalIndex < approvals.length; approvalIndex += 1) {
        const approval = approvals[approvalIndex]!;
        const approvalNodeId = `approval:${approval.id}`;
        const approvalFallback = {
          x: 1040,
          y: 40 + flowIndex * 260 + taskIndex * 116 + approvalIndex * 72
        };
        const approvalPosition = input.layoutMap.get(approvalNodeId) ?? approvalFallback;
        nodes.push({
          id: approvalNodeId,
          position: approvalPosition,
          data: {
            label: (
              <div className="space-y-1 text-left">
                <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-amber-100">
                  Pending Approval
                </p>
                <p className="text-[9px] text-amber-50">{compactText(approval.reason, 52)}</p>
              </div>
            )
          },
          style: {
            width: 220,
            minHeight: 76,
            borderRadius: 12,
            border: "1px solid rgba(245,158,11,0.55)",
            background: "rgba(120,53,15,0.26)",
            color: "#fef3c7"
          }
        });
        nodeMeta.set(approvalNodeId, { type: "approval", data: approval });

        edges.push({
          id: `edge-task-approval:${task.id}:${approval.id}`,
          source: taskNodeId,
          target: approvalNodeId,
          animated: false,
          style: { stroke: "rgba(245,158,11,0.75)", strokeWidth: 1.2 }
        });
      }
    }
  }

  for (const delegation of input.snapshot.delegations) {
    const includeDelegation =
      input.selectedFlowId === "ALL" || delegation.flowId === input.selectedFlowId;
    if (!includeDelegation) {
      continue;
    }
    if (!allowedMemberIds.has(delegation.fromAgent.id) || !allowedMemberIds.has(delegation.toAgent.id)) {
      continue;
    }
    edges.push({
      id: `edge-delegation:${delegation.id}`,
      source: `workforce:${delegation.fromAgent.id}`,
      target: `workforce:${delegation.toAgent.id}`,
      label: "delegates",
      style: {
        stroke: "rgba(236,72,153,0.55)",
        strokeWidth: 1,
        strokeDasharray: "3 4"
      },
      labelStyle: {
        fill: "rgba(244,114,182,0.92)",
        fontSize: 9
      }
    });
  }

  return {
    nodes,
    edges,
    nodeMeta
  };
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/35 px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-100">{value}</p>
    </div>
  );
}

export function BlueprintConsole({ orgId, themeStyle }: BlueprintConsoleProps) {
  const notify = useVorldXStore((state) => state.pushNotification);
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingLayout, setSavingLayout] = useState(false);
  const [taskActionLoading, setTaskActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<BlueprintSnapshot | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showHumans, setShowHumans] = useState(true);
  const [showAgents, setShowAgents] = useState(true);
  const [includeCompletedTasks, setIncludeCompletedTasks] = useState(false);
  const [selectedFlowId, setSelectedFlowId] = useState<string>("ALL");
  const [layoutDirty, setLayoutDirty] = useState(false);
  const [layoutDraft, setLayoutDraft] = useState<Map<string, { x: number; y: number }>>(
    () => new Map()
  );
  const [assigneeDraft, setAssigneeDraft] = useState<string>("");
  const [orderDraft, setOrderDraft] = useState<string>("");

  const loadSnapshot = useCallback(
    async (silent?: boolean) => {
      if (silent) setRefreshing(true);
      else setLoading(true);

      try {
        const response = await fetch(`/api/blueprint?orgId=${encodeURIComponent(orgId)}`, {
          cache: "no-store"
        });
        const { payload, rawText } = await parseJsonResponse<{
          ok?: boolean;
          message?: string;
          snapshot?: BlueprintSnapshot;
        }>(response);

        if (!response.ok || !payload?.ok || !payload.snapshot) {
          throw new Error(
            payload?.message ??
              (rawText
                ? `Failed loading blueprint (${response.status}): ${rawText.slice(0, 180)}`
                : "Failed loading blueprint.")
          );
        }

        setSnapshot(payload.snapshot);
        setError(null);

        if (!layoutDirty) {
          const nextLayout = new Map<string, { x: number; y: number }>();
          for (const node of payload.snapshot.layout.nodes) {
            nextLayout.set(node.nodeId, { x: node.x, y: node.y });
          }
          setLayoutDraft(nextLayout);
        }

        if (selectedFlowId !== "ALL") {
          const exists = payload.snapshot.flows.some((flow) => flow.id === selectedFlowId);
          if (!exists) {
            setSelectedFlowId("ALL");
          }
        }
      } catch (requestError) {
        const message =
          requestError instanceof Error ? requestError.message : "Failed loading blueprint.";
        setError(message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [layoutDirty, orgId, selectedFlowId]
  );

  useEffect(() => {
    void loadSnapshot();
    const timer = setInterval(() => void loadSnapshot(true), 12000);
    return () => clearInterval(timer);
  }, [loadSnapshot]);

  const graphModel = useMemo(
    () =>
      buildGraphModel({
        snapshot,
        showHumans,
        showAgents,
        includeCompletedTasks,
        selectedFlowId,
        layoutMap: layoutDraft
      }),
    [includeCompletedTasks, layoutDraft, selectedFlowId, showAgents, showHumans, snapshot]
  );

  const selectedMeta = selectedNodeId ? graphModel.nodeMeta.get(selectedNodeId) ?? null : null;
  const selectedTask = selectedMeta?.type === "task" ? selectedMeta.data : null;
  const taskOwner = useMemo(() => {
    if (!selectedTask || !snapshot) return null;
    return snapshot.workforce.find((member) => member.id === selectedTask.agentId) ?? null;
  }, [selectedTask, snapshot]);

  useEffect(() => {
    if (!selectedTask) {
      setAssigneeDraft("");
      setOrderDraft("");
      return;
    }
    setAssigneeDraft(selectedTask.agentId ?? "");
    setOrderDraft(
      typeof selectedTask.blueprintOrder === "number" ? String(selectedTask.blueprintOrder) : ""
    );
  }, [selectedTask]);

  const saveLayout = useCallback(async () => {
    if (!layoutDirty) {
      notify({
        title: "Blueprint",
        message: "Layout is already synced.",
        type: "info"
      });
      return;
    }

    setSavingLayout(true);
    try {
      const response = await fetch("/api/blueprint", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          orgId,
          layout: {
            nodes: [...layoutDraft.entries()].map(([nodeId, pos]) => ({
              nodeId,
              x: pos.x,
              y: pos.y
            }))
          }
        })
      });
      const { payload, rawText } = await parseJsonResponse<{
        ok?: boolean;
        message?: string;
      }>(response);
      if (!response.ok || !payload?.ok) {
        throw new Error(
          payload?.message ??
            (rawText
              ? `Failed saving layout (${response.status}): ${rawText.slice(0, 180)}`
              : "Failed saving layout.")
        );
      }
      setLayoutDirty(false);
      notify({
        title: "Blueprint",
        message: "Layout saved.",
        type: "success"
      });
    } catch (requestError) {
      notify({
        title: "Blueprint",
        message: requestError instanceof Error ? requestError.message : "Layout save failed.",
        type: "error"
      });
    } finally {
      setSavingLayout(false);
    }
  }, [layoutDirty, layoutDraft, notify, orgId]);

  const updateSelectedTask = useCallback(async () => {
    if (!selectedTask) return;

    setTaskActionLoading(true);
    try {
      const parsedOrder =
        orderDraft.trim().length > 0 ? Number.parseInt(orderDraft.trim(), 10) : null;
      const response = await fetch("/api/blueprint/task", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          orgId,
          taskId: selectedTask.id,
          agentId: assigneeDraft.trim() || null,
          blueprintOrder: Number.isFinite(parsedOrder as number) ? parsedOrder : null,
          note: "Updated from Blueprint tab."
        })
      });
      const { payload, rawText } = await parseJsonResponse<{
        ok?: boolean;
        message?: string;
      }>(response);
      if (!response.ok || !payload?.ok) {
        throw new Error(
          payload?.message ??
            (rawText
              ? `Failed updating task (${response.status}): ${rawText.slice(0, 180)}`
              : "Failed updating task.")
        );
      }

      notify({
        title: "Blueprint",
        message: "Task assignment and order updated.",
        type: "success"
      });
      await loadSnapshot(true);
    } catch (requestError) {
      notify({
        title: "Blueprint",
        message: requestError instanceof Error ? requestError.message : "Task update failed.",
        type: "error"
      });
    } finally {
      setTaskActionLoading(false);
    }
  }, [assigneeDraft, loadSnapshot, notify, orderDraft, orgId, selectedTask]);

  const resumeTask = useCallback(
    async (taskId: string) => {
      setTaskActionLoading(true);
      try {
        const response = await fetch(`/api/tasks/${taskId}/resume`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            orgId,
            note: "Resumed from Blueprint correction queue."
          })
        });
        const { payload, rawText } = await parseJsonResponse<{
          ok?: boolean;
          message?: string;
        }>(response);
        if (!response.ok || !payload?.ok) {
          throw new Error(
            payload?.message ??
              (rawText
                ? `Failed resuming task (${response.status}): ${rawText.slice(0, 180)}`
                : "Failed resuming task.")
          );
        }
        notify({
          title: "Blueprint",
          message: "Task resumed.",
          type: "success"
        });
        await loadSnapshot(true);
      } catch (requestError) {
        notify({
          title: "Blueprint",
          message: requestError instanceof Error ? requestError.message : "Task resume failed.",
          type: "error"
        });
      } finally {
        setTaskActionLoading(false);
      }
    },
    [loadSnapshot, notify, orgId]
  );

  const rewindTask = useCallback(
    async (taskId: string) => {
      setTaskActionLoading(true);
      try {
        const response = await fetch(`/api/tasks/${taskId}/rewind`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            orgId,
            overridePrompt: `Blueprint correction rewind for task ${taskId}. Continue mission with safer constraints.`
          })
        });
        const { payload, rawText } = await parseJsonResponse<{
          ok?: boolean;
          message?: string;
        }>(response);
        if (!response.ok || !payload?.ok) {
          throw new Error(
            payload?.message ??
              (rawText
                ? `Failed rewinding task (${response.status}): ${rawText.slice(0, 180)}`
                : "Failed rewinding task.")
          );
        }
        notify({
          title: "Blueprint",
          message: "Rewind branch launched.",
          type: "success"
        });
        await loadSnapshot(true);
      } catch (requestError) {
        notify({
          title: "Blueprint",
          message: requestError instanceof Error ? requestError.message : "Task rewind failed.",
          type: "error"
        });
      } finally {
        setTaskActionLoading(false);
      }
    },
    [loadSnapshot, notify, orgId]
  );

  const applySuggestion = useCallback(
    async (suggestion: BlueprintSuggestion) => {
      if (suggestion.type === "REVIEW_PENDING_APPROVAL") {
        router.replace("/app?tab=control");
        notify({
          title: "Blueprint",
          message: "Redirected to Control Deck for approval review.",
          type: "info"
        });
        return;
      }

      if (!suggestion.taskId) {
        notify({
          title: "Blueprint",
          message: "Suggestion has no target task.",
          type: "error"
        });
        return;
      }

      if (suggestion.type === "RESUME_PAUSED_TASK") {
        await resumeTask(suggestion.taskId);
        return;
      }
      if (suggestion.type === "REWIND_FAILED_TASK") {
        await rewindTask(suggestion.taskId);
        return;
      }
      if (suggestion.type === "ASSIGN_UNOWNED_TASK") {
        setTaskActionLoading(true);
        try {
          const response = await fetch("/api/blueprint/task", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              orgId,
              taskId: suggestion.taskId,
              agentId: suggestion.recommendedAgentId ?? null,
              note: "Auto-assign from Blueprint suggestion."
            })
          });
          const { payload, rawText } = await parseJsonResponse<{
            ok?: boolean;
            message?: string;
          }>(response);
          if (!response.ok || !payload?.ok) {
            throw new Error(
              payload?.message ??
                (rawText
                  ? `Failed applying suggestion (${response.status}): ${rawText.slice(0, 180)}`
                  : "Failed applying suggestion.")
            );
          }
          notify({
            title: "Blueprint",
            message: "Suggestion applied.",
            type: "success"
          });
          await loadSnapshot(true);
        } catch (requestError) {
          notify({
            title: "Blueprint",
            message:
              requestError instanceof Error ? requestError.message : "Suggestion apply failed.",
            type: "error"
          });
        } finally {
          setTaskActionLoading(false);
        }
      }
    },
    [loadSnapshot, notify, orgId, resumeTask, rewindTask, router]
  );

  if (loading) {
    return (
      <div className="flex h-[58vh] items-center justify-center rounded-3xl border border-white/10 bg-black/30">
        <div className="flex items-center gap-3 text-sm text-slate-300">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading Blueprint...
        </div>
      </div>
    );
  }

  if (error || !snapshot) {
    return (
      <div className="rounded-3xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-200">
        {error ?? "Blueprint snapshot unavailable."}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className={`rounded-3xl border border-white/10 bg-black/35 p-4 ${themeStyle.border}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
              Organization Blueprint
            </p>
            <h2 className="text-lg font-semibold text-slate-100">
              Human + Agent Workforce Topology
            </h2>
            <p className="text-xs text-slate-400">
              Drag nodes to rearrange. Use task panel to reassign owner, reprioritize, and apply
              corrections.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void loadSnapshot(true)}
              disabled={refreshing || taskActionLoading}
              className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-slate-200 transition hover:bg-white/10 disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <button
              onClick={() => void saveLayout()}
              disabled={savingLayout || !layoutDirty}
              className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 transition hover:bg-cyan-500/20 disabled:opacity-60"
            >
              <Save className="h-3.5 w-3.5" />
              {savingLayout ? "Saving..." : layoutDirty ? "Save Layout" : "Layout Synced"}
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-4 xl:grid-cols-8">
          <StatCard label="Workforce" value={snapshot.metrics.workforceTotal} />
          <StatCard label="Humans" value={snapshot.metrics.humans} />
          <StatCard label="Agents" value={snapshot.metrics.agents} />
          <StatCard label="Active Flows" value={snapshot.metrics.activeFlows} />
          <StatCard label="Queued Tasks" value={snapshot.metrics.queuedTasks} />
          <StatCard label="Running Tasks" value={snapshot.metrics.runningTasks} />
          <StatCard label="Blocked Tasks" value={snapshot.metrics.blockedTasks} />
          <StatCard label="Pending Approvals" value={snapshot.metrics.pendingApprovals} />
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <section className={`rounded-3xl border border-white/10 bg-black/35 p-3 ${themeStyle.border}`}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={showHumans}
                onChange={(event) => setShowHumans(event.target.checked)}
              />
              Humans
            </label>
            <label className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={showAgents}
                onChange={(event) => setShowAgents(event.target.checked)}
              />
              Agents
            </label>
            <label className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={includeCompletedTasks}
                onChange={(event) => setIncludeCompletedTasks(event.target.checked)}
              />
              Include Completed
            </label>
            <select
              value={selectedFlowId}
              onChange={(event) => setSelectedFlowId(event.target.value)}
              className="rounded-lg border border-white/15 bg-black/40 px-2 py-1 text-xs text-slate-200"
            >
              <option value="ALL">All Flows</option>
              {snapshot.flows.map((flow) => (
                <option key={flow.id} value={flow.id}>
                  {flow.id.slice(0, 12)} | {flow.status}
                </option>
              ))}
            </select>
          </div>

          <div className="h-[62vh] rounded-2xl border border-white/10 bg-[#02060d]">
            <ReactFlow
              nodes={graphModel.nodes}
              edges={graphModel.edges}
              fitView
              onNodeClick={(_, node) => setSelectedNodeId(node.id)}
              onPaneClick={() => setSelectedNodeId(null)}
              onNodeDragStop={(_, node) => {
                setLayoutDraft((prev) => {
                  const next = new Map(prev);
                  next.set(node.id, { x: node.position.x, y: node.position.y });
                  return next;
                });
                setLayoutDirty(true);
              }}
              defaultEdgeOptions={{
                markerEnd: {
                  type: MarkerType.ArrowClosed
                }
              }}
            >
              <Background color="rgba(148,163,184,0.2)" gap={22} size={0.8} />
              <MiniMap
                nodeColor={() => "rgba(56,189,248,0.35)"}
                maskColor="rgba(2,6,23,0.5)"
                style={{ backgroundColor: "rgba(2,6,23,0.6)" }}
              />
              <Controls />
            </ReactFlow>
          </div>
        </section>

        <aside className="space-y-4">
          <section className={`rounded-3xl border border-white/10 bg-black/35 p-4 ${themeStyle.border}`}>
            <h3 className="text-sm font-semibold text-slate-100">Selected Node</h3>
            {!selectedMeta ? (
              <p className="mt-2 text-xs text-slate-400">Select a node to inspect and edit.</p>
            ) : selectedMeta.type === "task" ? (
              <div className="mt-2 space-y-3">
                <p className="text-xs text-slate-300">{compactText(selectedMeta.data.prompt, 180)}</p>
                <p className="text-[11px] text-slate-400">
                  Status: <span className="text-slate-200">{selectedMeta.data.status}</span>
                </p>
                <p className="text-[11px] text-slate-400">
                  Current owner:{" "}
                  <span className="text-slate-200">
                    {taskOwner ? `${taskOwner.name} (${taskOwner.role})` : "Unassigned"}
                  </span>
                </p>

                <div className="space-y-2">
                  <label className="block text-[11px] uppercase tracking-[0.12em] text-slate-500">
                    Assign Owner
                  </label>
                  <select
                    value={assigneeDraft}
                    onChange={(event) => setAssigneeDraft(event.target.value)}
                    className="w-full rounded-lg border border-white/15 bg-black/35 px-2 py-2 text-xs text-slate-200"
                  >
                    <option value="">Unassigned</option>
                    {snapshot.workforce.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name} | {member.role}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="block text-[11px] uppercase tracking-[0.12em] text-slate-500">
                    Order Priority
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={orderDraft}
                    onChange={(event) => setOrderDraft(event.target.value)}
                    className="w-full rounded-lg border border-white/15 bg-black/35 px-2 py-2 text-xs text-slate-200"
                    placeholder="e.g. 10"
                  />
                </div>

                <button
                  onClick={() => void updateSelectedTask()}
                  disabled={taskActionLoading}
                  className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-cyan-500/35 bg-cyan-500/12 px-3 py-2 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-500/20 disabled:opacity-60"
                >
                  <UserRoundPlus className="h-3.5 w-3.5" />
                  {taskActionLoading ? "Updating..." : "Apply Task Update"}
                </button>

                {(selectedMeta.data.isPausedForInput || selectedMeta.data.status === "PAUSED") && (
                  <button
                    onClick={() => void resumeTask(selectedMeta.data.id)}
                    disabled={taskActionLoading}
                    className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-emerald-500/35 bg-emerald-500/12 px-3 py-2 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/20 disabled:opacity-60"
                  >
                    <PlayCircle className="h-3.5 w-3.5" />
                    Resume Task
                  </button>
                )}

                {(selectedMeta.data.status === "FAILED" || selectedMeta.data.status === "ABORTED") && (
                  <button
                    onClick={() => void rewindTask(selectedMeta.data.id)}
                    disabled={taskActionLoading}
                    className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-amber-500/35 bg-amber-500/12 px-3 py-2 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/20 disabled:opacity-60"
                  >
                    <GitBranchPlus className="h-3.5 w-3.5" />
                    Rewind Task
                  </button>
                )}
              </div>
            ) : selectedMeta.type === "workforce" ? (
              <div className="mt-2 space-y-2">
                <p className="text-sm font-semibold text-slate-100">{selectedMeta.data.name}</p>
                <p className="text-xs text-slate-300">{selectedMeta.data.role}</p>
                <p className="text-[11px] text-slate-400">Type: {selectedMeta.data.type}</p>
                <p className="text-[11px] text-slate-400">Status: {selectedMeta.data.status}</p>
                <p className="text-[11px] text-slate-400">
                  Autonomy score: {selectedMeta.data.autonomyScore.toFixed(2)}
                </p>
              </div>
            ) : selectedMeta.type === "flow" ? (
              <div className="mt-2 space-y-2">
                <p className="text-sm font-semibold text-slate-100">{selectedMeta.data.id}</p>
                <p className="text-xs text-slate-300">{compactText(selectedMeta.data.prompt, 200)}</p>
                <p className="text-[11px] text-slate-400">Status: {selectedMeta.data.status}</p>
                <p className="text-[11px] text-slate-400">
                  Progress: {(selectedMeta.data.progress * 100).toFixed(1)}%
                </p>
                <p className="text-[11px] text-slate-400">
                  Burn: {selectedMeta.data.predictedBurn} BTU
                </p>
              </div>
            ) : (
              <div className="mt-2 space-y-2">
                <p className="text-sm font-semibold text-amber-100">Approval Pending</p>
                <p className="text-xs text-amber-50">{selectedMeta.data.reason}</p>
                <button
                  onClick={() => {
                    router.replace("/app?tab=control");
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/18"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Open Control Deck
                </button>
              </div>
            )}
          </section>

          <section className={`rounded-3xl border border-white/10 bg-black/35 p-4 ${themeStyle.border}`}>
            <h3 className="text-sm font-semibold text-slate-100">Correction Queue</h3>
            <div className="mt-3 max-h-[36vh] space-y-2 overflow-y-auto pr-1">
              {snapshot.suggestions.length === 0 ? (
                <p className="text-xs text-slate-400">No corrections suggested right now.</p>
              ) : (
                snapshot.suggestions.slice(0, 50).map((suggestion) => (
                  <div
                    key={suggestion.id}
                    className="rounded-xl border border-white/10 bg-black/35 px-3 py-2"
                  >
                    <p className="text-xs font-semibold text-slate-100">{suggestion.title}</p>
                    <p className="mt-1 text-[11px] text-slate-300">{compactText(suggestion.detail, 180)}</p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                        {suggestion.severity}
                      </p>
                      <button
                        onClick={() => void applySuggestion(suggestion)}
                        disabled={taskActionLoading}
                        className="rounded-md border border-white/15 bg-white/8 px-2 py-1 text-[11px] font-semibold text-slate-200 transition hover:bg-white/15 disabled:opacity-60"
                      >
                        Apply
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
