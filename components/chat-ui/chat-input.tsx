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
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
  };

  return (
    <div className="sticky bottom-0 z-10 shrink-0 border-t border-white/[0.06] bg-[#0f172a]/96 px-4 py-4 backdrop-blur sm:px-5">
      <div className="w-full rounded-[22px] border border-white/[0.08] bg-[#0b1220] p-3 shadow-[0_10px_24px_rgba(2,6,23,0.18)]">
        <div className="flex items-end gap-3">
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
            className="max-h-44 min-h-[60px] w-full resize-none bg-transparent px-4 py-4 text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-500"
          />
          <button
            type="button"
            disabled={disabled || !value.trim()}
            onClick={onSend}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-slate-950 transition duration-200 hover:bg-slate-100 disabled:opacity-50"
            aria-label="Send message"
          >
            {sending ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={16} />}
          </button>
        </div>
        <p className="px-4 pt-2 text-[11px] text-slate-500">
          Press Enter to send, Shift + Enter for a new line.
        </p>
      </div>
    </div>
  );
}
