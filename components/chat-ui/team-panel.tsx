"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, Plus, UserPlus, Users, X } from "lucide-react";

import type { Collaborator, CollaboratorGroup } from "@/components/chat-ui/types";

interface TeamPanelProps {
  open: boolean;
  collaborators: Collaborator[];
  groups: CollaboratorGroup[];
  onInvite: () => void;
  onCreateGroup: () => void;
  onRemove: (id: string) => void;
  onRemoveGroup: (id: string) => void;
  onUseGroup: (id: string) => void;
  onCloseMobile: () => void;
}

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function TeamPanelCard({
  collaborators,
  groups,
  onInvite,
  onCreateGroup,
  onRemove,
  onRemoveGroup,
  onUseGroup
}: Omit<TeamPanelProps, "open" | "onCloseMobile">) {
  return (
    <div className="flex h-full flex-col rounded-2xl border border-white/10 bg-[#0f141b] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.3)]">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-100">Collaborators</p>
          <p className="text-xs text-slate-500">{collaborators.length} members</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onInvite}
            className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/35 bg-cyan-500/12 px-3 py-1.5 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-500/20"
          >
            <UserPlus size={14} />
            Invite
          </button>
          <button
            type="button"
            onClick={onCreateGroup}
            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/35 bg-emerald-500/12 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/20"
          >
            <Plus size={14} />
            Create Team
          </button>
        </div>
      </div>

      <div className="vx-scrollbar mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        <div className="space-y-2">
          {collaborators.map((collaborator) => (
            <div
              key={collaborator.id}
              className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/25 px-3 py-2.5"
            >
              <div className="relative">
                <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-xs font-bold text-slate-200">
                  {initials(collaborator.name || collaborator.email)}
                </div>
                <span
                  className={`absolute -bottom-0.5 -right-0.5 inline-flex h-2.5 w-2.5 rounded-full border border-[#0f141b] ${
                    collaborator.online === false ? "bg-slate-500" : "bg-emerald-400"
                  }`}
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-100">{collaborator.name}</p>
                <p className="truncate text-[11px] text-slate-500">{collaborator.email}</p>
                <p className="text-[10px] text-slate-400">
                  <span
                    className={
                      collaborator.kind === "AI" ? "text-fuchsia-300" : "text-cyan-300"
                    }
                  >
                    {collaborator.kind === "AI" ? "AI" : "Human"}
                  </span>
                  {" | "}
                  {collaborator.role ? `${collaborator.role} | ` : ""}
                  {collaborator.online === false ? "Offline" : "Online"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onRemove(collaborator.id)}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/15 bg-black/20 text-slate-400 transition hover:bg-black/40 hover:text-slate-200"
                aria-label={`Remove ${collaborator.name}`}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-300">
              <Users size={12} />
              Teams
            </p>
            <p className="text-[11px] text-slate-500">{groups.length} teams</p>
          </div>
          <div className="mt-3 space-y-2">
            {groups.length === 0 ? (
              <p className="rounded-lg border border-dashed border-white/15 px-3 py-2 text-xs text-slate-500">
                No teams yet. Create a team from Workforce members.
              </p>
            ) : (
              groups.map((group) => (
                <div
                  key={group.id}
                  className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-100">{group.name}</p>
                      <p className="text-[11px] text-slate-500">
                        Team | {group.memberIds.length} members
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoveGroup(group.id)}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/15 bg-black/25 text-slate-400 transition hover:bg-black/40 hover:text-slate-200"
                      aria-label={`Remove ${group.name}`}
                    >
                      <X size={12} />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => onUseGroup(group.id)}
                    className="mt-2 inline-flex items-center gap-1 rounded-full border border-cyan-500/35 bg-cyan-500/12 px-2.5 py-1 text-[11px] font-semibold text-cyan-200 transition hover:bg-cyan-500/20"
                  >
                    Use In Chat
                    <ArrowUpRight size={11} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function TeamPanel({
  open,
  collaborators,
  groups,
  onInvite,
  onCreateGroup,
  onRemove,
  onRemoveGroup,
  onUseGroup,
  onCloseMobile
}: TeamPanelProps) {
  return (
    <>
      <motion.aside
        initial={false}
        animate={{ width: open ? 320 : 0, opacity: open ? 1 : 0 }}
        transition={{ type: "spring", stiffness: 240, damping: 28 }}
        className="hidden h-full shrink-0 overflow-hidden xl:block"
      >
        <div className="h-full p-3">
          <TeamPanelCard
            collaborators={collaborators}
            groups={groups}
            onInvite={onInvite}
            onCreateGroup={onCreateGroup}
            onRemove={onRemove}
            onRemoveGroup={onRemoveGroup}
            onUseGroup={onUseGroup}
          />
        </div>
      </motion.aside>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/55 xl:hidden"
            onClick={onCloseMobile}
          >
            <motion.aside
              initial={{ x: 360 }}
              animate={{ x: 0 }}
              exit={{ x: 360 }}
              transition={{ type: "spring", stiffness: 260, damping: 28 }}
              className="ml-auto h-full w-[min(92vw,340px)] p-3"
              onClick={(event) => event.stopPropagation()}
            >
              <TeamPanelCard
                collaborators={collaborators}
                groups={groups}
                onInvite={onInvite}
                onCreateGroup={onCreateGroup}
                onRemove={onRemove}
                onRemoveGroup={onRemoveGroup}
                onUseGroup={onUseGroup}
              />
            </motion.aside>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
