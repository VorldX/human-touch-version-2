"use client";

import type { Collaborator } from "@/components/chat-ui/types";

interface ParticipantListProps {
  participants: Collaborator[];
}

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");
}

export function ParticipantList({ participants }: ParticipantListProps) {
  if (participants.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 px-4 py-5 text-sm text-slate-500">
        No active participants in this view.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {participants.map((participant) => (
        <div
          key={participant.id}
          className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/15 px-3 py-3"
        >
          <div className="relative">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-xs font-semibold text-slate-100">
              {initials(participant.name)}
            </div>
            <span
              className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#121826] ${
                participant.online === false ? "bg-slate-500" : "bg-emerald-400"
              }`}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-100">{participant.name}</p>
            <p className="truncate text-xs text-slate-400">
              {participant.role || "Contributor"} • {participant.kind === "AI" ? "AI" : "Human"}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
