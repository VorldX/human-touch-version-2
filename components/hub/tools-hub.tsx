"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Loader2, PlugZap, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";

import { IntegrationsConsole } from "@/components/settings/integrations-console";
import { useVorldXStore } from "@/lib/store/vorldx-store";

type ToolName = "GOOGLE_DRIVE" | "S3_COMPATIBLE" | "MANAGED_VAULT";
type PrincipalType = "OWNER" | "EMPLOYEE" | "AGENT";

interface StorageTool {
  key: ToolName;
  label: string;
  description: string;
  enabled: boolean;
}

interface StorageConnector {
  id: string;
  name: string;
  provider: "GOOGLE_DRIVE" | "S3_COMPATIBLE";
  status: "CONNECTED" | "PENDING" | "ERROR" | "DISCONNECTED";
  accountHint: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ToolGrant {
  id: string;
  tool: ToolName;
  principalType: PrincipalType;
  principalId: string;
  capabilities: string[];
}

interface ToolsHubProps {
  orgId: string;
  themeStyle: {
    border: string;
  };
}

export function ToolsHub({ orgId, themeStyle }: ToolsHubProps) {
  const notify = useVorldXStore((state) => state.pushNotification);
  const [toolSurface, setToolSurface] = useState<"INTEGRATIONS" | "STORAGE">("INTEGRATIONS");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tools, setTools] = useState<StorageTool[]>([]);
  const [connectors, setConnectors] = useState<StorageConnector[]>([]);
  const [grants, setGrants] = useState<ToolGrant[]>([]);

  const [connectorName, setConnectorName] = useState("Google Drive Connector");
  const [connectorProvider, setConnectorProvider] = useState<"GOOGLE_DRIVE" | "S3_COMPATIBLE">(
    "GOOGLE_DRIVE"
  );
  const [connectorAccountHint, setConnectorAccountHint] = useState("");
  const [connectorCredential, setConnectorCredential] = useState("");
  const [connectorSaving, setConnectorSaving] = useState(false);

  const [grantTool, setGrantTool] = useState<ToolName>("GOOGLE_DRIVE");
  const [grantPrincipalType, setGrantPrincipalType] = useState<PrincipalType>("EMPLOYEE");
  const [grantPrincipalId, setGrantPrincipalId] = useState("");
  const [grantCapabilities, setGrantCapabilities] = useState("read,write");
  const [grantSaving, setGrantSaving] = useState(false);

