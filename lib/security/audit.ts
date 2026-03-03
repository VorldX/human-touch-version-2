import "server-only";

import { createHash } from "node:crypto";

export function buildComplianceHash(payload: Record<string, unknown>) {
  const encoded = JSON.stringify(payload);
  return createHash("sha256").update(encoded).digest("hex");
}

