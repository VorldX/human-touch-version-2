"use client";

import { type ComponentType, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Bot,
  Loader2,
  PlusCircle,
  RefreshCw,
  ShieldCheck,
  UserCircle2,
  X
} from "lucide-react";

import { useVorldXStore } from "@/lib/store/vorldx-store";

type PersonnelType = "HUMAN" | "AI";
type PersonnelStatus = "IDLE" | "ACTIVE" | "PAUSED" | "DISABLED" | "RENTED";
type PricingModel = "TOKEN" | "SUBSCRIPTION" | "OUTCOME";
type JoinRequestRole = "EMPLOYEE" | "ADMIN";

interface PersonnelItem {
  id: string;
  type: PersonnelType;
  name: string;
  role: string;
  expertise: string | null;
  autonomyScore: number;
  pricingModel: PricingModel | null;
  status: PersonnelStatus;
  assignedOAuthIds: string[];
  brainConfig: unknown;
  fallbackBrainConfig: unknown;
  rentRate: string | number | null;
  cost: string | number | null;
  salary: string | number | null;
}

interface LinkedAccountItem {
  id: string;
  provider: "GOOGLE" | "LINKEDIN" | "X";
  providerAccountId: string;
  user: {
    id: string;
    username: string;
    email: string;
  };
}

interface CapabilityGrantItem {
  id: string;
  agentId: string;
  linkedAccountId: string;
  scopes: Record<string, unknown>;
  createdAt: string;
}

interface JoinRequestItem {
  id: string;
  orgId: string;
  requesterUserId: string;
  requesterEmail: string;
  requesterName: string | null;
  requestedRole: JoinRequestRole;
  message: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
  decidedByUserId: string | null;
  decidedByEmail: string | null;
  decisionNote: string | null;
}

interface SquadConsoleProps {
  orgId: string;
  themeStyle: {
    accent: string;
    accentSoft: string;
    border: string;
  };
}

interface RecruitFormState {
  type: PersonnelType;
  name: string;
  role: string;
  expertise: string;
  autonomyScore: string;
  pricingModel: "" | PricingModel;
  salary: string;
  cost: string;
  rentRate: string;
  status: PersonnelStatus;
  isRented: boolean;
  brainConfig: string;
  fallbackBrainConfig: string;
  brainKey: string;
  fallbackBrainKey: string;
  capabilityScopes: string;
}

const INITIAL_FORM: RecruitFormState = {
  type: "HUMAN",
  name: "",
  role: "",
  expertise: "",
  autonomyScore: "0.5",
  pricingModel: "",
  salary: "",
  cost: "",
  rentRate: "",
  status: "IDLE",
  isRented: false,
  brainConfig: "{}",
  fallbackBrainConfig: "{}",
  brainKey: "",
  fallbackBrainKey: "",
  capabilityScopes: "{\"read\": true}"
};

function toNumber(value: string | number | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parseJsonObject(
  raw: string,
  label: string
): { ok: true; value: Record<string, unknown> | undefined } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: true, value: undefined };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ok: true, value: parsed as Record<string, unknown> };
    }
    return {
      ok: false,
      message: `${label} must be a JSON object.`
    };
  } catch (error) {
    return {
      ok: false,
      message: `${label} JSON is invalid: ${error instanceof Error ? error.message : "parse error"}`
    };
  }
}

function shortProvider(provider: LinkedAccountItem["provider"]) {
  if (provider === "GOOGLE") return "GO";
  if (provider === "LINKEDIN") return "LI";
  return "X";
}

