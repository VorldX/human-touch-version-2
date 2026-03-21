"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

import type { Collaborator } from "@/components/chat-ui/types";

interface CreateGroupModalProps {
  open: boolean;
  collaborators: Collaborator[];
  onClose: () => void;
  onCreate: (input: {
    name: string;
    memberIds: string[];
  }) => void;
}

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function CreateGroupModal({
  open,
  collaborators,
  onClose,
  onCreate
}: CreateGroupModalProps) {
  const [groupName, setGroupName] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setGroupName("");
    setSelectedIds([]);
  }, [open]);

  const selectedCount = selectedIds.length;
  const canCreate = groupName.trim().length > 0 && selectedCount > 0;
  const selectedSummary = useMemo(
    () => collaborators.filter((item) => selectedIds.includes(item.id)),
    [collaborators, selectedIds]
  );

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleCreate = () => {
    const normalizedName = groupName.trim();
    if (!normalizedName || selectedIds.length === 0) {
      return;
    }
    onCreate({
      name: normalizedName,
      memberIds: selectedIds
    });
    onClose();
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[75] flex items-center justify-center bg-black/65 p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 16, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-2xl rounded-2xl border border-white/15 bg-[#0f141b] p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-sm font-semibold text-slate-100">Create Team</p>
            <p className="mt-1 text-xs text-slate-500">
              Build a team from Workforce members (Human + AI).
            </p>

            <div className="mt-4">
              <input
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                placeholder="Group name (e.g. Revenue Strike Team)"
                className="w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500"
              />
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-black/25 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Select members ({selectedCount})
              </p>
              <div className="vx-scrollbar mt-3 max-h-[300px] space-y-2 overflow-y-auto pr-1">
                {collaborators.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No workforce members available yet. Add members in Workforce first.
                  </p>
                ) : (
                  collaborators.map((collaborator) => {
                    const selected = selectedIds.includes(collaborator.id);
                    const kindLabel = collaborator.kind === "AI" ? "AI" : "HUMAN";
                    return (
                      <button
                        key={collaborator.id}
                        type="button"
                        onClick={() => toggleSelection(collaborator.id)}
                        className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition ${
                          selected
                            ? "border-cyan-400/40 bg-cyan-500/10"
                            : "border-white/10 bg-black/20 hover:bg-black/35"
                        }`}
                      >
                        <div className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-[11px] font-bold text-slate-200">
                          {initials(collaborator.name || collaborator.email)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-100">
                            {collaborator.name}
                          </p>
                          <p className="truncate text-[11px] text-slate-500">
                            {collaborator.email}
                          </p>
                        </div>
                        <span
                          className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${
                            collaborator.kind === "AI"
                              ? "border-fuchsia-400/40 bg-fuchsia-500/15 text-fuchsia-100"
                              : "border-cyan-400/40 bg-cyan-500/15 text-cyan-100"
                          }`}
                        >
                          {kindLabel}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {selectedSummary.length > 0 ? (
              <p className="mt-3 line-clamp-2 text-xs text-slate-400">
                Selected: {selectedSummary.map((item) => item.name).join(", ")}
              </p>
            ) : null}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-white/15 bg-black/25 px-4 py-2 text-xs font-semibold text-slate-300 transition hover:bg-black/40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={!canCreate}
                className="rounded-full border border-emerald-500/35 bg-emerald-500/15 px-4 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Create Team
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
