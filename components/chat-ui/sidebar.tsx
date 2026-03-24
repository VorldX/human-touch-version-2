"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Plus, Search, X } from "lucide-react";

import { ChatHistoryItem } from "@/components/chat-ui/chat-history-item";
import type { ChatString } from "@/components/chat-ui/types";

interface SidebarProps {
  open: boolean;
  searchQuery: string;
  chats: ChatString[];
  activeChatId: string | null;
  onSearchQueryChange: (value: string) => void;
  onSelectChat: (chatId: string) => void;
  onNewChat: () => void;
  onClose: () => void;
}

export function Sidebar({
  open,
  searchQuery,
  chats,
  activeChatId,
  onSearchQueryChange,
  onSelectChat,
  onNewChat,
  onClose
}: SidebarProps) {
  const sidebarContent = (
    <div className="flex h-full min-h-0 flex-col rounded-[22px] border border-white/[0.06] bg-[#0f172a] p-3.5 shadow-[0_14px_36px_rgba(2,6,23,0.3)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500">
            History
          </p>
          <h2 className="mt-1 text-lg font-semibold tracking-[-0.02em] text-slate-100">
            Strings
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onNewChat}
            className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-slate-950 transition duration-200 hover:bg-slate-100"
          >
            <Plus size={14} />
            New
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.04] text-slate-300 transition duration-200 hover:bg-white/[0.08]"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <label className="mt-3 flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 transition duration-200 focus-within:border-white/[0.12] focus-within:bg-white/[0.05]">
        <Search size={14} className="text-slate-500" />
        <input
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder="Search strings..."
          className="w-full bg-transparent text-sm text-slate-200 outline-none placeholder:text-slate-500"
        />
      </label>

      <div className="vx-scrollbar mt-4 min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1">
        {chats.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] px-4 py-5 text-sm leading-6 text-slate-500">
            No strings found.
          </div>
        ) : (
          chats.map((chat) => (
            <ChatHistoryItem
              key={chat.id}
              chat={chat}
              active={chat.id === activeChatId}
              onSelect={onSelectChat}
            />
          ))
        )}
      </div>
    </div>
  );

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="sidebar-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[1px]"
          onClick={onClose}
        >
          <motion.aside
            initial={{ x: -320 }}
            animate={{ x: 0 }}
            exit={{ x: -320 }}
            transition={{ type: "spring", stiffness: 280, damping: 30 }}
            className="h-full w-[min(86vw,240px)] p-2.5 sm:p-3"
            onClick={(event) => event.stopPropagation()}
          >
            {sidebarContent}
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
