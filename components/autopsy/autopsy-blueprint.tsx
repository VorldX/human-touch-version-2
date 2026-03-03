"use client";

import { MouseEvent, useCallback, useMemo, useState } from "react";
import {
  ArrowDownRight,
  Network,
  Settings2,
  SlidersHorizontal,
  Waves,
  X
} from "lucide-react";
import ReactFlow, { Background, Controls, Edge, MiniMap, Node } from "reactflow";
import "reactflow/dist/style.css";

type BlueprintStatus = "RUNNING" | "COMPLETED" | "FAILED" | "PAUSED";

interface AutopsyBlueprintProps {
  title: string;
  subtitle?: string;
  nodes: Node[];
  edges: Edge[];
  className?: string;
  defaultTime?: number;
}

interface NodeTimelineMeta {
  start: number;
  end: number;
  impact: number;
  status: BlueprintStatus;
}

interface RenderNodeMeta {
  raw: Node;
  id: string;
  title: string;
  status: BlueprintStatus;
  impact: number;
  start: number;
  end: number;
  isFuture: boolean;
  isActive: boolean;
  isPast: boolean;
}

const STATUS_META: Record<
  BlueprintStatus,
  { label: string; color: string; edge: string; text: string }
> = {
  RUNNING: {
    label: "Running",
    color: "#00F0FF",
    edge: "#00E5FF",
    text: "text-cyan-300"
  },
  COMPLETED: {
    label: "Completed",
    color: "#39FF14",
    edge: "#39FF14",
    text: "text-emerald-300"
  },
  FAILED: {
    label: "Failed",
    color: "#FF003C",
    edge: "#FF003C",
    text: "text-rose-300"
  },
  PAUSED: {
    label: "Paused",
    color: "#FFB000",
    edge: "#FFB000",
    text: "text-amber-300"
  }
};

function hashCode(input: string) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function parseNodeLabel(node: Node) {
  const label = (node.data as { label?: unknown } | undefined)?.label;
  if (typeof label === "string") return label;
  return node.id;
}

function inferStatus(node: Node, label: string): BlueprintStatus {
  const text = `${node.id} ${label}`.toUpperCase();
  if (text.includes("FAILED") || text.includes("ABORTED") || text.includes("BLOCKS")) {
    return "FAILED";
  }
  if (text.includes("COMPLETED") || text.includes("DONE") || text.includes("SUCCESS")) {
    return "COMPLETED";
  }
  if (text.includes("PAUSED") || text.includes("WAIT") || text.includes("HUMAN")) {
    return "PAUSED";
  }
  return "RUNNING";
}

function formatTime(raw: number) {
  const days = Math.floor(raw / 24);
  const hours = Math.floor(raw % 24);
  return `T+ ${String(days).padStart(2, "0")}:${String(hours).padStart(2, "0")}`;
}

function normalizeNodeDimension(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  return fallback;
}

