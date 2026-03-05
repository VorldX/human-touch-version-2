"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  BadgeCheck,
  Brain,
  Building2,
  ChevronRight,
  Cloud,
  Fingerprint,
  KeyRound,
  Loader2,
  Shield,
  Wallet,
  Zap
} from "lucide-react";

import { completeOnboardingAction } from "@/app/actions/onboarding";
import { useFirebaseAuth } from "@/components/auth/firebase-auth-provider";
import type { AppTheme } from "@/lib/store/vorldx-store";
import type {
  LlmCredentialModeInput,
  OAuthProviderInput,
  OnboardingPayload,
  OnboardingResult,
  ServicePlanInput
} from "@/lib/types/onboarding";

type OnboardingStep = 1 | 2 | 3 | 4;

interface OnboardingWizardProps {
  mode: "initial" | "add-org";
  onComplete: (result: NonNullable<OnboardingResult["org"]>) => void;
  onCancel?: () => void;
}

interface OAuthDraft {
  enabled: boolean;
  providerAccountId: string;
  accessToken: string;
}

const PROVIDERS: { id: OAuthProviderInput; label: string }[] = [
  { id: "GOOGLE", label: "Google" },
  { id: "LINKEDIN", label: "LinkedIn" },
  { id: "X", label: "X" }
];

const THEMES: { id: AppTheme; label: string }[] = [
  { id: "APEX", label: "APEX" },
  { id: "VEDA", label: "VEDA" },
  { id: "NEXUS", label: "NEXUS" }
];

const COMPUTE_TYPES = ["Cloud", "Local", "Container"] as const;
const SERVICE_PLANS: ServicePlanInput[] = ["STARTER", "GROWTH", "ENTERPRISE"];

