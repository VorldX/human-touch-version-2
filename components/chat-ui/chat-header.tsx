"use client";

import { Menu, Users } from "lucide-react";

import { ModeToggle } from "@/components/chat-ui/mode-toggle";
import type { StringMode } from "@/components/chat-ui/types";

interface ChatHeaderProps {
  title: string;
  mode: StringMode;
  teamPanelOpen: boolean;
  onTitleChange: (value: string) => void;
  onModeChange: (mode: StringMode) => void;
  onToggleSidebar: () => void;
  onToggleTeamPanel: () => void;
}

export function ChatHeader({
  title,
  mode,
  teamPanelOpen,
  onTitleChange,
  onModeChange,
  onToggleSidebar,
  onToggleTeamPanel
}: ChatHeaderProps) {
  return (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/15 bg-black/25 text-slate-300 transition hover:bg-black/40"
          aria-label="Toggle sidebar"
        >
          <Menu size={16} />
        </button>
        <input
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          className="min-w-0 rounded-xl border border-transparent bg-transparent px-2 py-1 text-lg font-semibold text-slate-100 outline-none transition focus:border-white/15 focus:bg-black/20"
        />
      </div>

      <div className="flex items-center gap-2">
        <ModeToggle mode={mode} onModeChange={onModeChange} />
        <button
          type="button"
          onClick={onToggleTeamPanel}
          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
            teamPanelOpen
              ? "border-cyan-400/45 bg-cyan-500/15 text-cyan-100"
              : "border-white/15 bg-black/25 text-slate-300 hover:bg-black/40"
          }`}
        >
          <Users size={14} />
          Team
        </button>
      </div>
    </header>
  );
}
