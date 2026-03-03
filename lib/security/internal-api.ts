import { NextRequest } from "next/server";

export const INTERNAL_API_HEADER = "x-internal-api-key";

export function resolveInternalApiKey() {
  return (
    process.env.INTERNAL_API_KEY?.trim() ||
    process.env.INTERNAL_AGENT_EXECUTION_KEY?.trim() ||
    ""
  );
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

