"use client";

import { Menu, PanelRight } from "lucide-react";

import { ModeTabs } from "@/components/chat-ui/mode-tabs";
import type { StringMode } from "@/components/chat-ui/types";

interface ChatHeaderProps {
  title: string;
  mode: StringMode;
  stringPanelOpen: boolean;
  stringPanelPinned?: boolean;
  selectedTeamLabel: string | null;
  audienceLabel?: string | null;
  audienceKind?: "everyone" | "team" | "person";
  statusText?: string | null;
  statusTone?: "neutral" | "error";
  onTitleChange: (value: string) => void;
  onTitleBlur: () => void;
  onModeChange: (mode: StringMode) => void;
  onToggleStringPanel: () => void;
  onOpenSidebar: () => void;
}

export function ChatHeader({
  title,
  mode,
  stringPanelOpen,
  stringPanelPinned = false,
  selectedTeamLabel,
  audienceLabel,
  audienceKind = "everyone",
  statusText,
  statusTone = "neutral",
  onTitleChange,
  onTitleBlur,
  onModeChange,
  onToggleStringPanel,
  onOpenSidebar
}: ChatHeaderProps) {
  return (
    <header className="shrink-0 border-b border-white/[0.06] bg-[#0f172a]/96 px-3 sm:px-4">
      <div className="grid h-14 grid-cols-[minmax(0,1fr)_minmax(140px,280px)_minmax(0,1fr)] items-center gap-2 sm:gap-3">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={onOpenSidebar}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.04] text-slate-200 transition duration-200 hover:bg-white/[0.08]"
            aria-label="Open sidebar"
          >
            <Menu size={16} />
          </button>

          <div className="hidden min-w-0 flex-1 items-center gap-2 lg:flex">
            {statusText ? (
              <span
                className={`max-w-[220px] truncate rounded-full border px-2.5 py-1 text-[11px] ${
                  statusTone === "error"
                    ? "border-rose-500/20 bg-rose-500/10 text-rose-200"
                    : "border-white/[0.08] bg-white/[0.04] text-slate-400"
                }`}
              >
                {statusText}
              </span>
            ) : null}

            {audienceLabel || selectedTeamLabel ? (
              <span
                className={`max-w-[220px] truncate rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                  audienceKind === "person"
                    ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
                    : "border-cyan-400/20 bg-cyan-400/10 text-cyan-100"
                }`}
              >
                {audienceLabel
                  ? `To ${audienceLabel}`
                  : selectedTeamLabel
                    ? `Team ${selectedTeamLabel}`
                    : null}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex min-w-0 items-center justify-center px-1">
          <input
            value={title}
            onBlur={onTitleBlur}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder="Untitled string"
            className="h-9 w-full min-w-0 rounded-xl border border-transparent bg-transparent px-2 text-center text-sm font-semibold text-slate-100 outline-none transition duration-200 placeholder:text-slate-500 focus:border-white/[0.08] focus:bg-white/[0.04]"
          />
        </div>

        <div className="flex min-w-0 items-center justify-end gap-2">
          <ModeTabs mode={mode} onChange={onModeChange} />
          <button
            type="button"
            onClick={onToggleStringPanel}
            className={`inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-[12px] font-medium transition duration-200 ${
              stringPanelOpen
                ? "border-cyan-400/20 bg-cyan-400/10 text-cyan-100"
                : "border-white/[0.06] bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]"
            } ${stringPanelPinned ? "xl:hidden" : ""}`}
          >
            <PanelRight size={14} />
            <span className="hidden sm:inline">String Panel</span>
          </button>
        </div>
      </div>
    </header>
  );
}
