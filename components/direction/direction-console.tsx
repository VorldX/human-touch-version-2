"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, PlayCircle, RefreshCw, Search } from "lucide-react";
import type { Edge, Node } from "reactflow";

import { AutopsyBlueprint } from "@/components/autopsy/autopsy-blueprint";
import { useFirebaseAuth } from "@/components/auth/firebase-auth-provider";
import { useVorldXStore } from "@/lib/store/vorldx-store";

type DirectionStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";
type DirectionRelation = "SUPPORTS" | "BLOCKS" | "DEPENDS_ON" | "RELATES_TO";

interface DirectionRecord {
  id: string;
  title: string;
  summary: string;
  direction: string;
  status: DirectionStatus;
  ownerEmail: string | null;
  updatedAt: string;
  lastExecutedAt?: string;
}

interface DirectionLink {
  id: string;
  fromDirectionId: string;
  toDirectionId: string;
  relation: DirectionRelation;
  note: string | null;
}

interface WorkflowRecord {
  id: string;
  prompt: string;
  status: string;
  progress: number;
  predictedBurn: number;
  taskCount: number;
  updatedAt: string;
}

interface DirectionAutopsy {
  nodes: Array<{
    id: string;
    kind: "direction" | "flow";
    title: string;
    isPrimary?: boolean;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    relation: DirectionRelation | "GENERATES";
  }>;
}

interface DirectionConsoleProps {
  orgId: string;
  themeStyle: {
    accent?: string;
    accentSoft?: string;
    border: string;
  };
}

type HistoryFilter = "ALL" | DirectionStatus;

function buildCircularGraph(autopsy: DirectionAutopsy | null) {
  if (!autopsy) {
    return { nodes: [] as Node[], edges: [] as Edge[] };
  }

  const center = { x: 360, y: 220 };
  const directions = autopsy.nodes.filter((item) => item.kind === "direction");
  const flows = autopsy.nodes.filter((item) => item.kind === "flow");
  const primary = directions.find((item) => item.isPrimary) ?? directions[0];
  const outer = directions.filter((item) => item.id !== primary?.id);

  const nodes: Node[] = [];
  if (primary) {
    nodes.push({
      id: primary.id,
      position: center,
      data: { label: primary.title },
      style: {
        width: 150,
        height: 150,
        borderRadius: "999px",
        border: "2px solid rgba(52,211,153,0.8)",
        background: "rgba(6,78,59,0.75)",
        color: "#ecfdf5",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        fontSize: "11px",
        fontWeight: 700,
        padding: "14px"
      }
    });
  }

  outer.forEach((item, index) => {
    const angle = (index / Math.max(1, outer.length)) * Math.PI * 2;
    nodes.push({
      id: item.id,
      position: {
        x: center.x + Math.cos(angle) * 230,
        y: center.y + Math.sin(angle) * 230
      },
      data: { label: item.title },
      style: {
        width: 112,
        height: 112,
        borderRadius: "999px",
        border: "1px solid rgba(59,130,246,0.55)",
        background: "rgba(15,23,42,0.86)",
        color: "#dbeafe",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        fontSize: "10px",
        fontWeight: 700,
        padding: "10px"
      }
    });
  });

  flows.forEach((item, index) => {
    const angle = (index / Math.max(1, flows.length)) * Math.PI * 2;
    nodes.push({
      id: item.id,
      position: {
        x: center.x + Math.cos(angle) * 370,
        y: center.y + Math.sin(angle) * 370
      },
      data: { label: item.title },
      style: {
        width: 90,
        height: 90,
        borderRadius: "999px",
        border: "1px solid rgba(56,189,248,0.5)",
        background: "rgba(8,47,73,0.8)",
        color: "#dff7ff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        fontSize: "9px",
        fontWeight: 700,
        padding: "8px"
      }
    });
  });

  const edges: Edge[] = autopsy.edges.map((item) => ({
    id: item.id,
    source: item.source,
    target: item.target,
    label: item.relation,
    animated: item.relation === "DEPENDS_ON",
    style: {
      stroke:
        item.relation === "BLOCKS"
          ? "#ef4444"
          : item.relation === "SUPPORTS"
            ? "#22c55e"
            : item.relation === "DEPENDS_ON"
              ? "#f59e0b"
              : item.relation === "GENERATES"
                ? "#38bdf8"
                : "#a78bfa"
    }
  }));

  return { nodes, edges };
}