export function SquadConsole({ orgId, themeStyle }: SquadConsoleProps) {
  const notify = useVorldXStore((state) => state.pushNotification);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [personnel, setPersonnel] = useState<PersonnelItem[]>([]);
  const [linkedAccounts, setLinkedAccounts] = useState<LinkedAccountItem[]>([]);
  const [capabilityGrants, setCapabilityGrants] = useState<CapabilityGrantItem[]>([]);
  const [capabilityVaultEnabled, setCapabilityVaultEnabled] = useState(false);
  const [canReviewJoinRequests, setCanReviewJoinRequests] = useState(false);
  const [joinRequests, setJoinRequests] = useState<JoinRequestItem[]>([]);
  const [joinRequestsError, setJoinRequestsError] = useState<string | null>(null);
  const [requestRoleDrafts, setRequestRoleDrafts] = useState<
    Record<string, JoinRequestRole>
  >({});
  const [requestNoteDrafts, setRequestNoteDrafts] = useState<Record<string, string>>({});
  const [actingRequestId, setActingRequestId] = useState<string | null>(null);
  const [showRecruitModal, setShowRecruitModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedOAuthIds, setSelectedOAuthIds] = useState<string[]>([]);
  const [form, setForm] = useState<RecruitFormState>(INITIAL_FORM);
  const isAiRecruit = form.type === "AI";

  const loadSquad = useCallback(
    async (silent?: boolean) => {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const [personnelResponse, joinRequestsResponse] = await Promise.all([
          fetch(`/api/squad/personnel?orgId=${encodeURIComponent(orgId)}`, {
            cache: "no-store"
          }),
          fetch(
            `/api/squad/join-requests?orgId=${encodeURIComponent(orgId)}&status=PENDING`,
            { cache: "no-store" }
          )
        ]);

        const payload = (await personnelResponse.json()) as {
          ok?: boolean;
          message?: string;
          personnel?: PersonnelItem[];
          linkedAccounts?: LinkedAccountItem[];
          capabilityGrants?: CapabilityGrantItem[];
          capabilityVaultEnabled?: boolean;
        };
        const joinRequestsPayload = (await joinRequestsResponse.json()) as {
          ok?: boolean;
          message?: string;
          requests?: JoinRequestItem[];
        };

        if (!personnelResponse.ok || !payload.ok) {
          setError(payload.message ?? "Failed to load squad.");
          return;
        }

        setError(null);
        setPersonnel(payload.personnel ?? []);
        setLinkedAccounts(payload.linkedAccounts ?? []);
        setCapabilityGrants(payload.capabilityGrants ?? []);
        setCapabilityVaultEnabled(Boolean(payload.capabilityVaultEnabled));

        if (joinRequestsResponse.status === 403) {
          setCanReviewJoinRequests(false);
          setJoinRequests([]);
          setJoinRequestsError(null);
        } else if (!joinRequestsResponse.ok || !joinRequestsPayload.ok) {
          setCanReviewJoinRequests(false);
          setJoinRequests([]);
          setJoinRequestsError(
            joinRequestsPayload.message ?? "Failed to load join requests."
          );
        } else {
          const items = joinRequestsPayload.requests ?? [];
          setCanReviewJoinRequests(true);
          setJoinRequests(items);
          setJoinRequestsError(null);
          setRequestRoleDrafts(
            Object.fromEntries(items.map((item) => [item.id, item.requestedRole]))
          );
          setRequestNoteDrafts((prev) => {
            const next: Record<string, string> = {};
            for (const item of items) {
              if (typeof prev[item.id] === "string") {
                next[item.id] = prev[item.id];
              }
            }
            return next;
          });
        }
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Failed to load squad.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [orgId]
  );

  useEffect(() => {
    void loadSquad();
    const interval = setInterval(() => void loadSquad(true), 10000);
    return () => clearInterval(interval);
  }, [loadSquad]);

  useEffect(() => {
    if (form.type === "HUMAN") {
      setSelectedOAuthIds([]);
    }
  }, [form.type]);

  const humans = useMemo(
    () => personnel.filter((member) => member.type === "HUMAN"),
    [personnel]
  );
  const aiAgents = useMemo(() => personnel.filter((member) => member.type === "AI"), [personnel]);

  const grantCountByAgent = useMemo(() => {
    const map = new Map<string, number>();
    capabilityGrants.forEach((grant) => {
      map.set(grant.agentId, (map.get(grant.agentId) ?? 0) + 1);
    });
    return map;
  }, [capabilityGrants]);

  const accountLabelById = useMemo(() => {
    const map = new Map<string, string>();
    linkedAccounts.forEach((account) => {
      map.set(
        account.id,
        `${shortProvider(account.provider)}:${account.user.username || account.user.email}`
      );
    });
    return map;
  }, [linkedAccounts]);

  const toggleOAuthSelection = useCallback((id: string) => {
    setSelectedOAuthIds((prev) =>
      prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]
    );
  }, []);

  const resetRecruitState = useCallback(() => {
    setForm(INITIAL_FORM);
    setSelectedOAuthIds([]);
  }, []);

  const handleRecruit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setSubmitting(true);

      const emptyParsed = { ok: true as const, value: undefined as Record<string, unknown> | undefined };
      const brainConfigResult =
        form.type === "AI" ? parseJsonObject(form.brainConfig, "Brain config") : emptyParsed;
      if (!brainConfigResult.ok) {
        notify({
          title: "Recruitment Error",
          message: brainConfigResult.message,
          type: "error"
        });
        setSubmitting(false);
        return;
      }

      const fallbackConfigResult = parseJsonObject(
        form.type === "AI" ? form.fallbackBrainConfig : "",
        "Fallback brain config"
      );
      if (!fallbackConfigResult.ok) {
        notify({
          title: "Recruitment Error",
          message: fallbackConfigResult.message,
          type: "error"
        });
        setSubmitting(false);
        return;
      }

      const scopesResult =
        form.type === "AI" ? parseJsonObject(form.capabilityScopes, "Capability scopes") : emptyParsed;
      if (!scopesResult.ok) {
        notify({
          title: "Recruitment Error",
          message: scopesResult.message,
          type: "error"
        });
        setSubmitting(false);
        return;
      }

      const payload: Record<string, unknown> = {
        orgId,
        type: form.type,
        name: form.name.trim(),
        role: form.role.trim(),
        expertise: form.expertise.trim() || undefined,
        autonomyScore: Number.parseFloat(form.autonomyScore),
        pricingModel: form.pricingModel || undefined,
        salary: form.salary ? Number.parseFloat(form.salary) : undefined,
        cost: form.cost ? Number.parseFloat(form.cost) : undefined,
        rentRate: form.rentRate ? Number.parseFloat(form.rentRate) : undefined,
        status: form.status,
        isRented: form.isRented,
        assignedOAuthIds: selectedOAuthIds
      };

      if (form.type === "AI" && brainConfigResult.value) payload.brainConfig = brainConfigResult.value;
      if (form.type === "AI" && fallbackConfigResult.value) payload.fallbackBrainConfig = fallbackConfigResult.value;
      if (form.type === "AI" && form.brainKey.trim()) payload.brainKey = form.brainKey.trim();
      if (form.type === "AI" && form.fallbackBrainKey.trim()) payload.fallbackBrainKey = form.fallbackBrainKey.trim();

      if (form.type === "AI" && capabilityVaultEnabled && scopesResult.value && selectedOAuthIds.length > 0) {
        payload.capabilityGrants = selectedOAuthIds.map((linkedAccountId) => ({
          linkedAccountId,
          scopes: scopesResult.value
        }));
      }

      try {
        const response = await fetch("/api/squad/personnel", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });

        const result = (await response.json()) as {
          ok?: boolean;
          message?: string;
          personnel?: { id: string; name: string; role: string };
        };

        if (!response.ok || !result.ok) {
          notify({
            title: "Recruitment Failed",
            message: result.message ?? "Unable to recruit personnel.",
            type: "error"
          });
          return;
        }

        notify({
          title: "Personnel Recruited",
          message: `${result.personnel?.name ?? "New member"} added to squad.`,
          type: "success"
        });

        setShowRecruitModal(false);
        resetRecruitState();
        await loadSquad(true);
      } finally {
        setSubmitting(false);
      }
    },
    [
      capabilityVaultEnabled,
      form,
      loadSquad,
      notify,
      orgId,
      resetRecruitState,
      selectedOAuthIds
    ]
  );

  const handleJoinRequestDecision = useCallback(
    async (request: JoinRequestItem, decision: "APPROVE" | "REJECT") => {
      setActingRequestId(request.id);
      try {
        const response = await fetch(`/api/squad/join-requests/${request.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            orgId,
            decision,
            role: requestRoleDrafts[request.id] ?? request.requestedRole,
            note: requestNoteDrafts[request.id] ?? ""
          })
        });

        const payload = (await response.json()) as { ok?: boolean; message?: string };
        if (!response.ok || !payload.ok) {
          notify({
            title: "Join Request",
            message:
              payload.message ??
              `Failed to ${decision === "APPROVE" ? "approve" : "reject"} request.`,
            type: "error"
          });
          return;
        }

        notify({
          title: "Join Request",
          message: `Request ${decision === "APPROVE" ? "approved" : "rejected"}.`,
          type: "success"
        });
        await loadSquad(true);
      } catch (requestError) {
        notify({
          title: "Join Request",
          message:
            requestError instanceof Error
              ? requestError.message
              : "Failed to process request.",
          type: "error"
        });
      } finally {
        setActingRequestId(null);
      }
    },
    [loadSquad, notify, orgId, requestNoteDrafts, requestRoleDrafts]
  );

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
        <div>
          <h2 className="font-display text-4xl font-black uppercase tracking-tight">Squad</h2>
          <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
            Human / AI Personnel Grid
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void loadSquad(true)}
            className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-200"
          >
            {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Refresh
          </button>
          <button
            onClick={() => setShowRecruitModal(true)}
            className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-black transition hover:bg-emerald-500 hover:text-white"
          >
            <PlusCircle size={13} />
            Recruit
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {canReviewJoinRequests && (
        <div className={`vx-panel space-y-3 rounded-3xl p-4 ${themeStyle.border}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">
              Organization Join Requests
            </p>
            <span
              className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.2em] ${themeStyle.accentSoft}`}
            >
              {joinRequests.length} Pending
            </span>
          </div>

          {joinRequestsError && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {joinRequestsError}
            </div>
          )}

          {joinRequests.length === 0 ? (
            <p className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-500">
              No pending requests right now.
            </p>
          ) : (
            <div className="space-y-2">
              {joinRequests.map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl border border-white/10 bg-black/25 p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-100">
                        {item.requesterName || item.requesterEmail}
                      </p>
                      <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                        {item.requesterEmail} | Requested {item.requestedRole} |{" "}
                        {new Date(item.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={requestRoleDrafts[item.id] ?? item.requestedRole}
                        onChange={(event) =>
                          setRequestRoleDrafts((prev) => ({
                            ...prev,
                            [item.id]: event.target.value as JoinRequestRole
                          }))
                        }
                        className="rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-xs text-slate-100 outline-none"
                      >
                        <option value="EMPLOYEE">EMPLOYEE</option>
                        <option value="ADMIN">ADMIN</option>
                      </select>
                    </div>
                  </div>

                  {item.message ? (
                    <p className="mt-2 text-xs text-slate-300">{item.message}</p>
                  ) : (
                    <p className="mt-2 text-xs text-slate-500">No message provided.</p>
                  )}

                  <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto_auto]">
                    <input
                      value={requestNoteDrafts[item.id] ?? ""}
                      onChange={(event) =>
                        setRequestNoteDrafts((prev) => ({
                          ...prev,
                          [item.id]: event.target.value
                        }))
                      }
                      placeholder="Optional decision note"
                      className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-slate-100 outline-none"
                    />
                    <button
                      onClick={() => void handleJoinRequestDecision(item, "APPROVE")}
                      disabled={actingRequestId === item.id}
                      className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-60"
                    >
                      {actingRequestId === item.id ? "Working..." : "Approve"}
                    </button>
                    <button
                      onClick={() => void handleJoinRequestDecision(item, "REJECT")}
                      disabled={actingRequestId === item.id}
                      className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-red-300 transition hover:bg-red-500/20 disabled:opacity-60"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Humans" value={String(humans.length)} icon={UserCircle2} />
        <MetricCard label="AI Nodes" value={String(aiAgents.length)} icon={Bot} />
        <MetricCard
          label="Capability Grants"
          value={String(capabilityGrants.length)}
          icon={ShieldCheck}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <PersonnelPanel
          title="Human Personnel"
          items={humans}
          accountLabelById={accountLabelById}
          grantCountByAgent={grantCountByAgent}
          themeStyle={themeStyle}
          loading={loading}
        />
        <PersonnelPanel
          title="AI Personnel"
          items={aiAgents}
          accountLabelById={accountLabelById}
          grantCountByAgent={grantCountByAgent}
          themeStyle={themeStyle}
          loading={loading}
        />
      </div>

      {showRecruitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="vx-panel vx-scrollbar h-[90vh] w-full max-w-4xl overflow-y-auto rounded-[34px] border border-white/15 p-6">
            <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-3">
              <div>
                <h3 className="font-display text-2xl font-black uppercase tracking-tight">
                  Recruitment Console
                </h3>
                <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">
                  Assign OAuth + fallback brain
                </p>
              </div>
              <button
                onClick={() => {
                  setShowRecruitModal(false);
                  resetRecruitState();
                }}
                className="rounded-full border border-white/20 p-2 text-slate-300 transition hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleRecruit} className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Type</span>
                  <div className="grid grid-cols-2 gap-2">
                    {(["HUMAN", "AI"] as PersonnelType[]).map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setForm((prev) => ({ ...prev, type: item }))}
                        className={`rounded-xl border px-3 py-2 text-xs font-bold uppercase tracking-[0.16em] transition ${
                          form.type === item
                            ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                            : "border-white/10 bg-black/40 text-slate-300 hover:bg-white/5"
                        }`}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Status</span>
                  <select
                    value={form.status}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, status: event.target.value as PersonnelStatus }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                  >
                    <option value="IDLE">IDLE</option>
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="PAUSED">PAUSED</option>
                    <option value="DISABLED">DISABLED</option>
                    <option value="RENTED">RENTED</option>
                  </select>
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Name</span>
                  <input
                    value={form.name}
                    onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                    placeholder="Node display name"
                    required
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Role</span>
                  <input
                    value={form.role}
                    onChange={(event) => setForm((prev) => ({ ...prev, role: event.target.value }))}
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                    placeholder="Closer / Research / Main Agent"
                    required
                  />
                </label>
              </div>

              <label className="space-y-1">
                <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Expertise</span>
                <input
                  value={form.expertise}
                  onChange={(event) => setForm((prev) => ({ ...prev, expertise: event.target.value }))}
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                  placeholder="Growth, Compliance, Sales Ops..."
                />
              </label>

              <div className="grid gap-3 md:grid-cols-4">
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Autonomy</span>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={form.autonomyScore}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, autonomyScore: event.target.value }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Pricing</span>
                  <select
                    value={form.pricingModel}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        pricingModel: event.target.value as "" | PricingModel
                      }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                  >
                    <option value="">None</option>
                    <option value="TOKEN">TOKEN</option>
                    <option value="SUBSCRIPTION">SUBSCRIPTION</option>
                    <option value="OUTCOME">OUTCOME</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Cost</span>
                  <input
                    type="number"
                    step={0.0001}
                    min={0}
                    value={form.cost}
                    onChange={(event) => setForm((prev) => ({ ...prev, cost: event.target.value }))}
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Rent Rate</span>
                  <input
                    type="number"
                    step={0.0001}
                    min={0}
                    value={form.rentRate}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, rentRate: event.target.value }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                  />
                </label>
              </div>

              <label className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-slate-400">
                <input
                  type="checkbox"
                  checked={form.isRented}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, isRented: event.target.checked }))
                  }
                />
                Mark as rented asset
              </label>

              {isAiRecruit ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Brain Config JSON</span>
                    <textarea
                      value={form.brainConfig}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, brainConfig: event.target.value }))
                      }
                      className="h-28 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-slate-100 outline-none"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                      Fallback Brain Config JSON
                    </span>
                    <textarea
                      value={form.fallbackBrainConfig}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, fallbackBrainConfig: event.target.value }))
                      }
                      className="h-28 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-slate-100 outline-none"
                    />
                  </label>
                </div>
              ) : (
                <p className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-400">
                  Human recruit uses role, cost, and operational metadata. AI brain config fields are hidden in this mode.
                </p>
              )}

              {isAiRecruit && (
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Primary Brain Key</span>
                    <input
                      type="password"
                      value={form.brainKey}
                      onChange={(event) => setForm((prev) => ({ ...prev, brainKey: event.target.value }))}
                      placeholder="Optional encrypted secret"
                      className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                      Fallback Brain Key
                    </span>
                    <input
                      type="password"
                      value={form.fallbackBrainKey}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, fallbackBrainKey: event.target.value }))
                      }
                      placeholder="Optional encrypted secret"
                      className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                    />
                  </label>
                </div>
              )}

              {isAiRecruit && (
                <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Delegated OAuth Accounts</p>
                  {linkedAccounts.length === 0 ? (
                    <p className="mt-2 text-xs text-slate-500">No linked accounts available in this org.</p>
                  ) : (
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      {linkedAccounts.map((account) => {
                        const checked = selectedOAuthIds.includes(account.id);
                        return (
                          <label
                            key={account.id}
                            className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-slate-200"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleOAuthSelection(account.id)}
                            />
                            <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em]">
                              {shortProvider(account.provider)}
                            </span>
                            <span>{account.user.username || account.user.email}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {isAiRecruit && (
                <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
                    Capability Vault ({capabilityVaultEnabled ? "enabled" : "disabled"})
                  </p>
                  <textarea
                    value={form.capabilityScopes}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, capabilityScopes: event.target.value }))
                    }
                    disabled={!capabilityVaultEnabled}
                    className="mt-2 h-20 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-slate-100 outline-none disabled:opacity-40"
                  />
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowRecruitModal(false);
                    resetRecruitState();
                  }}
                  className="rounded-full border border-white/20 bg-white/5 px-5 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-black transition hover:bg-emerald-500 hover:text-white disabled:opacity-60"
                >
                  {submitting ? <Loader2 size={14} className="animate-spin" /> : <PlusCircle size={14} />}
                  Confirm Recruit
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon
}: {
  label: string;
  value: string;
  icon: ComponentType<{ size?: string | number; className?: string }>;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
      <div className="flex items-center gap-2">
        <Icon size={15} className="text-slate-400" />
        <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
      </div>
      <p className="mt-2 text-2xl font-bold text-slate-100">{value}</p>
    </div>
  );
}

function PersonnelPanel({
  title,
  items,
  loading,
  accountLabelById,
  grantCountByAgent,
  themeStyle
}: {
  title: string;
  items: PersonnelItem[];
  loading: boolean;
  accountLabelById: Map<string, string>;
  grantCountByAgent: Map<string, number>;
  themeStyle: { accent: string; accentSoft: string; border: string };
}) {
  return (
    <div className={`vx-panel rounded-3xl p-4 ${themeStyle.border}`}>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">{title}</p>
        <span className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.2em] ${themeStyle.accentSoft}`}>
          {items.length}
        </span>
      </div>

      {loading ? (
        <div className="inline-flex items-center gap-2 text-sm text-slate-400">
          <Loader2 size={14} className="animate-spin" />
          Loading roster...
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-xs uppercase tracking-[0.16em] text-slate-500">
          No members in this lane.
        </p>
      ) : (
        <div className="space-y-3">
          {items.map((member) => (
            <div key={member.id} className="rounded-2xl border border-white/10 bg-black/30 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-100">{member.name}</p>
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                    {member.role} | {member.status}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-cyan-300">
                    Autonomy {member.autonomyScore.toFixed(2)}
                  </span>
                  <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-emerald-300">
                    {member.pricingModel ?? "NONE"}
                  </span>
                </div>
              </div>

              {member.expertise ? (
                <p className="mt-2 text-xs text-slate-400">{member.expertise}</p>
              ) : null}

              <div className="mt-2 grid gap-2 text-[10px] uppercase tracking-[0.14em] text-slate-500 md:grid-cols-4">
                <span>Cost {toNumber(member.cost).toFixed(2)}</span>
                <span>Rent {toNumber(member.rentRate).toFixed(2)}</span>
                <span>Salary {toNumber(member.salary).toFixed(2)}</span>
                <span>Cap Grants {grantCountByAgent.get(member.id) ?? 0}</span>
              </div>

              <div className="mt-2 flex flex-wrap gap-1">
                {member.assignedOAuthIds.length === 0 ? (
                  <span className="rounded-full border border-white/15 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                    No OAuth delegation
                  </span>
                ) : (
                  member.assignedOAuthIds.map((id) => (
                    <span
                      key={id}
                      className="rounded-full border border-white/20 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-300"
                    >
                      {accountLabelById.get(id) ?? id.slice(0, 8)}
                    </span>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
