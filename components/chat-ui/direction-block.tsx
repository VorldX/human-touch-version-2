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
  const direction = message.direction;

  if (!direction) {
    return (
      <div className="w-full rounded-[28px] border border-cyan-400/15 bg-[linear-gradient(160deg,rgba(34,211,238,0.14),rgba(15,23,42,0.82))] p-4 shadow-[0_16px_50px_rgba(0,0,0,0.18)]">
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-cyan-200/80">
          <span>Discussion Context</span>
          {message.authorName ? (
            <span className="rounded-full border border-cyan-200/15 px-2 py-1 normal-case tracking-normal text-cyan-50">
              {message.authorName}
            </span>
          ) : null}
          {message.teamLabel ? (
            <span className="rounded-full border border-cyan-200/15 px-2 py-1 normal-case tracking-normal text-cyan-50">
              {message.teamLabel}
            </span>
          ) : null}
        </div>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-100 [overflow-wrap:anywhere]">
          {message.content}
        </p>
        <p className="mt-3 text-xs text-slate-400">
          This discussion context stays attached to the same string while you turn it into direction.
        </p>
      </div>
    );
  }

  const steps =
    direction.steps.length > 0
      ? direction.steps
      : [
          {
            id: `${message.id}-fallback`,
            title: "Create working direction",
            owner: "Team lead",
            status: "in_progress" as const,
            tasks: ["Clarify objective", "Assign first owner"],
            actions: ["Review and confirm scope"]
          }
        ];

  return (
    <div className="w-full rounded-[28px] border border-amber-200/15 bg-[linear-gradient(160deg,rgba(251,191,36,0.14),rgba(15,23,42,0.82))] p-4 shadow-[0_16px_50px_rgba(0,0,0,0.18)]">
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-amber-200/80">
        <span>Direction</span>
        {message.authorName ? (
          <span className="rounded-full border border-amber-200/15 px-2 py-1 normal-case tracking-normal text-amber-50">
            {message.authorName}
          </span>
        ) : null}
        {direction.teamName ? (
          <span className="rounded-full border border-amber-200/15 px-2 py-1 normal-case tracking-normal text-amber-50">
            {direction.teamName}
          </span>
        ) : null}
      </div>
      <p className="mt-3 text-lg font-semibold text-slate-50">{direction.objective}</p>
      {direction.summary ? <p className="mt-2 text-sm text-slate-300">{direction.summary}</p> : null}

      <div className="mt-4 grid gap-3">
        {steps.map((step) => (
          <article key={step.id} className="rounded-[24px] border border-white/10 bg-black/20 p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-slate-100">{step.title}</p>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${statusClass(step.status)}`}
              >
                {step.status.replace("_", " ")}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">Owner: {step.owner}</p>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
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

      {direction.nextAction ? (
        <div className="mt-4 rounded-[22px] border border-white/10 bg-black/20 px-4 py-3">
          <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Next action</p>
          <p className="mt-1 text-sm text-slate-200">{direction.nextAction}</p>
        </div>
      ) : null}
    </div>
  );
}
