import "server-only";

export interface PublishResult {
  ok: boolean;
  message?: string;
}

export async function publishInngestEvent(
  eventName: string,
  data: Record<string, unknown>
): Promise<PublishResult> {
  const baseUrl = process.env.INNGEST_BASE_URL;
  if (!baseUrl) {
    return {
      ok: false,
      message: "INNGEST_BASE_URL is not configured."
    };
  }

  const eventKey = process.env.INNGEST_EVENT_KEY ?? "dev_event_key";
  const endpoint = `${baseUrl.replace(/\/$/, "")}/e/${encodeURIComponent(eventKey)}`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify([
        {
          name: eventName,
          data
        }
      ]),
      cache: "no-store"
    });

    if (!response.ok) {
      const detail = await response.text();
      return {
        ok: false,
        message: `Inngest publish failed (${response.status}): ${detail.slice(0, 180)}`
      };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Unknown Inngest publish failure."
    };
  }
}
