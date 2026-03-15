"use client";

import { Loader2 } from "lucide-react";

import { useFirebaseAuth } from "@/components/auth/firebase-auth-provider";
import { MarketingHome } from "@/components/marketing/marketing-home";
import { VorldXShell } from "@/components/vorldx-shell";

export function AuthenticatedWorkspace() {
  const { loading, user } = useFirebaseAuth();

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#05070a] text-slate-300">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.16em]">
          <Loader2 size={14} className="animate-spin" />
          Validating Session
        </div>
      </main>
    );
  }

  if (!user) {
    return <MarketingHome />;
  }

  return <VorldXShell />;
}
