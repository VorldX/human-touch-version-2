"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, MessageSquareText, Target, UserPlus, Users, X } from "lucide-react";

import { ParticipantList } from "@/components/chat-ui/participant-list";
import { TeamSelector } from "@/components/chat-ui/team-selector";
import type { Collaborator, Team } from "@/components/chat-ui/types";

interface CollaborationPanelProps {
  open: boolean;
  collaborators: Collaborator[];
  teams: Team[];
  selectedTeamId: string | null;
  onSelectTeam: (teamId: string) => void;
  onClose: () => void;
  onSendToTeam: () => void;
  onDiscussWithTeam: () => void;
  onSetDirection: () => void;
  onOpenAddMember: () => void;
  onOpenCreateTeam: () => void;
  canSendToTeam: boolean;
  sending: boolean;
}

function CollaborationPanelContent({
  collaborators,
  teams,
  selectedTeamId,
  onSelectTeam,
  onSendToTeam,
  onDiscussWithTeam,
  onSetDirection,
  onOpenAddMember,
  onOpenCreateTeam,
  canSendToTeam,
  sending,
  onClose
}: CollaborationPanelProps) {
  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? null;
  const visibleParticipants = selectedTeam
    ? collaborators.filter((participant) => selectedTeam.memberIds.includes(participant.id))
    : collaborators;

  return (
    <div className="flex h-full min-h-0 flex-col rounded-[22px] border border-white/[0.06] bg-[#0f172a] p-4 shadow-[0_14px_36px_rgba(2,6,23,0.3)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500">
            Collaboration
          </p>
          <h2 className="mt-1 text-lg font-semibold tracking-[-0.02em] text-slate-100">
            Routing
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-400">
            Pick a team, review participants, and route this string when needed.
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
          {visibleParticipants.length} active
        </span>
        <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[11px] text-slate-300">
          {teams.length} team{teams.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onOpenAddMember}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 text-xs font-semibold text-slate-100 transition duration-200 hover:bg-white/[0.08]"
        >
          <UserPlus size={14} />
          Add Member
        </button>
        <button
          type="button"
          onClick={onOpenCreateTeam}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-400/18 bg-cyan-400/10 px-3 py-2.5 text-xs font-semibold text-cyan-100 transition duration-200 hover:bg-cyan-400/15"
        >
          <Users size={14} />
          Create Team
        </button>
      </div>

      <div className="vx-scrollbar mt-5 min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
        <section>
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
              Active Participants
            </p>
            <span className="text-xs text-slate-500">{visibleParticipants.length}</span>
          </div>
          <ParticipantList participants={visibleParticipants} />
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
              Teams
            </p>
            <span className="text-xs text-slate-500">{teams.length}</span>
          </div>
          <TeamSelector teams={teams} selectedTeamId={selectedTeamId} onSelect={onSelectTeam} />
        </section>

        <section>
          <p className="mb-3 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
            Interaction Controls
          </p>
          <div className="rounded-[20px] border border-white/[0.08] bg-white/[0.03] p-4">
            <p className="text-sm font-semibold text-slate-100">
              {selectedTeam?.name ?? "Select a team"}
            </p>
            <p className="mt-1 text-sm leading-6 text-slate-400">
              {selectedTeam?.focus ??
                "Choose a collaboration team to route discussion or direction for this string."}
            </p>

            <div className="mt-4 grid gap-2.5">
              <button
                type="button"
                onClick={onSendToTeam}
                disabled={!canSendToTeam || sending}
                className="inline-flex items-center justify-between rounded-xl border border-white/[0.08] bg-white px-4 py-3 text-sm font-semibold text-slate-950 transition duration-200 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span>Send to Team</span>
                <ArrowUpRight size={16} />
              </button>
              <button
                type="button"
                onClick={onDiscussWithTeam}
                className="inline-flex items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-sm font-semibold text-slate-100 transition duration-200 hover:bg-white/[0.08]"
              >
                <span>Discuss with Team</span>
                <MessageSquareText size={16} />
              </button>
              <button
                type="button"
                onClick={onSetDirection}
                className="inline-flex items-center justify-between rounded-xl border border-amber-300/18 bg-amber-300/10 px-4 py-3 text-sm font-semibold text-amber-50 transition duration-200 hover:bg-amber-300/15"
              >
                <span>Set Direction</span>
                <Target size={16} />
              </button>
            </div>
          </div>
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
