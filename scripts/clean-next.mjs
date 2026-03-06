import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const nextDir = resolve(process.cwd(), process.env.NEXT_DIST_DIR?.trim() || ".next");

try {
  if (existsSync(nextDir)) {
    rmSync(nextDir, {
      recursive: true,
      force: true,
      maxRetries: 6,
      retryDelay: 180
    });
  }
} catch {
  // Ignore when the cache dir does not exist or is briefly locked by another process.
}