  const loadTools = useCallback(
    async (silent?: boolean) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        const response = await fetch(`/api/storage/tools?orgId=${encodeURIComponent(orgId)}`, {
          cache: "no-store"
        });
        const payload = (await response.json()) as {
          ok?: boolean;
          message?: string;
          tools?: StorageTool[];
          connectors?: StorageConnector[];
          grants?: ToolGrant[];
        };
        if (!response.ok || !payload.ok) {
          throw new Error(payload.message ?? "Failed loading organization tools.");
        }
        setTools(payload.tools ?? []);
        setConnectors(payload.connectors ?? []);
        setGrants(payload.grants ?? []);
      } catch (error) {
        notify({
          title: "Tools",
          message: error instanceof Error ? error.message : "Unable to load tools.",
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
    if (toolSurface !== "STORAGE") {
      return;
    }
    void loadTools();
    const timer = setInterval(() => void loadTools(true), 15000);
    return () => clearInterval(timer);
  }, [loadTools, toolSurface]);

  const createConnector = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setConnectorSaving(true);
      try {
        const response = await fetch("/api/storage/connectors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orgId,
            name: connectorName.trim(),
            provider: connectorProvider,
            accountHint: connectorAccountHint.trim() || null,
            credential: connectorCredential.trim() || null
          })
        });
        const payload = (await response.json()) as { ok?: boolean; message?: string };
        if (!response.ok || !payload.ok) {
          throw new Error(payload.message ?? "Connector creation failed.");
        }
        setConnectorAccountHint("");
        setConnectorCredential("");
        await loadTools(true);
      } catch (error) {
        notify({
          title: "Tools",
          message: error instanceof Error ? error.message : "Connector creation failed.",
          type: "error"
        });
      } finally {
        setConnectorSaving(false);
      }
    },
    [connectorAccountHint, connectorCredential, connectorName, connectorProvider, loadTools, notify, orgId]
  );

  const createGrant = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setGrantSaving(true);
      try {
        const response = await fetch("/api/storage/tools", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orgId,
            tool: grantTool,
            principalType: grantPrincipalType,
            principalId: grantPrincipalId.trim(),
            capabilities: grantCapabilities
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean)
          })
        });
        const payload = (await response.json()) as { ok?: boolean; message?: string };
        if (!response.ok || !payload.ok) {
          throw new Error(payload.message ?? "Grant creation failed.");
        }
        setGrantPrincipalId("");
        await loadTools(true);
      } catch (error) {
        notify({
          title: "Tools",
          message: error instanceof Error ? error.message : "Grant creation failed.",
          type: "error"
        });
      } finally {
        setGrantSaving(false);
      }
    },
    [grantCapabilities, grantPrincipalId, grantPrincipalType, grantTool, loadTools, notify, orgId]
  );

  const deleteGrant = useCallback(
    async (grantId: string) => {
      const response = await fetch(
        `/api/storage/tools?orgId=${encodeURIComponent(orgId)}&grantId=${encodeURIComponent(grantId)}`,
        { method: "DELETE" }
      );
      const payload = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || !payload.ok) {
        notify({
          title: "Tools",
          message: payload.message ?? "Delete grant failed.",
          type: "error"
        });
        return;
      }
      await loadTools(true);
    },
    [loadTools, notify, orgId]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">Organizational Tools</p>
        {toolSurface === "STORAGE" ? (
          <button
            onClick={() => void loadTools(true)}
            className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-300"
          >
            {refreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Refresh
          </button>
        ) : null}
      </div>

      <div className="inline-flex rounded-full border border-white/10 bg-black/25 p-1">
        <button
          type="button"
          onClick={() => setToolSurface("INTEGRATIONS")}
          className={`rounded-full px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${
            toolSurface === "INTEGRATIONS"
              ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
              : "text-slate-300"
          }`}
        >
          App Integrations
        </button>
        <button
          type="button"
          onClick={() => setToolSurface("STORAGE")}
          className={`rounded-full px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${
            toolSurface === "STORAGE"
              ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
              : "text-slate-300"
          }`}
        >
          Storage Tools
        </button>
      </div>

      {toolSurface === "INTEGRATIONS" ? (
        <IntegrationsConsole orgId={orgId} themeStyle={{ border: themeStyle.border }} />
      ) : (
        <>
          <div className={`vx-panel rounded-2xl p-3 ${themeStyle.border}`}>
            {loading ? (
              <div className="inline-flex items-center gap-2 text-sm text-slate-400">
                <Loader2 size={14} className="animate-spin" />
                Loading tools...
              </div>
            ) : (
              <div className="space-y-2">
                {tools.map((tool) => (
                  <article key={tool.key} className="rounded-xl border border-white/10 bg-black/25 p-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white">{tool.label}</p>
                    <p className="text-xs text-slate-400">{tool.description}</p>
                    <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                      {tool.enabled ? "CONNECTED" : "NOT CONNECTED"}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </div>

          <form onSubmit={createConnector} className={`vx-panel space-y-2 rounded-2xl p-3 ${themeStyle.border}`}>
        <p className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-slate-500">
          <PlugZap size={12} />
          Add Connector
        </p>
        <div className="grid gap-2 md:grid-cols-2">
          <input
            value={connectorName}
            onChange={(event) => setConnectorName(event.target.value)}
            className="rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-sm text-slate-100 outline-none"
            placeholder="Connector name"
            required
          />
          <select
            value={connectorProvider}
            onChange={(event) => setConnectorProvider(event.target.value as "GOOGLE_DRIVE" | "S3_COMPATIBLE")}
            className="rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-sm text-slate-100 outline-none"
          >
            <option value="GOOGLE_DRIVE">GOOGLE_DRIVE</option>
            <option value="S3_COMPATIBLE">S3_COMPATIBLE</option>
          </select>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          <input
            value={connectorAccountHint}
            onChange={(event) => setConnectorAccountHint(event.target.value)}
            className="rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-sm text-slate-100 outline-none"
            placeholder="Account hint (email/bucket)"
          />
          <input
            value={connectorCredential}
            onChange={(event) => setConnectorCredential(event.target.value)}
            className="rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-sm text-slate-100 outline-none"
            placeholder="Credential/token (test mode)"
          />
        </div>
        <button
          type="submit"
          disabled={connectorSaving}
          className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-black transition hover:bg-emerald-500 hover:text-white disabled:opacity-60"
        >
          {connectorSaving ? <Loader2 size={12} className="animate-spin" /> : <PlugZap size={12} />}
          Connect
        </button>

        <div className="space-y-2">
          {connectors.map((connector) => (
            <article key={connector.id} className="rounded-xl border border-white/10 bg-black/25 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white">
                {connector.name}
              </p>
              <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                {connector.provider} | {connector.status}
              </p>
              <p className="text-xs text-slate-400">
                {connector.accountHint || "No account hint provided"}
              </p>
            </article>
          ))}
        </div>
          </form>

          <form onSubmit={createGrant} className={`vx-panel space-y-2 rounded-2xl p-3 ${themeStyle.border}`}>
        <p className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-slate-500">
          <ShieldCheck size={12} />
          Tool Grants
        </p>
        <div className="grid gap-2 md:grid-cols-3">
          <select
            value={grantTool}
            onChange={(event) => setGrantTool(event.target.value as ToolName)}
            className="rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-sm text-slate-100 outline-none"
          >
            <option value="GOOGLE_DRIVE">GOOGLE_DRIVE</option>
            <option value="S3_COMPATIBLE">S3_COMPATIBLE</option>
            <option value="MANAGED_VAULT">MANAGED_VAULT</option>
          </select>
          <select
            value={grantPrincipalType}
            onChange={(event) => setGrantPrincipalType(event.target.value as PrincipalType)}
            className="rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-sm text-slate-100 outline-none"
          >
            <option value="OWNER">OWNER</option>
            <option value="EMPLOYEE">EMPLOYEE</option>
            <option value="AGENT">AGENT</option>
          </select>
          <input
            value={grantPrincipalId}
            onChange={(event) => setGrantPrincipalId(event.target.value)}
            className="rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-sm text-slate-100 outline-none"
            placeholder="Principal ID"
            required
          />
        </div>
        <input
          value={grantCapabilities}
          onChange={(event) => setGrantCapabilities(event.target.value)}
          className="w-full rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-sm text-slate-100 outline-none"
          placeholder="Capabilities: read,write,ingest"
        />
        <button
          type="submit"
          disabled={grantSaving}
          className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-black transition hover:bg-emerald-500 hover:text-white disabled:opacity-60"
        >
          {grantSaving ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />}
          Save Grant
        </button>

        <div className="space-y-2">
          {grants.map((grant) => (
            <article key={grant.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-black/25 p-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white">
                  {grant.tool}
                  {" -> "}
                  {grant.principalType}:{grant.principalId}
                </p>
                <p className="text-xs text-slate-400">{grant.capabilities.join(", ") || "No capabilities"}</p>
              </div>
              <button
                onClick={() => void deleteGrant(grant.id)}
                className="rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-red-300"
              >
                <Trash2 size={12} />
              </button>
            </article>
          ))}
        </div>
          </form>
        </>
      )}
    </div>
  );
}
