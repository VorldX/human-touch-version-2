"use client";

import { useMemo } from "react";
import { Loader2 } from "lucide-react";

interface KnowledgeGraphNode {
  id: number;
  label: string;
  propertiesJsonb: Record<string, unknown> | null;
  version: number;
  updatedAt: string;
}

interface KnowledgeGraphEdge {
  id: number;
  sourceId: number;
  targetId: number;
  relationshipType: string;
  weight: number;
  version: number;
  updatedAt: string;
}

interface KnowledgeGraphSnapshot {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
}

interface CanvasMetric {
  label: string;
  value: string;
}

interface DnaKnowledgeCanvasProps {
  title: string;
  hint: string;
  metrics: CanvasMetric[];
  graph: KnowledgeGraphSnapshot | null;
  loading: boolean;
  error: string | null;
}

function formatKnowledgeTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function hashCanvasSeed(input: string) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function buildCanvasLayout(nodes: KnowledgeGraphNode[]) {
  const total = Math.max(1, nodes.length);
  return nodes.map((node, index) => {
    const seed = hashCanvasSeed(`${node.id}:${node.label}`);
    const baseRadius = total <= 4 ? 18 : total <= 8 ? 26 : 34;
    const ring = baseRadius + (seed % 9) - 4;
    const angle = (Math.PI * 2 * index) / total - Math.PI / 2;
    return {
      node,
      x: 50 + Math.cos(angle) * ring,
      y: 50 + Math.sin(angle) * ring,
      tone: seed % 3
    };
  });
}

export function DnaKnowledgeCanvas({
  title,
  hint,
  metrics,
  graph,
  loading,
  error
}: DnaKnowledgeCanvasProps) {
  const nodes = useMemo(() => graph?.nodes.slice(0, 14) ?? [], [graph]);
  const visibleNodeIds = new Set(nodes.map((node) => node.id));
  const edges = (graph?.edges ?? [])
    .filter((edge) => visibleNodeIds.has(edge.sourceId) && visibleNodeIds.has(edge.targetId))
    .slice(0, 20);
  const positions = useMemo(() => buildCanvasLayout(nodes), [nodes]);
  const positionByNodeId = useMemo(() => {
    const map = new Map<number, { x: number; y: number; tone: number }>();
    positions.forEach((item) => {
      map.set(item.node.id, { x: item.x, y: item.y, tone: item.tone });
    });
    return map;
  }, [positions]);

  return (
    <div className="space-y-3 rounded-3xl border border-white/10 bg-black/25 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">{title}</p>
          <p className="mt-1 max-w-2xl text-xs text-slate-500">{hint}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {metrics.map((metric) => (
            <div
              key={`${metric.label}-${metric.value}`}
              className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-300"
            >
              {metric.label}: {metric.value}
            </div>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="inline-flex items-center gap-2 text-sm text-slate-400">
          <Loader2 size={14} className="animate-spin" />
          Loading knowledge canvas...
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {error}
        </div>
      ) : nodes.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-500">
          No graph data available for this canvas yet.
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
          <div className="relative min-h-[320px] overflow-hidden rounded-3xl border border-white/10 bg-[radial-gradient(circle_at_50%_30%,rgba(16,185,129,0.16),transparent_36%),radial-gradient(circle_at_15%_80%,rgba(14,165,233,0.12),transparent_30%),linear-gradient(180deg,rgba(8,12,23,0.95),rgba(4,8,17,0.98))]">
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
              {edges.map((edge) => {
                const source = positionByNodeId.get(edge.sourceId);
                const target = positionByNodeId.get(edge.targetId);
                if (!source || !target) return null;
                const opacity = Math.max(0.22, Math.min(0.75, edge.weight / 100));
                return (
                  <line
                    key={edge.id}
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    stroke="rgba(56,189,248,0.45)"
                    strokeWidth={0.5 + edge.weight / 80}
                    strokeOpacity={opacity}
                  />
                );
              })}
            </svg>

            {positions.map((item) => (
              <div
                key={item.node.id}
                className="absolute flex w-28 -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 rounded-2xl border border-white/10 bg-black/55 px-2 py-2 text-center shadow-[0_0_24px_rgba(0,0,0,0.35)]"
                style={{
                  left: `${item.x}%`,
                  top: `${item.y}%`
                }}
              >
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-full border text-[10px] font-bold uppercase tracking-[0.16em] ${
                    item.tone === 0
                      ? "border-cyan-400/40 bg-cyan-400/15 text-cyan-200"
                      : item.tone === 1
                        ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-200"
                        : "border-amber-400/40 bg-amber-400/15 text-amber-200"
                  }`}
                >
                  {item.node.label.slice(0, 2).toUpperCase()}
                </span>
                <span className="line-clamp-2 text-[10px] font-semibold text-slate-100">
                  {item.node.label}
                </span>
                <span className="text-[9px] uppercase tracking-[0.12em] text-slate-500">
                  v{item.node.version}
                </span>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Node snapshot</p>
              <div className="mt-2 space-y-2">
                {nodes.slice(0, 6).map((node) => (
                  <div key={node.id} className="rounded-xl border border-white/10 bg-black/30 px-3 py-2">
                    <p className="text-sm font-semibold text-slate-100">{node.label}</p>
                    <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
                      {node.version} | {formatKnowledgeTimestamp(node.updatedAt)}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Edge snapshot</p>
              <div className="mt-2 space-y-2">
                {edges.slice(0, 6).map((edge) => (
                  <div key={edge.id} className="rounded-xl border border-white/10 bg-black/30 px-3 py-2">
                    <p className="text-sm font-semibold text-slate-100">
                      {edge.sourceId} {"->"} {edge.targetId}
                    </p>
                    <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
                      {edge.relationshipType} | weight {edge.weight}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
