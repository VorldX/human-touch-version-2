"use client";

import { Menu, PanelRight } from "lucide-react";

import { ModeTabs } from "@/components/chat-ui/mode-tabs";
import type { StringMode } from "@/components/chat-ui/types";

interface ChatHeaderProps {
  title: string;
  mode: StringMode;
  selectedTeamLabel: string | null;
  onTitleChange: (value: string) => void;
  onTitleBlur: () => void;
  onModeChange: (mode: StringMode) => void;
  onOpenSidebar: () => void;
  onOpenCollaboration: () => void;
}

export function ChatHeader({
  title,
  mode,
  selectedTeamLabel,
  onTitleChange,
  onTitleBlur,
  onModeChange,
  onOpenSidebar,
  onOpenCollaboration
}: ChatHeaderProps) {
  const helperText =
    mode === "discussion"
      ? selectedTeamLabel
        ? `Discuss with your co-founder manager in ${selectedTeamLabel}.`
        : "Discuss with your co-founder manager, then route the string into a team when needed."
      : selectedTeamLabel
        ? `This same string is now shaping direction for ${selectedTeamLabel}.`
        : "This same string is now in direction mode for structured decisions.";

  return (
    <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-white/10 px-4 py-4 sm:items-center sm:gap-4 sm:px-6">
      <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
        <button
          type="button"
          onClick={onOpenSidebar}
          className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-slate-200 transition hover:bg-white/[0.06] lg:hidden"
          aria-label="Open sidebar"
        >
          <Menu size={16} />
        </button>

        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-[0.16em] text-slate-500">String</p>
          <input
            value={title}
            onBlur={onTitleBlur}
            onChange={(event) => onTitleChange(event.target.value)}
            className="mt-1 w-full min-w-0 rounded-2xl border border-transparent bg-transparent px-2 py-1 text-lg font-semibold text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-white/10 focus:bg-black/10 sm:text-xl"
          />
          <p className="mt-1 max-w-2xl text-xs text-slate-400">
            {helperText}
          </p>
        </div>
      </div>

      <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
        <ModeTabs mode={mode} onChange={onModeChange} />
        <button
          type="button"
          onClick={onOpenCollaboration}
          className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-slate-200 transition hover:bg-white/[0.06] xl:hidden"
          aria-label="Open collaboration panel"
        >
          <PanelRight size={16} />
        </button>
      </div>
    </header>
  );
}
