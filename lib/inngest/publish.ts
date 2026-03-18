import "server-only";

import { featureFlags } from "@/lib/config/feature-flags";
import { decideExecutionMode } from "@/lib/migration/strangler-router";
import { logInfo, logWarn } from "@/lib/observability/logger";
import { dispatchLegacyEventToQueueShadow } from "@/lib/queue/shadow-dispatch";
import { buildInternalApiHeaders } from "@/lib/security/internal-api";

export interface PublishResult {
  ok: boolean;
  message?: string;
}

function appendCandidate(candidates: string[], value: string | undefined) {
  const normalized = value?.trim().replace(/\/$/, "");
  if (!normalized) {
    return;
  }
  if (!candidates.includes(normalized)) {
    candidates.push(normalized);
  }
}

function resolveFallbackOrigins() {
  const candidates: string[] = [];

  appendCandidate(candidates, process.env.INTERNAL_APP_BASE_URL);
  appendCandidate(candidates, process.env.APP_URL);
  appendCandidate(candidates, process.env.NEXT_PUBLIC_APP_URL);
  appendCandidate(candidates, process.env.NEXTAUTH_URL);

  const explicitPort = process.env.PORT?.trim();
  if (explicitPort) {
    appendCandidate(candidates, `http://127.0.0.1:${explicitPort}`);
    appendCandidate(candidates, `http://localhost:${explicitPort}`);
  }

  appendCandidate(candidates, "http://127.0.0.1:3001");
  appendCandidate(candidates, "http://localhost:3001");
  appendCandidate(candidates, "http://127.0.0.1:3000");
  appendCandidate(candidates, "http://localhost:3000");

  return candidates;
}

async function postToEndpoint(endpoint: string, payload: unknown) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildInternalApiHeaders()
    },
    body: JSON.stringify(payload),
    cache: "no-store"
  });

  if (!response.ok) {
    const detail = await response.text();
    return {
      ok: false as const,
      message: `Inngest publish failed (${response.status}): ${detail.slice(0, 180)}`
    };
  }

  return { ok: true as const };
}

export async function publishInngestEvent(
  eventName: string,
  data: Record<string, unknown>
): Promise<PublishResult> {
  const orgId = typeof data.orgId === "string" ? data.orgId.trim() : "";
  const decision = orgId
    ? decideExecutionMode({ orgId })
    : {
        mode: "legacy_only" as const,
        sourceOfTruth: "legacy_inngest_route" as const,
        shadowTarget: null
      };
  const shouldMirrorQueue =
    featureFlags.useQueueExecutionShadow ||
    (decision.mode === "shadow" && decision.shadowTarget === "queue_runtime");
  const shouldUseQueuePrimary =
    featureFlags.useQueueExecution ||
    (decision.mode === "queue_primary" && decision.sourceOfTruth === "queue_runtime");

  if (shouldMirrorQueue || shouldUseQueuePrimary) {
    const shadowPublish = await dispatchLegacyEventToQueueShadow({
      name: eventName,
      data
    });

    if (
      shouldUseQueuePrimary &&
      shadowPublish.ok &&
      featureFlags.disableLegacyInngestDispatch
    ) {
      logInfo({
        service: "inngest-publish",
        orgId,
        runId: typeof data.flowId === "string" ? data.flowId : undefined,
        traceId: typeof data.traceId === "string" ? data.traceId : undefined,
        event: "queue_primary_dispatch",
        message: `Queue primary accepted ${eventName}`,
        meta: {
          outboxId: shadowPublish.outboxId ?? null
        }
      });
      return {
        ok: true,
        message: `Queue primary dispatch accepted (${shadowPublish.outboxId ?? "outboxed"}).`
      };
    }

    if (shouldUseQueuePrimary && !shadowPublish.ok) {
      // Safety valve: queue primary falls back to legacy dispatch if queue path is unavailable.
      logWarn({
        service: "inngest-publish",
        orgId,
        runId: typeof data.flowId === "string" ? data.flowId : undefined,
        traceId: typeof data.traceId === "string" ? data.traceId : undefined,
        event: "queue_primary_fallback",
        message: `Queue primary failed for ${eventName}, using legacy dispatch.`,
        meta: {
          reason: shadowPublish.reason,
          error: shadowPublish.error ?? null
        }
      });
    }
  }

  const payload = [
    {
      name: eventName,
      data
    }
  ];

  const baseUrl = process.env.INNGEST_BASE_URL?.trim();
  const endpoint = baseUrl
    ? `${baseUrl.replace(/\/$/, "")}/e/${encodeURIComponent(
        process.env.INNGEST_EVENT_KEY ?? "dev_event_key"
      )}`
    : "";

  try {
    if (endpoint) {
      const remotePublish = await postToEndpoint(endpoint, payload);
      if (remotePublish.ok) {
        return remotePublish;
      }

      const fallbackOrigins = resolveFallbackOrigins();
      if (fallbackOrigins.length === 0) {
        return remotePublish;
      }

      const fallbackErrors: string[] = [];
      for (const origin of fallbackOrigins) {
        const localResult = await postToEndpoint(`${origin}/api/inngest`, payload);
        if (localResult.ok) {
          return {
            ok: true,
            message: `Primary Inngest endpoint failed. Fell back to local worker at ${origin}.`
          };
        }
        fallbackErrors.push(`${origin}: ${localResult.message}`);
      }

      return {
        ok: false,
        message: `${remotePublish.message} | Fallback dispatch failed: ${fallbackErrors.join(" || ")}`
      };
    }

    const fallbackOrigins = resolveFallbackOrigins();
    if (fallbackOrigins.length === 0) {
      return {
        ok: false,
        message: "No INNGEST_BASE_URL configured and no local fallback origins available."
      };
    }

    const fallbackErrors: string[] = [];
    for (const origin of fallbackOrigins) {
      const localResult = await postToEndpoint(`${origin}/api/inngest`, payload);
      if (localResult.ok) {
        return { ok: true };
      }
      fallbackErrors.push(`${origin}: ${localResult.message}`);
    }

    return {
      ok: false,
      message: `INNGEST_BASE_URL is not configured and local fallback failed: ${fallbackErrors.join(" || ")}`
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Unknown Inngest publish failure."
    };
  }
}
