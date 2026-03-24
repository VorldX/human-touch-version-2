"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUpRight,
  Clock3,
  FileText,
  MessageSquareText,
  Target,
  UserPlus,
  Users,
  X
} from "lucide-react";

import { ParticipantList } from "@/components/chat-ui/participant-list";
import { TeamSelector } from "@/components/chat-ui/team-selector";
import type { ChatString, Collaborator, Team } from "@/components/chat-ui/types";

interface StringPanelProps {
  open: boolean;
  chat: ChatString | null;
  stringDescription: string;
  stringParticipants: Collaborator[];
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
  canManageString?: boolean;
  canKillProcess?: boolean;
  actionInFlight?: "delete" | "kill" | null;
  onDeleteString?: () => void;
  onKillProcess?: () => void;
  variant?: "overlay" | "docked";
  className?: string;
  showCloseButton?: boolean;
}

function formatTimestamp(value?: string) {
  if (!value) {
    return "Not available";
  }
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? "Not available" : timestamp.toLocaleString();
}

function sourceLabel(source?: ChatString["source"]) {
  if (source === "direction") {
    return "Direction";
  }
  if (source === "plan") {
    return "Plan";
  }
  return "Workspace";
}

function modeLabel(mode?: ChatString["mode"]) {
  return mode === "direction" ? "Direction" : "Discussion";
}

