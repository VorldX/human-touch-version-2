"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Users, X } from "lucide-react";

import { ParticipantList } from "@/components/chat-ui/participant-list";
import type { Collaborator } from "@/components/chat-ui/types";

interface CollaborationPanelProps {
  open: boolean;
  participants: Collaborator[];
  onClose: () => void;
}

function CollaborationPanelContent({ participants, onClose }: CollaborationPanelProps) {
  const representedTeams = [...new Set(participants.flatMap((participant) => participant.teamNames ?? []))];

  return (
    <div className="flex h-full min-h-0 flex-col rounded-[22px] border border-white/[0.06] bg-[#0f172a] p-4 shadow-[0_14px_36px_rgba(2,6,23,0.3)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500">
            Workforce Collaborations
          </p>
          <h2 className="mt-1 text-lg font-semibold tracking-[-0.02em] text-slate-100">
            String Participants
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-400">
            Review the people involved in this string. Team tags show where each participant belongs.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.04] text-slate-300 transition duration-200 hover:bg-white/[0.08]"
        >
          <X size={14} />
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[11px] text-slate-300">
          {participants.length} participant{participants.length === 1 ? "" : "s"}
        </span>
        <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[11px] text-slate-300">
          {representedTeams.length} team{representedTeams.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="vx-scrollbar mt-5 min-h-0 flex-1 overflow-y-auto pr-1">
        <section>
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
              <Users size={12} />
              String Participants
            </p>
            <span className="text-xs text-slate-500">{participants.length}</span>
          </div>
          <ParticipantList participants={participants} />
        </section>
      </div>
    </div>
  );
}

export function CollaborationPanel(props: CollaborationPanelProps) {
  return (
    <AnimatePresence>
      {props.open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[1px]"
          onClick={props.onClose}
        >
          <motion.aside
            initial={{ x: 320 }}
            animate={{ x: 0 }}
            exit={{ x: 320 }}
            transition={{ type: "spring", stiffness: 280, damping: 30 }}
            className="ml-auto h-full w-[min(88vw,300px)] p-2.5 sm:p-3"
            onClick={(event) => event.stopPropagation()}
          >
            <CollaborationPanelContent {...props} />
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
