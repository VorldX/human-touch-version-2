import "server-only";

import { LogType } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { dnaPhase3Config } from "@/lib/dna/phase3/config";

function compact(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

export async function listPeripheralFallbackLogs(input: {
  orgId: string;
  limit?: number;
}) {
  const limit = Math.max(
    1,
    Math.min(25, Math.floor(input.limit ?? dnaPhase3Config.gracefulFallback.peripheralLogLimit))
  );

  const logs = await prisma.log.findMany({
    where: {
      orgId: input.orgId,
      type: {
        in: [LogType.SYS, LogType.EXE, LogType.NET, LogType.DNA]
      }
    },
    orderBy: { timestamp: "desc" },
    take: limit,
    select: {
      id: true,
      type: true,
      actor: true,
      message: true,
      timestamp: true
    }
  });

  return logs.map((log, index) => ({
    id: `peripheral-${log.id}`,
    key: `peripheral.log.${log.type.toLowerCase()}`,
    tier: "PERIPHERAL_LOG",
    value: {
      actor: log.actor,
      type: log.type,
      timestamp: log.timestamp.toISOString(),
      message: log.message,
      raw: compact(log.message)
    },
    score: Number((1 - index / Math.max(1, limit * 1.2)).toFixed(4))
  }));
}
