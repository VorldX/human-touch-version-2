"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, Link2, Loader2, RefreshCw, Search, Unplug, X } from "lucide-react";

import { useFirebaseAuth } from "@/components/auth/firebase-auth-provider";
import { useVorldXStore } from "@/lib/store/vorldx-store";

interface ToolkitItem {
  slug: string;
  name: string;
  description: string;
  logoUrl: string | null;
  appUrl: string | null;
  status: string;
  connected: boolean;
  connectionId: string | null;
}

interface ConnectionItem {
  id: string;
  userId: string;
  orgId: string | null;
  provider: string;
  toolkit: string;
  connectionId: string;
  status: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface IntegrationsConsoleProps {
  orgId: string;
  themeStyle: {
    border: string;
  };
}

interface AppPopupState {
  toolkit: string;
  name: string;
  url: string;
}

const TOOLKIT_APP_FALLBACKS: Record<string, string> = {
  gmail: "https://mail.google.com",
  slack: "https://app.slack.com/client",
  notion: "https://www.notion.so",
  github: "https://github.com",
  googlecalendar: "https://calendar.google.com",
  googledrive: "https://drive.google.com",
  googledocs: "https://docs.google.com/document",
  googlesheets: "https://docs.google.com/spreadsheets",
  outlook: "https://outlook.live.com",
  microsoftteams: "https://teams.microsoft.com",
  jira: "https://www.atlassian.com/software/jira",
  trello: "https://trello.com",
  asana: "https://app.asana.com",
  monday: "https://monday.com",
  linear: "https://linear.app",
  shopify: "https://www.shopify.com",
  stripe: "https://dashboard.stripe.com",
  salesforce: "https://www.salesforce.com",
  hubspot: "https://app.hubspot.com",
  pipedrive: "https://app.pipedrive.com",
  quickbooks: "https://quickbooks.intuit.com",
  zendesk: "https://www.zendesk.com",
  whatsapp: "https://web.whatsapp.com",
  twitter: "https://x.com",
  linkedin: "https://www.linkedin.com",
  youtube: "https://studio.youtube.com",
  zoom: "https://app.zoom.us",
  intercom: "https://www.intercom.com",
  typeform: "https://admin.typeform.com"
};

const TOOLKIT_ICON_SLUGS: Record<string, string> = {
  gmail: "gmail",
  slack: "slack",
  notion: "notion",
  github: "github",
  googlecalendar: "googlecalendar",
  googledrive: "googledrive",
  googledocs: "googledocs",
  googlesheets: "googlesheets",
  outlook: "microsoftoutlook",
  microsoftteams: "microsoftteams",
  jira: "jira",
  trello: "trello",
  asana: "asana",
  monday: "mondaydotcom",
  linear: "linear",
  shopify: "shopify",
  stripe: "stripe",
  salesforce: "salesforce",
  hubspot: "hubspot",
  pipedrive: "pipedrive",
  quickbooks: "intuitquickbooks",
  zendesk: "zendesk",
  whatsapp: "whatsapp",
  twitter: "x",
  linkedin: "linkedin",
  youtube: "youtube",
  zoom: "zoom",
  intercom: "intercom",
  typeform: "typeform"
};

function iconCandidateUrls(toolkitSlug: string, toolkitLogoUrl?: string | null) {
  const normalized = toolkitSlug.trim().toLowerCase();
  const simpleIconSlug = TOOLKIT_ICON_SLUGS[normalized] ?? normalized.replace(/[^a-z0-9]/g, "");
  const candidates: string[] = [];

  if (toolkitLogoUrl?.trim()) {
    candidates.push(toolkitLogoUrl.trim());
  }
  if (simpleIconSlug) {
    candidates.push(`https://cdn.simpleicons.org/${encodeURIComponent(simpleIconSlug)}/ffffff`);
    candidates.push(`https://cdn.simpleicons.org/${encodeURIComponent(simpleIconSlug)}`);
  }

  return [...new Set(candidates)];
}

function ToolkitIcon(props: {
  toolkitSlug: string;
  toolkitName: string;
  logoUrl?: string | null;
}) {
  const sources = iconCandidateUrls(props.toolkitSlug, props.logoUrl);
  const [index, setIndex] = useState(0);
  const src = sources[index] ?? null;
  const initials = (props.toolkitName || props.toolkitSlug).trim().slice(0, 2).toUpperCase();

  if (!src) {
    return (
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-[10px] font-bold text-slate-200">
        {initials}
      </div>
    );
  }

  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/35">
      <img
        src={src}
        alt={`${props.toolkitName} icon`}
        className="h-5 w-5 object-contain"
        loading="lazy"
        onError={() => setIndex((current) => current + 1)}
      />
    </div>
  );
}

