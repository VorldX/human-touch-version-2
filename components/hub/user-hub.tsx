"use client";

import type { ReactNode } from "react";
import { Building2, Globe2, Mail, UserRound } from "lucide-react";

import {
  earthApprovalModeLabel,
  earthProfileRoleFromControlLevel,
  normalizeEarthControlLevel,
  type EarthApprovalMode,
  type EarthProfileMode
} from "@/lib/store/vorldx-store";

export interface UserHubProfile {
  name: string;
  email: string;
  personalOrganizationName: string;
  personalType: string;
  personalControlLevel: number;
  personalMode: EarthProfileMode;
  personalApprovalMode: EarthApprovalMode;
  workspaceOrganizationName: string | null;
  workspaceRole: string | null;
  organizationCount: number;
  isEarthWorkspaceActive: boolean;
}

export function UserHub({
  profile,
  onEarthControlLevelChange,
  onEarthModeChange,
  onEarthApprovalModeChange,
  themeStyle
}: {
  profile: UserHubProfile;
  onEarthControlLevelChange: (controlLevel: number) => void;
  onEarthModeChange: (mode: EarthProfileMode) => void;
  onEarthApprovalModeChange: (mode: EarthApprovalMode) => void;
  themeStyle: {
    accentSoft: string;
    border: string;
  };
}) {
  const normalizedControlLevel = normalizeEarthControlLevel(profile.personalControlLevel);
  const derivedProfileType = earthProfileRoleFromControlLevel(normalizedControlLevel);
  const humanControlLevel = 100 - normalizedControlLevel;
  const isFullyAiControlled = normalizedControlLevel === 100;

  return (
    <div className="mx-auto max-w-[1380px] space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <h2 className="font-display text-3xl font-black tracking-tight md:text-4xl">You</h2>
          <p className="text-xs text-slate-500">
            Personal profile, fallback identity, and current workspace context
          </p>
        </div>
        <div className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${themeStyle.accentSoft}`}>
          Default profile
        </div>
      </div>

      <div className={`vx-panel space-y-6 rounded-[32px] p-6 ${themeStyle.border}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <p className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-slate-500">
              <UserRound size={12} />
              Personal Card
            </p>
            <div>
              <h3 className="text-3xl font-semibold text-slate-100">{profile.name}</h3>
              <p className="mt-2 inline-flex items-center gap-2 text-sm text-slate-400">
                <Mail size={14} />
                {profile.email}
              </p>
            </div>
          </div>

          <div className="min-w-[220px] rounded-3xl border border-white/10 bg-black/25 p-4">
            <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Fallback Identity</p>
            <div className="mt-3 space-y-2">
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Organization</p>
                <p className="text-sm font-semibold text-slate-100">{profile.personalOrganizationName}</p>
              </div>
              <div className="h-px bg-white/10" />
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                  Profile Type
                </p>
                <p className="text-sm font-semibold text-slate-100">{profile.personalType}</p>
              </div>
              <div className="h-px bg-white/10" />
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Mode</p>
                <p className="text-sm font-semibold text-slate-100">
                  {profile.personalMode === "OFFLINE"
                    ? "Offline"
                    : profile.personalMode === "LIVE"
                      ? "Live"
                      : "Mixed"}
                </p>
              </div>
              <div className="h-px bg-white/10" />
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Approval</p>
                <p className="text-sm font-semibold text-slate-100">
                  {earthApprovalModeLabel(profile.personalApprovalMode)}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <UserStat
            icon={<Globe2 size={14} />}
            label="Personal Organization"
            value={profile.personalOrganizationName}
          />
          <UserStat
            icon={<UserRound size={14} />}
            label="Profile Type"
            value={profile.personalType}
          />
          <UserStat
            icon={<Globe2 size={14} />}
            label="AI Control"
            value={`${normalizedControlLevel}%`}
          />
          <UserStat
            icon={<Globe2 size={14} />}
            label="Earth Mode"
            value={
              profile.personalMode === "OFFLINE"
                ? "Offline"
                : profile.personalMode === "LIVE"
                  ? "Live"
                  : "Mixed"
            }
          />
          <UserStat
            icon={<Building2 size={14} />}
            label="Active Workspace"
            value={profile.workspaceOrganizationName ?? profile.personalOrganizationName}
          />
          <UserStat icon={<Building2 size={14} />} label="Accessible Organizations" value={String(profile.organizationCount)} />
        </div>

        <div className="rounded-3xl border border-white/10 bg-black/25 p-4">
          <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Workspace Note</p>
          <p className="mt-2 text-sm text-slate-300">
            Your personal profile stays anchored to {profile.personalOrganizationName} with the
            type {profile.personalType}. When no organization is active, this becomes the default
            profile across the shell.
          </p>
          {profile.workspaceOrganizationName ? (
            <p className="mt-3 text-xs text-slate-400">
              Current workspace: {profile.workspaceOrganizationName}
              {profile.workspaceRole ? ` | ${profile.workspaceRole}` : ""}
            </p>
          ) : null}
        </div>

        <div className="rounded-3xl border border-white/10 bg-black/25 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Earth Profile</p>
              <p className="mt-2 text-sm text-slate-300">
                Choose the human-managed control mix for the Earth fallback profile. The profile
                type is derived from that mix, and AI cannot switch it on its own.
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${
                profile.isEarthWorkspaceActive ? themeStyle.accentSoft : "bg-white/5 text-slate-300"
              }`}
            >
              {profile.isEarthWorkspaceActive ? "Active Workspace" : "Ready In Switcher"}
            </span>
          </div>
          <div className="mt-4 rounded-3xl border border-white/10 bg-black/20 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                  Control Mix
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Human control {humanControlLevel}% | AI control {normalizedControlLevel}%
                </p>
              </div>
              <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-100">
                Derived Type: {derivedProfileType}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={normalizedControlLevel}
              onChange={(event) => onEarthControlLevelChange(Number(event.target.value))}
              className="mt-4 w-full accent-cyan-400"
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
              <span>Human-led</span>
              <span>Balanced</span>
              <span>AI-led</span>
            </div>
            <div className="mt-3 inline-flex flex-wrap rounded-full border border-white/10 bg-black/30 p-1">
              {([
                { value: 0, label: "Human-led" },
                { value: 50, label: "Balanced" },
                { value: 100, label: "AI-led" }
              ] as const).map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => onEarthControlLevelChange(preset.value)}
                  className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
                    normalizedControlLevel === preset.value
                      ? "bg-emerald-500/15 text-emerald-300"
                      : "text-slate-300 hover:bg-white/10"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-4 text-[10px] uppercase tracking-[0.16em] text-slate-500">
            Approval Model
          </p>
          <div className="mt-2 inline-flex flex-wrap rounded-full border border-white/10 bg-black/30 p-1">
            {([
              {
                id: "HUMAN_ONLY",
                label: "Human Only",
                disabled: !isFullyAiControlled
              },
              {
                id: "AI_REQUESTS_HUMAN",
                label: "AI Requests Human",
                disabled: !isFullyAiControlled
              },
              {
                id: "AI_SELF_APPROVE",
                label: "AI Self Approves",
                disabled: !isFullyAiControlled
              }
            ] as Array<{
              id: EarthApprovalMode;
              label: string;
              disabled: boolean;
            }>).map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => onEarthApprovalModeChange(mode.id)}
                disabled={mode.disabled}
                className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
                  profile.personalApprovalMode === mode.id
                    ? "bg-emerald-500/15 text-emerald-300"
                    : mode.disabled
                      ? "cursor-not-allowed text-slate-500"
                      : "text-slate-300 hover:bg-white/10"
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-400">
            {isFullyAiControlled
              ? "When the profile is fully AI-controlled, a human can choose whether AI requests approval or self-approves."
              : "Human-led and balanced profiles stay on human approval only."}
          </p>
          <p className="mt-4 text-[10px] uppercase tracking-[0.16em] text-slate-500">Mode</p>
          <div className="mt-2 grid gap-2 md:grid-cols-3">
            {([
              {
                id: "OFFLINE",
                label: "Offline",
                detail: "Keep the Earth profile inactive and unavailable for hiring."
              },
              {
                id: "LIVE",
                label: "Live",
                detail: "Keep the Earth profile visible and hireable by one organization."
              },
              {
                id: "MIXED",
                label: "Mixed",
                detail: "Keep the Earth profile active and open to additional organizations."
              }
            ] as Array<{
              id: EarthProfileMode;
              label: string;
              detail: string;
            }>).map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => onEarthModeChange(mode.id)}
                className={`rounded-2xl border px-3 py-3 text-left transition ${
                  profile.personalMode === mode.id
                    ? "border-cyan-500/40 bg-cyan-500/12"
                    : "border-white/10 bg-black/35 text-slate-300 hover:bg-white/5"
                }`}
              >
                <p className="text-xs font-semibold text-slate-100">{mode.label}</p>
                <p className="mt-1 text-[11px] text-slate-400">{mode.detail}</p>
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-400">
            This Earth profile is used whenever you switch to Earth from the top-left organization
            switcher or when Earth workforce availability is checked. Only a human changes this
            control mix and approval setup.
          </p>
        </div>
      </div>
    </div>
  );
}

function UserStat({
  icon,
  label,
  value
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-black/25 p-4">
      <p className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-slate-500">
        {icon}
        {label}
      </p>
      <p className="mt-3 text-lg font-semibold text-slate-100">{value}</p>
    </div>
  );
}
