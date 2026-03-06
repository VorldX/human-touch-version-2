"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { useVorldXStore } from "@/lib/store/vorldx-store";

type Lane = "webhooks" | "identity" | "rails" | "orchestration";
type RuntimeMode = "BYOK" | "PLATFORM_MANAGED";
type ServicePlan = "STARTER" | "GROWTH" | "ENTERPRISE";
type ExecutionMode = "ECO" | "BALANCED" | "TURBO";

interface WebhookItem {
  id: string;
  targetUrl: string;
  eventType: string;
  isActive: boolean;
}

interface RailItem {
  id: string;
  name: string;
  railType: string;
  baseUrl: string;
  region: string | null;
  isActive: boolean;
}

interface IdentityAccount {
  id: string;
  provider: "GOOGLE" | "LINKEDIN" | "X";
  delegatedAgentIds: string[];
  user: { username: string; email: string };
}

interface IdentityAgent {
  id: string;
  name: string;
  role: string;
  delegatedAccountIds: string[];
  hasPrimaryBrainKey: boolean;
  hasFallbackBrainKey: boolean;
}

interface OrganizationLlmSettings {
  mode: RuntimeMode;
  executionMode: ExecutionMode;
  provider: string;
  model: string;
  fallbackProvider: string;
  fallbackModel: string;
  servicePlan: ServicePlan;
  serviceMarkupPct: number;
  hasOrganizationApiKey: boolean;
  configuredApiKeyProviders: string[];
  updatedAt: string | null;
}

interface OrgCreditsWallet {
  balanceCredits: number;
  lowBalanceThreshold: number;
  autoRechargeEnabled: boolean;
  updatedAt: string | null;
}

interface SettingsConsoleProps {
  orgId: string;
  themeStyle: { accent: string; accentSoft: string; border: string };
  initialLane?: Lane;
}

function shortProvider(provider: IdentityAccount["provider"]) {
  if (provider === "GOOGLE") return "GO";
  if (provider === "LINKEDIN") return "LI";
  return "X";
}

function defaultMarkup(plan: ServicePlan) {
  if (plan === "ENTERPRISE") return 12;
  if (plan === "GROWTH") return 18;
  return 25;
}

