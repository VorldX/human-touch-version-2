import "server-only";

import { createHash } from "node:crypto";

export function hashSovereignIdentity(rawIdentity: string): string {
  const pepper = process.env.SOVEREIGN_ID_PEPPER ?? "";
  const normalized = rawIdentity.replace(/\s|-/g, "");
  return createHash("sha256").update(`${pepper}:${normalized}`).digest("hex");
}
