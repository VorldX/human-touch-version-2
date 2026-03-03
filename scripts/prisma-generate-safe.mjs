import { spawnSync } from "node:child_process";

function isWindowsEngineLockError(text) {
  return (
    /EPERM: operation not permitted, rename/i.test(text) &&
    /query_engine-windows\.dll\.node/i.test(text)
  );
}

function run(command, args) {
  return spawnSync(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32"
  });
}

const attempts = [
  ["prisma", ["generate"]],
  ["npx", ["prisma", "generate"]]
];

for (const [command, args] of attempts) {
  const result = run(command, args);
  const out = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

  if (result.status === 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(0);
  }

  if (isWindowsEngineLockError(out)) {
    if (result.stdout) process.stdout.write(result.stdout);
    console.warn(
      "Prisma generate skipped for typecheck: query engine is locked by a running process."
    );
    process.exit(0);
  }

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

process.exit(1);