export function SettingsConsole({ orgId, themeStyle, initialLane }: SettingsConsoleProps) {
  const notify = useVorldXStore((state) => state.pushNotification);

  const [lane, setLane] = useState<Lane>(initialLane ?? "webhooks");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [webhooks, setWebhooks] = useState<WebhookItem[]>([]);
  const [rails, setRails] = useState<RailItem[]>([]);
  const [accounts, setAccounts] = useState<IdentityAccount[]>([]);
  const [agents, setAgents] = useState<IdentityAgent[]>([]);
  const [llmSettings, setLlmSettings] = useState<OrganizationLlmSettings>({
    mode: "BYOK",
    executionMode: "BALANCED",
    provider: "OpenAI",
    model: "gpt-4o-mini",
    fallbackProvider: "Anthropic",
    fallbackModel: "claude-3-5-sonnet",
    servicePlan: "STARTER",
    serviceMarkupPct: 25,
    hasOrganizationApiKey: false,
    configuredApiKeyProviders: [],
    updatedAt: null
  });

  const [newWebhookUrl, setNewWebhookUrl] = useState("");
  const [newWebhookEvent, setNewWebhookEvent] = useState("TASK_UPDATED");
  const [newRailName, setNewRailName] = useState("");
  const [newRailUrl, setNewRailUrl] = useState("");
  const [newRailType, setNewRailType] = useState("ONDC");
  const [newRailRegion, setNewRailRegion] = useState("India");
  const [primaryProviderApiKey, setPrimaryProviderApiKey] = useState("");
  const [fallbackProviderApiKey, setFallbackProviderApiKey] = useState("");
  const [savingLlm, setSavingLlm] = useState(false);
  const [creditsWallet, setCreditsWallet] = useState<OrgCreditsWallet>({
    balanceCredits: 0,
    lowBalanceThreshold: 1000,
    autoRechargeEnabled: false,
    updatedAt: null
  });
  const [creditsRechargeInput, setCreditsRechargeInput] = useState("");
  const [savingCredits, setSavingCredits] = useState(false);

  const accountLabelById = useMemo(
    () =>
      new Map(
        accounts.map((item) => [item.id, `${shortProvider(item.provider)}:${item.user.username || item.user.email}`])
      ),
    [accounts]
  );

  const loadSettings = useCallback(
    async (silent?: boolean) => {
      if (silent) setRefreshing(true);
      else setLoading(true);

      try {
        const [webhooksRes, railsRes, identityRes, llmRes, creditsRes] = await Promise.all([
          fetch(`/api/settings/webhooks?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" }),
          fetch(`/api/settings/rails?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" }),
          fetch(`/api/settings/identity?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" }),
          fetch(`/api/settings/llm?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" }),
          fetch(`/api/settings/credits?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" })
        ]);

        const webhooksPayload = (await webhooksRes.json()) as { ok?: boolean; message?: string; webhooks?: WebhookItem[] };
        const railsPayload = (await railsRes.json()) as { ok?: boolean; message?: string; rails?: RailItem[] };
        const identityPayload = (await identityRes.json()) as {
          ok?: boolean;
          message?: string;
          accounts?: IdentityAccount[];
          agents?: IdentityAgent[];
        };
        const llmPayload = (await llmRes.json()) as {
          ok?: boolean;
          message?: string;
          settings?: OrganizationLlmSettings;
          executionMode?: ExecutionMode;
        };
        const creditsPayload = (await creditsRes.json()) as {
          ok?: boolean;
          message?: string;
          wallet?: OrgCreditsWallet;
        };

        if (!webhooksRes.ok || !webhooksPayload.ok) throw new Error(webhooksPayload.message ?? "Failed loading webhooks.");
        if (!railsRes.ok || !railsPayload.ok) throw new Error(railsPayload.message ?? "Failed loading rails.");
        if (!identityRes.ok || !identityPayload.ok) throw new Error(identityPayload.message ?? "Failed loading identity.");
        if (!llmRes.ok || !llmPayload.ok || !llmPayload.settings) throw new Error(llmPayload.message ?? "Failed loading orchestration.");
        if (!creditsRes.ok || !creditsPayload.ok || !creditsPayload.wallet) throw new Error(creditsPayload.message ?? "Failed loading credits.");

        setError(null);
        setWebhooks(webhooksPayload.webhooks ?? []);
        setRails(railsPayload.rails ?? []);
        setAccounts(identityPayload.accounts ?? []);
        setAgents(identityPayload.agents ?? []);
        setLlmSettings({
          ...llmPayload.settings,
          executionMode: llmPayload.executionMode ?? llmPayload.settings.executionMode ?? "BALANCED"
        });
        setCreditsWallet(creditsPayload.wallet);
        setPrimaryProviderApiKey("");
        setFallbackProviderApiKey("");
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Failed loading settings.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [orgId]
  );

  useEffect(() => {
    void loadSettings();
    const interval = setInterval(() => void loadSettings(true), 12000);
    return () => clearInterval(interval);
  }, [loadSettings]);

  useEffect(() => {
    if (!initialLane) return;
    setLane(initialLane);
  }, [initialLane]);

  const createWebhook = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const response = await fetch("/api/settings/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          targetUrl: newWebhookUrl.trim(),
          eventType: newWebhookEvent,
          isActive: true
        })
      });
      const payload = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || !payload.ok) {
        notify({ title: "Webhook", message: payload.message ?? "Create failed.", type: "error" });
        return;
      }
      setNewWebhookUrl("");
      setNewWebhookEvent("TASK_UPDATED");
      void loadSettings(true);
    },
    [newWebhookEvent, newWebhookUrl, notify, orgId, loadSettings]
  );

  const toggleWebhook = useCallback(
    async (item: WebhookItem) => {
      await fetch(`/api/settings/webhooks/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, isActive: !item.isActive })
      });
      void loadSettings(true);
    },
    [orgId, loadSettings]
  );

  const deleteWebhook = useCallback(
    async (item: WebhookItem) => {
      await fetch(`/api/settings/webhooks/${item.id}?orgId=${encodeURIComponent(orgId)}`, { method: "DELETE" });
      void loadSettings(true);
    },
    [orgId, loadSettings]
  );

  const createRail = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const response = await fetch("/api/settings/rails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          name: newRailName.trim(),
          railType: newRailType,
          baseUrl: newRailUrl.trim(),
          region: newRailRegion.trim(),
          isActive: true,
          config: { network: "mainnet" }
        })
      });
      const payload = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || !payload.ok) {
        notify({ title: "Rail", message: payload.message ?? "Create failed.", type: "error" });
        return;
      }
      setNewRailName("");
      setNewRailUrl("");
      setNewRailRegion("India");
      setNewRailType("ONDC");
      void loadSettings(true);
    },
    [newRailName, newRailRegion, newRailType, newRailUrl, notify, orgId, loadSettings]
  );

  const toggleRail = useCallback(
    async (item: RailItem) => {
      await fetch(`/api/settings/rails/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, isActive: !item.isActive })
      });
      void loadSettings(true);
    },
    [orgId, loadSettings]
  );

  const deleteRail = useCallback(
    async (item: RailItem) => {
      await fetch(`/api/settings/rails/${item.id}?orgId=${encodeURIComponent(orgId)}`, { method: "DELETE" });
      void loadSettings(true);
    },
    [orgId, loadSettings]
  );

  const saveOrchestration = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setSavingLlm(true);
      try {
        const providerApiKeys: Record<string, string> = {};
        if (llmSettings.mode === "BYOK") {
          const primaryKey = primaryProviderApiKey.trim();
          const fallbackKey = fallbackProviderApiKey.trim();
          if (primaryKey) {
            providerApiKeys[llmSettings.provider] = primaryKey;
          }
          if (fallbackKey) {
            providerApiKeys[llmSettings.fallbackProvider] = fallbackKey;
          }
        }

        const response = await fetch("/api/settings/llm", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orgId,
            mode: llmSettings.mode,
            executionMode: llmSettings.executionMode,
            provider: llmSettings.provider,
            model: llmSettings.model,
            fallbackProvider: llmSettings.fallbackProvider,
            fallbackModel: llmSettings.fallbackModel,
            servicePlan: llmSettings.servicePlan,
            serviceMarkupPct: llmSettings.serviceMarkupPct,
            ...(llmSettings.mode === "BYOK" && Object.keys(providerApiKeys).length > 0
              ? { providerApiKeys }
              : {})
          })
        });
        const payload = (await response.json()) as {
          ok?: boolean;
          message?: string;
          settings?: OrganizationLlmSettings;
          executionMode?: ExecutionMode;
        };
        if (!response.ok || !payload.ok || !payload.settings) {
          throw new Error(payload.message ?? "Save failed.");
        }
        setLlmSettings({
          ...payload.settings,
          executionMode: payload.executionMode ?? payload.settings.executionMode ?? llmSettings.executionMode
        });
        setPrimaryProviderApiKey("");
        setFallbackProviderApiKey("");
      } catch (requestError) {
        notify({
          title: "Orchestration",
          message: requestError instanceof Error ? requestError.message : "Save failed.",
          type: "error"
        });
      } finally {
        setSavingLlm(false);
      }
    },
    [fallbackProviderApiKey, llmSettings, notify, orgId, primaryProviderApiKey]
  );

  const saveCreditsWallet = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setSavingCredits(true);
      try {
        const trimmedRecharge = creditsRechargeInput.trim();
        const parsedRecharge = trimmedRecharge ? Number.parseFloat(trimmedRecharge) : 0;
        if (trimmedRecharge && (!Number.isFinite(parsedRecharge) || parsedRecharge <= 0)) {
          throw new Error("Recharge credits must be a positive number.");
        }

        const response = await fetch("/api/settings/credits", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orgId,
            ...(parsedRecharge > 0 ? { rechargeCredits: parsedRecharge } : {}),
            lowBalanceThreshold: creditsWallet.lowBalanceThreshold,
            autoRechargeEnabled: creditsWallet.autoRechargeEnabled
          })
        });

        const payload = (await response.json()) as {
          ok?: boolean;
          message?: string;
          wallet?: OrgCreditsWallet;
        };

        if (!response.ok || !payload.ok || !payload.wallet) {
          throw new Error(payload.message ?? "Credits update failed.");
        }

        setCreditsWallet(payload.wallet);
        setCreditsRechargeInput("");
      } catch (requestError) {
        notify({
          title: "Credits",
          message:
            requestError instanceof Error ? requestError.message : "Credits update failed.",
          type: "error"
        });
      } finally {
        setSavingCredits(false);
      }
    },
    [creditsRechargeInput, creditsWallet.autoRechargeEnabled, creditsWallet.lowBalanceThreshold, notify, orgId]
  );

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
        <h2 className="font-display text-3xl font-black uppercase tracking-tight md:text-4xl">Settings</h2>
        <button
          onClick={() => void loadSettings(true)}
          className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-200"
        >
          {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["webhooks", "identity", "rails", "orchestration"] as Lane[]).map((item) => (
          <button
            key={item}
            onClick={() => setLane(item)}
            className={`rounded-full border px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] ${lane === item ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300" : "border-white/20 bg-white/5 text-slate-300"}`}
          >
            {item}
          </button>
        ))}
      </div>

      {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}

      {loading ? (
        <div className="inline-flex items-center gap-2 text-sm text-slate-400"><Loader2 size={14} className="animate-spin" /> Loading...</div>
      ) : lane === "webhooks" ? (
        <div className={`vx-panel space-y-3 rounded-3xl p-4 ${themeStyle.border}`}>
          <form onSubmit={createWebhook} className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
            <input value={newWebhookUrl} onChange={(event) => setNewWebhookUrl(event.target.value)} placeholder="https://endpoint.example.com/webhook" className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none" required />
            <select value={newWebhookEvent} onChange={(event) => setNewWebhookEvent(event.target.value)} className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none">
              <option>TASK_UPDATED</option><option>FLOW_PAUSED</option><option>FLOW_COMPLETED</option><option>FLOW_ABORTED</option><option>HUMAN_TOUCH_REQUIRED</option><option>KILL_SWITCH</option>
            </select>
            <button type="submit" className="rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.14em] text-slate-200">Add</button>
          </form>
          {webhooks.map((item) => (
            <div key={item.id} className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/30 px-3 py-2">
              <div className="text-xs text-slate-200">
                {item.eventType}
                {" -> "}
                {item.targetUrl}
              </div>
              <div className="flex gap-2">
                <button onClick={() => void toggleWebhook(item)} className="rounded-lg border border-white/20 bg-white/5 px-2 py-1 text-[10px] uppercase text-slate-300">{item.isActive ? "Deactivate" : "Activate"}</button>
                <button onClick={() => void deleteWebhook(item)} className="rounded-lg border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] uppercase text-red-300">Delete</button>
              </div>
            </div>
          ))}
        </div>
      ) : lane === "identity" ? (
        <div className={`vx-panel space-y-3 rounded-3xl p-4 ${themeStyle.border}`}>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">OAuth Accounts</p>
          {accounts.map((account) => (
            <div key={account.id} className="rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-slate-200">
              {shortProvider(account.provider)} | {account.user.username || account.user.email} | Delegations: {account.delegatedAgentIds.length}
            </div>
          ))}
          <p className="pt-2 text-xs uppercase tracking-[0.18em] text-slate-500">Agents</p>
          {agents.map((agent) => (
            <div key={agent.id} className="rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-slate-200">
              {agent.name} ({agent.role}) | Primary:{agent.hasPrimaryBrainKey ? "Y" : "N"} | Fallback:{agent.hasFallbackBrainKey ? "Y" : "N"}
              <div className="mt-1 text-slate-400">{agent.delegatedAccountIds.map((id) => accountLabelById.get(id) ?? id).join(", ") || "No OAuth assignments"}</div>
            </div>
          ))}
        </div>
      ) : lane === "rails" ? (
        <div className={`vx-panel space-y-3 rounded-3xl p-4 ${themeStyle.border}`}>
          <form onSubmit={createRail} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
            <input value={newRailName} onChange={(event) => setNewRailName(event.target.value)} placeholder="Rail name" className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none" required />
            <input value={newRailUrl} onChange={(event) => setNewRailUrl(event.target.value)} placeholder="https://api.rail.example.com" className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none" required />
            <button type="submit" className="rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.14em] text-slate-200">Add</button>
            <select value={newRailType} onChange={(event) => setNewRailType(event.target.value)} className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"><option value="ONDC">ONDC</option><option value="CUSTOM">CUSTOM</option></select>
            <input value={newRailRegion} onChange={(event) => setNewRailRegion(event.target.value)} placeholder="Region" className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none" />
          </form>
          {rails.map((item) => (
            <div key={item.id} className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/30 px-3 py-2">
              <div className="text-xs text-slate-200">{item.name} | {item.railType} | {item.baseUrl}</div>
              <div className="flex gap-2">
                <button onClick={() => void toggleRail(item)} className="rounded-lg border border-white/20 bg-white/5 px-2 py-1 text-[10px] uppercase text-slate-300">{item.isActive ? "Deactivate" : "Activate"}</button>
                <button onClick={() => void deleteRail(item)} className="rounded-lg border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] uppercase text-red-300">Delete</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={`vx-panel space-y-4 rounded-3xl p-4 ${themeStyle.border}`}>
          <form onSubmit={saveOrchestration} className="space-y-3">
            <div className="grid gap-2 md:grid-cols-3">
              <label className="text-xs text-slate-300">
                Mode
                <select
                  value={llmSettings.mode}
                  onChange={(event) => {
                    const nextMode = event.target.value as RuntimeMode;
                    setLlmSettings((prev) => ({
                      ...prev,
                      mode: nextMode
                    }));
                    if (nextMode === "PLATFORM_MANAGED") {
                      setPrimaryProviderApiKey("");
                      setFallbackProviderApiKey("");
                    }
                  }}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                >
                  <option value="BYOK">BYOK</option>
                  <option value="PLATFORM_MANAGED">PLATFORM_MANAGED</option>
                </select>
              </label>
              <label className="text-xs text-slate-300">
                Plan
                <select
                  value={llmSettings.servicePlan}
                  onChange={(event) =>
                    setLlmSettings((prev) => ({
                      ...prev,
                      servicePlan: event.target.value as ServicePlan,
                      serviceMarkupPct: defaultMarkup(event.target.value as ServicePlan)
                    }))
                  }
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                >
                  <option value="STARTER">STARTER</option>
                  <option value="GROWTH">GROWTH</option>
                  <option value="ENTERPRISE">ENTERPRISE</option>
                </select>
              </label>
              <label className="text-xs text-slate-300">
                Execution Mode
                <select
                  value={llmSettings.executionMode}
                  onChange={(event) =>
                    setLlmSettings((prev) => ({
                      ...prev,
                      executionMode: event.target.value as ExecutionMode
                    }))
                  }
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                >
                  <option value="ECO">ECO</option>
                  <option value="BALANCED">BALANCED</option>
                  <option value="TURBO">TURBO</option>
                </select>
              </label>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <input
                value={llmSettings.provider}
                onChange={(event) =>
                  setLlmSettings((prev) => ({ ...prev, provider: event.target.value }))
                }
                placeholder="Primary provider"
                className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
              />
              <input
                value={llmSettings.model}
                onChange={(event) =>
                  setLlmSettings((prev) => ({ ...prev, model: event.target.value }))
                }
                placeholder="Primary model"
                className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
              />
              <input
                value={llmSettings.fallbackProvider}
                onChange={(event) =>
                  setLlmSettings((prev) => ({ ...prev, fallbackProvider: event.target.value }))
                }
                placeholder="Fallback provider"
                className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
              />
              <input
                value={llmSettings.fallbackModel}
                onChange={(event) =>
                  setLlmSettings((prev) => ({ ...prev, fallbackModel: event.target.value }))
                }
                placeholder="Fallback model"
                className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
              />
            </div>
            <input
              type="number"
              min={0}
              max={200}
              step={0.1}
              value={llmSettings.serviceMarkupPct}
              onChange={(event) =>
                setLlmSettings((prev) => ({
                  ...prev,
                  serviceMarkupPct: Number(event.target.value) || 0
                }))
              }
              className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
            />

            {llmSettings.mode === "BYOK" ? (
              <div className="grid gap-2 md:grid-cols-2">
                <label className="text-xs text-slate-300">
                  {llmSettings.provider} API key (Primary)
                  <input
                    type="password"
                    value={primaryProviderApiKey}
                    onChange={(event) => setPrimaryProviderApiKey(event.target.value)}
                    placeholder={`Paste ${llmSettings.provider} key`}
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                  />
                </label>
                <label className="text-xs text-slate-300">
                  {llmSettings.fallbackProvider} API key (Fallback)
                  <input
                    type="password"
                    value={fallbackProviderApiKey}
                    onChange={(event) => setFallbackProviderApiKey(event.target.value)}
                    placeholder={`Paste ${llmSettings.fallbackProvider} key`}
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                  />
                </label>
              </div>
            ) : (
              <p className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs text-blue-200">
                Platform-managed mode uses company-managed provider keys. Organization users only
                choose models and manage credits.
              </p>
            )}

            <div className="text-xs text-slate-400">
              Configured providers:{" "}
              {llmSettings.configuredApiKeyProviders.length > 0
                ? llmSettings.configuredApiKeyProviders.join(", ")
                : "None"}
              {" | "}Updated:{" "}
              {llmSettings.updatedAt ? new Date(llmSettings.updatedAt).toLocaleString() : "Never"}
            </div>
            <button
              type="submit"
              disabled={savingLlm}
              className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-black transition hover:bg-emerald-500 hover:text-white disabled:opacity-60"
            >
              {savingLlm ? <Loader2 size={14} className="animate-spin" /> : null}
              Save Orchestration Settings
            </button>
          </form>

          {llmSettings.mode === "PLATFORM_MANAGED" ? (
            <form
              onSubmit={saveCreditsWallet}
              className="space-y-3 rounded-2xl border border-white/10 bg-black/30 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">
                  Platform Credit Wallet
                </p>
                <p className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-emerald-300">
                  Balance {creditsWallet.balanceCredits.toLocaleString()}
                </p>
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                <label className="text-xs text-slate-300">
                  Recharge Credits
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={creditsRechargeInput}
                    onChange={(event) => setCreditsRechargeInput(event.target.value)}
                    placeholder="e.g. 100000"
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                  />
                </label>
                <label className="text-xs text-slate-300">
                  Low Balance Threshold
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={creditsWallet.lowBalanceThreshold}
                    onChange={(event) =>
                      setCreditsWallet((prev) => ({
                        ...prev,
                        lowBalanceThreshold: Number(event.target.value) || 0
                      }))
                    }
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                  />
                </label>
              </div>

              <label className="inline-flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={creditsWallet.autoRechargeEnabled}
                  onChange={(event) =>
                    setCreditsWallet((prev) => ({
                      ...prev,
                      autoRechargeEnabled: event.target.checked
                    }))
                  }
                />
                Auto-recharge when low threshold is reached
              </label>

              <p className="text-xs text-slate-400">
                Updated:{" "}
                {creditsWallet.updatedAt
                  ? new Date(creditsWallet.updatedAt).toLocaleString()
                  : "Never"}
              </p>

              <button
                type="submit"
                disabled={savingCredits}
                className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-200 transition hover:bg-white/10 disabled:opacity-60"
              >
                {savingCredits ? <Loader2 size={14} className="animate-spin" /> : null}
                Save Credit Settings
              </button>
            </form>
          ) : null}
        </div>
      )}
    </div>
  );
}
