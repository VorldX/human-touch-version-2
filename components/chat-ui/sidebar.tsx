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
    <div className="flex h-full min-h-0 flex-col rounded-[24px] border border-white/10 bg-[#121826]/90 p-3 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur sm:rounded-[28px] sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">History</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-100">Strings</h2>
        </div>
        <button
          type="button"
          onClick={onNewChat}
          className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 text-sm font-medium text-slate-950 transition hover:scale-[1.01] sm:px-4"
        >
          <Plus size={16} />
          New String
        </button>
      </div>

      <label className="mt-4 flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
        <Search size={14} className="text-slate-500" />
        <input
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder="Search strings..."
          className="w-full bg-transparent text-sm text-slate-200 outline-none placeholder:text-slate-500"
        />
      </label>

      <div className="vx-scrollbar mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {chats.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 px-4 py-5 text-sm text-slate-500">
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
    <>
      <aside className="hidden h-full w-[240px] shrink-0 lg:block 2xl:w-[260px]">{sidebarContent}</aside>

      <AnimatePresence>
        {open ? (
          <motion.div
            key="mobile-sidebar"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[1px] lg:hidden"
            onClick={onClose}
          >
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: "spring", stiffness: 260, damping: 28 }}
              className="h-full w-[min(92vw,320px)] p-2.5 sm:p-3"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-black/25 text-slate-300 transition hover:bg-black/40"
                >
                  <X size={14} />
                </button>
              </div>
              {sidebarContent}
            </motion.aside>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