export function DirectionConsole({ orgId, themeStyle }: DirectionConsoleProps) {
  const notify = useVorldXStore((state) => state.pushNotification);
  const { user } = useFirebaseAuth();

  const [directions, setDirections] = useState<DirectionRecord[]>([]);
  const [selectedDirectionId, setSelectedDirectionId] = useState<string | null>(null);
  const [links, setLinks] = useState<DirectionLink[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [autopsy, setAutopsy] = useState<DirectionAutopsy | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("ALL");
  const [historyQuery, setHistoryQuery] = useState("");

  const [titleDraft, setTitleDraft] = useState("");
  const [summaryDraft, setSummaryDraft] = useState("");
  const [directionDraft, setDirectionDraft] = useState("");
  const [statusDraft, setStatusDraft] = useState<DirectionStatus>("ACTIVE");
  const [linkTargetId, setLinkTargetId] = useState("");
  const [linkRelation, setLinkRelation] = useState<DirectionRelation>("RELATES_TO");

  const selectedDirection = useMemo(
    () => directions.find((item) => item.id === selectedDirectionId) ?? null,
    [directions, selectedDirectionId]
  );
  const graph = useMemo(() => buildCircularGraph(autopsy), [autopsy]);
  const historyCounts = useMemo(() => {
    const count = {
      ALL: directions.length,
      ACTIVE: 0,
      DRAFT: 0,
      ARCHIVED: 0
    };
    directions.forEach((item) => {
      if (item.status === "ACTIVE") count.ACTIVE += 1;
      if (item.status === "DRAFT") count.DRAFT += 1;
      if (item.status === "ARCHIVED") count.ARCHIVED += 1;
    });
    return count;
  }, [directions]);
  const filteredDirections = useMemo(() => {
    const q = historyQuery.trim().toLowerCase();
    return directions.filter((item) => {
      if (historyFilter !== "ALL" && item.status !== historyFilter) {
        return false;
      }
      if (!q) {
        return true;
      }
      return (
        item.title.toLowerCase().includes(q) ||
        item.summary.toLowerCase().includes(q) ||
        item.direction.toLowerCase().includes(q) ||
        (item.ownerEmail ?? "").toLowerCase().includes(q)
      );
    });
  }, [directions, historyFilter, historyQuery]);

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
          directions?: DirectionRecord[];
          message?: string;
        };
        if (!response.ok || !payload.ok || !payload.directions) {
          throw new Error(payload.message ?? "Failed loading directions.");
        }
        setDirections(payload.directions);
        const hasSelected = Boolean(
          selectedDirectionId && payload.directions.some((item) => item.id === selectedDirectionId)
        );
        if (!hasSelected) {
          setSelectedDirectionId(payload.directions[0]?.id ?? null);
        }
      } catch (error) {
        notify({
          title: "Direction",
          message: error instanceof Error ? error.message : "Load failed.",
          type: "error"
        });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [notify, orgId, selectedDirectionId]
  );

  const loadDirectionDetail = useCallback(
    async (directionId: string) => {
      const [linkResponse, workflowResponse, autopsyResponse] = await Promise.all([
        fetch(`/api/directions/${directionId}/links?orgId=${encodeURIComponent(orgId)}`, {
          cache: "no-store"
        }),
        fetch(`/api/directions/${directionId}/workflows?orgId=${encodeURIComponent(orgId)}`, {
          cache: "no-store"
        }),
        fetch(`/api/directions/${directionId}/autopsy?orgId=${encodeURIComponent(orgId)}`, {
          cache: "no-store"
        })
      ]);

      const linkPayload = (await linkResponse.json()) as {
        ok?: boolean;
        links?: DirectionLink[];
      };
      const workflowPayload = (await workflowResponse.json()) as {
        ok?: boolean;
        workflows?: WorkflowRecord[];
      };
      const autopsyPayload = (await autopsyResponse.json()) as {
        ok?: boolean;
        autopsy?: DirectionAutopsy;
      };

      if (!linkResponse.ok || !linkPayload.ok) throw new Error("Failed loading links.");
      if (!workflowResponse.ok || !workflowPayload.ok) throw new Error("Failed loading workflows.");
      if (!autopsyResponse.ok || !autopsyPayload.ok || !autopsyPayload.autopsy) {
        throw new Error("Failed loading autopsy.");
      }

      setLinks(linkPayload.links ?? []);
      setWorkflows(workflowPayload.workflows ?? []);
      setAutopsy(autopsyPayload.autopsy);
    },
    [orgId]
  );

  useEffect(() => {
    void loadDirections();
    const timer = setInterval(() => void loadDirections(true), 12000);
    return () => clearInterval(timer);
  }, [loadDirections]);

  useEffect(() => {
    if (!selectedDirectionId) return;
    void loadDirectionDetail(selectedDirectionId);
  }, [loadDirectionDetail, selectedDirectionId]);

  useEffect(() => {
    if (!selectedDirection) return;
    setTitleDraft(selectedDirection.title);
    setSummaryDraft(selectedDirection.summary);
    setDirectionDraft(selectedDirection.direction);
    setStatusDraft(selectedDirection.status);
  }, [selectedDirection]);

  const createDirection = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const response = await fetch("/api/directions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          title: titleDraft,
          summary: summaryDraft,
          direction: directionDraft,
          status: statusDraft,
          ownerEmail: user?.email ?? null
        })
      });
      const payload = (await response.json()) as { ok?: boolean; direction?: DirectionRecord; message?: string };
      if (!response.ok || !payload.ok || !payload.direction) {
        notify({ title: "Direction", message: payload.message ?? "Create failed.", type: "error" });
        return;
      }
      setSelectedDirectionId(payload.direction.id);
      await loadDirections(true);
      await loadDirectionDetail(payload.direction.id);
    },
    [directionDraft, loadDirectionDetail, loadDirections, notify, orgId, statusDraft, summaryDraft, titleDraft, user?.email]
  );

  const saveDirection = useCallback(async () => {
    if (!selectedDirectionId) return;
    const response = await fetch(`/api/directions/${selectedDirectionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orgId,
        title: titleDraft,
        summary: summaryDraft,
        direction: directionDraft,
        status: statusDraft
      })
    });
    const payload = (await response.json()) as { ok?: boolean; message?: string };
    if (!response.ok || !payload.ok) {
      notify({ title: "Direction", message: payload.message ?? "Save failed.", type: "error" });
      return;
    }
    await loadDirections(true);
    await loadDirectionDetail(selectedDirectionId);
  }, [directionDraft, loadDirectionDetail, loadDirections, notify, orgId, selectedDirectionId, statusDraft, summaryDraft, titleDraft]);

  const createLink = useCallback(async () => {
    if (!selectedDirectionId || !linkTargetId) return;
    const response = await fetch(`/api/directions/${selectedDirectionId}/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orgId,
        toDirectionId: linkTargetId,
        relation: linkRelation
      })
    });
    const payload = (await response.json()) as { ok?: boolean; message?: string };
    if (!response.ok || !payload.ok) {
      notify({ title: "Direction Link", message: payload.message ?? "Link failed.", type: "error" });
      return;
    }
    setLinkTargetId("");
    setLinkRelation("RELATES_TO");
    await loadDirectionDetail(selectedDirectionId);
  }, [linkRelation, linkTargetId, loadDirectionDetail, notify, orgId, selectedDirectionId]);

  const launchWorkflow = useCallback(async () => {
    if (!selectedDirection) return;
    const prompt = directionDraft.trim() || selectedDirection.direction;
    const swarmDensity = 24;
    const predictedBurn = Math.max(900, Math.floor(Math.max(prompt.length, 8) * swarmDensity * 1.8));
    const requiredSignatures = predictedBurn >= 75000 ? 2 : 1;
    const response = await fetch("/api/flows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orgId,
        prompt,
        directionId: selectedDirection.id,
        swarmDensity,
        predictedBurn,
        requiredSignatures,
        approvalsProvided: requiredSignatures,
        ...(user?.email ? { userEmail: user.email } : {})
      })
    });
    const payload = (await response.json()) as { ok?: boolean; message?: string };
    if (!response.ok || !payload.ok) {
      notify({ title: "Direction", message: payload.message ?? "Launch failed.", type: "error" });
      return;
    }
    await loadDirectionDetail(selectedDirection.id);
    await loadDirections(true);
  }, [directionDraft, loadDirectionDetail, loadDirections, notify, orgId, selectedDirection, user?.email]);

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <div className="flex items-center justify-between border-b border-white/10 pb-4">
        <div>
          <h2 className="font-display text-4xl font-black uppercase tracking-tight">Direction</h2>
          <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">
            Direction Console
          </p>
        </div>
        <button
          onClick={() => void loadDirections(true)}
          className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-200"
        >
          {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          Refresh
        </button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
        <div className={`vx-panel space-y-3 rounded-3xl p-4 ${themeStyle.border}`}>
          <form onSubmit={createDirection} className="space-y-2 rounded-2xl border border-white/10 bg-black/25 p-3">
            <input
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
              placeholder="Direction title"
              className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
              required
            />
            <textarea
              value={summaryDraft}
              onChange={(event) => setSummaryDraft(event.target.value)}
              placeholder="Summary"
              className="h-16 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-slate-100 outline-none"
            />
            <textarea
              value={directionDraft}
              onChange={(event) => setDirectionDraft(event.target.value)}
              placeholder="Direction body"
              className="h-24 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
              required
            />
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <select
                value={statusDraft}
                onChange={(event) => setStatusDraft(event.target.value as DirectionStatus)}
                className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-slate-100 outline-none"
              >
                <option value="ACTIVE">ACTIVE</option>
                <option value="DRAFT">DRAFT</option>
                <option value="ARCHIVED">ARCHIVED</option>
              </select>
              <button className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300">
                Create
              </button>
            </div>
          </form>

          <div className="space-y-2 rounded-2xl border border-white/10 bg-black/20 p-2">
            <p className="px-1 text-[10px] uppercase tracking-[0.16em] text-slate-500">Direction History</p>
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
              {(["ALL", "ACTIVE", "DRAFT", "ARCHIVED"] as HistoryFilter[]).map((item) => (
                <button
                  key={item}
                  onClick={() => setHistoryFilter(item)}
                  className={`rounded-xl border px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] transition ${
                    historyFilter === item
                      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                      : "border-white/10 bg-black/25 text-slate-300 hover:bg-white/5"
                  }`}
                >
                  {item} ({historyCounts[item]})
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/35 px-3 py-2">
              <Search size={13} className="text-slate-500" />
              <input
                value={historyQuery}
                onChange={(event) => setHistoryQuery(event.target.value)}
                placeholder="Find previous directions..."
                className="w-full bg-transparent text-xs text-slate-100 outline-none placeholder:text-slate-600"
              />
            </label>
            {loading ? (
              <div className="inline-flex items-center gap-2 text-xs text-slate-400">
                <Loader2 size={12} className="animate-spin" />
                Loading...
              </div>
            ) : filteredDirections.length === 0 ? (
              <p className="rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-xs text-slate-500">
                No directions match this history filter.
              </p>
            ) : (
              filteredDirections.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSelectedDirectionId(item.id)}
                  className={`w-full rounded-2xl border p-3 text-left ${
                    selectedDirectionId === item.id
                      ? "border-emerald-500/40 bg-emerald-500/10"
                      : "border-white/10 bg-black/25"
                  }`}
                >
                  <p className="line-clamp-1 text-xs font-semibold uppercase tracking-[0.14em] text-white">
                    {item.title}
                  </p>
                  <p className="line-clamp-2 text-xs text-slate-400">{item.summary || item.direction}</p>
                  <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                    {item.status} | {item.ownerEmail ?? "unassigned"}
                  </p>
                  <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                    Updated {new Date(item.updatedAt).toLocaleString()}
                    {item.lastExecutedAt
                      ? ` | Last run ${new Date(item.lastExecutedAt).toLocaleString()}`
                      : ""}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>

        <div className={`vx-panel space-y-4 rounded-3xl p-4 ${themeStyle.border}`}>
          {!selectedDirection ? (
            <p className="text-sm text-slate-400">Select a direction to inspect it.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => void saveDirection()}
                  className="rounded-full border border-white/20 bg-white/5 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-200"
                >
                  Save Direction
                </button>
                <button
                  onClick={() => void launchWorkflow()}
                  className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300"
                >
                  <PlayCircle size={12} />
                  Launch Workflow
                </button>
                <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                  Last run: {selectedDirection.lastExecutedAt ? new Date(selectedDirection.lastExecutedAt).toLocaleString() : "Never"}
                </span>
              </div>

              <div className="grid gap-3 xl:grid-cols-[1fr_1fr]">
                <div className="space-y-2 rounded-2xl border border-white/10 bg-black/25 p-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Links</p>
                  <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
                    <select
                      value={linkTargetId}
                      onChange={(event) => setLinkTargetId(event.target.value)}
                      className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-slate-100"
                    >
                      <option value="">Target direction</option>
                      {directions
                        .filter((item) => item.id !== selectedDirection.id)
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.title}
                          </option>
                        ))}
                    </select>
                    <select
                      value={linkRelation}
                      onChange={(event) => setLinkRelation(event.target.value as DirectionRelation)}
                      className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-slate-100"
                    >
                      <option value="RELATES_TO">RELATES_TO</option>
                      <option value="SUPPORTS">SUPPORTS</option>
                      <option value="BLOCKS">BLOCKS</option>
                      <option value="DEPENDS_ON">DEPENDS_ON</option>
                    </select>
                    <button
                      onClick={() => void createLink()}
                      disabled={!linkTargetId}
                      className="rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-cyan-300 disabled:opacity-60"
                    >
                      Link
                    </button>
                  </div>
                  <div className="max-h-36 space-y-1 overflow-y-auto">
                    {links.map((item) => (
                      <p key={item.id} className="text-xs text-slate-300">
                        {item.relation}: {item.fromDirectionId.slice(0, 8)}
                        {" -> "}
                        {item.toDirectionId.slice(0, 8)}
                      </p>
                    ))}
                  </div>
                </div>

                <div className="space-y-2 rounded-2xl border border-white/10 bg-black/25 p-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Workflows</p>
                  <div className="max-h-36 space-y-2 overflow-y-auto">
                    {workflows.length === 0 ? (
                      <p className="text-xs text-slate-500">No workflows yet.</p>
                    ) : (
                      workflows.map((item) => (
                        <article key={item.id} className="rounded-xl border border-white/10 bg-black/30 p-2">
                          <p className="line-clamp-2 text-xs text-slate-200">{item.prompt}</p>
                          <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                            {item.status} | {item.progress}% | Burn {item.predictedBurn}
                          </p>
                        </article>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <AutopsyBlueprint
                title="Direction Autopsy"
                subtitle="Circular Direction Relationship Blueprint"
                nodes={graph.nodes}
                edges={graph.edges}
                className="h-[520px]"
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
