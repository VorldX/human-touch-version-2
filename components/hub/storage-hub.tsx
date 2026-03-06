"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Search, Trash2, UploadCloud } from "lucide-react";

import { useFirebaseAuth } from "@/components/auth/firebase-auth-provider";
import { parseJsonResponse } from "@/lib/http/json-response";
import { useVorldXStore } from "@/lib/store/vorldx-store";

type OwnerType = "ORG" | "OWNER" | "EMPLOYEE" | "AGENT";
type OwnerView = "ALL" | OwnerType;
type PersonnelType = "HUMAN" | "AI";

interface StorageAsset {
  id: string;
  name: string;
  size: string;
  url: string;
  namespace: string;
  ownerType: OwnerType;
  ownerId: string | null;
  provider: "MANAGED" | "GOOGLE_DRIVE" | "S3_COMPATIBLE";
  type: "INPUT" | "DNA";
  createdAt: string;
  updatedAt: string;
}

interface PersonnelItem {
  id: string;
  type: PersonnelType;
  name: string;
  role: string;
}

interface StorageHubProps {
  orgId: string;
  themeStyle: {
    border: string;
  };
}

function toBytes(sizeRaw: string) {
  const value = Number(sizeRaw);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value;
}

function toSizeLabel(sizeRaw: string | number) {
  const value = typeof sizeRaw === "number" ? sizeRaw : toBytes(sizeRaw);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="text-sm font-bold text-slate-200">{value}</p>
    </div>
  );
}

