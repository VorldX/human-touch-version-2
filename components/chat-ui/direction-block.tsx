"use client";

import type { ChatMessage } from "@/components/chat-ui/types";

interface DirectionBlockProps {
  message: ChatMessage;
}

function statusClass(status: "todo" | "in_progress" | "done") {
  if (status === "done") {
    return "border-emerald-500/35 bg-emerald-500/10 text-emerald-200";
  }
  if (status === "in_progress") {
    return "border-cyan-500/35 bg-cyan-500/10 text-cyan-200";
  }
  return "border-slate-500/35 bg-slate-500/10 text-slate-300";
}

export function DirectionBlock({ message }: DirectionBlockProps) {
  if (!message.direction) {
    return null;
  }

  return (
    <div className="w-full rounded-2xl border border-amber-500/25 bg-amber-500/6 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">Direction Block</p>
      <p className="mt-2 text-sm text-slate-100">{message.direction.objective}</p>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {message.direction.steps.map((step) => (
          <article key={step.id} className="rounded-2xl border border-white/10 bg-black/30 p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-slate-100">{step.title}</p>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${statusClass(step.status)}`}
              >
                {step.status.replace("_", " ")}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">Owner: {step.owner}</p>

            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <div>
                <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Tasks</p>
                <ul className="mt-1 space-y-1 text-xs text-slate-300">
                  {step.tasks.map((task) => (
                    <li key={task} className="line-clamp-2">
                      - {task}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Actions</p>
                <ul className="mt-1 space-y-1 text-xs text-slate-300">
                  {step.actions.map((action) => (
                    <li key={action} className="line-clamp-2">
                      - {action}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
