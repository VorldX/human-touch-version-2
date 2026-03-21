"use client";

import { motion } from "framer-motion";

import { DirectionBlock } from "@/components/chat-ui/direction-block";
import { MessageBubble } from "@/components/chat-ui/message-bubble";
import type { ChatMessage, StringMode } from "@/components/chat-ui/types";

interface ChatWindowProps {
  mode: StringMode;
  messages: ChatMessage[];
}

export function ChatWindow({ mode, messages }: ChatWindowProps) {
  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-md rounded-2xl border border-dashed border-white/15 bg-black/20 px-6 py-10 text-center">
          <p className="text-sm font-semibold text-slate-200">No messages yet</p>
          <p className="mt-2 text-sm text-slate-500">
            {mode === "discussion"
              ? "Start a conversation in discussion mode."
              : "Start by defining the next step in direction mode."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="vx-scrollbar flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        {messages.map((message) => (
          <motion.div
            key={message.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="space-y-3"
          >
            {mode === "direction" && message.direction ? (
              <DirectionBlock message={message} />
            ) : (
              <MessageBubble message={message} mode={mode} />
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}
