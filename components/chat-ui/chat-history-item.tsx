"use client";

import type { ChatString } from "@/components/chat-ui/types";

interface ChatHistoryItemProps {
  chat: ChatString;
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

export function ChatHistoryItem({ chat, active, onSelect }: ChatHistoryItemProps) {
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
      <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-400">{previewFromChat(chat)}</p>
    </button>
  );
}