export function OnboardingWizard({ mode, onComplete, onCancel }: OnboardingWizardProps) {
  const { user } = useFirebaseAuth();
  const [step, setStep] = useState<OnboardingStep>(1);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [identity, setIdentity] = useState({
    username: "",
    email: "",
    aadhaarId: ""
  });

  const [oauth, setOauth] = useState<Record<OAuthProviderInput, OAuthDraft>>({
    GOOGLE: { enabled: false, providerAccountId: "", accessToken: "" },
    LINKEDIN: { enabled: false, providerAccountId: "", accessToken: "" },
    X: { enabled: false, providerAccountId: "", accessToken: "" }
  });

  const [organization, setOrganization] = useState({
    name: "",
    description: "",
    theme: "NEXUS" as AppTheme
  });

  const [primaryBrain, setPrimaryBrain] = useState({
    provider: "OpenAI",
    model: "gpt-4o",
    apiKey: "",
    computeType: "Cloud" as (typeof COMPUTE_TYPES)[number]
  });

  const [fallbackBrain, setFallbackBrain] = useState({
    provider: "Anthropic",
    model: "claude-3-5-sonnet",
    apiKey: "",
    computeType: "Container" as (typeof COMPUTE_TYPES)[number]
  });
  const [credentialMode, setCredentialMode] = useState<LlmCredentialModeInput>("BYOK");
  const [servicePlan, setServicePlan] = useState<ServicePlanInput>("STARTER");
  const [serviceMarkupPct, setServiceMarkupPct] = useState(25);
  const [organizationApiKey, setOrganizationApiKey] = useState("");

  const [financial, setFinancial] = useState({
    monthlyBudgetUsd: 50000,
    monthlyBtuCap: 250000
  });

  const progress = useMemo(() => (step / 4) * 100, [step]);

  useEffect(() => {
    const signedInEmail = user?.email?.trim().toLowerCase();
    if (!signedInEmail) {
      return;
    }
    setIdentity((prev) =>
      prev.email.trim().toLowerCase() === signedInEmail
        ? prev
        : {
            ...prev,
            email: signedInEmail
          }
    );
  }, [user?.email]);

  const updateCredentialMode = (nextMode: LlmCredentialModeInput) => {
    setCredentialMode(nextMode);
    if (nextMode === "PLATFORM_MANAGED") {
      setOrganizationApiKey("");
      setPrimaryBrain((prev) => ({ ...prev, apiKey: "" }));
      setFallbackBrain((prev) => ({ ...prev, apiKey: "" }));
    }
  };

  function validateCurrentStep() {
    if (step === 1) {
      if (!identity.username.trim() || !identity.email.trim() || !identity.aadhaarId.trim()) {
        return "Identity fields are required.";
      }

      const invalidEnabledProvider = Object.entries(oauth).find(
        ([, value]) =>
          value.enabled && (!value.providerAccountId.trim() || !value.accessToken.trim())
      );

      if (invalidEnabledProvider) {
        return "Each enabled OAuth provider needs account id and token.";
      }
    }

    if (step === 2) {
      if (!organization.name.trim() || !organization.description.trim()) {
        return "Organization name and mission brief are required.";
      }
    }

    if (step === 3) {
      if (credentialMode === "BYOK" && !organizationApiKey.trim()) {
        return "Organization API key is required in BYOK mode.";
      }
    }

    if (step === 4) {
      if (financial.monthlyBudgetUsd <= 0 || financial.monthlyBtuCap <= 0) {
        return "Budget and BTU caps must be greater than zero.";
      }
    }

    return null;
  }

  function moveNext() {
    const validationError = validateCurrentStep();
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setStep((prev) => (prev < 4 ? ((prev + 1) as OnboardingStep) : prev));
  }

  function moveBack() {
    setError(null);
    setStep((prev) => (prev > 1 ? ((prev - 1) as OnboardingStep) : prev));
  }

  function submit() {
    const validationError = validateCurrentStep();
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);

    const oauthAccounts = Object.entries(oauth)
      .filter(([, value]) => value.enabled)
      .map(([provider, value]) => ({
        provider: provider as OAuthProviderInput,
        providerAccountId: value.providerAccountId.trim(),
        accessToken: value.accessToken.trim()
      }));

    const payload: OnboardingPayload = {
      identity: {
        username: identity.username.trim(),
        email: identity.email.trim(),
        aadhaarId: identity.aadhaarId.trim()
      },
      oauthAccounts,
      organization: {
        name: organization.name.trim(),
        description: organization.description.trim(),
        theme: organization.theme
      },
      orchestration: {
        credentialMode,
        servicePlan,
        serviceMarkupPct,
        ...(organizationApiKey.trim()
          ? { organizationApiKey: organizationApiKey.trim() }
          : {}),
        primary: {
          provider: primaryBrain.provider,
          model: primaryBrain.model,
          computeType: primaryBrain.computeType,
          ...(credentialMode === "BYOK" && primaryBrain.apiKey.trim()
            ? { apiKey: primaryBrain.apiKey.trim() }
            : {})
        },
        fallback: {
          provider: fallbackBrain.provider,
          model: fallbackBrain.model,
          computeType: fallbackBrain.computeType,
          ...(credentialMode === "BYOK" && fallbackBrain.apiKey.trim()
            ? { apiKey: fallbackBrain.apiKey.trim() }
            : {})
        }
      },
      financial
    };

    startTransition(async () => {
      const result = await completeOnboardingAction(payload);
      if (!result.ok || !result.org) {
        setError(result.message ?? "Unable to complete onboarding.");
        return;
      }
      onComplete(result.org);
    });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#05070a] p-4 text-slate-100 md:p-10">
      <div className="relative w-full max-w-4xl overflow-hidden rounded-[42px] border border-white/10 bg-[#0d1117] shadow-vx">
        <div className="absolute inset-x-0 top-0 h-1 bg-white/5">
          <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>

        <div className="border-b border-white/10 p-6 md:p-8">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10">
                <Zap className="text-emerald-400" size={22} />
              </div>
              <div>
                <h1 className="font-display text-2xl font-black uppercase tracking-tight">
                  {mode === "initial" ? "VorldX Initialization" : "Add Organization"}
                </h1>
                <p className="text-[11px] uppercase tracking-[0.25em] text-slate-500">
                  Human Touch Onboarding
                </p>
              </div>
            </div>

            {onCancel && (
              <button
                onClick={onCancel}
                className="rounded-full border border-white/20 px-4 py-2 text-[11px] uppercase tracking-[0.2em] text-slate-300 transition hover:bg-white/10"
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        <div className="p-6 md:p-8">
          <StepLabel step={step} />

          {step === 1 && (
            <section className="space-y-6">
              <div className="grid gap-4 md:grid-cols-3">
                <Field
                  label="Principal Username"
                  value={identity.username}
                  onChange={(value) => setIdentity((prev) => ({ ...prev, username: value }))}
                  placeholder="e.g. aris_vane"
                  icon={Shield}
                />
                <Field
                  label="Work Email"
                  value={identity.email}
                  onChange={(value) => setIdentity((prev) => ({ ...prev, email: value }))}
                  placeholder="name@company.com"
                  icon={BadgeCheck}
                  readOnly={Boolean(user?.email)}
                />
                <Field
                  label="Sovereign Identity"
                  value={identity.aadhaarId}
                  onChange={(value) => setIdentity((prev) => ({ ...prev, aadhaarId: value }))}
                  placeholder="Aadhaar / National ID"
                  icon={Fingerprint}
                />
              </div>

              <div className="rounded-3xl border border-white/10 bg-black/30 p-4">
                <p className="mb-3 text-[11px] uppercase tracking-[0.22em] text-slate-400">
                  OAuth Linkage
                </p>
                <div className="grid gap-3 md:grid-cols-3">
                  {PROVIDERS.map((provider) => {
                    const item = oauth[provider.id];
                    return (
                      <div key={provider.id} className="rounded-2xl border border-white/10 bg-[#11161d] p-3">
                        <div className="mb-3 flex items-center justify-between">
                          <span className="text-sm font-semibold text-white">{provider.label}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setOauth((prev) => ({
                                ...prev,
                                [provider.id]: { ...prev[provider.id], enabled: !prev[provider.id].enabled }
                              }))
                            }
                            className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.2em] transition ${
                              item.enabled
                                ? "bg-emerald-500/20 text-emerald-400"
                                : "bg-white/10 text-slate-400"
                            }`}
                          >
                            {item.enabled ? "Linked" : "Link"}
                          </button>
                        </div>

                        {item.enabled && (
                          <div className="space-y-2">
                            <input
                              value={item.providerAccountId}
                              onChange={(event) =>
                                setOauth((prev) => ({
                                  ...prev,
                                  [provider.id]: {
                                    ...prev[provider.id],
                                    providerAccountId: event.target.value
                                  }
                                }))
                              }
                              placeholder="Provider Account ID"
                              className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs outline-none focus:border-emerald-500/50"
                            />
                            <input
                              value={item.accessToken}
                              onChange={(event) =>
                                setOauth((prev) => ({
                                  ...prev,
                                  [provider.id]: {
                                    ...prev[provider.id],
                                    accessToken: event.target.value
                                  }
                                }))
                              }
                              placeholder="OAuth Access Token"
                              type="password"
                              className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs outline-none focus:border-emerald-500/50"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          )}

          {step === 2 && (
            <section className="space-y-5">
              <Field
                label="Organization Name"
                value={organization.name}
                onChange={(value) => setOrganization((prev) => ({ ...prev, name: value }))}
                placeholder="e.g. Nexus Security"
                icon={Building2}
              />
              <div>
                <p className="mb-2 text-[11px] uppercase tracking-[0.22em] text-slate-400">
                  Mission Brief
                </p>
                <textarea
                  value={organization.description}
                  onChange={(event) =>
                    setOrganization((prev) => ({ ...prev, description: event.target.value }))
                  }
                  placeholder="Define directive, risk profile, and oversight boundaries."
                  className="h-32 w-full resize-none rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm outline-none focus:border-emerald-500/50"
                />
              </div>
              <div>
                <p className="mb-2 text-[11px] uppercase tracking-[0.22em] text-slate-400">Theme</p>
                <div className="flex flex-wrap gap-2">
                  {THEMES.map((theme) => (
                    <button
                      key={theme.id}
                      type="button"
                      onClick={() =>
                        setOrganization((prev) => ({
                          ...prev,
                          theme: theme.id
                        }))
                      }
                      className={`rounded-xl border px-4 py-2 text-xs uppercase tracking-[0.2em] transition ${
                        organization.theme === theme.id
                          ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                          : "border-white/15 bg-white/5 text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {theme.label}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          )}

          {step === 3 && (
            <section className="space-y-4">
              <div className="rounded-3xl border border-white/10 bg-black/30 p-4">
                <p className="mb-3 text-[11px] uppercase tracking-[0.22em] text-slate-400">
                  Organization Credential Mode
                </p>
                <div className="flex flex-wrap gap-2">
                  {(["BYOK", "PLATFORM_MANAGED"] as LlmCredentialModeInput[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => updateCredentialMode(mode)}
                      className={`rounded-xl border px-4 py-2 text-xs uppercase tracking-[0.2em] transition ${
                        credentialMode === mode
                          ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                          : "border-white/15 bg-white/5 text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {mode === "BYOK" ? "BYOK (Org Key)" : "Platform Managed"}
                    </button>
                  ))}
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                      Service Plan
                    </span>
                    <select
                      value={servicePlan}
                      onChange={(event) => {
                        const next = event.target.value as ServicePlanInput;
                        setServicePlan(next);
                        if (next === "STARTER") setServiceMarkupPct(25);
                        if (next === "GROWTH") setServiceMarkupPct(18);
                        if (next === "ENTERPRISE") setServiceMarkupPct(12);
                      }}
                      className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                    >
                      {SERVICE_PLANS.map((plan) => (
                        <option key={plan} value={plan}>
                          {plan}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                      Service Markup %
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={200}
                      step={0.1}
                      value={serviceMarkupPct}
                      onChange={(event) => setServiceMarkupPct(Number(event.target.value) || 0)}
                      className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                    />
                  </label>
                </div>

                {credentialMode === "BYOK" && (
                  <label className="mt-4 block">
                    <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-slate-500">
                      One-Time Organization API Key
                    </p>
                    <input
                      type="password"
                      value={organizationApiKey}
                      onChange={(event) => setOrganizationApiKey(event.target.value)}
                      placeholder="Paste once, encrypted at rest"
                      className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                    />
                  </label>
                )}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <BrainCard
                  title="Main Agent Brain"
                  brain={primaryBrain}
                  onChange={setPrimaryBrain}
                  accent="emerald"
                  showApiKey={credentialMode === "BYOK"}
                />
                <BrainCard
                  title="Fallback Brain"
                  brain={fallbackBrain}
                  onChange={setFallbackBrain}
                  accent="amber"
                  showApiKey={credentialMode === "BYOK"}
                />
              </div>
            </section>
          )}

          {step === 4 && (
            <section className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <RangeField
                  label="Monthly Budget (USD)"
                  value={financial.monthlyBudgetUsd}
                  min={5000}
                  max={500000}
                  step={5000}
                  icon={Wallet}
                  onChange={(value) =>
                    setFinancial((prev) => ({ ...prev, monthlyBudgetUsd: value }))
                  }
                />
                <RangeField
                  label="Monthly BTU Cap"
                  value={financial.monthlyBtuCap}
                  min={10000}
                  max={2000000}
                  step={10000}
                  icon={Zap}
                  onChange={(value) =>
                    setFinancial((prev) => ({ ...prev, monthlyBtuCap: value }))
                  }
                />
              </div>

              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                <p className="text-sm text-emerald-300">
                  Finalizing this step will encrypt sensitive keys/tokens at rest with AES-256-GCM
                  and create the initial Main Agent node.
                </p>
              </div>
            </section>
          )}

          {error && (
            <div className="mt-5 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="mt-8 flex items-center justify-between">
            <button
              type="button"
              onClick={moveBack}
              disabled={step === 1 || isPending}
              className="rounded-full border border-white/15 px-5 py-2 text-xs uppercase tracking-[0.2em] text-slate-300 disabled:cursor-not-allowed disabled:opacity-30"
            >
              Back
            </button>

            {step < 4 ? (
              <button
                type="button"
                onClick={moveNext}
                disabled={isPending}
                className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-2 text-xs font-bold uppercase tracking-[0.2em] text-black transition hover:bg-emerald-500 hover:text-white"
              >
                Next
                <ChevronRight size={16} />
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={isPending}
                className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-6 py-2 text-xs font-bold uppercase tracking-[0.2em] text-white transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isPending ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Deploying
                  </>
                ) : (
                  <>
                    Deploy OS
                    <ChevronRight size={16} />
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StepLabel({ step }: { step: OnboardingStep }) {
  const steps = [
    { id: 1, label: "Identity", icon: Shield },
    { id: 2, label: "VNet Setup", icon: Building2 },
    { id: 3, label: "Orchestration", icon: Brain },
    { id: 4, label: "Financials", icon: Wallet }
  ] as const;

  return (
    <div className="mb-6 grid gap-2 md:grid-cols-4">
      {steps.map((item) => (
        <div
          key={item.id}
          className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs uppercase tracking-[0.2em] transition ${
            item.id === step
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              : "border-white/10 bg-black/20 text-slate-500"
          }`}
        >
          <item.icon size={14} />
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  icon: Icon,
  readOnly = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  icon: typeof Shield;
  readOnly?: boolean;
}) {
  return (
    <label className="block">
      <p className="mb-2 text-[11px] uppercase tracking-[0.22em] text-slate-400">{label}</p>
      <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/35 px-3 py-2.5">
        <Icon size={16} className="text-slate-500" />
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          readOnly={readOnly}
          className={`w-full bg-transparent text-sm outline-none placeholder:text-slate-600 ${
            readOnly ? "cursor-not-allowed text-slate-400" : ""
          }`}
        />
      </div>
    </label>
  );
}

function BrainCard({
  title,
  brain,
  onChange,
  accent,
  showApiKey
}: {
  title: string;
  brain: {
    provider: string;
    model: string;
    apiKey: string;
    computeType: "Cloud" | "Local" | "Container";
  };
  onChange: (next: {
    provider: string;
    model: string;
    apiKey: string;
    computeType: "Cloud" | "Local" | "Container";
  }) => void;
  accent: "emerald" | "amber";
  showApiKey: boolean;
}) {
  const accentClass =
    accent === "emerald"
      ? "border-emerald-500/30 bg-emerald-500/5"
      : "border-amber-500/30 bg-amber-500/5";

  return (
    <div className={`rounded-3xl border p-4 ${accentClass}`}>
      <p className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
        <Brain size={16} />
        {title}
      </p>

      <div className="space-y-3">
        <Field
          label="Provider"
          value={brain.provider}
          onChange={(value) => onChange({ ...brain, provider: value })}
          placeholder="OpenAI / Anthropic / Gemini"
          icon={Cloud}
        />
        <Field
          label="Model"
          value={brain.model}
          onChange={(value) => onChange({ ...brain, model: value })}
          placeholder="gpt-4o / claude / gemini"
          icon={Brain}
        />
        {showApiKey ? (
          <Field
            label="API Key (Encrypted)"
            value={brain.apiKey}
            onChange={(value) => onChange({ ...brain, apiKey: value })}
            placeholder="sk-..."
            icon={KeyRound}
          />
        ) : null}

        <div>
          <p className="mb-2 text-[11px] uppercase tracking-[0.22em] text-slate-400">Compute</p>
          <div className="grid grid-cols-3 gap-2">
            {COMPUTE_TYPES.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => onChange({ ...brain, computeType: option })}
                className={`rounded-xl border px-2 py-2 text-[10px] uppercase tracking-[0.2em] ${
                  brain.computeType === option
                    ? "border-white/60 bg-white text-black"
                    : "border-white/15 bg-black/30 text-slate-400"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function RangeField({
  label,
  value,
  min,
  max,
  step,
  icon: Icon,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  icon: typeof Wallet;
  onChange: (value: number) => void;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-black/30 p-4">
      <p className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-slate-400">
        <Icon size={14} />
        {label}
      </p>
      <p className="font-display text-3xl font-black text-white">{value.toLocaleString()}</p>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-4 w-full accent-emerald-500"
      />
    </div>
  );
}
