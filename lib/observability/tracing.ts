import "server-only";

import { randomUUID } from "node:crypto";

export function getOrCreateTraceId(value?: string | null) {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (candidate) return candidate;
  return randomUUID();
}
