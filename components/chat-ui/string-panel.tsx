"use client";

import { useEffect, useMemo, useState } from "react";

import { AnimatePresence, motion } from "framer-motion";
import { Clock3, FileText, Plus, Users, X } from "lucide-react";

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
  linkedTeamIds: string[];
  linkedParticipantIds: string[];
  onAddTeam: (teamId: string) => void;
  onRemoveTeam: (teamId: string) => void;
  onAddParticipant: (participantId: string) => void;
  onRemoveParticipant: (participantId: string) => void;
  onClose: () => void;
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

function statusLabel(chat: ChatString | null) {
  if (!chat) {
    return "Draft";
  }
  if (chat.planId) {
    return "Planning";
  }
  if (chat.directionId) {
    return "Direction Ready";
  }
  if (chat.mode === "direction") {
    return "Direction Draft";
  }
  if (chat.messages.length > 0) {
    return "Discussion";
  }
  return "Draft";
}

function StringPanelContent({
  chat,
  stringDescription,
  stringParticipants,
  collaborators,
  teams,
  selectedTeamId,
  linkedTeamIds,
  linkedParticipantIds,
  onAddTeam,
  onRemoveTeam,
  onAddParticipant,
  onRemoveParticipant,
  canManageString = false,
  canKillProcess = false,
  actionInFlight = null,
  onDeleteString,
  onKillProcess,
  onClose,
  showCloseButton = true
}: StringPanelProps) {
  const currentTeam = teams.find((team) => team.id === selectedTeamId) ?? null;
  const linkedTeams = useMemo(
    () =>
      linkedTeamIds
        .map((teamId) => teams.find((team) => team.id === teamId) ?? null)
        .filter((team): team is Team => Boolean(team)),
    [linkedTeamIds, teams]
  );
  const directParticipants = useMemo(
    () =>
      linkedParticipantIds
        .map((participantId) =>
          collaborators.find((participant) => participant.id === participantId) ?? null
        )
        .filter((participant): participant is Collaborator => Boolean(participant)),
    [collaborators, linkedParticipantIds]
  );
  const availableParticipants = useMemo(
    () =>
      collaborators.filter((participant) => !linkedParticipantIds.includes(participant.id)),
    [collaborators, linkedParticipantIds]
  );
  const [teamPickerId, setTeamPickerId] = useState<string>("");
  const [participantPickerId, setParticipantPickerId] = useState<string>("");
  const messageCount = chat?.messages.length ?? 0;
  const stringStatus = statusLabel(chat);
  const details = [
    { label: "Created", value: formatTimestamp(chat?.createdAt) },
    { label: "Updated", value: formatTimestamp(chat?.updatedAt) },
    { label: "Status", value: stringStatus },
    { label: "Source", value: sourceLabel(chat?.source) },
    { label: "Team", value: currentTeam?.name ?? chat?.selectedTeamLabel ?? "Not assigned" },
    {
      label: "Conversation Target",
      value:
        chat?.activeAudience?.kind && chat.activeAudience.kind !== "everyone"
          ? chat.activeAudience.label ?? chat.activeAudience.kind
          : "Everyone"
    },
    { label: "Messages", value: `${messageCount}` }
  ];

  useEffect(() => {
    const fallbackTeamId = selectedTeamId ?? linkedTeams[0]?.id ?? teams[0]?.id ?? "";
    if (!fallbackTeamId) {
      setTeamPickerId("");
      return;
    }
    if (!teams.some((team) => team.id === teamPickerId)) {
      setTeamPickerId(fallbackTeamId);
    }
  }, [linkedTeams, selectedTeamId, teamPickerId, teams]);

  useEffect(() => {
    if (!availableParticipants.some((participant) => participant.id === participantPickerId)) {
      setParticipantPickerId(availableParticipants[0]?.id ?? "");
    }
  }, [availableParticipants, participantPickerId]);

  const selectedPickerTeam = teams.find((team) => team.id === teamPickerId) ?? null;
  const canAddSelectedTeam =
    Boolean(selectedPickerTeam) && !linkedTeamIds.includes(selectedPickerTeam?.id ?? "");

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
            Review this string, its description, participants, and collaboration context in one place.
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
          {currentTeam?.name ?? chat?.selectedTeamLabel ?? "No team selected"}
        </span>
      </div>

      <div className="vx-scrollbar mt-5 min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
        <section>
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
              <Clock3 size={12} />
              String Details
            </p>
            <span className="text-xs text-slate-500">{stringStatus}</span>
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
          <ParticipantList
            participants={stringParticipants}
            onRemoveParticipant={onRemoveParticipant}
          />
          <p className="mt-2 text-[11px] leading-5 text-slate-500">
            Remove a participant here to hide that person from this string, even if they came from a linked team.
          </p>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
              Workforce Collaborations
            </p>
            <span className="text-xs text-slate-500">{linkedTeams.length} linked team{linkedTeams.length === 1 ? "" : "s"}</span>
          </div>

          <div className="space-y-4">
            <div className="rounded-[20px] border border-white/[0.08] bg-white/[0.03] p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
                  Teams
                </p>
                <span className="text-xs text-slate-500">{teams.length}</span>
              </div>
              <div className="mt-3">
                <TeamSelector
                  teams={teams}
                  selectedTeamId={teamPickerId || null}
                  onSelect={setTeamPickerId}
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  if (teamPickerId) {
                    onAddTeam(teamPickerId);
                  }
                }}
                disabled={!canAddSelectedTeam}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-3 py-2.5 text-xs font-semibold text-cyan-100 transition duration-200 hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus size={14} />
                {selectedPickerTeam && linkedTeamIds.includes(selectedPickerTeam.id)
                  ? "Team Already Added"
                  : "Add Selected Team"}
              </button>
            </div>

            <div className="rounded-[20px] border border-white/[0.08] bg-white/[0.03] p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
                  Linked Teams
                </p>
                <span className="text-xs text-slate-500">{linkedTeams.length}</span>
              </div>
              {linkedTeams.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {linkedTeams.map((team) => (
                    <span
                      key={team.id}
                      className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1.5 text-[11px] text-cyan-100"
                    >
                      {team.name}
                      <button
                        type="button"
                        onClick={() => onRemoveTeam(team.id)}
                        className="rounded-full border border-cyan-400/20 bg-black/10 p-0.5 text-cyan-100 transition duration-200 hover:bg-black/20"
                        aria-label={`Remove ${team.name} from string`}
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm leading-6 text-slate-500">
                  No teams linked to this string yet.
                </p>
              )}
            </div>

            <div className="rounded-[20px] border border-white/[0.08] bg-white/[0.03] p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
                  Direct Members
                </p>
                <span className="text-xs text-slate-500">{directParticipants.length}</span>
              </div>
              <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <select
                  value={participantPickerId}
                  onChange={(event) => setParticipantPickerId(event.target.value)}
                  className="min-w-0 rounded-xl border border-white/[0.08] bg-[#0b1220] px-3 py-2.5 text-sm text-slate-100 outline-none transition duration-200 focus:border-cyan-400/30"
                >
                  {availableParticipants.length === 0 ? (
                    <option value="">No members available</option>
                  ) : null}
                  {availableParticipants.map((participant) => (
                    <option key={participant.id} value={participant.id}>
                      {participant.name} | {participant.role || "Contributor"}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    if (participantPickerId) {
                      onAddParticipant(participantPickerId);
                    }
                  }}
                  disabled={!participantPickerId}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2.5 text-xs font-semibold text-emerald-100 transition duration-200 hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus size={14} />
                  Add Member
                </button>
              </div>
              {directParticipants.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {directParticipants.map((participant) => (
                    <span
                      key={participant.id}
                      className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-[11px] text-emerald-100"
                    >
                      {participant.name}
                      <button
                        type="button"
                        onClick={() => onRemoveParticipant(participant.id)}
                        className="rounded-full border border-emerald-400/20 bg-black/10 p-0.5 text-emerald-100 transition duration-200 hover:bg-black/20"
                        aria-label={`Remove ${participant.name} from string`}
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm leading-6 text-slate-500">
                  No direct members linked yet.
                </p>
              )}
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
