"use client";

import type { AssistantMessageMeta } from "@/src/types/chat";

interface TimelineEventProps {
  meta: AssistantMessageMeta;
  timestampLabel?: string | null;
  fallbackText?: string | null;
}

function statusPillClass(status?: string) {
  const normalized = status?.trim().toUpperCase() ?? "";
  if (normalized === "COMPLETED") {
    return "border-emerald-500/35 bg-emerald-500/10 text-emerald-200";
  }
  if (normalized === "RUNNING" || normalized === "ACTIVE") {
    return "border-cyan-500/35 bg-cyan-500/10 text-cyan-200";
  }
  if (normalized === "PAUSED" || normalized === "DRAFT" || normalized === "QUEUED") {
    return "border-amber-500/35 bg-amber-500/10 text-amber-200";
  }
  if (normalized === "FAILED" || normalized === "ABORTED") {
    return "border-rose-500/35 bg-rose-500/10 text-rose-200";
  }
  return "border-white/10 bg-white/5 text-slate-300";
}

function compactId(value?: string) {
  const normalized = value?.trim() ?? "";
  return normalized ? normalized.slice(0, 8) : "";
}

export function TimelineEvent({
  meta,
  timestampLabel,
  fallbackText
}: TimelineEventProps) {
  if (meta.kind !== "thread_event" && meta.kind !== "workflow_event") {
    return null;
  }

  const detail = meta.message.trim() || fallbackText?.trim() || "";
  const flowId = meta.kind === "workflow_event" ? compactId(meta.flowId) : "";
  const taskId = meta.kind === "workflow_event" ? compactId(meta.taskId) : "";
  const agentLabel =
    meta.kind === "workflow_event" ? meta.agentLabel?.trim() ?? "" : "";
  const scopeLabel =
    meta.kind === "thread_event" ? meta.scope?.trim() ?? "" : "WORKFLOW";
  const isCompactThreadEvent = meta.kind === "thread_event";

  if (isCompactThreadEvent) {
    return (
      <div className="flex w-full justify-center">
        <article className="w-fit max-w-[72%] rounded-[14px] border border-white/8 bg-white/[0.045] px-3 py-2 text-center sm:max-w-[220px]">
          <p className="mx-auto max-w-[190px] text-[11px] leading-4 text-slate-300 [overflow-wrap:anywhere]">
            {detail}
          </p>
          {timestampLabel ? (
            <p className="mt-1 text-[9px] text-slate-500">{timestampLabel}</p>
          ) : null}
        </article>
      </div>
    );
  }

  return (
    <div className="flex w-full justify-center">
      <article className="w-full max-w-[92%] rounded-[22px] border border-white/10 bg-white/[0.04] px-4 py-3 text-center sm:max-w-[78%]">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300">
            {scopeLabel || "SYSTEM"}
          </span>
          {meta.status ? (
            <span
              className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${statusPillClass(meta.status)}`}
            >
              {meta.status}
            </span>
          ) : null}
          {flowId ? (
            <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-0.5 text-[10px] text-slate-400">
              Flow {flowId}
            </span>
          ) : null}
          {taskId ? (
            <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-0.5 text-[10px] text-slate-400">
              Task {taskId}
            </span>
          ) : null}
          {agentLabel ? (
            <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-0.5 text-[10px] text-slate-400">
              {agentLabel}
            </span>
          ) : null}
        </div>

        <p className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-200">
          {meta.title}
        </p>

        {detail ? (
          <p className="mt-1 text-sm leading-6 text-slate-300 [overflow-wrap:anywhere]">
            {detail}
          </p>
        ) : null}

        {timestampLabel ? (
          <p className="mt-2 text-[10px] uppercase tracking-[0.14em] text-slate-500">
            {timestampLabel}
          </p>
        ) : null}
      </article>
    </div>
  );
}
