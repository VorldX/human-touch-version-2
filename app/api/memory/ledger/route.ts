import { LogType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";

function parseLimit(value: string | null) {
  if (!value) {
    return 120;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 120;
  }
  return Math.min(parsed, 400);
}

function isCarbonActor(input: { actor: string; type: LogType }) {
  if (input.type === LogType.USER || input.type === LogType.COMPLIANCE) {
    return true;
  }
  return /(carbon|human|manual)/i.test(input.actor);
}

function hasHotSwapSignal(message: string) {
  return /(hot[- ]?swap|fallback model|cognitive redundancy|sovereign routing)/i.test(message);
}

function hasAmnesiaSignal(message: string, type: LogType) {
  if (type === LogType.SCRUB) {
    return true;
  }
  return /(amnesia|zero-retention|zkml|scrub)/i.test(message);
}

interface StreamEntry {
  id: string;
  source: "LOG" | "COMPLIANCE";
  actor: string;
  type: string;
  message: string;
  timestamp: Date;
  complianceHash: string | null;
}

export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("orgId")?.trim();
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));

  if (!orgId) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId query param is required."
      },
      { status: 400 }
    );
  }

  const [logs, compliance] = await Promise.all([
    prisma.log.findMany({
      where: { orgId },
      orderBy: { timestamp: "desc" },
      take: limit
    }),
    prisma.complianceAudit.findMany({
      where: { orgId },
      orderBy: { timestamp: "desc" },
      take: Math.min(limit, 200),
      include: {
        humanActor: {
          select: {
            id: true,
            username: true,
            email: true
          }
        }
      }
    })
  ]);

  const machine: StreamEntry[] = [];
  const carbon: StreamEntry[] = [];
  let hotSwapEvents = 0;
  let amnesiaWipes = 0;

  for (const log of logs) {
    if (hasHotSwapSignal(log.message)) {
      hotSwapEvents += 1;
    }
    if (hasAmnesiaSignal(log.message, log.type)) {
      amnesiaWipes += 1;
    }

    const entry: StreamEntry = {
      id: log.id,
      source: "LOG",
      actor: log.actor,
      type: log.type,
      message: log.message,
      timestamp: log.timestamp,
      complianceHash: null
    };

    if (isCarbonActor(log)) {
      carbon.push(entry);
    } else {
      machine.push(entry);
    }
  }

  for (const audit of compliance) {
    carbon.push({
      id: `audit-${audit.id}`,
      source: "COMPLIANCE",
      actor: audit.humanActor?.username || audit.humanActor?.email || "CARBON_NODE",
      type: "COMPLIANCE",
      message: `Compliance action: ${audit.actionType}`,
      timestamp: audit.timestamp,
      complianceHash: audit.complianceHash
    });
  }

  machine.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  carbon.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  return NextResponse.json({
    ok: true,
    metrics: {
      machineEvents: machine.length,
      carbonEvents: carbon.length,
      hotSwapEvents,
      amnesiaWipes,
      complianceHashes: compliance.length
    },
    streams: {
      machine: machine.slice(0, limit),
      carbon: carbon.slice(0, limit)
    },
    compliance
  });
}

