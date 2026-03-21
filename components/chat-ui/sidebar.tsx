"use client";

import { AnimatePresence, motion } from "framer-motion";
import { PlusCircle, Search, X } from "lucide-react";

import { StringList } from "@/components/chat-ui/string-list";
import type { ChatString } from "@/components/chat-ui/types";

interface SidebarProps {
  sidebarOpen: boolean;
  searchQuery: string;
  strings: ChatString[];
  selectedStringId: string | null;
  onSearchQueryChange: (value: string) => void;
  onSelectString: (stringId: string) => void;
  onNewString: () => void;
  onCloseMobile: () => void;
}

export function Sidebar({
  sidebarOpen,
  searchQuery,
  strings,
  selectedStringId,
  onSearchQueryChange,
  onSelectString,
  onNewString,
  onCloseMobile
}: SidebarProps) {
  const sidebarContent = (
    <div className="flex h-full flex-col rounded-2xl border border-white/10 bg-[#0f141b] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.35)]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-100">Strings</h2>
        <button
          type="button"
          onClick={onNewString}
          className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/35 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-300 transition hover:bg-cyan-500/20"
        >
          <PlusCircle size={14} />
          New
        </button>
      </div>

      <label className="mt-3 flex items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-3 py-2">
        <Search size={14} className="text-slate-500" />
        <input
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder="Search strings..."
          className="w-full bg-transparent text-sm text-slate-200 outline-none placeholder:text-slate-500"
        />
      </label>

      <div className="vx-scrollbar mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
        <StringList
          items={strings}
          selectedStringId={selectedStringId}
          onSelectString={onSelectString}
        />
      </div>
    </div>
  );

  return (
    <>
      <motion.aside
        initial={false}
        animate={{ width: sidebarOpen ? 320 : 0, opacity: sidebarOpen ? 1 : 0 }}
        transition={{ type: "spring", stiffness: 240, damping: 28 }}
        className="hidden h-full shrink-0 overflow-hidden lg:block"
      >
        <div className="h-full p-3">{sidebarContent}</div>
      </motion.aside>

      <AnimatePresence>
        {sidebarOpen ? (
          <motion.div
            key="mobile-sidebar"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[1px] lg:hidden"
            onClick={onCloseMobile}
          >
            <motion.aside
              initial={{ x: -320 }}
              animate={{ x: 0 }}
              exit={{ x: -320 }}
              transition={{ type: "spring", stiffness: 260, damping: 28 }}
              className="h-full w-[min(88vw,320px)] p-3"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-2 flex items-center justify-end">
                <button
                  type="button"
                  onClick={onCloseMobile}
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
