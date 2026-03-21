"use client";

import { ArrowUpRight } from "lucide-react";
import { useRef } from "react";

import type { StringMode } from "@/components/chat-ui/types";

interface ChatInputProps {
  mode: StringMode;
  value: string;
  disabled?: boolean;
  onValueChange: (value: string) => void;
  onSend: () => void;
}

export function ChatInput({ mode, value, disabled, onValueChange, onSend }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const placeholder = mode === "discussion" ? "Type a message..." : "Define next step...";

  const handleValueChange = (nextValue: string) => {
    onValueChange(nextValue);
    if (!textareaRef.current) {
      return;
    }
    textareaRef.current.style.height = "0px";
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
  };

  return (
    <div className="shrink-0 border-t border-white/10 p-4 sm:p-6">
      <div className="mx-auto max-w-4xl rounded-2xl border border-white/10 bg-[#0f141b] p-2 shadow-[0_16px_36px_rgba(0,0,0,0.28)]">
        <div className="flex items-end gap-2">
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
            className="max-h-40 min-h-11 w-full resize-none bg-transparent px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500"
          />
          <button
            type="button"
            disabled={disabled || !value.trim()}
            onClick={onSend}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cyan-400 text-slate-950 transition hover:brightness-105 disabled:opacity-50"
            aria-label="Send message"
          >
            <ArrowUpRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
