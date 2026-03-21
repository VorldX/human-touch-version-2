"use client";

import type { StringMode } from "@/components/chat-ui/types";

interface ModeToggleProps {
  mode: StringMode;
  onModeChange: (mode: StringMode) => void;
}

export function ModeToggle({ mode, onModeChange }: ModeToggleProps) {
  return (
    <div className="inline-flex items-center rounded-full border border-white/15 bg-black/35 p-1">
      <button
        type="button"
        onClick={() => onModeChange("discussion")}
        className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${
          mode === "discussion"
            ? "bg-cyan-500/15 text-cyan-100"
            : "text-slate-400 hover:bg-white/10 hover:text-slate-200"
        }`}
      >
        Discussion
      </button>
      <button
        type="button"
        onClick={() => onModeChange("direction")}
        className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${
          mode === "direction"
            ? "bg-amber-500/15 text-amber-100"
            : "text-slate-400 hover:bg-white/10 hover:text-slate-200"
        }`}
      >
        Direction
      </button>
    </div>
  );
}
