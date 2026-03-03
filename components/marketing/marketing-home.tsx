"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Database,
  Dna,
  KeyRound,
  Layers3,
  LogOut,
  MessageSquare,
  Route,
  Sparkles,
  Workflow
} from "lucide-react";

import { useFirebaseAuth } from "@/components/auth/firebase-auth-provider";

const PLATFORM_STEPS = [
  {
    title: "Talk To Organization",
    description: "Founders discuss strategy with the company, not with isolated prompts.",
    icon: MessageSquare
  },
  {
    title: "Direction Is Extracted",
    description: "Conversation output is transformed into a concrete Direction document.",
    icon: Route
  },
  {
    title: "Main Agent Orchestrates",
    description: "The Main Agent decomposes Direction into task graphs for specialized agents.",
    icon: Workflow
  },
  {
    title: "Organization Vault Storage",
    description: "A shared storage pool keeps organizational files, outputs, and agent working assets.",
    icon: Database
  },
  {
    title: "DNA Built From Vault",
    description: "Organizational, employee, and agent DNA profiles are generated from real stored assets.",
    icon: Dna
  },
  {
    title: "Schedules Keep Running",
    description: "Direction can execute immediately or recur through mission schedules.",
    icon: Layers3
  }
] as const;

const PLAN_ROWS = [
  {
    name: "Starter",
    model: "BYOK + Managed Vault",
    detail: "Single organization key, storage vault, core DNA memory, clear markup.",
    accent: "from-cyan-500/25 to-blue-500/10"
  },
  {
    name: "Growth",
    model: "Hybrid Runtime + Connectors",
    detail: "Switch BYOK/managed billing with connector tools like Google Drive.",
    accent: "from-emerald-500/25 to-teal-500/10"
  },
  {
    name: "Enterprise",
    model: "Managed Runtime + BYO Storage",
    detail: "Token billing, governance controls, and migration to your own storage stack.",
    accent: "from-amber-500/25 to-orange-500/10"
  }
] as const;

