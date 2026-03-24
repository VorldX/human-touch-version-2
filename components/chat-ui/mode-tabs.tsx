"use client";

import type { StringMode } from "@/components/chat-ui/types";

interface ModeTabsProps {
  mode: StringMode;
  onChange: (mode: StringMode) => void;
}

export function ModeTabs({ mode, onChange }: ModeTabsProps) {
  return (
    <div className="inline-flex h-9 max-w-full rounded-xl border border-white/[0.06] bg-white/[0.04] p-0.5 sm:w-auto">
      <button
        type="button"
        onClick={() => onChange("discussion")}
        className={`flex-1 whitespace-nowrap rounded-[10px] px-3 py-1.5 text-[12px] font-medium transition duration-200 sm:flex-none ${
          mode === "discussion"
            ? "bg-white text-slate-950"
            : "text-slate-400 hover:bg-white/[0.05] hover:text-slate-200"
        }`}
      >
        Discussion
      </button>
      <button
        type="button"
        onClick={() => onChange("direction")}
        className={`flex-1 whitespace-nowrap rounded-[10px] px-3 py-1.5 text-[12px] font-medium transition duration-200 sm:flex-none ${
          mode === "direction"
            ? "bg-amber-300 text-slate-950"
            : "text-slate-400 hover:bg-white/[0.05] hover:text-slate-200"
        }`}
      >
        Direction
      </button>
    </div>
  );
}
