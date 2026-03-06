"use client";

import { useCallback, useMemo, useState } from "react";
import { Loader2, Link2, SendHorizonal } from "lucide-react";

import { useFirebaseAuth } from "@/components/auth/firebase-auth-provider";

type RunStatus = "needs_input" | "needs_confirmation" | "completed" | "error";

interface RunResponse {
  status: RunStatus;
  assistant_message: string;
  required_inputs?: Array<{
    key: string;
    label: string;
    type: "text" | "email" | "number";
    placeholder: string;
  }>;
  draft?: {
    to: string;
    subject: string;
    body: string;
  };
  actions_taken?: Array<{
    type: string;
    meta?: Record<string, unknown>;
  }>;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

interface AgentRunConsoleProps {
  orgId: string;
}

function asText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function statusClasses(status: RunStatus) {
  if (status === "completed") {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
  }
  if (status === "needs_confirmation") {
    return "border-cyan-500/40 bg-cyan-500/10 text-cyan-200";
  }
  if (status === "needs_input") {
    return "border-amber-500/40 bg-amber-500/10 text-amber-200";
  }
  return "border-red-500/40 bg-red-500/10 text-red-200";
}

function openCenteredPopup(url: string, name: string) {
  const width = Math.max(720, Math.min(980, window.outerWidth - 80));
  const height = Math.max(620, Math.min(760, window.outerHeight - 90));
  const left = Math.max(0, window.screenX + Math.round((window.outerWidth - width) / 2));
  const top = Math.max(0, window.screenY + Math.round((window.outerHeight - height) / 2));

  return window.open(
    url,
    name,
    `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
  );
}

export function AgentRunConsole({ orgId }: AgentRunConsoleProps) {
  const { user } = useFirebaseAuth();

  const [prompt, setPrompt] = useState("");
  const [inputValues, setInputValues] = useState<Record<string, unknown>>({});
  const [result, setResult] = useState<RunResponse | null>(null);
  const [loading, setLoading] = useState(false);

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

  const callAgentRun = useCallback(
    async (confirm = false) => {
      if (!authHeaders) {
        setResult({
          status: "error",
          assistant_message: "Sign in to use Gmail agent actions.",
          error: {
            code: "UNAUTHENTICATED",
            message: "Session headers are missing."
          }
        });
        return;
      }

      const cleanedPrompt = prompt.trim();
      if (!cleanedPrompt) {
        setResult({
          status: "error",
          assistant_message: "Please enter a prompt.",
          error: {
            code: "INVALID_REQUEST",
            message: "Prompt is required."
          }
        });
        return;
      }

      setLoading(true);
      try {
        const response = await fetch("/api/agent/run", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders
          },
          body: JSON.stringify({
            prompt: cleanedPrompt,
            input: {
              ...inputValues,
              orgId
            },
            confirm,
            orgId
          })
        });

        const payload = (await response.json().catch(() => null)) as RunResponse | null;
        if (!payload) {
          throw new Error("Invalid response from agent.");
        }

        setResult(payload);
        if (payload.draft) {
          const draft = payload.draft;
          setInputValues((previous) => ({
            ...previous,
            recipient_email: draft.to || previous.recipient_email,
            subject: draft.subject,
            body: draft.body,
            draft
          }));
        }
      } catch (error) {
        setResult({
          status: "error",
          assistant_message: "Failed to run Gmail agent flow.",
          error: {
            code: "REQUEST_FAILED",
            message: error instanceof Error ? error.message : "Request failed."
          }
        });
      } finally {
        setLoading(false);
      }
    },
    [authHeaders, inputValues, orgId, prompt]
  );

  const connectUrl =
    result?.error?.code === "INTEGRATION_NOT_CONNECTED"
      ? asText(result.error.details?.connectUrl) ||
        "/app?tab=hub&hubScope=TOOLS&toolkit=gmail"
      : "";

  return (
    <section className="space-y-4 rounded-3xl border border-white/10 bg-black/35 p-5">
      <div>
        <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">One Prompt Gmail</p>
        <h3 className="mt-1 font-display text-xl font-black uppercase tracking-[0.08em] text-white">
          Agent Run
        </h3>
      </div>

      <textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder="Send congratulation mail to her for her wedding"
        className="min-h-24 w-full resize-y rounded-2xl border border-white/10 bg-black/45 p-3 text-sm text-slate-100 outline-none placeholder:text-slate-600"
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => void callAgentRun(false)}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300 disabled:opacity-60"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <SendHorizonal size={12} />}
          Run
        </button>
        {result?.status === "needs_confirmation" && result.draft ? (
          <button
            onClick={() => void callAgentRun(true)}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-200 disabled:opacity-60"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <SendHorizonal size={12} />}
            Confirm Send
          </button>
        ) : null}
        {connectUrl ? (
          <button
            onClick={() => {
              const popup = openCenteredPopup(connectUrl, "integrations-gmail");
              if (!popup) {
                window.location.assign(connectUrl);
              }
            }}
            className="inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-200"
          >
            <Link2 size={12} />
            Connect Gmail
          </button>
        ) : null}
      </div>

      {result ? (
        <div className={`rounded-2xl border px-3 py-2 text-sm ${statusClasses(result.status)}`}>
          {result.assistant_message}
        </div>
      ) : null}

      {result?.required_inputs && result.required_inputs.length > 0 ? (
        <div className="grid gap-2 md:grid-cols-2">
          {result.required_inputs.map((field) => (
            <label key={field.key} className="space-y-1">
              <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                {field.label}
              </span>
              <input
                type={field.type}
                value={asText(inputValues[field.key])}
                onChange={(event) =>
                  setInputValues((previous) => ({
                    ...previous,
                    [field.key]: event.target.value
                  }))
                }
                placeholder={field.placeholder}
                className="w-full rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600"
              />
            </label>
          ))}
        </div>
      ) : null}

      {result?.draft ? (
        <div className="space-y-2 rounded-2xl border border-white/10 bg-black/30 p-3">
          <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Draft Preview</p>
          <label className="space-y-1">
            <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">To</span>
            <input
              value={asText(inputValues.recipient_email) || result.draft.to}
              onChange={(event) =>
                setInputValues((previous) => ({
                  ...previous,
                  recipient_email: event.target.value
                }))
              }
              className="w-full rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-sm text-slate-100 outline-none"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Subject</span>
            <input
              value={asText(inputValues.subject) || result.draft.subject}
              onChange={(event) =>
                setInputValues((previous) => ({
                  ...previous,
                  subject: event.target.value
                }))
              }
              className="w-full rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-sm text-slate-100 outline-none"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Body</span>
            <textarea
              value={asText(inputValues.body) || result.draft.body}
              onChange={(event) =>
                setInputValues((previous) => ({
                  ...previous,
                  body: event.target.value
                }))
              }
              className="min-h-28 w-full resize-y rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-sm text-slate-100 outline-none"
            />
          </label>
        </div>
      ) : null}

      {result?.actions_taken && result.actions_taken.length > 0 ? (
        <div className="space-y-1 rounded-2xl border border-white/10 bg-black/30 p-3">
          <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Actions</p>
          {result.actions_taken.map((entry, index) => (
            <p key={`${entry.type}:${index}`} className="text-xs text-slate-300">
              {entry.type}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}