function StringPanelContent({
  chat,
  stringDescription,
  stringParticipants,
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
  canManageString = false,
  canKillProcess = false,
  actionInFlight = null,
  onDeleteString,
  onKillProcess,
  onClose,
  showCloseButton = true
}: StringPanelProps) {
  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? null;
  const teamParticipants = selectedTeam
    ? collaborators.filter((participant) => selectedTeam.memberIds.includes(participant.id))
    : [];
  const messageCount = chat?.messages.length ?? 0;
  const details = [
    { label: "Created", value: formatTimestamp(chat?.createdAt) },
    { label: "Updated", value: formatTimestamp(chat?.updatedAt) },
    { label: "Mode", value: modeLabel(chat?.mode) },
    { label: "Source", value: sourceLabel(chat?.source) },
    { label: "Routed Team", value: selectedTeam?.name ?? chat?.selectedTeamLabel ?? "Not assigned" },
    { label: "Messages", value: `${messageCount}` }
  ];

  return (
    <div className="flex h-full min-h-0 flex-col rounded-[22px] border border-white/[0.06] bg-[#0f172a] p-4 shadow-[0_14px_36px_rgba(2,6,23,0.3)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500">
            String Panel
          </p>
          <h2 className="mt-1 text-lg font-semibold tracking-[-0.02em] text-slate-100">
            {chat?.title || "Untitled string"}
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-400">
            Review this string, its description, participants, and routing controls in one place.
          </p>
        </div>
        {showCloseButton ? (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.04] text-slate-300 transition duration-200 hover:bg-white/[0.08]"
            aria-label="Close string panel"
          >
            <X size={14} />
          </button>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[11px] text-slate-300">
          {stringParticipants.length} participant{stringParticipants.length === 1 ? "" : "s"}
        </span>
        <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[11px] text-slate-300">
          {messageCount} message{messageCount === 1 ? "" : "s"}
        </span>
        <span className="rounded-full border border-cyan-400/18 bg-cyan-400/10 px-3 py-1 text-[11px] text-cyan-100">
          {selectedTeam?.name ?? "No team routed"}
        </span>
      </div>

      <div className="vx-scrollbar mt-5 min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
        <section>
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
              <Clock3 size={12} />
              String Details
            </p>
            <span className="text-xs text-slate-500">{modeLabel(chat?.mode)}</span>
          </div>
          <div className="space-y-2">
            <div className="rounded-[20px] border border-white/[0.08] bg-white/[0.03] p-4">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
                String Name
              </p>
              <p className="mt-2 text-sm font-semibold text-slate-100">
                {chat?.title || "Untitled string"}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {details.map((item) => (
                <div
                  key={item.label}
                  className="rounded-[18px] border border-white/[0.08] bg-white/[0.03] px-3 py-3"
                >
                  <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
                    {item.label}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-slate-200 [overflow-wrap:anywhere]">
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
              <FileText size={12} />
              String Description
            </p>
            <span className="text-xs text-slate-500">
              {stringDescription ? "Derived from thread" : "Waiting for content"}
            </span>
          </div>
          <div className="rounded-[20px] border border-white/[0.08] bg-white/[0.03] p-4">
            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-300 [overflow-wrap:anywhere]">
              {stringDescription || "No string description is available yet."}
            </p>
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
              <Users size={12} />
              String Participants
            </p>
            <span className="text-xs text-slate-500">{stringParticipants.length}</span>
          </div>
          <ParticipantList participants={stringParticipants} />
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
              WorkForce Routing
            </p>
            <span className="text-xs text-slate-500">{teams.length} teams</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
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

          <div className="mt-4 rounded-[20px] border border-white/[0.08] bg-white/[0.03] p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
                Teams
              </p>
              <span className="text-xs text-slate-500">{teams.length}</span>
            </div>
            <div className="mt-3">
              <TeamSelector teams={teams} selectedTeamId={selectedTeamId} onSelect={onSelectTeam} />
            </div>
          </div>

          {selectedTeam ? (
            <div className="mt-4 rounded-[20px] border border-white/[0.08] bg-white/[0.03] p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
                  Routed Team Participants
                </p>
                <span className="text-xs text-slate-500">{teamParticipants.length}</span>
              </div>
              <p className="mt-2 text-sm text-slate-300">
                {selectedTeam.focus || "Route discussion or direction through this team."}
              </p>
              <div className="mt-3">
                <ParticipantList participants={teamParticipants} />
              </div>
            </div>
          ) : null}

          <div className="mt-4 rounded-[20px] border border-white/[0.08] bg-white/[0.03] p-4">
            <p className="text-sm font-semibold text-slate-100">
              {selectedTeam?.name ?? "Select a team"}
            </p>
            <p className="mt-1 text-sm leading-6 text-slate-400">
              {selectedTeam?.focus ||
                "Choose a team when you want to route this string for discussion or direction."}
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

        {chat?.persisted ? (
          <section>
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
                Creator Controls
              </p>
              <span className="text-xs text-slate-500">
                {canManageString ? "Creator access" : "Creator only"}
              </span>
            </div>
            <div className="rounded-[20px] border border-white/[0.08] bg-white/[0.03] p-4">
              <p className="text-sm leading-6 text-slate-400">
                Delete this string or kill its linked process. These actions are available only to
                the string creator.
              </p>
              <div className="mt-4 grid gap-2.5">
                <button
                  type="button"
                  onClick={onKillProcess}
                  disabled={!canManageString || !canKillProcess || actionInFlight !== null}
                  className="inline-flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-100 transition duration-200 hover:bg-amber-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span>{actionInFlight === "kill" ? "Killing Process..." : "Kill Process"}</span>
                  <span className="text-[10px] uppercase tracking-[0.14em]">
                    {canKillProcess ? "Linked" : "No Process"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={onDeleteString}
                  disabled={!canManageString || actionInFlight !== null}
                  className="inline-flex items-center justify-between rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-100 transition duration-200 hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span>{actionInFlight === "delete" ? "Deleting String..." : "Delete String"}</span>
                  <span className="text-[10px] uppercase tracking-[0.14em]">Creator</span>
                </button>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

export function StringPanel(props: StringPanelProps) {
  const {
    variant = "overlay",
    className = "",
    showCloseButton = variant === "overlay"
  } = props;

  if (variant === "docked") {
    if (!props.open) {
      return null;
    }

    return (
      <aside className={`h-full min-h-0 ${className}`}>
        <StringPanelContent {...props} showCloseButton={showCloseButton} />
      </aside>
    );
  }

  return (
    <AnimatePresence>
      {props.open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className={`fixed inset-0 z-50 bg-black/55 backdrop-blur-[1px] ${className}`}
          onClick={props.onClose}
        >
          <motion.aside
            initial={{ x: 360 }}
            animate={{ x: 0 }}
            exit={{ x: 360 }}
            transition={{ type: "spring", stiffness: 280, damping: 30 }}
            className="ml-auto h-full w-[min(92vw,380px)] p-2.5 sm:p-3"
            onClick={(event) => event.stopPropagation()}
          >
            <StringPanelContent {...props} showCloseButton={showCloseButton} />
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
