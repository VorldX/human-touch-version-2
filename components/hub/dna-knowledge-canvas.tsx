"use client";

import { useMemo } from "react";

interface CanvasMetric {
  label: string;
  value: string;
}

interface CanvasItem {
  id: string;
  label: string;
  summary: string;
  meta: string;
  timestamp: string;
  status: "PENDING" | "RECONCILED";
}

interface DnaKnowledgeCanvasProps {
  title: string;
  hint: string;
  summary: string;
  metrics: CanvasMetric[];
  items: CanvasItem[];
}

function hashSeed(input: string) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function clipText(value: string, max = 120) {
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 1)).trimEnd()}...`;
}

function formatTimestamp(value: string) {
  if (!value) return "No timestamp";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function buildSpokeLayout(items: CanvasItem[]) {
  const total = Math.max(1, items.length);
  return items.map((item, index) => {
    const angle = (Math.PI * 2 * index) / total - Math.PI / 2;
    return {
      item,
      x: 50 + Math.cos(angle) * 28,
      y: 50 + Math.sin(angle) * 28
    };
  });
}

function buildDetachedLayout(items: CanvasItem[]) {
  return items.map((item, index) => {
    const seed = hashSeed(`${item.id}:${index}`);
    const angle = ((seed % 360) * Math.PI) / 180;
    const radius = 38 + (seed % 8);
    return {
      item,
      x: 50 + Math.cos(angle) * radius,
      y: 50 + Math.sin(angle) * radius
    };
  });
}

export function DnaKnowledgeCanvas({
  title,
  hint,
  summary,
  metrics,
  items
}: DnaKnowledgeCanvasProps) {
  const pendingItems = useMemo(
    () => items.filter((item) => item.status === "PENDING").slice(0, 10),
    [items]
  );
  const reconciledItems = useMemo(
    () => items.filter((item) => item.status === "RECONCILED").slice(0, 12),
    [items]
  );
  const spokeItems = useMemo(() => buildSpokeLayout(pendingItems), [pendingItems]);
  const detachedItems = useMemo(() => buildDetachedLayout(reconciledItems), [reconciledItems]);

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

      {items.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-500">
          No graph files are available for this folder yet.
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="relative min-h-[360px] overflow-hidden rounded-3xl border border-white/10 bg-[radial-gradient(circle_at_50%_45%,rgba(16,185,129,0.14),transparent_28%),radial-gradient(circle_at_20%_22%,rgba(245,158,11,0.08),transparent_22%),linear-gradient(180deg,rgba(8,12,23,0.95),rgba(4,8,17,0.98))]">
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
              {spokeItems.map((node) => (
                <line
                  key={`line-${node.item.id}`}
                  x1={50}
                  y1={50}
                  x2={node.x}
                  y2={node.y}
                  stroke="rgba(245,158,11,0.45)"
                  strokeWidth="0.5"
                />
              ))}
            </svg>

            <div className="absolute left-1/2 top-1/2 flex w-60 -translate-x-1/2 -translate-y-1/2 flex-col rounded-3xl border border-emerald-500/30 bg-black/65 p-4 text-center shadow-[0_0_32px_rgba(0,0,0,0.4)]">
              <span className="text-[10px] uppercase tracking-[0.16em] text-emerald-300">Summary center</span>
              <p className="mt-3 text-sm leading-6 text-slate-100">{summary}</p>
            </div>

            {spokeItems.map((node) => (
              <div
                key={node.item.id}
                className="absolute flex w-28 -translate-x-1/2 -translate-y-1/2 flex-col items-center rounded-2xl border border-amber-500/30 bg-black/60 px-2 py-2 text-center"
                style={{
                  left: `${node.x}%`,
                  top: `${node.y}%`
                }}
              >
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-300">
                  Pending
                </span>
                <span className="mt-1 line-clamp-2 text-[11px] font-semibold text-slate-100">
                  {node.item.label}
                </span>
              </div>
            ))}

            {detachedItems.map((node) => (
              <div
                key={node.item.id}
                className="absolute flex w-24 -translate-x-1/2 -translate-y-1/2 flex-col items-center rounded-2xl border border-cyan-500/25 bg-black/50 px-2 py-2 text-center opacity-90"
                style={{
                  left: `${node.x}%`,
                  top: `${node.y}%`
                }}
              >
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-300">
                  Reconciled
                </span>
                <span className="mt-1 line-clamp-2 text-[11px] font-semibold text-slate-100">
                  {node.item.label}
                </span>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                Pending reconciliation
              </p>
              <div className="mt-2 space-y-2">
                {pendingItems.length === 0 ? (
                  <p className="text-sm text-slate-500">No pending files on the spoke ring.</p>
                ) : (
                  pendingItems.map((item) => (
                    <div key={item.id} className="rounded-xl border border-white/10 bg-black/30 px-3 py-2">
                      <p className="text-sm font-semibold text-slate-100">{item.label}</p>
                      <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-slate-500">
                        {item.meta} | {formatTimestamp(item.timestamp)}
                      </p>
                      <p className="mt-2 text-xs leading-5 text-slate-300">{clipText(item.summary)}</p>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                Reconciled into summary
              </p>
              <div className="mt-2 space-y-2">
                {reconciledItems.length === 0 ? (
                  <p className="text-sm text-slate-500">No detached reconciled files yet.</p>
                ) : (
                  reconciledItems.map((item) => (
                    <div key={item.id} className="rounded-xl border border-white/10 bg-black/30 px-3 py-2">
                      <p className="text-sm font-semibold text-slate-100">{item.label}</p>
                      <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-slate-500">
                        {item.meta} | {formatTimestamp(item.timestamp)}
                      </p>
                      <p className="mt-2 text-xs leading-5 text-slate-300">{clipText(item.summary)}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
