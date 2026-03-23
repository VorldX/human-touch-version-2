"use client";

import type { Team } from "@/components/chat-ui/types";

interface TeamSelectorProps {
  teams: Team[];
  selectedTeamId: string | null;
  onSelect: (teamId: string) => void;
}

export function TeamSelector({ teams, selectedTeamId, onSelect }: TeamSelectorProps) {
  if (teams.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 px-4 py-5 text-sm text-slate-500">
        No teams available yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {teams.map((team) => {
        const active = team.id === selectedTeamId;

        return (
          <button
            key={team.id}
            type="button"
            onClick={() => onSelect(team.id)}
            className={`w-full rounded-2xl border p-3 text-left transition ${
              active
                ? "border-cyan-400/30 bg-cyan-400/10"
                : "border-white/10 bg-black/15 hover:border-white/20 hover:bg-white/[0.04]"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-100">{team.name}</p>
                <p className="mt-1 text-xs text-slate-400">{team.focus || "General collaboration"}</p>
              </div>
              <span className="rounded-full border border-white/10 px-2 py-1 text-[11px] text-slate-400">
                {team.memberIds.length}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
