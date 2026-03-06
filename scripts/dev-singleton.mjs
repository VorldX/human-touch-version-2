import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import process from "node:process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const lockPath = resolve(process.cwd(), ".next-dev.lock");
const cleanScriptPath = resolve(process.cwd(), "scripts/clean-next.mjs");
const prismaGenerateScriptPath = resolve(process.cwd(), "scripts/prisma-generate-safe.mjs");
const nextBin = require.resolve("next/dist/bin/next");
const isOneDriveWorkspace = /(^|[\\/])onedrive([\\/]|$)/i.test(process.cwd());

function isRunningPid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLock() {
  if (!existsSync(lockPath)) {
    return null;
  }

  try {
    const raw = readFileSync(lockPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function removeLockIfMatches(expectedPid) {
  if (!existsSync(lockPath)) {
    return;
  }

  try {
    const lock = readLock();
    if (!lock || lock.pid === expectedPid) {
      rmSync(lockPath, { force: true });
    }
  } catch {
    // Ignore cleanup failure to avoid masking the real exit reason.
  }
}

const existing = readLock();
if (existing?.pid && isRunningPid(existing.pid)) {
  console.error(
    `Another dev server is already running for this repo (pid ${existing.pid}). Stop it before starting a new one.`
  );
  process.exit(1);
}

removeLockIfMatches(existing?.pid ?? null);

const devEnv = { ...process.env };

if (!devEnv.NEXT_DIST_DIR && process.platform === "win32" && isOneDriveWorkspace) {
  const cacheRootPath = resolve(process.cwd(), ".next-local-cache");
  const cacheDistPath = resolve(cacheRootPath, "dist");

  try {
    if (existsSync(cacheRootPath)) {
      const stat = lstatSync(cacheRootPath);
      if (stat.isSymbolicLink()) {
        rmSync(cacheRootPath, { recursive: true, force: true });
      }
    }

    mkdirSync(cacheDistPath, { recursive: true });
  } catch (error) {
    console.warn("Failed to initialize local Next.js cache path. Falling back to default .next.", error);
  }

  if (existsSync(cacheDistPath)) {
    devEnv.NEXT_DIST_DIR = ".next-local-cache/dist";
  }
}

const cleanResult = spawnSync(process.execPath, [cleanScriptPath], {
  stdio: "inherit",
  env: devEnv
});
if (typeof cleanResult.status === "number" && cleanResult.status !== 0) {
  process.exit(cleanResult.status);
}

const prismaGenerateResult = spawnSync(process.execPath, [prismaGenerateScriptPath], {
  stdio: "inherit",
  env: devEnv
});
if (typeof prismaGenerateResult.status === "number" && prismaGenerateResult.status !== 0) {
  process.exit(prismaGenerateResult.status);
}

const child = spawn(process.execPath, [nextBin, "dev", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: devEnv
});

writeFileSync(
  lockPath,
  JSON.stringify(
    {
      pid: child.pid,
      startedAt: new Date().toISOString()
    },
    null,
    2
  ),
  "utf8"
);

let cleaned = false;
function cleanup() {
  if (cleaned) {
    return;
  }
  cleaned = true;
  removeLockIfMatches(child.pid);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    if (!child.killed) {
      child.kill(signal);
    }
  });
}

child.on("error", (error) => {
  cleanup();
  console.error("Failed to start Next.js dev server:", error);
  process.exit(1);
});

child.on("exit", (code) => {
  cleanup();
  process.exit(code ?? 0);
});
