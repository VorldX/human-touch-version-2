import "server-only";

interface RealtimePublishInput {
  orgId: string;
  event: string;
  payload?: Record<string, unknown>;
}

interface RealtimePublishResult {
  ok: boolean;
  message?: string;
}

export async function publishRealtimeEvent(
  input: RealtimePublishInput
): Promise<RealtimePublishResult> {
  const endpoint = process.env.REALTIME_SERVER_URL?.trim();
  if (!endpoint) {
    return { ok: false, message: "REALTIME_SERVER_URL not configured." };
  }

  try {
    const token = process.env.REALTIME_EMIT_TOKEN?.trim();
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "X-Realtime-Token": token } : {})
      },
      body: JSON.stringify({
        orgId: input.orgId,
        event: input.event,
        payload: input.payload ?? {}
      }),
      cache: "no-store"
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        ok: false,
        message: `Realtime publish failed (${response.status}): ${text}`
      };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Realtime publish failed."
    };
  }
}