export function AutopsyBlueprint({
  title,
  subtitle,
  nodes,
  edges,
  className,
  defaultTime = 50
}: AutopsyBlueprintProps) {
  const [timeValue, setTimeValue] = useState(defaultTime);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [oceanEnabled, setOceanEnabled] = useState(true);
  const [oceanLevel, setOceanLevel] = useState(-15);
  const [waveIntensity, setWaveIntensity] = useState(0.8);

  const timelineMetaByNodeId = useMemo(() => {
    const map = new Map<string, NodeTimelineMeta>();
    const total = Math.max(1, nodes.length);
    nodes.forEach((node, index) => {
      const label = parseNodeLabel(node);
      const status = inferStatus(node, label);
      const seed = hashCode(node.id);
      const start = (seed % 60) * 0.9;
      const span = 14 + (seed % 34);
      const end = Math.min(100, start + span + (index / total) * 8);
      const impact = 15 + (seed % 85);
      map.set(node.id, { start, end, impact, status });
    });
    return map;
  }, [nodes]);

  const nodeMeta = useMemo<RenderNodeMeta[]>(() => {
    return nodes.map((node) => {
      const titleText = parseNodeLabel(node);
      const timeline = timelineMetaByNodeId.get(node.id);
      const start = timeline?.start ?? 0;
      const end = timeline?.end ?? 100;
      const status = timeline?.status ?? inferStatus(node, titleText);
      const impact = timeline?.impact ?? 50;
      const isFuture = timeValue < start;
      const isPast = timeValue > end;
      const isActive = !isFuture && !isPast;
      return {
        raw: node,
        id: node.id,
        title: titleText,
        status,
        impact,
        start,
        end,
        isFuture,
        isActive,
        isPast
      };
    });
  }, [nodes, timeValue, timelineMetaByNodeId]);

  const nodeMetaById = useMemo(() => {
    const map = new Map<string, RenderNodeMeta>();
    nodeMeta.forEach((item) => map.set(item.id, item));
    return map;
  }, [nodeMeta]);

  const activeNodeCount = useMemo(
    () => nodeMeta.filter((item) => item.isActive).length,
    [nodeMeta]
  );
  const systemLoad = useMemo(() => {
    if (nodeMeta.length === 0) return 0;
    return Math.max(1, Math.min(99, Math.round((activeNodeCount / nodeMeta.length) * 100)));
  }, [activeNodeCount, nodeMeta.length]);

  const selectedNode = selectedNodeId ? nodeMetaById.get(selectedNodeId) ?? null : null;
  const hoveredNode = hoveredNodeId ? nodeMetaById.get(hoveredNodeId) ?? null : null;

  const styledNodes = useMemo<Node[]>(() => {
    return nodeMeta.map((item) => {
      const statusMeta = STATUS_META[item.status];
      const isSelected = item.id === selectedNodeId;
      const isHovered = item.id === hoveredNodeId;
      const scale = isSelected ? 1.24 : isHovered ? 1.12 : 1;

      const baseWidth = normalizeNodeDimension(
        (item.raw.style as { width?: unknown } | undefined)?.width,
        108
      );
      const baseHeight = normalizeNodeDimension(
        (item.raw.style as { height?: unknown } | undefined)?.height,
        108
      );
      const width = Math.round(baseWidth * scale);
      const height = Math.round(baseHeight * scale);

      const opacity = item.isFuture ? 0.22 : item.isPast ? 0.55 : 0.98;
      const borderColor = item.isActive ? statusMeta.color : "rgba(148,163,184,0.35)";
      const glow = item.isActive ? `0 0 26px ${statusMeta.color}66` : "0 8px 26px rgba(0,0,0,0.35)";

      return {
        ...item.raw,
        type: undefined,
        data: {
          label: (
            <div className="flex h-full w-full flex-col items-center justify-center px-2 text-center">
              <span className="line-clamp-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-100">
                {item.title}
              </span>
              <span className={`mt-1 text-[9px] font-bold uppercase tracking-[0.16em] ${statusMeta.text}`}>
                {statusMeta.label}
              </span>
            </div>
          )
        },
        style: {
          width,
          height,
          borderRadius: "999px",
          border: `1px solid ${borderColor}`,
          background:
            "radial-gradient(circle at 28% 26%, rgba(255,255,255,0.3), rgba(10,15,30,0.42) 46%, rgba(7,10,22,0.86) 100%)",
          color: "#e2e8f0",
          boxShadow: glow,
          opacity
        }
      };
    });
  }, [hoveredNodeId, nodeMeta, selectedNodeId]);

  const styledEdges = useMemo<Edge[]>(() => {
    return edges.map((edge) => {
      const source = nodeMetaById.get(edge.source);
      const target = nodeMetaById.get(edge.target);
      const sourceStatus = source ? STATUS_META[source.status] : STATUS_META.RUNNING;
      const targetStatus = target ? STATUS_META[target.status] : STATUS_META.RUNNING;
      const active = Boolean(source?.isActive && target?.isActive);
      const hidden = Boolean(source?.isFuture || target?.isFuture);
      const defaultColor = active ? sourceStatus.edge : `${targetStatus.edge}66`;
      const explicitColor =
        edge.style && typeof edge.style.stroke === "string" ? edge.style.stroke : undefined;
      const edgeColor = explicitColor ?? defaultColor;

      return {
        ...edge,
        animated: active || edge.animated,
        label: edge.label,
        labelStyle: {
          fill: "rgba(203,213,225,0.88)",
          fontSize: 10,
          letterSpacing: "0.05em",
          textTransform: "uppercase"
        },
        style: {
          ...(edge.style ?? {}),
          stroke: edgeColor,
          strokeOpacity: hidden ? 0.08 : active ? 0.92 : 0.34,
          strokeWidth: active ? 2.1 : 1.2
        }
      };
    });
  }, [edges, nodeMetaById]);

  const selectedDependencies = useMemo(() => {
    if (!selectedNode) return [];
    const incoming = edges
      .filter((edge) => edge.target === selectedNode.id)
      .slice(0, 6)
      .map((edge) => nodeMetaById.get(edge.source)?.title ?? edge.source);
    return incoming;
  }, [edges, nodeMetaById, selectedNode]);

  const selectedTerminalLogs = useMemo(() => {
    if (!selectedNode) return [];
    const baseTime = new Date();
    const steps = [
      "Initiating node runtime.",
      "Allocating memory buffers.",
      "Connected to upstream dependency graph.",
      "Processing execution context chunks.",
      selectedNode.isActive ? "Awaiting next signal..." : "Node transitioned out of active window."
    ];
    return steps.map((line, index) => {
      const stamp = new Date(baseTime.getTime() - (steps.length - index) * 45_000)
        .toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      return `[${stamp}] ${line}`;
    });
  }, [selectedNode]);

  const handleNodeClick = useCallback((_event: MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
  }, []);

  const handlePaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const handleNodeMouseEnter = useCallback((event: MouseEvent, node: Node) => {
    setHoveredNodeId(node.id);
    setTooltipPos({ x: event.clientX, y: event.clientY });
  }, []);

  const handleNodeMouseMove = useCallback((event: MouseEvent) => {
    setTooltipPos({ x: event.clientX, y: event.clientY });
  }, []);

  const handleNodeMouseLeave = useCallback(() => {
    setHoveredNodeId(null);
    setTooltipPos(null);
  }, []);

  return (
    <div
      className={`relative overflow-hidden rounded-3xl border border-white/10 bg-[#050814] ${className ?? "h-[560px]"}`}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_12%,rgba(18,52,90,0.4),transparent_45%),radial-gradient(circle_at_82%_22%,rgba(5,142,189,0.22),transparent_42%),linear-gradient(180deg,#050814_0%,#04060f_100%)]" />
      <div className="absolute inset-0 opacity-30 [background-size:30px_30px] [background-image:linear-gradient(rgba(56,189,248,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(56,189,248,0.08)_1px,transparent_1px)]" />

      {oceanEnabled && (
        <div
          className="pointer-events-none absolute inset-x-0 h-32 bg-gradient-to-t from-cyan-500/25 via-blue-500/15 to-transparent blur-2xl transition-all duration-300"
          style={{
            bottom: `${20 + (oceanLevel + 40) * 0.6}%`,
            opacity: 0.18 + waveIntensity * 0.2
          }}
        />
      )}

      <div className="absolute inset-x-4 top-4 bottom-28 z-10">
        <div className="h-full overflow-hidden rounded-2xl border border-white/10 bg-black/20">
          <ReactFlow
            nodes={styledNodes}
            edges={styledEdges}
            fitView
            fitViewOptions={{ padding: 0.28 }}
            minZoom={0.25}
            onNodeClick={handleNodeClick}
            onPaneClick={handlePaneClick}
            onNodeMouseEnter={handleNodeMouseEnter}
            onNodeMouseMove={handleNodeMouseMove}
            onNodeMouseLeave={handleNodeMouseLeave}
            className="!bg-transparent"
          >
            <MiniMap className="!bg-black/50" nodeColor={() => "#0ea5e9"} zoomable pannable />
            <Controls />
            <Background gap={22} size={1.1} color="rgba(148,163,184,0.16)" />
          </ReactFlow>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-0 z-30 flex flex-col justify-between p-4">
        <header className="pointer-events-auto flex items-start justify-between gap-3">
          <div className="rounded-2xl border border-white/10 bg-[#0a0f1e]/55 px-4 py-3 backdrop-blur-xl">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-cyan-300/70 bg-cyan-400/10 text-cyan-300 shadow-[0_0_18px_rgba(0,240,255,0.45)]">
                <Network size={18} />
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-white">{title}</p>
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">
                  {subtitle ?? "Autopsy Blueprint Screen"}
                </p>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <div className="rounded-xl border border-white/10 bg-[#0a0f1e]/55 px-3 py-2 text-right backdrop-blur-xl">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Active Nodes</p>
              <p className="font-mono text-lg font-bold text-cyan-300">{activeNodeCount}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#0a0f1e]/55 px-3 py-2 text-right backdrop-blur-xl">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-400">System Load</p>
              <p className="font-mono text-lg font-bold text-emerald-300">{systemLoad}%</p>
            </div>
          </div>
        </header>

        <div className="pointer-events-auto mx-auto w-full max-w-3xl rounded-2xl border border-white/10 bg-[#0a0f1e]/70 p-4 backdrop-blur-xl">
          <div className="mb-3 flex items-end justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-300">
                Chronos Time Scrubber
              </p>
              <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
                Filter active nodes by timeline
              </p>
            </div>
            <p className="font-mono text-2xl font-bold text-white">{formatTime(timeValue)}</p>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={0.1}
            value={timeValue}
            onChange={(event) => setTimeValue(Number(event.target.value))}
            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-white/20 accent-cyan-400"
          />
          <div className="mt-2 flex justify-between text-[10px] uppercase tracking-[0.14em] text-slate-500">
            <span>System Start</span>
            <span>Current Time</span>
            <span>Projected End</span>
          </div>
        </div>
      </div>

      <aside
        className={`absolute right-4 top-20 bottom-28 z-40 flex w-80 flex-col gap-4 rounded-2xl border border-white/10 bg-[#0a0f1e]/80 p-4 backdrop-blur-2xl transition-transform duration-300 ${
          selectedNode ? "translate-x-0" : "translate-x-[120%]"
        }`}
      >
        <button
          onClick={() => setSelectedNodeId(null)}
          className="absolute right-3 top-3 rounded-md border border-white/10 bg-black/20 p-1 text-slate-400 transition hover:text-white"
        >
          <X size={14} />
        </button>

        {selectedNode && (
          <>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-slate-400">{selectedNode.id}</p>
              <p className="text-lg font-bold text-white">{selectedNode.title}</p>
              <div className="mt-2 flex items-center gap-2">
                <span
                  className="rounded px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em]"
                  style={{
                    color: STATUS_META[selectedNode.status].color,
                    border: `1px solid ${STATUS_META[selectedNode.status].color}66`,
                    backgroundColor: `${STATUS_META[selectedNode.status].color}22`
                  }}
                >
                  {STATUS_META[selectedNode.status].label}
                </span>
                <span className="text-[11px] text-slate-400">
                  Impact: <span className="font-mono text-slate-100">{selectedNode.impact}</span>
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Duration</p>
                <p className="font-mono text-slate-200">{Math.max(1, Math.round(selectedNode.end - selectedNode.start))}h</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Region</p>
                <p className="font-mono text-slate-200">org-grid</p>
              </div>
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Dependencies</p>
              <div className="mt-2 space-y-1 rounded-xl border border-white/10 bg-black/30 p-2">
                {selectedDependencies.length === 0 ? (
                  <p className="text-xs text-slate-500">No inbound dependencies.</p>
                ) : (
                  selectedDependencies.map((dependency) => (
                    <div key={dependency} className="flex items-center gap-2 text-xs text-slate-300">
                      <ArrowDownRight size={12} className="text-slate-500" />
                      <span className="font-mono">{dependency}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="min-h-0 flex-1">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Terminal Output</p>
              <div className="vx-scrollbar mt-2 h-full overflow-y-auto rounded-xl border border-white/10 bg-black/35 p-2 font-mono text-[10px] text-slate-400">
                {selectedTerminalLogs.map((line) => (
                  <p key={line} className="py-0.5">
                    {line}
                  </p>
                ))}
                <p className="animate-pulse py-0.5 text-cyan-300">&gt; Awaiting signal...</p>
              </div>
            </div>
          </>
        )}
      </aside>

      {hoveredNode && tooltipPos && !selectedNode && (
        <div
          className="pointer-events-none fixed z-[120] rounded-lg border border-white/15 bg-[#0a0f1e]/88 px-3 py-2 backdrop-blur-xl"
          style={{ left: tooltipPos.x + 12, top: tooltipPos.y - 22 }}
        >
          <div className="flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: STATUS_META[hoveredNode.status].color }}
            />
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-slate-400">{hoveredNode.id}</span>
          </div>
          <p className="max-w-[220px] text-xs font-semibold text-white">{hoveredNode.title}</p>
          <p className={`text-[10px] uppercase tracking-[0.14em] ${STATUS_META[hoveredNode.status].text}`}>
            {STATUS_META[hoveredNode.status].label}
          </p>
        </div>
      )}

      <div className="absolute bottom-4 left-4 z-40 flex flex-col items-start gap-2">
        <div
          className={`w-64 rounded-2xl border border-white/10 bg-[#0a0f1e]/80 p-4 backdrop-blur-xl transition-all duration-300 ${
            settingsOpen
              ? "pointer-events-auto translate-y-0 opacity-100"
              : "pointer-events-none translate-y-3 opacity-0"
          }`}
        >
          <p className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-300">
            <SlidersHorizontal size={14} className="text-cyan-300" />
            Environment
          </p>
          <label className="mb-3 flex items-center justify-between text-xs text-slate-300">
            <span className="font-mono">Digital Ocean</span>
            <input
              type="checkbox"
              checked={oceanEnabled}
              onChange={(event) => setOceanEnabled(event.target.checked)}
              className="h-4 w-4 accent-cyan-400"
            />
          </label>
          <label className="mb-2 block text-[10px] uppercase tracking-[0.12em] text-slate-500">
            Ocean Level ({oceanLevel})
          </label>
          <input
            type="range"
            min={-40}
            max={5}
            value={oceanLevel}
            onChange={(event) => setOceanLevel(Number(event.target.value))}
            className="mb-3 h-1.5 w-full cursor-pointer rounded-full bg-white/20 accent-cyan-400"
          />
          <label className="mb-2 block text-[10px] uppercase tracking-[0.12em] text-slate-500">
            Wave Intensity ({waveIntensity.toFixed(1)})
          </label>
          <input
            type="range"
            min={0}
            max={2}
            step={0.1}
            value={waveIntensity}
            onChange={(event) => setWaveIntensity(Number(event.target.value))}
            className="h-1.5 w-full cursor-pointer rounded-full bg-white/20 accent-cyan-400"
          />
        </div>

        <button
          onClick={() => setSettingsOpen((prev) => !prev)}
          className="rounded-full border border-white/10 bg-[#0a0f1e]/80 p-3 text-slate-300 backdrop-blur-xl transition hover:border-cyan-400/50 hover:text-cyan-300"
          title="Environment Settings"
        >
          {settingsOpen ? <Waves size={16} /> : <Settings2 size={16} />}
        </button>
      </div>
    </div>
  );
}
