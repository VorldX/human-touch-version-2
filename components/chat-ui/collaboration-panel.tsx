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
    <div className="flex h-full min-h-0 flex-col rounded-[24px] border border-white/10 bg-[#121826]/90 p-3 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur sm:rounded-[28px] sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Right Panel</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-100">Collaboration</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-black/15 text-slate-300 transition hover:bg-white/[0.05] xl:hidden"
        >
          <X size={14} />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onOpenAddMember}
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/15 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:bg-white/[0.06]"
        >
          <UserPlus size={14} />
          Add Member
        </button>
        <button
          type="button"
          onClick={onOpenCreateTeam}
          className="inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-400/15"
        >
          <Users size={14} />
          Create Team
        </button>
      </div>

      <div className="vx-scrollbar mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
        <section>
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Active Participants</p>
            <span className="text-xs text-slate-500">{visibleParticipants.length}</span>
          </div>
          <ParticipantList participants={visibleParticipants} />
        </section>

        <section className="mt-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Teams</p>
            <span className="text-xs text-slate-500">{teams.length}</span>
          </div>
          <TeamSelector teams={teams} selectedTeamId={selectedTeamId} onSelect={onSelectTeam} />
        </section>

        <section className="mt-5">
          <p className="mb-3 text-xs uppercase tracking-[0.16em] text-slate-500">Interaction Controls</p>
          <div className="rounded-[24px] border border-white/10 bg-black/15 p-4">
            <p className="text-sm font-semibold text-slate-100">
              {selectedTeam?.name ?? "Select a team"}
            </p>
            <p className="mt-1 text-sm text-slate-400">
              {selectedTeam?.focus ?? "Choose a collaboration team to route discussion or direction."}
            </p>

            <div className="mt-4 grid gap-2">
              <button
                type="button"
                onClick={onSendToTeam}
                disabled={!canSendToTeam || sending}
                className="inline-flex items-center justify-between rounded-2xl border border-white/10 bg-white px-4 py-3 text-sm font-medium text-slate-950 transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span>Send to Team</span>
                <ArrowUpRight size={16} />
              </button>
              <button
                type="button"
                onClick={onDiscussWithTeam}
                className="inline-flex items-center justify-between rounded-2xl border border-white/10 bg-black/10 px-4 py-3 text-sm font-medium text-slate-100 transition hover:bg-white/[0.05]"
              >
                <span>Discuss with Team</span>
                <MessageSquareText size={16} />
              </button>
              <button
                type="button"
                onClick={onSetDirection}
                className="inline-flex items-center justify-between rounded-2xl border border-amber-200/20 bg-amber-300/10 px-4 py-3 text-sm font-medium text-amber-50 transition hover:bg-amber-300/15"
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
    <>
      <aside className="hidden h-full w-[280px] shrink-0 xl:block 2xl:w-[300px]">
        <CollaborationPanelContent {...props} />
      </aside>

      <AnimatePresence>
        {props.open ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[1px] xl:hidden"
            onClick={props.onClose}
          >
            <motion.aside
              initial={{ x: 320 }}
              animate={{ x: 0 }}
              exit={{ x: 320 }}
              transition={{ type: "spring", stiffness: 260, damping: 28 }}
              className="ml-auto h-full w-[min(92vw,340px)] p-2.5 sm:p-3"
              onClick={(event) => event.stopPropagation()}
            >
              <CollaborationPanelContent {...props} />
            </motion.aside>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
