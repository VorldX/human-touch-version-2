import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { delimiter, join, relative, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import process from "node:process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const lockPath = resolve(process.cwd(), ".next-dev.lock");
const cleanScriptPath = resolve(process.cwd(), "scripts/clean-next.mjs");
const prismaGenerateScriptPath = resolve(process.cwd(), "scripts/prisma-generate-safe.mjs");
const fsRetryHookPath = resolve(process.cwd(), "scripts/fs-ebusy-retry.cjs");
const nextBin = require.resolve("next/dist/bin/next");
const nextPackage = require("next/package.json");
const isOneDriveWorkspace = /(^|[\\/])onedrive([\\/]|$)/i.test(process.cwd());
const nextMajorVersion = Number.parseInt(String(nextPackage.version || "0").split(".")[0] || "0", 10);

function normalizePathForCompare(value) {
  return value.replace(/^\\\\\?\\/, "").toLowerCase();
}

function appendNodePathEntry(existingValue, entry) {
  const normalizedEntry = entry.trim();
  if (!normalizedEntry) return existingValue || "";

  const items = (existingValue || "")
    .split(delimiter)
    .map((part) => part.trim())
    .filter(Boolean);
  const hasEntry = items.some(
    (item) => normalizePathForCompare(item) === normalizePathForCompare(normalizedEntry)
  );
  if (!hasEntry) {
    items.unshift(normalizedEntry);
  }
  return items.join(delimiter);
}

function appendNodeRequireOption(existingValue, modulePath) {
  const currentValue = existingValue?.trim() || "";
  if (!modulePath) {
    return currentValue;
  }

  const normalizedModulePath = modulePath.replace(/\\/g, "/");
  if (
    normalizePathForCompare(currentValue).includes(
      normalizePathForCompare(normalizedModulePath)
    ) ||
    normalizePathForCompare(currentValue).includes(normalizePathForCompare(modulePath))
  ) {
    return currentValue;
  }

  const escapedPath = normalizedModulePath.replace(/"/g, '\\"');
  const requireOption = `--require "${escapedPath}"`;
  return currentValue ? `${requireOption} ${currentValue}` : requireOption;
}

function resolveExternalNextCacheRoot() {
  const explicitBase = process.env.NEXT_WINDOWS_CACHE_BASE_DIR?.trim() || "";
  const localAppData = process.env.LOCALAPPDATA?.trim() || "";
  const tempBase = process.env.TEMP?.trim() || process.env.TMP?.trim() || "";
  const basePath = explicitBase || localAppData || tempBase;

  if (!basePath) {
    return null;
  }

  const repoHash = createHash("sha1")
    .update(process.cwd().toLowerCase())
    .digest("hex")
    .slice(0, 12);

  return join(basePath, "vorldx-next-cache", repoHash);
}

function resolveExternalRelativeDistDir(externalCacheRoot) {
  const externalDistAbsolute = join(externalCacheRoot, "dist");
  mkdirSync(externalDistAbsolute, { recursive: true });

  const relativeDist = relative(process.cwd(), externalDistAbsolute);
  if (!relativeDist) {
    return null;
  }
  if (/^[A-Za-z]:[\\/]/.test(relativeDist)) {
    return null;
  }
  return relativeDist;
}

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
const shouldExternalizeDist = process.platform === "win32" && isOneDriveWorkspace;

if (!devEnv.NEXT_DIST_DIR && shouldExternalizeDist) {
  const externalCacheRoot = resolveExternalNextCacheRoot();
  const localCacheRoot = resolve(process.cwd(), ".next-local-cache");
  const localDistRelative = ".next-local-cache/dist";
  const localDistAbsolute = resolve(process.cwd(), localDistRelative);

  if (externalCacheRoot) {
    try {
      mkdirSync(externalCacheRoot, { recursive: true });
      const externalRelativeDist = resolveExternalRelativeDistDir(externalCacheRoot);
      if (externalRelativeDist) {
        devEnv.NEXT_DIST_DIR = externalRelativeDist;
        console.log(
          `[dev-singleton] Using direct external Next.js cache at ${resolve(
            process.cwd(),
            externalRelativeDist
          )}`
        );
      } else {
        let recreateLink = true;
        if (existsSync(localCacheRoot)) {
          const stat = lstatSync(localCacheRoot);
          if (stat.isSymbolicLink()) {
            const linked = readlinkSync(localCacheRoot);
            const resolvedLinked = resolve(process.cwd(), linked.replace(/^\\\\\?\\/, ""));
            if (
              normalizePathForCompare(resolvedLinked) ===
              normalizePathForCompare(externalCacheRoot)
            ) {
              recreateLink = false;
            } else {
              rmSync(localCacheRoot, {
                recursive: true,
                force: true,
                maxRetries: 6,
                retryDelay: 180
              });
            }
          } else {
            rmSync(localCacheRoot, {
              recursive: true,
              force: true,
              maxRetries: 6,
              retryDelay: 180
            });
          }
        }

        if (recreateLink) {
          symlinkSync(externalCacheRoot, localCacheRoot, "junction");
        }

        mkdirSync(localDistAbsolute, { recursive: true });
        devEnv.NEXT_DIST_DIR = localDistRelative;
        console.log(
          `[dev-singleton] Using Next.js cache outside OneDrive at ${externalCacheRoot}`
        );
      }
    } catch (error) {
      console.warn(
        "Failed to initialize external Next.js cache junction. Falling back to workspace cache path.",
        error
      );
    }
  }

  if (!devEnv.NEXT_DIST_DIR) {
    try {
      mkdirSync(localDistAbsolute, { recursive: true });
      devEnv.NEXT_DIST_DIR = localDistRelative;
      console.log(
        `[dev-singleton] Using fallback Next.js cache at ${localDistAbsolute}`
      );
    } catch {
      // Keep default ".next" behavior if cache bootstrap fails.
    }
  }

}

// Externalized dist paths execute compiled files outside repo root; ensure runtime
// still resolves project-local dependencies like "react" and "next/dist/compiled/*".
if (shouldExternalizeDist && devEnv.NEXT_DIST_DIR) {
  const projectNodeModules = resolve(process.cwd(), "node_modules");
  devEnv.NODE_PATH = appendNodePathEntry(devEnv.NODE_PATH, projectNodeModules);

  if (devEnv.NEXT_DISABLE_FS_EBUSY_RETRY !== "1") {
    devEnv.NODE_OPTIONS = appendNodeRequireOption(devEnv.NODE_OPTIONS, fsRetryHookPath);
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

const requestedArgs = process.argv.slice(2);
const hasBundlerOverride = requestedArgs.some(
  (arg) => arg === "--webpack" || arg === "--turbopack" || arg === "--turbo"
);
const nextArgs = [
  nextBin,
  "dev",
  ...(nextMajorVersion >= 16 && !hasBundlerOverride ? ["--webpack"] : []),
  ...requestedArgs
];

const child = spawn(process.execPath, nextArgs, {
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