export function MarketingHome() {
  const router = useRouter();
  const { loading, user, signInWithOtp, signOutCurrentUser } = useFirebaseAuth();

  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [authInFlight, setAuthInFlight] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const handleOtpAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError(null);
    setAuthInFlight(true);
    try {
      await signInWithOtp({ email, otp });
      router.push("/app");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setAuthInFlight(false);
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#05090d] text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(34,211,238,0.16),transparent_40%),radial-gradient(circle_at_80%_0%,rgba(16,185,129,0.14),transparent_45%),radial-gradient(circle_at_50%_100%,rgba(245,158,11,0.12),transparent_45%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.22] [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:64px_64px]" />

      <section className="relative mx-auto max-w-7xl px-6 pb-20 pt-8 md:px-10">
        <header className="flex items-center justify-between">
          <div className="inline-flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-400/30 bg-cyan-500/10 text-cyan-300">
              <Building2 size={19} />
            </div>
            <div>
              <p className="font-display text-sm font-bold uppercase tracking-[0.26em] text-cyan-200">
                Human Touch
              </p>
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
                Organization Intelligence Platform
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {user ? (
              <>
                <button
                  onClick={() => void signOutCurrentUser()}
                  className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-300 transition hover:bg-white/10"
                >
                  <LogOut size={12} />
                  Sign Out
                </button>
                <Link
                  href="/app"
                  className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-black transition hover:bg-emerald-400"
                >
                  Enter App
                  <ArrowRight size={12} />
                </Link>
              </>
            ) : (
              <a
                href="#login"
                className="inline-flex items-center gap-2 rounded-full border border-cyan-300/40 bg-cyan-400/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-100 transition hover:bg-cyan-300/15"
              >
                Login
                <KeyRound size={12} />
              </a>
            )}
          </div>
        </header>

        <div className="mt-16 grid gap-10 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-400/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.22em] text-amber-100">
              <Sparkles size={13} />
              Talk Like You Talk To A Company
            </div>

            <div>
              <h1 className="font-display text-5xl font-black uppercase leading-[0.95] tracking-tight md:text-7xl">
                Direction-Based
                <br />
                Organization AI
              </h1>
              <p className="mt-6 max-w-2xl text-lg text-slate-300 md:text-xl">
                Your philosophy is now native: discuss with the organization, extract one
                Direction, let the Main Agent orchestrate multi-agent execution, and keep it alive
                through schedules, vault storage, and DNA memory built from real company data.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {PLATFORM_STEPS.map((step) => (
                <article
                  key={step.title}
                  className="rounded-3xl border border-white/10 bg-black/35 p-4 transition hover:border-cyan-400/40"
                >
                  <div className="mb-3 inline-flex rounded-2xl border border-white/10 bg-white/5 p-2 text-cyan-300">
                    <step.icon size={16} />
                  </div>
                  <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-100">
                    {step.title}
                  </h2>
                  <p className="mt-2 text-sm text-slate-400">{step.description}</p>
                </article>
              ))}
            </div>
          </div>

          <div className="space-y-4" id="login">
            <section className="rounded-[2rem] border border-white/10 bg-black/50 p-6 backdrop-blur-md">
              <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">
                Test Authenticator
              </p>
              <h2 className="mt-3 font-display text-3xl font-black uppercase tracking-tight">
                Login To Command OS
              </h2>
              <p className="mt-2 text-sm text-slate-400">
                For testing, use any valid email and any 6-digit OTP to enter the app.
              </p>

              {loading ? (
                <div className="mt-6 rounded-2xl border border-white/10 bg-black/35 p-4 text-sm text-slate-300">
                  Checking session...
                </div>
              ) : user ? (
                <div className="mt-6 space-y-3 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-emerald-100">
                    Signed in as {user.email}
                  </p>
                  <Link
                    href="/app"
                    className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-black transition hover:bg-emerald-300"
                  >
                    Enter Application
                    <ArrowRight size={12} />
                  </Link>
                </div>
              ) : (
                <div className="mt-6 space-y-3">
                  <form
                    onSubmit={handleOtpAuth}
                    className="space-y-3 rounded-2xl border border-white/10 bg-black/30 p-4"
                  >
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="work@email.com"
                      className="w-full rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600"
                      required
                    />
                    <input
                      type="text"
                      value={otp}
                      onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="6-digit OTP"
                      inputMode="numeric"
                      maxLength={6}
                      className="w-full rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600"
                      required
                    />
                    <p className="text-xs text-slate-500">
                      Test mode: any six digits are accepted.
                    </p>
                    <button
                      type="submit"
                      disabled={authInFlight}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-300/35 bg-cyan-400/10 px-4 py-2.5 text-xs font-bold uppercase tracking-[0.18em] text-cyan-100 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {authInFlight ? "Signing In..." : "Login With OTP"}
                    </button>
                  </form>
                </div>
              )}

              {authError ? (
                <p className="mt-4 rounded-xl border border-red-500/35 bg-red-500/15 px-3 py-2 text-xs text-red-200">
                  {authError}
                </p>
              ) : null}
            </section>

            <section className="rounded-[2rem] border border-white/10 bg-black/45 p-6">
              <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Plans</p>
              <div className="mt-4 space-y-2">
                {PLAN_ROWS.map((plan) => (
                  <article
                    key={plan.name}
                    className={`rounded-2xl border border-white/10 bg-gradient-to-r p-4 ${plan.accent}`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold uppercase tracking-[0.2em] text-white">
                        {plan.name}
                      </p>
                      <CheckCircle2 size={14} className="text-emerald-300" />
                    </div>
                    <p className="mt-1 text-xs uppercase tracking-[0.14em] text-slate-200">
                      {plan.model}
                    </p>
                    <p className="mt-2 text-sm text-slate-300">{plan.detail}</p>
                  </article>
                ))}
              </div>
            </section>

            <section className="rounded-[2rem] border border-white/10 bg-black/45 p-6">
              <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">
                Organizational Tools
              </p>
              <div className="mt-3 space-y-2 text-sm text-slate-300">
                <p>
                  Connect Google Drive from Hub, let teams and agents access approved tools, and keep
                  Direction + DNA data synchronized with your organization vault.
                </p>
                <p>
                  Start in managed storage, then shift to your own storage provider when you are ready.
                </p>
              </div>
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}
