"use client";

import type { ChatString } from "@/components/chat-ui/types";

interface StringItemProps {
  item: ChatString;
  selected: boolean;
  onSelect: (stringId: string) => void;
}

function formatRelativeTime(iso: string) {
  const time = new Date(iso).getTime();
  const now = Date.now();
  const diffMinutes = Math.max(1, Math.floor((now - time) / 60000));
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function StringItem({ item, selected, onSelect }: StringItemProps) {
  const badgeClass =
    item.mode === "discussion"
      ? "border-cyan-500/35 bg-cyan-500/10 text-cyan-300"
      : "border-amber-500/35 bg-amber-500/10 text-amber-300";

  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      className={`w-full rounded-2xl border px-3 py-2.5 text-left transition ${
        selected
          ? "border-cyan-400/45 bg-cyan-500/12"
          : "border-white/10 bg-black/20 hover:border-white/20 hover:bg-black/35"
      }`}
    >
      <p className="line-clamp-1 text-sm font-semibold text-slate-100">{item.title}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span
          className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${badgeClass}`}
        >
          {item.mode}
        </span>
        <span className="text-[11px] text-slate-500">{formatRelativeTime(item.updatedAt)}</span>
      </div>
    </button>
  );
}
