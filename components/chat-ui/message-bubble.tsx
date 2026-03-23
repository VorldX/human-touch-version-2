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
    ? mode === "direction"
      ? "border-amber-200/30 bg-[linear-gradient(145deg,rgba(251,191,36,0.22),rgba(120,53,15,0.18))] text-amber-50"
      : "border-cyan-300/25 bg-[linear-gradient(145deg,rgba(34,211,238,0.18),rgba(15,23,42,0.75))] text-slate-50"
    : "border-white/10 bg-[rgba(15,23,42,0.65)] text-slate-200";
  const roleLabel = isUser
    ? "You"
    : message.authorName || (message.error ? "System" : "Co-Founder Manager");

  return (
    <div className={`flex w-full ${wrapperClass}`}>
      <div
        className={`max-w-[min(100%,42rem)] rounded-[26px] border px-4 py-3 shadow-[0_14px_40px_rgba(0,0,0,0.14)] ${bubbleClass}`}
      >
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-slate-400">
          <span className={isUser ? "text-slate-200" : "text-slate-400"}>{roleLabel}</span>
          {!isUser && message.authorRole ? (
            <span className="text-[10px] text-slate-500">{message.authorRole}</span>
          ) : null}
          {message.teamLabel ? (
            <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-slate-300">
              {message.teamLabel}
            </span>
          ) : null}
        </div>
        <p className="whitespace-pre-wrap text-sm leading-6 [overflow-wrap:anywhere]">
          {message.content}
        </p>
        <p className="mt-1 text-right text-[11px] text-slate-500">{formatTime(message.createdAt)}</p>
      </div>
    </div>
  );
}
