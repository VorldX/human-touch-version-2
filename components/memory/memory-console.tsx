"use client";

import { type ComponentType, useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArrowUpRight,
  Bot,
  Fingerprint,
  Loader2,
  RefreshCw,
  ShieldCheck,
  UserCircle2,
  X
} from "lucide-react";

import { parseJsonResponse } from "@/lib/http/json-response";
import { useVorldXStore } from "@/lib/store/vorldx-store";

type FlowStatus = "DRAFT" | "QUEUED" | "ACTIVE" | "PAUSED" | "COMPLETED" | "ABORTED" | "FAILED";

interface FlowListItem {
  id: string;
  prompt: string;
  status: FlowStatus;
  progress: number;
  predictedBurn: number;
  requiredSignatures?: number;
  updatedAt: string;
  createdAt?: string;
  taskCounts?: {
    total: number;
    completed: number;
    failed: number;
    paused: number;
  };
}

interface LedgerStreamEntry {
  id: string;
  source: "LOG" | "COMPLIANCE";
  actor: string;
  type: string;
  message: string;
  timestamp: string;
  complianceHash: string | null;
}

interface LedgerMetrics {
  machineEvents: number;
  carbonEvents: number;
  hotSwapEvents: number;
  amnesiaWipes: number;
  complianceHashes: number;
}

interface ComplianceAuditEntry {
  id: string;
  actionType: string;
  timestamp: string;
  complianceHash: string;
  humanActor: {
    id: string;
    username: string;
    email: string;
  } | null;
}

interface FlowDetailTask {
  id: string;
  status: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
}

interface FlowDetail {
  id: string;
  prompt: string;
  status: FlowStatus;
  progress: number;
  predictedBurn: number;
  requiredSignatures: number;
  createdAt: string;
  updatedAt: string;
  tasks: FlowDetailTask[];
  complianceAudits: ComplianceAuditEntry[];
}

interface FlowLog {
  id: string;
  type: string;
  actor: string;
  message: string;
  timestamp: string;
}

interface MemoryConsoleProps {
  orgId: string;
  themeStyle: {
    accent: string;
    accentSoft: string;
    border: string;
  };
}

interface AuditModalState {
  flow: FlowDetail;
  logs: FlowLog[];
}

function flowStatusStyle(status: FlowStatus) {
  if (status === "COMPLETED") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  if (status === "FAILED" || status === "ABORTED")
    return "border-red-500/40 bg-red-500/10 text-red-300";
  if (status === "PAUSED") return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  return "border-white/20 bg-white/5 text-slate-300";
}

