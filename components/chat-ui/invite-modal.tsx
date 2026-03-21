"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";

interface InviteModalProps {
  open: boolean;
  onClose: () => void;
  onInvite: (input: { value: string; kind: "HUMAN" | "AI" }) => void;
}

export function InviteModal({ open, onClose, onInvite }: InviteModalProps) {
  const [value, setValue] = useState("");
  const [kind, setKind] = useState<"HUMAN" | "AI">("HUMAN");

  const handleInvite = () => {
    const normalized = value.trim();
    if (!normalized) {
      return;
    }
    onInvite({ value: normalized, kind });
    setValue("");
    setKind("HUMAN");
    onClose();
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 16, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-md rounded-2xl border border-white/15 bg-[#11161d] p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-sm font-semibold text-slate-100">Invite to Team</p>
            <p className="mt-1 text-xs text-slate-500">
              Enter an email address or team name to add collaborator.
            </p>

            <div className="mt-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Collaborator type
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setKind("HUMAN")}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    kind === "HUMAN"
                      ? "border-cyan-400/45 bg-cyan-500/15 text-cyan-100"
                      : "border-white/15 bg-black/25 text-slate-300 hover:bg-black/40"
                  }`}
                >
                  Human
                </button>
                <button
                  type="button"
                  onClick={() => setKind("AI")}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    kind === "AI"
                      ? "border-fuchsia-400/45 bg-fuchsia-500/15 text-fuchsia-100"
                      : "border-white/15 bg-black/25 text-slate-300 hover:bg-black/40"
                  }`}
                >
                  AI
                </button>
              </div>
            </div>

            <input
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="name@company.com or Team A"
              className="mt-3 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500"
            />

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
                onClick={handleInvite}
                className="rounded-full border border-cyan-500/35 bg-cyan-500/15 px-4 py-2 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-500/25"
              >
                Invite
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
