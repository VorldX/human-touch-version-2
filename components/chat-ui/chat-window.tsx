"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef } from "react";

import { DirectionBlock } from "@/components/chat-ui/direction-block";
import { MessageBubble } from "@/components/chat-ui/message-bubble";
import type { ChatMessage, StringMode } from "@/components/chat-ui/types";

interface ChatWindowProps {
  mode: StringMode;
  messages: ChatMessage[];
  isResponding?: boolean;
}

export function ChatWindow({ mode, messages, isResponding = false }: ChatWindowProps) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    const behavior = mountedRef.current ? "smooth" : "auto";
    endRef.current?.scrollIntoView({ behavior, block: "end" });
    mountedRef.current = true;
  }, [isResponding, messages.length, mode]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-start px-4 py-5 sm:px-5 sm:py-6">
        <div className="max-w-xl rounded-[22px] border border-white/[0.06] bg-white/[0.03] px-5 py-5">
          <p className="text-sm font-semibold text-slate-100">
            {mode === "discussion" ? "Start a discussion" : "Shape the direction"}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            {mode === "discussion"
              ? "Talk with your co-founder manager here, refine the scope, and then switch into direction without losing the thread."
              : "Direction builds on the same discussion and turns it into a structured execution plan for the selected team."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="vx-scrollbar flex-1 overflow-y-auto scroll-pb-32 px-4 py-4 sm:px-5 sm:py-5">
      <div className="flex w-full flex-col gap-4">
        <AnimatePresence initial={false}>
          {messages.map((message) => (
            <motion.div
              key={message.id}
              layout
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              {mode === "direction" && message.role !== "user" ? (
                <div className="flex justify-start">
                  <DirectionBlock message={message} />
                </div>
              ) : (
                <MessageBubble message={message} mode={mode} />
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        {isResponding ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex justify-start"
          >
            <div className="max-w-[88%] rounded-[20px] border border-white/[0.06] bg-white/[0.04] px-4 py-3">
              {mode === "direction" ? (
                <div className="space-y-3">
                  <div className="h-3 w-32 animate-pulse rounded-full bg-amber-200/25" />
                  <div className="h-4 w-64 animate-pulse rounded-full bg-white/10" />
                  <div className="grid gap-2">
                    <div className="h-20 animate-pulse rounded-[20px] bg-white/[0.05]" />
                    <div className="h-20 animate-pulse rounded-[20px] bg-white/[0.05]" />
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-slate-300" />
                    <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-slate-400 [animation-delay:120ms]" />
                    <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-slate-500 [animation-delay:240ms]" />
                  </div>
                  <span className="text-sm text-slate-400">AI is thinking...</span>
                </div>
              )}
            </div>
          </motion.div>
        ) : null}

        <div ref={endRef} className="h-4" />
      </div>
    </div>
  );
}
