"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Search, Trash2, UploadCloud } from "lucide-react";

import { useFirebaseAuth } from "@/components/auth/firebase-auth-provider";
import { parseJsonResponse } from "@/lib/http/json-response";
import { useVorldXStore } from "@/lib/store/vorldx-store";

type OwnerType = "ORG" | "OWNER" | "EMPLOYEE" | "AGENT";
type OwnerView = "ALL" | OwnerType;
type PersonnelType = "HUMAN" | "AI";
type StorageSurface = "EXPLORER" | "UPLOAD";
type StorageTypeView = "ALL" | "INPUT" | "DNA";

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
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function toSizeLabel(sizeRaw: string | number) {
  const value = typeof sizeRaw === "number" ? sizeRaw : toBytes(sizeRaw);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
      <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-100">{value}</p>
    </div>
  );
}

export function StorageHub({ orgId, themeStyle }: StorageHubProps) {
  const { user } = useFirebaseAuth();
  const notify = useVorldXStore((state) => state.pushNotification);
  const [surface, setSurface] = useState<StorageSurface>("EXPLORER");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);
  const [assets, setAssets] = useState<StorageAsset[]>([]);
  const [personnel, setPersonnel] = useState<PersonnelItem[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [ownerView, setOwnerView] = useState<OwnerView>("ALL");
  const [typeView, setTypeView] = useState<StorageTypeView>("ALL");
  const [namespaceFilter, setNamespaceFilter] = useState<string>("ALL");

  const [name, setName] = useState("");
  const [namespace, setNamespace] = useState("/org/shared");
  const [ownerType, setOwnerType] = useState<OwnerType>("ORG");
  const [ownerId, setOwnerId] = useState("");
  const [asDna, setAsDna] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");

  const [editName, setEditName] = useState("");
  const [editNamespace, setEditNamespace] = useState("");
  const [editOwnerType, setEditOwnerType] = useState<OwnerType>("ORG");
  const [editOwnerId, setEditOwnerId] = useState("");

  const employees = useMemo(() => personnel.filter((item) => item.type === "HUMAN"), [personnel]);
  const agents = useMemo(() => personnel.filter((item) => item.type === "AI"), [personnel]);
  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedAssetId) ?? null,
    [assets, selectedAssetId]
  );

  const ownerEmail = user?.email?.trim().toLowerCase() ?? "";
  const totalBytes = useMemo(() => assets.reduce((sum, item) => sum + toBytes(item.size), 0), [assets]);
  const ownerVaultAssets = useMemo(
    () =>
      assets.filter(
        (item) => item.ownerType === "OWNER" && (item.ownerId ?? "").trim().toLowerCase() === ownerEmail
      ),
    [assets, ownerEmail]
  );

  const namespaceOptions = useMemo(() => {
    const values = [...new Set(assets.map((asset) => asset.namespace).filter(Boolean))];
    return values.sort((left, right) => left.localeCompare(right));
  }, [assets]);

  const filteredAssets = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return assets.filter((asset) => {
      if (ownerView !== "ALL" && asset.ownerType !== ownerView) return false;
      if (typeView !== "ALL" && asset.type !== typeView) return false;
      if (namespaceFilter !== "ALL" && !asset.namespace.startsWith(namespaceFilter)) return false;
      if (!query) return true;
      return (
        asset.name.toLowerCase().includes(query) ||
        asset.namespace.toLowerCase().includes(query) ||
        asset.ownerType.toLowerCase().includes(query) ||
        (asset.ownerId ?? "").toLowerCase().includes(query)
      );
    });
  }, [assets, namespaceFilter, ownerView, searchQuery, typeView]);

  useEffect(() => {
    if (!selectedAsset) return;
    setEditName(selectedAsset.name);
    setEditNamespace(selectedAsset.namespace);
    setEditOwnerType(selectedAsset.ownerType);
    setEditOwnerId(selectedAsset.ownerId ?? "");
  }, [selectedAsset]);

  useEffect(() => {
    if (ownerType === "ORG") {
      setOwnerId("");
      return;
    }
    if (ownerType === "OWNER") {
      setOwnerId((current) => current || user?.email || "");
      return;
    }
    if (ownerType === "EMPLOYEE") {
      setOwnerId((current) => (employees.some((item) => item.id === current) ? current : employees[0]?.id ?? ""));
      return;
    }
    setOwnerId((current) => (agents.some((item) => item.id === current) ? current : agents[0]?.id ?? ""));
  }, [agents, employees, ownerType, user?.email]);

  useEffect(() => {
    if (editOwnerType === "ORG") {
      setEditOwnerId("");
      return;
    }
    if (editOwnerType === "OWNER") {
      setEditOwnerId((current) => current || user?.email || "");
      return;
    }
    if (editOwnerType === "EMPLOYEE") {
      setEditOwnerId((current) => (employees.some((item) => item.id === current) ? current : employees[0]?.id ?? ""));
      return;
    }
    setEditOwnerId((current) => (agents.some((item) => item.id === current) ? current : agents[0]?.id ?? ""));
  }, [agents, editOwnerType, employees, user?.email]);

  const loadAssets = useCallback(async (silent?: boolean) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const [assetResponse, personnelResponse] = await Promise.all([
        fetch(`/api/storage/assets?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" }),
        fetch(`/api/squad/personnel?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" })
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

      const loadedAssets = assetPayload.assets;
      setAssets(loadedAssets);
      setPersonnel(personnelPayload.personnel);
      setSelectedAssetId((current) =>
        current && loadedAssets.some((asset) => asset.id === current)
          ? current
          : loadedAssets[0]?.id ?? null
      );
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
  }, [notify, orgId]);

  useEffect(() => {
    void loadAssets();
    const timer = setInterval(() => void loadAssets(true), 15000);
    return () => clearInterval(timer);
  }, [loadAssets]);

  const createAsset = useCallback(async (event: FormEvent<HTMLFormElement>) => {
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

      const response = await fetch("/api/storage/assets", { method: "POST", body: formData });
      const { payload, rawText } = await parseJsonResponse<{ ok?: boolean; message?: string }>(response);
      if (!response.ok || !payload?.ok) {
        throw new Error(
          payload?.message ??
            (rawText
              ? `Failed to create storage asset (${response.status}): ${rawText.slice(0, 180)}`
              : "Failed to create storage asset.")
        );
      }

      setName("");
      setNamespace("/org/shared");
      setOwnerType("ORG");
      setOwnerId("");
      setAsDna(false);
      setFile(null);
      setSourceUrl("");
      notify({ title: "Storage", message: "Storage asset created.", type: "success" });
      await loadAssets(true);
      setSurface("EXPLORER");
    } catch (error) {
      notify({
        title: "Storage",
        message: error instanceof Error ? error.message : "Upload failed.",
        type: "error"
      });
    } finally {
      setSaving(false);
    }
  }, [asDna, file, loadAssets, name, namespace, notify, orgId, ownerId, ownerType, sourceUrl]);

  const saveAsset = useCallback(async () => {
    if (!selectedAsset) return;
    setEditing(true);
    try {
      const response = await fetch(`/api/storage/assets/${selectedAsset.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          name: editName.trim(),
          namespace: editNamespace.trim(),
          ownerType: editOwnerType,
          ownerId: editOwnerType === "ORG" ? null : editOwnerId.trim()
        })
      });
      const { payload, rawText } = await parseJsonResponse<{ ok?: boolean; message?: string }>(response);
      if (!response.ok || !payload?.ok) {
        throw new Error(
          payload?.message ??
            (rawText
              ? `Failed to save asset (${response.status}): ${rawText.slice(0, 180)}`
              : "Failed to save asset.")
        );
      }
      notify({ title: "Storage", message: "Asset filing updated.", type: "success" });
      await loadAssets(true);
    } catch (error) {
      notify({
        title: "Storage",
        message: error instanceof Error ? error.message : "Save failed.",
        type: "error"
      });
    } finally {
      setEditing(false);
    }
  }, [editName, editNamespace, editOwnerId, editOwnerType, loadAssets, notify, orgId, selectedAsset]);

  const deleteAsset = useCallback(async (assetId: string) => {
    setDeletingAssetId(assetId);
    try {
      const response = await fetch(`/api/storage/assets/${assetId}?orgId=${encodeURIComponent(orgId)}`, { method: "DELETE" });
      const { payload, rawText } = await parseJsonResponse<{ ok?: boolean; message?: string }>(response);
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
  }, [loadAssets, notify, orgId]);

  const editOwnerOptions = editOwnerType === "EMPLOYEE" ? employees : editOwnerType === "AGENT" ? agents : [];
  const uploadOwnerOptions = ownerType === "EMPLOYEE" ? employees : ownerType === "AGENT" ? agents : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">Storage Hub</p>
          <p className="text-xs text-slate-500">
            File manager for raw human and workflow files, filing, and namespace organization.
          </p>
        </div>
        <button onClick={() => void loadAssets(true)} className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-300">
          {refreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Refresh
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Stat label="Total Assets" value={String(assets.length)} />
        <Stat label="Total Storage" value={toSizeLabel(totalBytes)} />
        <Stat label="Owner Vault" value={String(ownerVaultAssets.length)} />
        <Stat label="DNA-ready" value={String(assets.filter((item) => item.type === "DNA").length)} />
      </div>

      <div className="inline-flex rounded-full border border-white/10 bg-black/25 p-1">
        {(["EXPLORER", "UPLOAD"] as StorageSurface[]).map((item) => (
          <button key={item} type="button" onClick={() => setSurface(item)} className={`rounded-full px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${surface === item ? "bg-emerald-500/15 text-emerald-300" : "text-slate-300"}`}>
            {item === "EXPLORER" ? "Explorer" : "Upload"}
          </button>
        ))}
      </div>

      {surface === "EXPLORER" ? (
        <div className="grid gap-4 xl:grid-cols-[0.3fr_0.7fr_0.65fr]">
          <div className={`vx-panel rounded-3xl p-4 ${themeStyle.border}`}>
            <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Folders</p>
            <div className="mt-3 space-y-2">
              <button onClick={() => setNamespaceFilter("ALL")} className={`w-full rounded-2xl border px-3 py-2 text-left text-xs ${namespaceFilter === "ALL" ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300" : "border-white/10 bg-black/25 text-slate-300"}`}>
                All files
              </button>
              {namespaceOptions.map((item) => (
                <button key={item} onClick={() => setNamespaceFilter(item)} className={`w-full rounded-2xl border px-3 py-2 text-left text-xs ${namespaceFilter === item ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300" : "border-white/10 bg-black/25 text-slate-300"}`}>
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className={`vx-panel rounded-3xl p-4 ${themeStyle.border}`}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-2xl border border-white/10 bg-black/35 px-3 py-2">
                <Search size={13} className="text-slate-500" />
                <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search names, owners, or folders" className="w-full bg-transparent text-xs text-slate-100 outline-none placeholder:text-slate-600" />
              </label>
              {(["ALL", "ORG", "OWNER", "EMPLOYEE", "AGENT"] as OwnerView[]).map((item) => (
                <button key={item} onClick={() => setOwnerView(item)} className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${ownerView === item ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-300" : "border-white/20 bg-white/5 text-slate-300"}`}>
                  {item}
                </button>
              ))}
              {(["ALL", "INPUT", "DNA"] as StorageTypeView[]).map((item) => (
                <button
                  key={item}
                  onClick={() => setTypeView(item)}
                  className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${
                    typeView === item
                      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
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
              <p className="text-sm text-slate-500">No files match this view.</p>
            ) : (
              <div className="space-y-2">
                {filteredAssets.map((asset) => (
                  <button key={asset.id} onClick={() => setSelectedAssetId(asset.id)} className={`w-full rounded-2xl border p-3 text-left ${selectedAssetId === asset.id ? "border-emerald-500/40 bg-emerald-500/10" : "border-white/10 bg-black/25"}`}>
                    <p className="truncate text-sm font-semibold text-slate-100">{asset.name}</p>
                    <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                      {asset.namespace} | {asset.ownerType} | {asset.provider}
                    </p>
                    <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                      {toSizeLabel(asset.size)} | {new Date(asset.updatedAt).toLocaleString()}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className={`vx-panel rounded-3xl p-4 ${themeStyle.border}`}>
            {selectedAsset ? (
              <div className="space-y-4">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Selected File</p>
                  <h3 className="mt-2 text-lg font-semibold text-slate-100">{selectedAsset.name}</h3>
                  <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                    {selectedAsset.type} | {selectedAsset.provider} | {toSizeLabel(selectedAsset.size)}
                  </p>
                </div>

                <div className="grid gap-3">
                  <input value={editName} onChange={(event) => setEditName(event.target.value)} placeholder="File name" className="rounded-2xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-slate-100 outline-none" />
                  <input value={editNamespace} onChange={(event) => setEditNamespace(event.target.value)} placeholder="Namespace / folder" className="rounded-2xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-slate-100 outline-none" />
                  <select value={editOwnerType} onChange={(event) => setEditOwnerType(event.target.value as OwnerType)} className="rounded-2xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-slate-100 outline-none">
                    <option value="ORG">ORG</option>
                    <option value="OWNER">OWNER</option>
                    <option value="EMPLOYEE">EMPLOYEE</option>
                    <option value="AGENT">AGENT</option>
                  </select>
                  {editOwnerType === "ORG" ? null : editOwnerType === "OWNER" ? (
                    <input value={editOwnerId} onChange={(event) => setEditOwnerId(event.target.value)} placeholder="Owner email" className="rounded-2xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-slate-100 outline-none" />
                  ) : (
                    <select value={editOwnerId} onChange={(event) => setEditOwnerId(event.target.value)} className="rounded-2xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-slate-100 outline-none">
                      <option value="">Select owner</option>
                      {editOwnerOptions.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} ({item.role})
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <a href={selectedAsset.url} target="_blank" rel="noreferrer" className="rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-slate-300">
                    Open
                  </a>
                  <button onClick={() => void saveAsset()} disabled={editing || (editOwnerType !== "ORG" && !editOwnerId.trim())} className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-cyan-300 disabled:opacity-60">
                    {editing ? "Saving..." : "Save filing"}
                  </button>
                  <button onClick={() => void deleteAsset(selectedAsset.id)} disabled={deletingAssetId === selectedAsset.id} className="rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-red-300 disabled:opacity-60">
                    {deletingAssetId === selectedAsset.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Select a file from the explorer to manage its filing.</p>
            )}
          </div>
        </div>
      ) : (
        <form onSubmit={createAsset} className={`vx-panel space-y-4 rounded-3xl p-5 ${themeStyle.border}`}>
          <div className="grid gap-3 md:grid-cols-2">
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Asset name" className="rounded-2xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-slate-100 outline-none" required />
            <input value={namespace} onChange={(event) => setNamespace(event.target.value)} placeholder="/org/shared, /owner/main, /employee/{id}" className="rounded-2xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-slate-100 outline-none" />
          </div>

          <div className="flex flex-wrap gap-2">
            {(["ORG", "OWNER", "EMPLOYEE", "AGENT"] as OwnerType[]).map((item) => (
              <button key={item} type="button" onClick={() => setOwnerType(item)} className={`rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] ${ownerType === item ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300" : "border-white/20 bg-white/5 text-slate-300"}`}>
                {item}
              </button>
            ))}
          </div>

          {ownerType === "ORG" ? null : ownerType === "OWNER" ? (
            <input value={ownerId} onChange={(event) => setOwnerId(event.target.value)} placeholder="Owner email" className="w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-slate-100 outline-none" />
          ) : (
            <select value={ownerId} onChange={(event) => setOwnerId(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-slate-100 outline-none">
              <option value="">Select owner</option>
              {uploadOwnerOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.role})
                </option>
              ))}
            </select>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <input type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="rounded-2xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-slate-100 outline-none file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-xs" />
            <input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="or external URL" className="rounded-2xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-slate-100 outline-none" />
          </div>

          <label className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-slate-400">
            <input type="checkbox" checked={asDna} onChange={(event) => setAsDna(event.target.checked)} />
            Mark as DNA-ready asset
          </label>

          <button type="submit" disabled={saving || (ownerType !== "ORG" && !ownerId.trim())} className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-black transition hover:bg-emerald-500 hover:text-white disabled:opacity-60">
            {saving ? <Loader2 size={12} className="animate-spin" /> : <UploadCloud size={12} />}
            Upload Asset
          </button>
        </form>
      )}
    </div>
  );
}
