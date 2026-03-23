"use client";

import { ArrowUp, Loader2 } from "lucide-react";
import { useRef } from "react";

import type { StringMode } from "@/components/chat-ui/types";

interface ChatInputProps {
  mode: StringMode;
  value: string;
  disabled?: boolean;
  sending?: boolean;
  onValueChange: (value: string) => void;
  onSend: () => void;
}

export function ChatInput({
  mode,
  value,
  disabled,
  sending,
  onValueChange,
  onSend
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const placeholder =
    mode === "discussion"
      ? "Discuss with your co-founder manager..."
      : "Turn this discussion into direction...";

  const handleValueChange = (nextValue: string) => {
    onValueChange(nextValue);
    if (!textareaRef.current) {
      return;
    }
    textareaRef.current.style.height = "0px";
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
  };

  return (
    <div className="shrink-0 border-t border-white/10 px-3 py-3 sm:px-6 sm:py-5">
      <div className="mx-auto max-w-4xl rounded-[24px] border border-white/10 bg-[#111827]/90 p-2.5 shadow-[0_18px_50px_rgba(0,0,0,0.18)] sm:rounded-[28px] sm:p-3">
        <div className="flex items-end gap-2.5 sm:gap-3">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => handleValueChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSend();
              }
            }}
            disabled={disabled}
            placeholder={placeholder}
            rows={1}
            className="max-h-40 min-h-11 w-full resize-none bg-transparent px-3 py-2 text-[13px] text-slate-100 outline-none placeholder:text-slate-500 sm:min-h-12 sm:text-sm"
          />
          <button
            type="button"
            disabled={disabled || !value.trim()}
            onClick={onSend}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-slate-950 transition hover:scale-[1.01] disabled:opacity-50 sm:h-11 sm:w-11"
            aria-label="Send message"
          >
            {sending ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={16} />}
          </button>
        </div>
        <p className="px-3 pt-2 text-[11px] text-slate-500 sm:text-xs">
          Press Enter to send, Shift + Enter for a new line.
        </p>
      </div>
    </div>
  );
}
