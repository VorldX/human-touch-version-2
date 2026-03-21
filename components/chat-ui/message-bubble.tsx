"use client";

import type { ChatMessage, StringMode } from "@/components/chat-ui/types";

interface MessageBubbleProps {
  message: ChatMessage;
  mode: StringMode;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function MessageBubble({ message, mode }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const wrapperClass = isUser ? "justify-end" : "justify-start";
  const bubbleClass = isUser
    ? "border-cyan-400/30 bg-cyan-500/12 text-slate-100"
    : mode === "direction"
      ? "border-amber-500/30 bg-amber-500/8 text-slate-200"
      : "border-white/10 bg-black/25 text-slate-200";

  return (
    <div className={`flex w-full ${wrapperClass}`}>
      <div className={`max-w-[85%] rounded-2xl border px-4 py-3 shadow-sm ${bubbleClass}`}>
        <p className="whitespace-pre-wrap text-sm leading-6 [overflow-wrap:anywhere]">
          {message.content}
        </p>
        <p className="mt-1 text-right text-[11px] text-slate-500">{formatTime(message.createdAt)}</p>
      </div>
    </div>
  );
}