function resolveAppUrl(toolkitSlug: string, toolkitAppUrl?: string | null) {
  const candidate = (toolkitAppUrl?.trim() || TOOLKIT_APP_FALLBACKS[toolkitSlug] || "").trim();
  if (!candidate) {
    return null;
  }

  try {
    const normalized = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
    return new URL(normalized).toString();
  } catch {
    return null;
  }
}

function statusClasses(status: string) {
  const normalized = status.toUpperCase();
  if (normalized === "ACTIVE") {
    return "border-emerald-500/40 bg-emerald-500/15 text-emerald-300";
  }
  if (normalized === "INITIATED" || normalized === "INITIALIZING" || normalized === "PENDING") {
    return "border-amber-500/40 bg-amber-500/15 text-amber-300";
  }
  if (normalized === "FAILED" || normalized === "ERROR") {
    return "border-red-500/40 bg-red-500/15 text-red-300";
  }
  return "border-white/20 bg-white/5 text-slate-300";
}

function titleCase(input: string) {
  return input
    .split(/[-_]/g)
    .map((part) => (part.length > 0 ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

async function parseJsonResponse<T>(response: Response): Promise<{
  payload: T | null;
  rawText: string;
}> {
  const rawText = await response.text();
  if (!rawText) {
    return { payload: null, rawText: "" };
  }
  try {
    return {
      payload: JSON.parse(rawText) as T,
      rawText
    };
  } catch {
    return {
      payload: null,
      rawText
    };
  }
}

export function IntegrationsConsole({ orgId, themeStyle }: IntegrationsConsoleProps) {
  const { user } = useFirebaseAuth();
  const notify = useVorldXStore((state) => state.pushNotification);

  const [toolkits, setToolkits] = useState<ToolkitItem[]>([]);
  const [connections, setConnections] = useState<ConnectionItem[]>([]);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [actionToolkit, setActionToolkit] = useState<string | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<ConnectionItem | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [appPopup, setAppPopup] = useState<AppPopupState | null>(null);

  const authHeaders = useMemo(
    () =>
      user
        ? {
            "x-user-id": user.uid,
            "x-user-email": user.email
          }
        : null,
    [user]
  );

  const loadIntegrations = useCallback(
    async (silent?: boolean) => {
      if (silent) setRefreshing(true);
      else setLoading(true);

      try {
        const toolkitsResponse = await fetch(
          `/api/integrations/composio/toolkits?orgId=${encodeURIComponent(orgId)}`,
          {
            cache: "no-store",
            ...(authHeaders ? { headers: authHeaders } : {})
          }
        );

        const { payload: toolkitsPayload, rawText: toolkitsRawText } = await parseJsonResponse<{
          ok?: boolean;
          enabled?: boolean;
          toolkits?: ToolkitItem[];
          message?: string;
        }>(toolkitsResponse);
        if (!toolkitsResponse.ok || !toolkitsPayload?.ok) {
          throw new Error(
            toolkitsPayload?.message ??
              (toolkitsRawText
                ? `Failed loading available apps (${toolkitsResponse.status}): ${toolkitsRawText.slice(0, 180)}`
                : "Failed loading available apps.")
          );
        }

        setEnabled(Boolean(toolkitsPayload.enabled));
        setToolkits(toolkitsPayload.toolkits ?? []);

        if (!toolkitsPayload.enabled) {
          setConnections([]);
          setError(null);
          return;
        }

        if (!authHeaders) {
          setConnections([]);
          setError("Sign in to manage app connections.");
          return;
        }

        const connectionsResponse = await fetch(
          `/api/integrations/composio/connections?orgId=${encodeURIComponent(orgId)}`,
          {
            cache: "no-store",
            headers: authHeaders
          }
        );
        const { payload: connectionsPayload, rawText: connectionsRawText } = await parseJsonResponse<{
          ok?: boolean;
          connections?: ConnectionItem[];
          message?: string;
        }>(connectionsResponse);

        if (!connectionsResponse.ok || !connectionsPayload?.ok) {
          throw new Error(
            connectionsPayload?.message ??
              (connectionsRawText
                ? `Failed loading your connections (${connectionsResponse.status}): ${connectionsRawText.slice(0, 180)}`
                : "Failed loading your connections.")
          );
        }

        setConnections(connectionsPayload.connections ?? []);
        setError(null);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Failed loading integrations.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [authHeaders, orgId]
  );

  useEffect(() => {
    void loadIntegrations();
    const timer = setInterval(() => void loadIntegrations(true), 12000);
    return () => clearInterval(timer);
  }, [loadIntegrations]);

  const connectToolkit = useCallback(
    async (toolkit: string) => {
      if (!authHeaders) {
        notify({
          title: "Integrations",
          message: "Sign in to connect apps.",
          type: "error"
        });
        return;
      }

      setActionToolkit(toolkit);
      try {
        const returnTo = `${window.location.origin}/app?tab=hub&hubScope=TOOLS`;
        const response = await fetch("/api/integrations/composio/connect", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders
          },
          body: JSON.stringify({
            orgId,
            toolkit,
            returnTo
          })
        });

        const { payload, rawText } = await parseJsonResponse<{
          ok?: boolean;
          connectUrl?: string;
          message?: string;
        }>(response);
        if (!response.ok || !payload?.ok || !payload.connectUrl) {
          throw new Error(
            payload?.message ??
              (rawText
                ? `Unable to start connect flow (${response.status}): ${rawText.slice(0, 180)}`
                : "Unable to start connect flow.")
          );
        }

        window.location.assign(payload.connectUrl);
      } catch (requestError) {
        notify({
          title: "Integrations",
          message: requestError instanceof Error ? requestError.message : "Connect flow failed.",
          type: "error"
        });
      } finally {
        setActionToolkit(null);
      }
    },
    [authHeaders, notify, orgId]
  );

  const disconnectSelected = useCallback(async () => {
    if (!disconnectTarget || !authHeaders) {
      return;
    }
    setDisconnecting(true);
    try {
      const response = await fetch(
        `/api/integrations/composio/connections/${encodeURIComponent(disconnectTarget.connectionId)}?orgId=${encodeURIComponent(orgId)}`,
        {
          method: "DELETE",
          headers: authHeaders
        }
      );
      const { payload, rawText } = await parseJsonResponse<{ ok?: boolean; message?: string }>(
        response
      );
      if (!response.ok || !payload?.ok) {
        throw new Error(
          payload?.message ??
            (rawText ? `Disconnect failed (${response.status}): ${rawText.slice(0, 180)}` : "Disconnect failed.")
        );
      }
      setDisconnectTarget(null);
      await loadIntegrations(true);
    } catch (requestError) {
      notify({
        title: "Integrations",
        message: requestError instanceof Error ? requestError.message : "Disconnect failed.",
        type: "error"
      });
    } finally {
      setDisconnecting(false);
    }
  }, [authHeaders, disconnectTarget, loadIntegrations, notify, orgId]);

  const connectionByToolkit = useMemo(() => {
    const map = new Map<string, ConnectionItem>();
    for (const connection of connections) {
      const existing = map.get(connection.toolkit);
      if (!existing || existing.status !== "ACTIVE") {
        map.set(connection.toolkit, connection);
      }
    }
    return map;
  }, [connections]);

  const filteredToolkits = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return toolkits;
    return toolkits.filter((item) => {
      return item.name.toLowerCase().includes(q) || item.slug.toLowerCase().includes(q);
    });
  }, [search, toolkits]);

  const toolkitBySlug = useMemo(() => {
    return new Map(toolkits.map((toolkit) => [toolkit.slug, toolkit]));
  }, [toolkits]);

  const openExternalWindow = useCallback((url: string) => {
    window.open(url, "_blank", "noopener,noreferrer,width=1360,height=900");
  }, []);

  const openAppPopup = useCallback(
    (toolkitSlug: string) => {
      const toolkit = toolkitBySlug.get(toolkitSlug);
      const url = resolveAppUrl(toolkitSlug, toolkit?.appUrl);
      if (!url) {
        notify({
          title: "Integrations",
          message: `No launch URL available for ${titleCase(toolkitSlug)}.`,
          type: "error"
        });
        return;
      }

      setAppPopup({
        toolkit: toolkitSlug,
        name: toolkit?.name ?? titleCase(toolkitSlug),
        url
      });
    },
    [notify, toolkitBySlug]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-white/10 pb-3">
        <div>
          <h3 className="font-display text-2xl font-black uppercase tracking-tight">Connected Apps</h3>
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
            Manage Gmail, Slack, Notion, and more
          </p>
        </div>
        <button
          onClick={() => void loadIntegrations(true)}
          className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-200"
        >
          {refreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Refresh
        </button>
      </div>

      <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/35 px-3 py-2">
        <Search size={13} className="text-slate-500" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search apps"
          className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-600"
        />
      </label>

      {enabled === false && !error ? (
        <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          App integrations are disabled. Set `FEATURE_COMPOSIO_INTEGRATIONS=true` and server Composio env vars.
        </div>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-red-500/35 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="inline-flex items-center gap-2 text-sm text-slate-400">
          <Loader2 size={14} className="animate-spin" />
          Loading integrations...
        </div>
      ) : (
        <>
          <section className={`vx-panel space-y-3 rounded-3xl p-4 ${themeStyle.border}`}>
            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Available Apps</p>
            {filteredToolkits.length === 0 ? (
              <p className="text-sm text-slate-500">No apps match your search.</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {filteredToolkits.map((toolkit) => {
                  const activeConnection = connectionByToolkit.get(toolkit.slug);
                  const status = activeConnection?.status ?? toolkit.status;
                  const statusLabel = status === "NOT_CONNECTED" ? "DISCONNECTED" : status;
                  const integrationsEnabled = enabled !== false;
                  const connectDisabled = !integrationsEnabled || actionToolkit === toolkit.slug;
                  return (
                    <article key={toolkit.slug} className="rounded-2xl border border-white/10 bg-black/30 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <ToolkitIcon
                            toolkitSlug={toolkit.slug}
                            toolkitName={toolkit.name}
                            logoUrl={toolkit.logoUrl}
                          />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-white">{toolkit.name}</p>
                            <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                              {toolkit.slug}
                            </p>
                          </div>
                        </div>
                        <span
                          className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${statusClasses(
                            statusLabel
                          )}`}
                        >
                          {statusLabel}
                        </span>
                      </div>
                      <p className="mt-2 line-clamp-2 text-xs text-slate-400">
                        {toolkit.description || `${titleCase(toolkit.slug)} integration toolkit.`}
                      </p>
                      <div className="mt-3 flex items-center gap-2">
                        <button
                          onClick={() => void connectToolkit(toolkit.slug)}
                          disabled={connectDisabled}
                          className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] transition disabled:cursor-not-allowed ${
                            integrationsEnabled
                              ? "border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-60"
                              : "border border-white/20 bg-white/5 text-slate-400"
                          }`}
                        >
                          {actionToolkit === toolkit.slug ? (
                            <Loader2 size={11} className="animate-spin" />
                          ) : (
                            <Link2 size={11} />
                          )}
                          {!integrationsEnabled ? "Unavailable" : status === "ACTIVE" ? "Reconnect" : "Connect"}
                        </button>
                        {activeConnection && status === "ACTIVE" ? (
                          <button
                            onClick={() => openAppPopup(toolkit.slug)}
                            className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-200 transition hover:bg-cyan-500/20"
                          >
                            <ExternalLink size={11} />
                            Open App
                          </button>
                        ) : null}
                        {activeConnection && status === "ACTIVE" ? (
                          <button
                            onClick={() => setDisconnectTarget(activeConnection)}
                            className="inline-flex items-center gap-1 rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-red-300 transition hover:bg-red-500/20"
                          >
                            <Unplug size={11} />
                            Disconnect
                          </button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className={`vx-panel space-y-3 rounded-3xl p-4 ${themeStyle.border}`}>
            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Your Connections</p>
            {connections.length === 0 ? (
              <p className="text-sm text-slate-500">No connections yet. Connect an app above.</p>
            ) : (
              <div className="space-y-2">
                {connections.map((connection) => (
                  <article
                    key={`${connection.connectionId}:${connection.updatedAt}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/30 px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <ToolkitIcon
                        toolkitSlug={connection.toolkit}
                        toolkitName={titleCase(connection.toolkit)}
                        logoUrl={toolkitBySlug.get(connection.toolkit)?.logoUrl ?? null}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold uppercase tracking-[0.14em] text-white">
                          {titleCase(connection.toolkit)}
                        </p>
                        <p className="text-[10px] text-slate-500">
                          id: {connection.connectionId} | Updated:{" "}
                          {new Date(connection.updatedAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${statusClasses(
                          connection.status
                        )}`}
                      >
                        {connection.status}
                      </span>
                      {connection.status === "ACTIVE" ? (
                        <button
                          onClick={() => openAppPopup(connection.toolkit)}
                          className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-cyan-200"
                        >
                          <ExternalLink size={11} />
                          Open
                        </button>
                      ) : null}
                      {connection.status === "ACTIVE" ? (
                        <button
                          onClick={() => setDisconnectTarget(connection)}
                          className="rounded-lg border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-red-300"
                        >
                          Disconnect
                        </button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {appPopup ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-3">
          <div className="flex h-[85vh] w-full max-w-6xl flex-col rounded-2xl border border-white/20 bg-[#0b1218] p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-100">{appPopup.name}</p>
                <p className="truncate text-[10px] uppercase tracking-[0.14em] text-slate-500">
                  Embedded preview. Some providers block iframe access.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openExternalWindow(appPopup.url)}
                  className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-cyan-200"
                >
                  <ExternalLink size={12} />
                  Pop Out
                </button>
                <button
                  onClick={() => setAppPopup(null)}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/20 bg-white/5 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-200"
                >
                  <X size={12} />
                  Close
                </button>
              </div>
            </div>
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-white/10 bg-black">
              <iframe
                title={`${appPopup.name} embedded`}
                src={appPopup.url}
                className="h-full w-full border-0"
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </div>
          </div>
        </div>
      ) : null}

      {disconnectTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md space-y-3 rounded-2xl border border-white/20 bg-[#0b1218] p-4">
            <p className="text-sm text-slate-200">
              Disconnect <span className="font-semibold">{titleCase(disconnectTarget.toolkit)}</span> from this
              workspace?
            </p>
            <p className="text-xs text-slate-500">
              Agents will lose access until you reconnect this app.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDisconnectTarget(null)}
                disabled={disconnecting}
                className="rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-xs uppercase tracking-[0.12em] text-slate-300"
              >
                Cancel
              </button>
              <button
                onClick={() => void disconnectSelected()}
                disabled={disconnecting}
                className="inline-flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/15 px-3 py-1.5 text-xs uppercase tracking-[0.12em] text-red-300 disabled:opacity-60"
              >
                {disconnecting ? <Loader2 size={12} className="animate-spin" /> : <Unplug size={12} />}
                Disconnect
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
