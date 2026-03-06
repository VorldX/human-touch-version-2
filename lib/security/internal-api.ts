import { NextRequest } from "next/server";

export const INTERNAL_API_HEADER = "x-internal-api-key";
const DEV_FALLBACK_INTERNAL_API_KEY = "dev_vorldx_internal_api_key";

export function resolveInternalApiKey() {
  const configured = (
    process.env.INTERNAL_API_KEY?.trim() ||
    process.env.INTERNAL_AGENT_EXECUTION_KEY?.trim()
  );

  if (configured) {
    return configured;
  }

  // In local development, keep internal route-to-route dispatch functional
  // even when the key is not explicitly configured in .env.
  if (process.env.NODE_ENV !== "production") {
    return DEV_FALLBACK_INTERNAL_API_KEY;
  }

  return "";
}

export function hasValidInternalApiKey(request: NextRequest) {
  const expected = resolveInternalApiKey();
  if (!expected) {
    return false;
  }

  const provided = request.headers.get(INTERNAL_API_HEADER)?.trim() ?? "";
  return provided.length > 0 && provided === expected;
}

export function buildInternalApiHeaders() {
  const key = resolveInternalApiKey();
  if (!key) {
    return {} as Record<string, string>;
  }
  return {
    [INTERNAL_API_HEADER]: key
  };
}
