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
  const bubbleClass = message.error
    ? "border-rose-500/20 bg-rose-500/10 text-rose-100"
    : isUser
      ? mode === "direction"
        ? "border-amber-300/18 bg-amber-300/10 text-amber-50"
        : "border-cyan-400/18 bg-cyan-400/10 text-slate-50"
      : "border-white/[0.06] bg-white/[0.04] text-slate-200";
  const roleLabel = isUser
    ? "You"
    : message.authorName || (message.error ? "System" : "Main Agent");
  const audienceLabel =
    message.audience && message.audience.kind !== "everyone"
      ? message.audience.label || message.audience.kind
      : null;
  const showTeamLabel = Boolean(message.teamLabel && message.teamLabel !== audienceLabel);

  return (
    <div className={`flex w-full ${wrapperClass}`}>
      <article
        className={`max-w-[88%] rounded-[20px] border px-4 py-3.5 sm:max-w-[72%] xl:max-w-[68%] ${bubbleClass}`}
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className={`text-[11px] font-semibold ${isUser ? "text-slate-100" : "text-slate-300"}`}>
              {roleLabel}
            </span>
            {!isUser && message.authorRole ? (
              <span className="text-[10px] text-slate-500">{message.authorRole}</span>
            ) : null}
            {showTeamLabel ? (
              <span className="rounded-full border border-white/[0.08] bg-black/10 px-2 py-0.5 text-[10px] text-slate-300">
                {message.teamLabel}
              </span>
            ) : null}
          </div>
          <time className="shrink-0 text-[10px] text-slate-500">{formatTime(message.createdAt)}</time>
        </div>
        {audienceLabel || (message.mentions?.length ?? 0) > 0 ? (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {audienceLabel ? (
              <span className="rounded-full border border-white/[0.08] bg-black/10 px-2 py-0.5 text-[10px] text-slate-300">
                To {audienceLabel}
              </span>
            ) : null}
            {message.mentions?.map((mention) => (
              <span
                key={`${message.id}:${mention.kind}:${mention.id}`}
                className="rounded-full border border-white/[0.08] bg-black/10 px-2 py-0.5 text-[10px] text-slate-300"
              >
                @{mention.handle}
              </span>
            ))}
          </div>
        ) : null}
        <p className="whitespace-pre-wrap text-sm leading-6 [overflow-wrap:anywhere]">
          {message.content}
        </p>
      </article>
    </div>
  );
}
