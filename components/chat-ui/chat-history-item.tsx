"use client";

import type { ChatString, Team } from "@/components/chat-ui/types";

interface ChatHistoryItemProps {
  chat: ChatString;
  teams: Team[];
  active: boolean;
  onSelect: (chatId: string) => void;
}

function formatTimestamp(iso: string) {
  const date = new Date(iso);
  const sameDay = new Date().toDateString() === date.toDateString();

  if (sameDay) {
    return date.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit"
    });
  }

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric"
  });
}

function previewFromChat(chat: ChatString) {
  const lastMessage = chat.messages[chat.messages.length - 1];

  if (!lastMessage) {
    return "Start a string...";
  }

  const normalized = lastMessage.content.replace(/\s+/g, " ").trim();
  return normalized.length > 78 ? `${normalized.slice(0, 75)}...` : normalized;
}

function statusLabel(chat: ChatString) {
  if (chat.planId) {
    return "Planning";
  }
  if (chat.directionId) {
    return "Direction Ready";
  }
  if (chat.mode === "direction") {
    return "Direction Draft";
  }
  if (chat.messages.length > 0) {
    return "Discussion";
  }
  return "Draft";
}

function resolveTeamLabels(chat: ChatString, teams: Team[]) {
  const labels: string[] = [];
  const seen = new Set<string>();
  const addLabel = (value: string | null | undefined) => {
    const next = typeof value === "string" ? value.trim() : "";
    if (!next || seen.has(next)) {
      return;
    }
    seen.add(next);
    labels.push(next);
  };
  const teamNameById = new Map(teams.map((team) => [team.id, team.name] as const));

  addLabel(teamNameById.get(chat.selectedTeamId ?? "") ?? chat.selectedTeamLabel ?? "");
  (chat.workspaceState?.linkedTeamIds ?? []).forEach((teamId) => {
    addLabel(teamNameById.get(teamId) ?? "");
  });

  return labels;
}

export function ChatHistoryItem({ chat, teams, active, onSelect }: ChatHistoryItemProps) {
  const teamLabels = resolveTeamLabels(chat, teams);
  const visibleTeamLabels = teamLabels.slice(0, 2);
  const hiddenTeamCount = Math.max(0, teamLabels.length - visibleTeamLabels.length);

  return (
    <button
      type="button"
      onClick={() => onSelect(chat.id)}
      className={`w-full rounded-[22px] border px-4 py-3.5 text-left transition duration-200 ${
        active
          ? "border-cyan-400/30 bg-cyan-400/[0.12] shadow-[0_18px_40px_rgba(34,211,238,0.08)]"
          : "border-white/10 bg-white/[0.03] hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.05]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="line-clamp-1 text-sm font-semibold leading-6 text-slate-100">{chat.title}</p>
        <span className="shrink-0 text-[11px] text-slate-500">{formatTimestamp(chat.updatedAt)}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-cyan-100">
          {statusLabel(chat)}
        </span>
        {visibleTeamLabels.length > 0 ? (
          visibleTeamLabels.map((teamLabel) => (
            <span
              key={teamLabel}
              className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium text-slate-300"
            >
              {teamLabel}
            </span>
          ))
        ) : (
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium text-slate-500">
            No team
          </span>
        )}
        {hiddenTeamCount > 0 ? (
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium text-slate-400">
            +{hiddenTeamCount}
          </span>
        ) : null}
      </div>
      <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-400">{previewFromChat(chat)}</p>
    </button>
  );
}
