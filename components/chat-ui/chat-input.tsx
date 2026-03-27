"use client";

import { ArrowUp, Check, ChevronDown, Loader2, Paperclip, UserRound, Users2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { StringMode } from "@/components/chat-ui/types";

interface AudienceOption {
  value: string;
  label: string;
  group: "General" | "Teams" | "People";
}

interface MentionSuggestion {
  id: string;
  handle: string;
  label: string;
  kind: "team" | "person";
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function optionTone(value: string) {
  if (value.startsWith("person:")) {
    return {
      border: "border-emerald-400/20",
      bg: "bg-emerald-400/10",
      text: "text-emerald-100"
    };
  }
  if (value.startsWith("team:")) {
    return {
      border: "border-cyan-400/20",
      bg: "bg-cyan-400/10",
      text: "text-cyan-100"
    };
  }
  return {
    border: "border-white/[0.08]",
    bg: "bg-white/[0.04]",
    text: "text-slate-200"
  };
}

function optionIcon(value: string) {
  if (value.startsWith("person:")) {
    return UserRound;
  }
  return Users2;
}

interface ChatInputProps {
  mode: StringMode;
  value: string;
  files: File[];
  audienceValue: string;
  audienceOptions: AudienceOption[];
  audienceLabel?: string | null;
  mentionSuggestions?: MentionSuggestion[];
  disabled?: boolean;
  sending?: boolean;
  onValueChange: (value: string) => void;
  onFilesAdd: (files: File[]) => void;
  onFileRemove: (index: number) => void;
  onAudienceChange: (value: string) => void;
  onInsertMention: (handle: string) => void;
  onSend: () => void;
}

export function ChatInput({
  mode,
  value,
  files,
  audienceValue,
  audienceOptions,
  audienceLabel,
  mentionSuggestions = [],
  disabled,
  sending,
  onValueChange,
  onFilesAdd,
  onFileRemove,
  onAudienceChange,
  onInsertMention,
  onSend
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const selectedAudienceOption =
    audienceOptions.find((option) => option.value === audienceValue) ?? audienceOptions[0] ?? null;
  const selectedTone = optionTone(audienceValue);
  const SelectedIcon = optionIcon(audienceValue);
  const groupedAudienceOptions = useMemo(
    () =>
      (["General", "Teams", "People"] as const)
        .map((group) => ({
          group,
          options: audienceOptions.filter((item) => item.group === group)
        }))
        .filter((entry) => entry.options.length > 0),
    [audienceOptions]
  );
  const placeholder =
    mode === "discussion"
      ? audienceLabel
        ? `Talk with ${audienceLabel}...`
        : "Discuss with your co-founder manager..."
      : audienceLabel
        ? `Turn this into direction for ${audienceLabel}...`
        : "Turn this discussion into direction...";

  const handleValueChange = (nextValue: string) => {
    onValueChange(nextValue);
    if (!textareaRef.current) {
      return;
    }
    textareaRef.current.style.height = "0px";
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
  };

  useEffect(() => {
    if (!pickerOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setPickerOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPickerOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [pickerOpen]);

  return (
    <div className="sticky bottom-0 z-10 shrink-0 border-t border-white/[0.06] bg-[#0f172a]/96 px-4 py-3 backdrop-blur sm:px-5">
      <div className="w-full rounded-[20px] border border-white/[0.08] bg-[#0b1220] p-2.5 shadow-[0_10px_24px_rgba(2,6,23,0.18)]">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
              Talk To
            </span>
            <div ref={pickerRef} className="relative">
              <button
                type="button"
                onClick={() => setPickerOpen((current) => !current)}
                disabled={disabled}
                className={`inline-flex min-h-9 items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left transition duration-200 disabled:opacity-60 ${selectedTone.border} ${selectedTone.bg} ${selectedTone.text} hover:bg-white/[0.08]`}
              >
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-black/10">
                  <SelectedIcon size={13} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[9px] uppercase tracking-[0.16em] text-slate-400">
                    {selectedAudienceOption?.group ?? "General"}
                  </span>
                  <span className="block max-w-[150px] truncate text-[13px] font-medium leading-4">
                    {selectedAudienceOption?.label ?? "Everyone"}
                  </span>
                </span>
                <ChevronDown
                  size={13}
                  className={`text-slate-400 transition duration-200 ${pickerOpen ? "rotate-180" : ""}`}
                />
              </button>

              {pickerOpen ? (
                <div className="absolute bottom-[calc(100%+8px)] left-0 z-30 w-[min(88vw,280px)] overflow-hidden rounded-[20px] border border-white/[0.08] bg-[#111a2d] shadow-[0_18px_48px_rgba(2,6,23,0.55)]">
                  <div className="border-b border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
                    <p className="text-[9px] uppercase tracking-[0.18em] text-slate-500">
                      Conversation Target
                    </p>
                    <p className="mt-1 text-xs text-slate-300">
                      Choose who this thread is currently aimed at.
                    </p>
                  </div>

                  <div className="vx-scrollbar max-h-[260px] overflow-y-auto p-2">
                    {groupedAudienceOptions.map((entry) => (
                      <div key={entry.group} className="pb-1.5 last:pb-0">
                        <p className="px-2 py-1.5 text-[9px] font-medium uppercase tracking-[0.16em] text-slate-500">
                          {entry.group}
                        </p>
                        <div className="space-y-1">
                          {entry.options.map((option) => {
                            const active = option.value === audienceValue;
                            const tone = optionTone(option.value);
                            const Icon = optionIcon(option.value);

                            return (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() => {
                                  onAudienceChange(option.value);
                                  setPickerOpen(false);
                                }}
                                className={`flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition duration-200 ${
                                  active
                                    ? `${tone.border} ${tone.bg}`
                                    : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]"
                                }`}
                              >
                                <span
                                  className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 ${
                                    active ? "bg-black/10 text-slate-100" : "bg-white/[0.04] text-slate-400"
                                  }`}
                                >
                                  <Icon size={14} />
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[13px] font-medium leading-4 text-slate-100">
                                    {option.label}
                                  </span>
                                  <span className="block text-[11px] text-slate-500">
                                    {option.group === "General"
                                      ? "Open group thread"
                                      : option.group === "Teams"
                                        ? "Route the conversation to this team"
                                        : "Focus the conversation on this person"}
                                  </span>
                                </span>
                                {active ? <Check size={14} className="shrink-0 text-slate-100" /> : null}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          <span className="text-[10px] text-slate-500">
            Use `@handle` to bring a teammate or team into the thread.
          </span>
        </div>

        {mentionSuggestions.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1.5 px-1">
            {mentionSuggestions.map((suggestion) => (
              <button
                key={suggestion.id}
                type="button"
                onClick={() => onInsertMention(suggestion.handle)}
                disabled={disabled}
                className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11px] text-slate-200 transition duration-200 hover:bg-white/[0.08] disabled:opacity-60"
              >
                @{suggestion.handle}
                <span className="ml-1 text-slate-400">({suggestion.label})</span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex items-end gap-3">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={(event) => {
              const selected = Array.from(event.target.files ?? []);
              if (selected.length > 0) {
                onFilesAdd(selected);
              }
              event.currentTarget.value = "";
            }}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] text-slate-300 transition duration-200 hover:bg-white/[0.08] hover:text-slate-100 disabled:opacity-50"
            aria-label="Attach files"
            title="Attach files"
          >
            <Paperclip size={15} />
          </button>
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
            className="max-h-36 min-h-[46px] w-full resize-none bg-transparent px-3 py-3 text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-500"
          />
          <button
            type="button"
            disabled={disabled || (!value.trim() && files.length === 0)}
            onClick={onSend}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-slate-950 transition duration-200 hover:bg-slate-100 disabled:opacity-50"
            aria-label="Send message"
          >
            {sending ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={15} />}
          </button>
        </div>
        {files.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5 px-3">
            {files.map((file, index) => (
              <span
                key={`${file.name}-${file.size}-${index}`}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-[11px] text-slate-200"
              >
                <Paperclip size={11} className="text-slate-400" />
                <span className="max-w-[11rem] truncate">{file.name}</span>
                <span className="text-slate-500">{formatFileSize(file.size)}</span>
                <button
                  type="button"
                  onClick={() => onFileRemove(index)}
                  disabled={disabled}
                  className="rounded-full p-0.5 text-slate-400 transition duration-200 hover:bg-white/[0.08] hover:text-slate-100 disabled:opacity-50"
                  aria-label={`Remove ${file.name}`}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <p className="px-3 pt-1.5 text-[10px] text-slate-500">
          Press Enter to send, Shift + Enter for a new line.
        </p>
      </div>
    </div>
  );
}
