"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Building2, Dna, Loader2, RefreshCw, Users } from "lucide-react";

import { useVorldXStore } from "@/lib/store/vorldx-store";

type Scope = "ORGANIZATION" | "EMPLOYEE" | "AGENT";
type PersonnelType = "HUMAN" | "AI";

interface DnaProfile {
  id: string;
  scope: Scope;
  targetId: string | null;
  title: string;
  summary: string;
  coreTraits: string[];
  sourceAssetIds: string[];
  updatedAt: string;
}

interface StorageAsset {
  id: string;
  name: string;
  namespace: string;
  provider: "MANAGED" | "GOOGLE_DRIVE" | "S3_COMPATIBLE";
}

interface PersonnelItem {
  id: string;
  type: PersonnelType;
  name: string;
  role: string;
}

interface DnaMemoryPanelProps {
  orgId: string;
}

const SCOPE_META: Record<
  Scope,
  {
    title: string;
    hint: string;
    icon: typeof Building2;
  }
> = {
  ORGANIZATION: {
    title: "Organizational DNA",
    hint: "Identity, vision, values, and governance memory for the Main Agent.",
    icon: Building2
  },
  EMPLOYEE: {
    title: "Employee DNA",
    hint: "Role memory and operating style for human personnel context.",
    icon: Users
  },
  AGENT: {
    title: "Agent DNA",
    hint: "Personality, expertise, and stable operating profile for AI agents.",
    icon: Bot
  }
};