export function StorageHub({ orgId, themeStyle }: StorageHubProps) {
  const { user } = useFirebaseAuth();
  const notify = useVorldXStore((state) => state.pushNotification);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [assets, setAssets] = useState<StorageAsset[]>([]);
  const [personnel, setPersonnel] = useState<PersonnelItem[]>([]);
  const [name, setName] = useState("");
  const [namespace, setNamespace] = useState("/org/shared");
  const [ownerType, setOwnerType] = useState<OwnerType>("ORG");
  const [ownerId, setOwnerId] = useState("");
  const [asDna, setAsDna] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [ownerView, setOwnerView] = useState<OwnerView>("ALL");

  const employees = useMemo(
    () => personnel.filter((item) => item.type === "HUMAN"),
    [personnel]
  );
  const agents = useMemo(
    () => personnel.filter((item) => item.type === "AI"),
    [personnel]
  );
  const personnelNameById = useMemo(() => {
    const map = new Map<string, string>();
    personnel.forEach((item) => map.set(item.id, `${item.name} (${item.role})`));
    return map;
  }, [personnel]);

  const ownerEmail = user?.email?.trim().toLowerCase() ?? "";
  const totalBytes = useMemo(
    () => assets.reduce((sum, item) => sum + toBytes(item.size), 0),
    [assets]
  );
  const ownerVaultAssets = useMemo(() => {
    if (!ownerEmail) return [];
    return assets.filter(
      (item) => item.ownerType === "OWNER" && (item.ownerId ?? "").trim().toLowerCase() === ownerEmail
    );
  }, [assets, ownerEmail]);
  const ownerVaultBytes = useMemo(
    () => ownerVaultAssets.reduce((sum, item) => sum + toBytes(item.size), 0),
    [ownerVaultAssets]
  );
  const dnaReadyCount = useMemo(
    () => assets.filter((item) => item.type === "DNA").length,
    [assets]
  );
  const filteredAssets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return assets.filter((item) => {
      if (ownerView !== "ALL" && item.ownerType !== ownerView) {
        return false;
      }
      if (!q) {
        return true;
      }
      return (
        item.name.toLowerCase().includes(q) ||
        item.namespace.toLowerCase().includes(q) ||
        item.ownerType.toLowerCase().includes(q) ||
        (item.ownerId ?? "").toLowerCase().includes(q)
      );
    });
  }, [assets, ownerView, searchQuery]);

  useEffect(() => {
    if (ownerType === "ORG") {
      setOwnerId("");
      return;
    }
    if (ownerType === "OWNER") {
      setOwnerId((prev) => prev || user?.email || "");
      return;
    }
    if (ownerType === "EMPLOYEE") {
      setOwnerId((prev) => (employees.some((item) => item.id === prev) ? prev : employees[0]?.id ?? ""));
      return;
    }
    setOwnerId((prev) => (agents.some((item) => item.id === prev) ? prev : agents[0]?.id ?? ""));
  }, [agents, employees, ownerType, user?.email]);

  const loadAssets = useCallback(
    async (silent?: boolean) => {
      if (silent) setRefreshing(true);
      else setLoading(true);

      try {
        const [assetResponse, personnelResponse] = await Promise.all([
          fetch(`/api/storage/assets?orgId=${encodeURIComponent(orgId)}`, {
            cache: "no-store"
          }),
          fetch(`/api/squad/personnel?orgId=${encodeURIComponent(orgId)}`, {
            cache: "no-store"
          })
        ]);
        const { payload: assetPayload, rawText: assetRawText } = await parseJsonResponse<{
          ok?: boolean;
          message?: string;
          assets?: StorageAsset[];
        }>(assetResponse);
        const { payload: personnelPayload, rawText: personnelRawText } = await parseJsonResponse<{
          ok?: boolean;
          message?: string;
          personnel?: PersonnelItem[];
        }>(personnelResponse);

        if (!assetResponse.ok || !assetPayload?.ok || !assetPayload.assets) {
          throw new Error(
            assetPayload?.message ??
              (assetRawText
                ? `Failed to load storage assets (${assetResponse.status}): ${assetRawText.slice(0, 180)}`
                : "Failed to load storage assets.")
          );
        }
        if (!personnelResponse.ok || !personnelPayload?.ok || !personnelPayload.personnel) {
          throw new Error(
            personnelPayload?.message ??
              (personnelRawText
                ? `Failed to load personnel roster (${personnelResponse.status}): ${personnelRawText.slice(0, 180)}`
                : "Failed to load personnel roster.")
          );
        }
        setAssets(assetPayload.assets);
        setPersonnel(personnelPayload.personnel);
      } catch (error) {
        notify({
          title: "Storage",
          message: error instanceof Error ? error.message : "Unable to load storage assets.",
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
    void loadAssets();
    const timer = setInterval(() => void loadAssets(true), 15000);
    return () => clearInterval(timer);
  }, [loadAssets]);

  const createAsset = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setSaving(true);
      try {
        const formData = new FormData();
        formData.set("orgId", orgId);
        formData.set("name", name.trim());
        formData.set("namespace", namespace.trim() || "/org/shared");
        formData.set("ownerType", ownerType);
        if (ownerType !== "ORG" && ownerId.trim()) formData.set("ownerId", ownerId.trim());
        if (sourceUrl.trim()) formData.set("sourceUrl", sourceUrl.trim());
        formData.set("asDna", String(asDna));
        if (file) formData.set("file", file);

        const response = await fetch("/api/storage/assets", {
          method: "POST",
          body: formData
        });
        const { payload, rawText } = await parseJsonResponse<{ ok?: boolean; message?: string }>(
          response
        );
        if (!response.ok || !payload?.ok) {
          throw new Error(
            payload?.message ??
              (rawText
                ? `Failed to create storage asset (${response.status}): ${rawText.slice(0, 180)}`
                : "Failed to create storage asset.")
          );
        }

        notify({
          title: "Storage",
          message:
            ownerType === "OWNER"
              ? "Asset assigned to owner account vault."
              : "Storage asset created.",
          type: "success"
        });

        setName("");
        setSourceUrl("");
        setFile(null);
        setAsDna(false);
        if (ownerType === "ORG") {
          setNamespace("/org/shared");
        }
        await loadAssets(true);
      } catch (error) {
        notify({
          title: "Storage",
          message: error instanceof Error ? error.message : "Upload failed.",
          type: "error"
        });
      } finally {
        setSaving(false);
      }
    },
    [asDna, file, loadAssets, name, namespace, notify, orgId, ownerId, ownerType, sourceUrl]
  );

  const deleteAsset = useCallback(
    async (assetId: string) => {
      setDeletingAssetId(assetId);
      try {
        const response = await fetch(
          `/api/storage/assets/${assetId}?orgId=${encodeURIComponent(orgId)}`,
          { method: "DELETE" }
        );
        const { payload, rawText } = await parseJsonResponse<{ ok?: boolean; message?: string }>(
          response
        );
        if (!response.ok || !payload?.ok) {
          throw new Error(
            payload?.message ??
              (rawText
                ? `Failed deleting storage asset (${response.status}): ${rawText.slice(0, 180)}`
                : "Failed deleting storage asset.")
          );
        }
        await loadAssets(true);
      } catch (error) {
        notify({
          title: "Storage",
          message: error instanceof Error ? error.message : "Delete failed.",
          type: "error"
        });
      } finally {
        setDeletingAssetId(null);
      }
    },
    [loadAssets, notify, orgId]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">Storage Hub</p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setOwnerType("OWNER");
              setOwnerId(user?.email ?? "");
              setNamespace("/owner/main");
            }}
            className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-300"
          >
            Use Main Owner Vault
          </button>
          <button
            onClick={() => {
              setOwnerType("ORG");
              setOwnerId("");
              setNamespace("/org/shared");
            }}
            className="rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-300"
          >
            Use Shared Org Vault
          </button>
          <button
            onClick={() => void loadAssets(true)}
            className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-300"
          >
            {refreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Refresh
          </button>
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-4">
        <StatPill label="Total Assets" value={String(assets.length)} />
        <StatPill label="Total Storage" value={toSizeLabel(totalBytes)} />
        <StatPill label="Owner Vault Assets" value={String(ownerVaultAssets.length)} />
        <StatPill label="Owner Vault Size" value={toSizeLabel(ownerVaultBytes)} />
      </div>
      <div className="grid gap-2 md:grid-cols-4">
        <StatPill label="DNA-Ready Assets" value={String(dnaReadyCount)} />
        <StatPill label="Employees" value={String(employees.length)} />
        <StatPill label="Agents" value={String(agents.length)} />
        <StatPill label="Main Owner" value={ownerEmail || "Not signed"} />
      </div>

      <form onSubmit={createAsset} className={`vx-panel space-y-3 rounded-2xl p-3 ${themeStyle.border}`}>
        <div className="grid gap-2 md:grid-cols-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Asset name"
            className="rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-sm text-slate-100 outline-none"
            required
          />
          <input
            value={namespace}
            onChange={(event) => setNamespace(event.target.value)}
            placeholder="/org/shared, /owner/main, /employee/{id}, /agent/{id}"
            className="rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-sm text-slate-100 outline-none"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {(["ORG", "OWNER", "EMPLOYEE", "AGENT"] as OwnerType[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setOwnerType(item)}
              className={`rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] ${
                ownerType === item
                  ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                  : "border-white/20 bg-white/5 text-slate-300"
              }`}
            >
              {item}
            </button>
          ))}
        </div>

        {ownerType === "ORG" ? (
          <p className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-slate-400">
            Shared organization storage. Every approved workflow can access it.
          </p>
        ) : ownerType === "OWNER" ? (
          <input
            value={ownerId}
            onChange={(event) => setOwnerId(event.target.value)}
            placeholder="Owner email"
            className="w-full rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-sm text-slate-100 outline-none"
            required
          />
        ) : ownerType === "EMPLOYEE" ? (
          <select
            value={ownerId}
            onChange={(event) => setOwnerId(event.target.value)}
            className="w-full rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-sm text-slate-100 outline-none"
            required
          >
            <option value="">Select employee owner</option>
            {employees.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name} ({member.role})
              </option>
            ))}
          </select>
        ) : (
          <select
            value={ownerId}
            onChange={(event) => setOwnerId(event.target.value)}
            className="w-full rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-sm text-slate-100 outline-none"
            required
          >
            <option value="">Select agent owner</option>
            {agents.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name} ({member.role})
              </option>
            ))}
          </select>
        )}

        <div className="grid gap-2 md:grid-cols-2">
          <input
            type="file"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-sm text-slate-100 outline-none file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-xs"
          />
          <input
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            placeholder="or external URL"
            className="rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-sm text-slate-100 outline-none"
          />
        </div>

        <label className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-slate-400">
          <input type="checkbox" checked={asDna} onChange={(event) => setAsDna(event.target.checked)} />
          Mark as DNA-ready asset
        </label>

        <button
          type="submit"
          disabled={saving || (ownerType !== "ORG" && !ownerId.trim())}
          className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-black transition hover:bg-emerald-500 hover:text-white disabled:opacity-60"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <UploadCloud size={12} />}
          Upload Asset
        </button>
      </form>

      <div className={`vx-panel rounded-2xl p-3 ${themeStyle.border}`}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="flex min-w-[260px] flex-1 items-center gap-2 rounded-xl border border-white/10 bg-black/35 px-3 py-2">
            <Search size={13} className="text-slate-500" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search asset history"
              className="w-full bg-transparent text-xs text-slate-100 outline-none placeholder:text-slate-600"
            />
          </label>
          {(["ALL", "ORG", "OWNER", "EMPLOYEE", "AGENT"] as OwnerView[]).map((item) => (
            <button
              key={item}
              onClick={() => setOwnerView(item)}
              className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${
                ownerView === item
                  ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-300"
                  : "border-white/20 bg-white/5 text-slate-300"
              }`}
            >
              {item}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="inline-flex items-center gap-2 text-sm text-slate-400">
            <Loader2 size={14} className="animate-spin" />
            Loading storage...
          </div>
        ) : filteredAssets.length === 0 ? (
          <p className="text-xs text-slate-500">No storage assets available for this view.</p>
        ) : (
          <div className="space-y-2">
            {filteredAssets.map((asset) => {
              const resolvedOwner =
                asset.ownerType === "ORG"
                  ? "organization shared"
                  : asset.ownerType === "OWNER"
                    ? asset.ownerId ?? "owner"
                    : personnelNameById.get(asset.ownerId ?? "") ?? asset.ownerId ?? "unassigned";
              return (
                <article key={asset.id} className="rounded-xl border border-white/10 bg-black/25 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold uppercase tracking-[0.14em] text-white">
                        {asset.name}
                      </p>
                      <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                        {asset.namespace} | {asset.ownerType} ({resolvedOwner})
                      </p>
                      <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                        {toSizeLabel(asset.size)} | {asset.provider} | {asset.type} | Updated{" "}
                        {new Date(asset.updatedAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href={asset.url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg border border-white/20 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-300"
                      >
                        Open
                      </a>
                      <button
                        onClick={() => void deleteAsset(asset.id)}
                        disabled={deletingAssetId === asset.id}
                        className="rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-red-300 disabled:opacity-60"
                      >
                        {deletingAssetId === asset.id ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : (
                          <Trash2 size={11} />
                        )}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
