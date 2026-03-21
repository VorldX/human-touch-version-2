"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { DnaMemoryHub } from "@/components/hub/dna-memory-hub";
import { DirectionalHub } from "@/components/hub/directional-hub";
import { OrganizationHub } from "@/components/hub/organization-hub";
import { StorageHub } from "@/components/hub/storage-hub";
import { ToolsHub } from "@/components/hub/tools-hub";
import { UserHub, type UserHubProfile } from "@/components/hub/user-hub";
import type { EarthApprovalMode, EarthProfileMode, OrgContext } from "@/lib/store/vorldx-store";

type HubScope = "USER" | "ORGANIZATIONAL" | "DIRECTIONAL" | "DNA" | "STORAGE" | "TOOLS";

interface HubConsoleProps {
  orgId: string | null;
  orgs: OrgContext[];
  currentOrgId: string | null;
  onSelectOrg: (orgId: string) => void;
  userProfile: UserHubProfile;
  onEarthControlLevelChange: (controlLevel: number) => void;
  onEarthModeChange: (mode: EarthProfileMode) => void;
  onEarthApprovalModeChange: (mode: EarthApprovalMode) => void;
  themeStyle: {
    accent: string;
    accentSoft: string;
    border: string;
  };
  initialScope?: HubScope;
}

const HUB_TABS: Array<{ key: HubScope; label: string; requiresOrg?: boolean }> = [
  { key: "USER", label: "You" },
  { key: "ORGANIZATIONAL", label: "Organization" },
  { key: "DIRECTIONAL", label: "Strings", requiresOrg: true },
  { key: "DNA", label: "DNA memory", requiresOrg: true },
  { key: "STORAGE", label: "Storage", requiresOrg: true },
  { key: "TOOLS", label: "Connected tools", requiresOrg: true }
];

export function HubConsole({
  orgId,
  orgs,
  currentOrgId,
  onSelectOrg,
  userProfile,
  onEarthControlLevelChange,
  onEarthModeChange,
  onEarthApprovalModeChange,
  themeStyle,
  initialScope
}: HubConsoleProps) {
  const [scope, setScope] = useState<HubScope>(initialScope ?? (orgId ? "ORGANIZATIONAL" : "USER"));
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (initialScope) {
      setScope(initialScope);
      return;
    }
    if (!orgId) {
      setScope("USER");
    }
  }, [initialScope, orgId]);

  const activePanel = useMemo(() => {
    const key = `${scope}:${orgId ?? "personal"}:${refreshNonce}`;
    if (scope === "USER") {
      return (
        <UserHub
          key={key}
          profile={userProfile}
          onEarthControlLevelChange={onEarthControlLevelChange}
          onEarthModeChange={onEarthModeChange}
          onEarthApprovalModeChange={onEarthApprovalModeChange}
          themeStyle={themeStyle}
        />
      );
    }
    if (!orgId) {
      return <HubOrganizationRequired key={key} themeStyle={themeStyle} />;
    }
    if (scope === "ORGANIZATIONAL") {
      return (
        <OrganizationHub
          key={key}
          orgId={orgId}
          orgs={orgs}
          activeOrgId={currentOrgId}
          onSelectOrg={onSelectOrg}
          themeStyle={themeStyle}
        />
      );
    }
    if (scope === "DIRECTIONAL") {
      return <DirectionalHub key={key} orgId={orgId} themeStyle={{ border: themeStyle.border }} />;
    }
    if (scope === "DNA") {
      return <DnaMemoryHub key={key} orgId={orgId} themeStyle={{ border: themeStyle.border }} />;
    }
    if (scope === "STORAGE") {
      return <StorageHub key={key} orgId={orgId} themeStyle={{ border: themeStyle.border }} />;
    }
    return <ToolsHub key={key} orgId={orgId} themeStyle={{ border: themeStyle.border }} />;
  }, [
    currentOrgId,
    onEarthApprovalModeChange,
    onEarthControlLevelChange,
    onEarthModeChange,
    onSelectOrg,
    orgId,
    orgs,
    refreshNonce,
    scope,
    themeStyle,
    userProfile
  ]);

  return (
    <div className="mx-auto max-w-[1380px] space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <h2 className="font-display text-3xl font-black tracking-tight md:text-4xl">Hub</h2>
          <p className="text-xs text-slate-500">
            Organization data, strings, memory, storage, and connected tools
          </p>
        </div>
        <button
          onClick={() => {
            setRefreshing(true);
            setRefreshNonce((value) => value + 1);
            setTimeout(() => setRefreshing(false), 350);
          }}
          className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200"
        >
          {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {HUB_TABS.map((item) => (
          <button
            key={item.key}
            onClick={() => setScope(item.key)}
            disabled={!orgId && item.requiresOrg}
            className={`rounded-full border px-4 py-2 text-xs font-semibold ${
              scope === item.key
                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                : !orgId && item.requiresOrg
                  ? "cursor-not-allowed border-white/10 bg-white/5 text-slate-500 opacity-60"
                  : "border-white/20 bg-white/5 text-slate-300"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {activePanel}
    </div>
  );
}

function HubOrganizationRequired({
  themeStyle
}: {
  themeStyle: {
    border: string;
  };
}) {
  return (
    <div className={`vx-panel rounded-[32px] p-6 ${themeStyle.border}`}>
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">
        Organization Required
      </p>
      <p className="mt-3 text-sm text-slate-400">
        Join or create an organization to open the organization, strings, DNA, storage, and tool
        hubs. Your personal Earth profile stays available in the You section.
      </p>
    </div>
  );
}