export function MemoryConsole({ orgId, themeStyle }: MemoryConsoleProps) {
  const notify = useVorldXStore((state) => state.pushNotification);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<LedgerMetrics>({
    machineEvents: 0,
    carbonEvents: 0,
    hotSwapEvents: 0,
    amnesiaWipes: 0,
    complianceHashes: 0
  });
  const [machineStream, setMachineStream] = useState<LedgerStreamEntry[]>([]);
  const [carbonStream, setCarbonStream] = useState<LedgerStreamEntry[]>([]);
  const [archivedFlows, setArchivedFlows] = useState<FlowListItem[]>([]);
  const [auditModal, setAuditModal] = useState<AuditModalState | null>(null);
  const [auditLoadingId, setAuditLoadingId] = useState<string | null>(null);

  const loadLedger = useCallback(
    async (silent?: boolean) => {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const [ledgerResponse, flowsResponse] = await Promise.all([
          fetch(`/api/memory/ledger?orgId=${encodeURIComponent(orgId)}&limit=120`, {
            cache: "no-store"
          }),
          fetch(`/api/flows?orgId=${encodeURIComponent(orgId)}&limit=240`, {
            cache: "no-store"
          })
        ]);

        const { payload: ledgerPayload, rawText: ledgerRawText } = await parseJsonResponse<{
          ok?: boolean;
          message?: string;
          metrics?: LedgerMetrics;
          streams?: {
            machine?: LedgerStreamEntry[];
            carbon?: LedgerStreamEntry[];
          };
        }>(ledgerResponse);

        const { payload: flowPayload, rawText: flowsRawText } = await parseJsonResponse<{
          ok?: boolean;
          message?: string;
          flows?: FlowListItem[];
        }>(flowsResponse);

        if (!ledgerResponse.ok || !ledgerPayload?.ok) {
          setError(
            ledgerPayload?.message ??
              (ledgerRawText
                ? `Failed to load memory ledger (${ledgerResponse.status}): ${ledgerRawText.slice(0, 180)}`
                : "Failed to load memory ledger.")
          );
          return;
        }
        if (!flowsResponse.ok || !flowPayload?.ok) {
          setError(
            flowPayload?.message ??
              (flowsRawText
                ? `Failed to load archived workflows (${flowsResponse.status}): ${flowsRawText.slice(0, 180)}`
                : "Failed to load archived workflows.")
          );
          return;
        }

        setError(null);
        setMetrics(
          ledgerPayload.metrics ?? {
            machineEvents: 0,
            carbonEvents: 0,
            hotSwapEvents: 0,
            amnesiaWipes: 0,
            complianceHashes: 0
          }
        );
        setMachineStream(ledgerPayload.streams?.machine ?? []);
        setCarbonStream(ledgerPayload.streams?.carbon ?? []);
        setArchivedFlows(
          (flowPayload.flows ?? []).filter(
            (flow) =>
              flow.status === "COMPLETED" || flow.status === "FAILED" || flow.status === "ABORTED"
          )
        );
      } catch (requestError) {
        setError(
          requestError instanceof Error ? requestError.message : "Failed to load memory ledger."
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [orgId]
  );

  useEffect(() => {
    void loadLedger();
    const interval = setInterval(() => void loadLedger(true), 12000);
    return () => clearInterval(interval);
  }, [loadLedger]);

  const openAuditModal = useCallback(
    async (flowId: string) => {
      setAuditLoadingId(flowId);
      try {
        const response = await fetch(`/api/flows/${flowId}`, { cache: "no-store" });
        const { payload, rawText } = await parseJsonResponse<{
          ok?: boolean;
          message?: string;
          flow?: FlowDetail;
          logs?: FlowLog[];
        }>(response);

        if (!response.ok || !payload?.ok || !payload.flow) {
          notify({
            title: "Audit Ledger",
            message:
              payload?.message ??
              (rawText
                ? `Unable to open audit ledger (${response.status}): ${rawText.slice(0, 180)}`
                : "Unable to open audit ledger."),
            type: "error"
          });
          return;
        }

        setAuditModal({
          flow: payload.flow,
          logs: payload.logs ?? []
        });
      } finally {
        setAuditLoadingId(null);
      }
    },
    [notify]
  );

  const auditTimeline = useMemo(() => {
    if (!auditModal) {
      return [];
    }

    const logEvents = auditModal.logs.map((entry) => ({
      id: `log-${entry.id}`,
      timestamp: entry.timestamp,
      badge: entry.type,
      actor: entry.actor,
      message: entry.message,
      complianceHash: null as string | null
    }));

    const complianceEvents = auditModal.flow.complianceAudits.map((entry) => ({
      id: `compliance-${entry.id}`,
      timestamp: entry.timestamp,
      badge: "COMPLIANCE",
      actor: entry.humanActor?.username || entry.humanActor?.email || "CARBON_NODE",
      message: `Action ${entry.actionType}`,
      complianceHash: entry.complianceHash
    }));

    const taskEvents = auditModal.flow.tasks.map((task) => ({
      id: `task-${task.id}`,
      timestamp: task.updatedAt,
      badge: "TASK",
      actor: "TASK_RUNTIME",
      message: `Task ${task.id.slice(0, 8)} updated to ${task.status}`,
      complianceHash: null as string | null
    }));

    return [...logEvents, ...complianceEvents, ...taskEvents].sort(
      (left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
    );
  }, [auditModal]);

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
        <div>
          <h2 className="font-display text-3xl font-black uppercase tracking-tight md:text-4xl">Memory</h2>
          <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
            System Ledger + Archived Missions
          </p>
        </div>
        <button
          onClick={() => void loadLedger(true)}
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

      <div className="grid gap-4 md:grid-cols-5">
        <MetricCard label="Machine Stream" value={String(metrics.machineEvents)} icon={Bot} />
        <MetricCard label="Carbon Stream" value={String(metrics.carbonEvents)} icon={UserCircle2} />
        <MetricCard label="Hot-Swap Events" value={String(metrics.hotSwapEvents)} icon={ArrowUpRight} />
        <MetricCard label="Amnesia Wipes" value={String(metrics.amnesiaWipes)} icon={Archive} />
        <MetricCard
          label="Compliance Hashes"
          value={String(metrics.complianceHashes)}
          icon={Fingerprint}
        />
      </div>

      <div className="grid gap-4 2xl:grid-cols-2">
        <StreamPanel
          title="Machine Stream"
          subtitle="Autonomous runtime events"
          events={machineStream}
          loading={loading}
          themeStyle={themeStyle}
        />
        <StreamPanel
          title="Carbon Stream"
          subtitle="Human interventions and approvals"
          events={carbonStream}
          loading={loading}
          themeStyle={themeStyle}
        />
      </div>

      <div className={`vx-panel rounded-3xl p-4 ${themeStyle.border}`}>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">
              Archived Workflows
            </p>
            <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
              Completed, failed, or aborted missions
            </p>
          </div>
          <span className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.2em] ${themeStyle.accentSoft}`}>
            {archivedFlows.length}
          </span>
        </div>

        {loading ? (
          <div className="inline-flex items-center gap-2 text-sm text-slate-400">
            <Loader2 size={14} className="animate-spin" />
            Loading archives...
          </div>
        ) : archivedFlows.length === 0 ? (
          <p className="rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-xs uppercase tracking-[0.16em] text-slate-500">
            No archived workflows found.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {archivedFlows.map((flow) => (
              <div key={flow.id} className="rounded-2xl border border-white/10 bg-black/30 p-3">
                <p className="line-clamp-2 text-sm text-slate-100">{flow.prompt}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.14em] ${flowStatusStyle(flow.status)}`}>
                    {flow.status}
                  </span>
                  <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                    Burn {flow.predictedBurn.toLocaleString()}
                  </span>
                </div>
                <p className="mt-2 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                  Updated {new Date(flow.updatedAt).toLocaleString()}
                </p>
                <button
                  onClick={() => void openAuditModal(flow.id)}
                  className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-200"
                >
                  {auditLoadingId === flow.id ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <ShieldCheck size={12} />
                  )}
                  Audit Ledger
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {auditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="vx-panel vx-scrollbar h-[90dvh] w-full max-w-5xl overflow-y-auto rounded-[34px] border border-white/15 p-6">
            <div className="mb-4 flex items-start justify-between border-b border-white/10 pb-3">
              <div>
                <h3 className="font-display text-2xl font-black uppercase tracking-tight">
                  Audit Ledger
                </h3>
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
                  Flow {auditModal.flow.id} | {auditModal.flow.status}
                </p>
              </div>
              <button
                onClick={() => setAuditModal(null)}
                className="rounded-full border border-white/20 p-2 text-slate-300 transition hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3">
              {auditTimeline.length === 0 ? (
                <p className="rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-xs uppercase tracking-[0.16em] text-slate-500">
                  No timeline events found for this flow.
                </p>
              ) : (
                auditTimeline.map((entry) => (
                  <div key={entry.id} className="rounded-2xl border border-white/10 bg-black/30 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="rounded-full border border-white/20 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-200">
                        {entry.badge}
                      </span>
                      <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                        {new Date(entry.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <p className="mt-2 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                      {entry.actor}
                    </p>
                    <p className="mt-1 text-sm text-slate-200">{entry.message}</p>
                    {entry.complianceHash ? (
                      <p className="mt-2 break-all rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.1em] text-cyan-300">
                        Hash {entry.complianceHash}
                      </p>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon
}: {
  label: string;
  value: string;
  icon: ComponentType<{ size?: string | number; className?: string }>;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 px-3 py-3">
      <div className="flex items-center gap-2">
        <Icon size={15} className="text-slate-400" />
        <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
      </div>
      <p className="mt-2 text-2xl font-bold text-slate-100">{value}</p>
    </div>
  );
}

function StreamPanel({
  title,
  subtitle,
  events,
  loading,
  themeStyle
}: {
  title: string;
  subtitle: string;
  events: LedgerStreamEntry[];
  loading: boolean;
  themeStyle: { accentSoft: string; border: string };
}) {
  return (
    <div className={`vx-panel rounded-3xl p-4 ${themeStyle.border}`}>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">{title}</p>
          <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{subtitle}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.2em] ${themeStyle.accentSoft}`}>
          {events.length}
        </span>
      </div>

      {loading ? (
        <div className="inline-flex items-center gap-2 text-sm text-slate-400">
          <Loader2 size={14} className="animate-spin" />
          Loading stream...
        </div>
      ) : events.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-xs uppercase tracking-[0.16em] text-slate-500">
          No events in this stream.
        </p>
      ) : (
        <div className="vx-scrollbar max-h-[360px] space-y-2 overflow-y-auto pr-1">
          {events.map((event) => (
            <div key={event.id} className="rounded-2xl border border-white/10 bg-black/30 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="rounded-full border border-white/20 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-200">
                  {event.type}
                </span>
                <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                  {new Date(event.timestamp).toLocaleString()}
                </span>
              </div>
              <p className="mt-2 text-[10px] uppercase tracking-[0.14em] text-slate-500">{event.actor}</p>
              <p className="mt-1 text-sm text-slate-200">{event.message}</p>
              {event.complianceHash ? (
                <p className="mt-2 break-all rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.1em] text-cyan-300">
                  Hash {event.complianceHash}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