export function DnaMemoryPanel({ orgId }: DnaMemoryPanelProps) {
  const notify = useVorldXStore((state) => state.pushNotification);
  const [profiles, setProfiles] = useState<DnaProfile[]>([]);
  const [assets, setAssets] = useState<StorageAsset[]>([]);
  const [personnel, setPersonnel] = useState<PersonnelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [scope, setScope] = useState<Scope>("ORGANIZATION");
  const [targetId, setTargetId] = useState("");
  const [title, setTitle] = useState(SCOPE_META.ORGANIZATION.title);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);

  const employees = useMemo(
    () => personnel.filter((item) => item.type === "HUMAN"),
    [personnel]
  );
  const agents = useMemo(
    () => personnel.filter((item) => item.type === "AI"),
    [personnel]
  );
  const targetOptions = useMemo(() => {
    if (scope === "EMPLOYEE") return employees;
    if (scope === "AGENT") return agents;
    return [];
  }, [agents, employees, scope]);
  const profileCounts = useMemo(() => {
    const count = {
      ORGANIZATION: 0,
      EMPLOYEE: 0,
      AGENT: 0
    };
    profiles.forEach((item) => {
      if (item.scope === "ORGANIZATION") count.ORGANIZATION += 1;
      if (item.scope === "EMPLOYEE") count.EMPLOYEE += 1;
      if (item.scope === "AGENT") count.AGENT += 1;
    });
    return count;
  }, [profiles]);
  const profileTargetName = useMemo(() => {
    const map = new Map<string, string>();
    personnel.forEach((item) => map.set(item.id, `${item.name} (${item.role})`));
    return map;
  }, [personnel]);
  const visibleProfiles = useMemo(
    () => profiles.filter((profile) => profile.scope === scope),
    [profiles, scope]
  );

  const loadData = useCallback(
    async (silent?: boolean) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        const [profileResponse, assetResponse, personnelResponse] = await Promise.all([
          fetch(`/api/dna/profiles?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" }),
          fetch(`/api/storage/assets?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" }),
          fetch(`/api/squad/personnel?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" })
        ]);
        const profilePayload = (await profileResponse.json()) as {
          ok?: boolean;
          message?: string;
          profiles?: DnaProfile[];
        };
        const assetPayload = (await assetResponse.json()) as {
          ok?: boolean;
          message?: string;
          assets?: StorageAsset[];
        };
        const personnelPayload = (await personnelResponse.json()) as {
          ok?: boolean;
          message?: string;
          personnel?: PersonnelItem[];
        };

        if (!profileResponse.ok || !profilePayload.ok || !profilePayload.profiles) {
          throw new Error(profilePayload.message ?? "Failed loading DNA profiles.");
        }
        if (!assetResponse.ok || !assetPayload.ok || !assetPayload.assets) {
          throw new Error(assetPayload.message ?? "Failed loading storage assets.");
        }
        if (!personnelResponse.ok || !personnelPayload.ok || !personnelPayload.personnel) {
          throw new Error(personnelPayload.message ?? "Failed loading personnel.");
        }

        setProfiles(profilePayload.profiles);
        setAssets(assetPayload.assets);
        setPersonnel(personnelPayload.personnel);
      } catch (error) {
        notify({
          title: "DNA Memory",
          message: error instanceof Error ? error.message : "Unable to load DNA memory data.",
          type: "error"
        });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [notify, orgId]
  );

  useEffect(() => {
    void loadData();
    const timer = setInterval(() => void loadData(true), 18000);
    return () => clearInterval(timer);
  }, [loadData]);

  useEffect(() => {
    if (scope === "ORGANIZATION") {
      setTargetId("");
      setTitle(SCOPE_META.ORGANIZATION.title);
      return;
    }
    const firstTarget = targetOptions[0]?.id ?? "";
    setTargetId((prev) => prev || firstTarget);
  }, [scope, targetOptions]);

  useEffect(() => {
    if (scope === "ORGANIZATION") {
      return;
    }
    const selectedTarget = targetOptions.find((item) => item.id === targetId);
    if (selectedTarget) {
      setTitle(`${selectedTarget.name} DNA`);
      return;
    }
    setTitle(SCOPE_META[scope].title);
  }, [scope, targetId, targetOptions]);

  const buildProfile = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (scope !== "ORGANIZATION" && !targetId.trim()) {
        notify({
          title: "DNA Memory",
          message: `Select a ${scope.toLowerCase()} target before building DNA.`,
          type: "warning"
        });
        return;
      }

      if (selectedAssetIds.length === 0) {
        notify({
          title: "DNA Memory",
          message: "Select at least one storage asset.",
          type: "warning"
        });
        return;
      }

      setSaving(true);
      try {
        const response = await fetch("/api/dna/profiles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orgId,
            scope,
            targetId: scope === "ORGANIZATION" ? null : targetId.trim(),
            title: title.trim(),
            sourceAssetIds: selectedAssetIds
          })
        });
        const payload = (await response.json()) as { ok?: boolean; message?: string };
        if (!response.ok || !payload.ok) {
          throw new Error(payload.message ?? "Failed building DNA profile.");
        }
        notify({
          title: "DNA Memory",
          message: `${SCOPE_META[scope].title} updated from selected storage assets.`,
          type: "success"
        });
        await loadData(true);
      } catch (error) {
        notify({
          title: "DNA Memory",
          message: error instanceof Error ? error.message : "Build failed.",
          type: "error"
        });
      } finally {
        setSaving(false);
      }
    },
    [loadData, notify, orgId, scope, selectedAssetIds, targetId, title]
  );

  return (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="flex items-center justify-between">
        <p className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-slate-500">
          <Dna size={12} />
          DNA Memory Builder
        </p>
        <button
          onClick={() => void loadData(true)}
          className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-300"
        >
          {refreshing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {(Object.keys(SCOPE_META) as Scope[]).map((item) => {
          const Icon = SCOPE_META[item].icon;
          return (
            <button
              key={item}
              onClick={() => setScope(item)}
              className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] transition ${
                scope === item
                  ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-300"
                  : "border-white/20 bg-white/5 text-slate-300"
              }`}
            >
              <Icon size={11} />
              {SCOPE_META[item].title} ({profileCounts[item]})
            </button>
          );
        })}
      </div>

      <p className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-slate-400">
        {SCOPE_META[scope].hint}
      </p>

      <form onSubmit={buildProfile} className="space-y-3">
        <div className="grid gap-2 md:grid-cols-2">
          {scope === "ORGANIZATION" ? (
            <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-slate-300">
              This profile applies to the full organization and the Main Agent.
            </div>
          ) : (
            <select
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
              className="rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-xs text-slate-100 outline-none"
              required
            >
              <option value="">Select {scope.toLowerCase()} target</option>
              {targetOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.role})
                </option>
              ))}
            </select>
          )}
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="DNA title"
            className="rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-xs text-slate-100 outline-none"
            required
          />
        </div>

        <div className="rounded-xl border border-white/10 bg-black/30 p-2">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
              Source Storage Assets ({selectedAssetIds.length} selected)
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedAssetIds(assets.map((item) => item.id))}
                className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-300"
              >
                Select All
              </button>
              <button
                type="button"
                onClick={() => setSelectedAssetIds([])}
                className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-300"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="vx-scrollbar grid max-h-36 gap-2 overflow-y-auto md:grid-cols-2">
            {assets.length === 0 ? (
              <p className="text-xs text-slate-500">No storage assets available.</p>
            ) : (
              assets.slice(0, 80).map((asset) => {
                const selected = selectedAssetIds.includes(asset.id);
                return (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() =>
                      setSelectedAssetIds((prev) =>
                        selected ? prev.filter((item) => item !== asset.id) : [...prev, asset.id]
                      )
                    }
                    className={`rounded-xl border px-2 py-2 text-left text-xs transition ${
                      selected
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                        : "border-white/10 bg-black/35 text-slate-300 hover:bg-white/5"
                    }`}
                  >
                    <p className="truncate font-semibold">{asset.name}</p>
                    <p className="truncate text-[10px] uppercase tracking-[0.12em] text-slate-500">
                      {asset.namespace} | {asset.provider}
                    </p>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <button
          type="submit"
          disabled={saving || loading}
          className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-black transition hover:bg-emerald-500 hover:text-white disabled:opacity-60"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Dna size={12} />}
          Build {SCOPE_META[scope].title}
        </button>
      </form>

      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
          Existing {SCOPE_META[scope].title}
        </p>
        {loading ? (
          <div className="inline-flex items-center gap-2 text-sm text-slate-400">
            <Loader2 size={14} className="animate-spin" />
            Loading DNA profiles...
          </div>
        ) : visibleProfiles.length === 0 ? (
          <p className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-slate-500">
            No profiles yet in this DNA lane.
          </p>
        ) : (
          visibleProfiles.map((profile) => (
            <article key={profile.id} className="rounded-xl border border-white/10 bg-black/25 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white">{profile.title}</p>
              <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                {profile.scope}
                {profile.targetId
                  ? ` | ${profileTargetName.get(profile.targetId) ?? profile.targetId}`
                  : ""}
                {" | "}
                {new Date(profile.updatedAt).toLocaleString()}
              </p>
              <p className="mt-1 line-clamp-3 text-xs text-slate-400">{profile.summary}</p>
              <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                Traits: {profile.coreTraits.join(", ") || "none"}
              </p>
              <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                Source Assets: {profile.sourceAssetIds.length}
              </p>
            </article>
          ))
        )}
      </div>
    </div>
  );
}

