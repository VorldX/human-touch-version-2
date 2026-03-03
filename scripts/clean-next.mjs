import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const nextDir = ".next";

try {
  const entries = readdirSync(nextDir);
  for (const entry of entries) {
    const target = join(nextDir, entry);
    rmSync(target, { recursive: true, force: true });
  }
} catch {
  // Ignore when .next doesn't exist yet.
}
