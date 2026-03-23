"use client";

import type { StringMode } from "@/components/chat-ui/types";

interface ModeTabsProps {
  mode: StringMode;
  onChange: (mode: StringMode) => void;
}

export function ModeTabs({ mode, onChange }: ModeTabsProps) {
  return (
    <div className="inline-flex w-full max-w-full rounded-full border border-white/10 bg-black/20 p-1 sm:w-auto">
      <button
        type="button"
        onClick={() => onChange("discussion")}
        className={`flex-1 whitespace-nowrap rounded-full px-3 py-2 text-xs font-medium transition sm:flex-none sm:px-4 sm:text-sm ${
          mode === "discussion"
            ? "bg-white text-slate-950 shadow-sm"
            : "text-slate-400 hover:text-slate-200"
        }`}
      >
        Discussion
      </button>
      <button
        type="button"
        onClick={() => onChange("direction")}
        className={`flex-1 whitespace-nowrap rounded-full px-3 py-2 text-xs font-medium transition sm:flex-none sm:px-4 sm:text-sm ${
          mode === "direction"
            ? "bg-amber-300 text-slate-950 shadow-sm"
            : "text-slate-400 hover:text-slate-200"
        }`}
      >
        Direction
      </button>
    </div>
  );
}
