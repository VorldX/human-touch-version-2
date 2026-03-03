"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

import { useFirebaseAuth } from "@/components/auth/firebase-auth-provider";
import { VorldXShell } from "@/components/vorldx-shell";

export function AuthenticatedWorkspace() {
  const router = useRouter();
  const { loading, user } = useFirebaseAuth();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/");
    }
  }, [loading, router, user]);

  if (loading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#05070a] text-slate-300">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.16em]">
          <Loader2 size={14} className="animate-spin" />
          Validating Session
        </div>
      </main>
    );
  }

  return <VorldXShell />;
}
