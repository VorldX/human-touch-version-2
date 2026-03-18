export const dynamic = "force-dynamic";

import { LogType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { buildComplianceHash } from "@/lib/security/audit";
import { requireOrgAccess } from "@/lib/security/org-access";

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

function resolveMemoryEventType(input: {
  createdAt: Date;
  updatedAt: Date;
  redactedAt: Date | null;
}) {
  if (input.redactedAt) {
    return "MEMORY_REDACT" as const;
  }
  if (input.updatedAt.getTime() > input.createdAt.getTime()) {
    return "MEMORY_UPDATE" as const;
  }
  return "MEMORY_WRITE" as const;
}

function buildMemoryMessage(input: {
  eventType: "MEMORY_WRITE" | "MEMORY_UPDATE" | "MEMORY_REDACT";
  key: string;
  tier: string;
  flowId: string | null;
  taskId: string | null;
}) {
  const scopeParts = [
    `tier=${input.tier}`,
    input.flowId ? `flow=${input.flowId}` : null,
    input.taskId ? `task=${input.taskId}` : null
  ].filter(Boolean);
  const scope = scopeParts.join(", ");
  if (input.eventType === "MEMORY_REDACT") {
    return `Memory entry ${input.key} redacted (${scope}).`;
  }
  if (input.eventType === "MEMORY_UPDATE") {
    return `Memory entry ${input.key} updated (${scope}).`;
  }
  return `Memory entry ${input.key} created (${scope}).`;
}

interface StreamEntry {
  id: string;
  source: "LOG" | "COMPLIANCE" | "MEMORY";
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
  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  const [logs, compliance, memoryEntries] = await Promise.all([
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
    }),
    prisma.memoryEntry.findMany({
      where: { orgId },
      orderBy: { updatedAt: "desc" },
      take: Math.min(limit * 2, 400),
      include: {
        user: {
          select: {
            id: true,
            username: true,
            email: true
          }
        },
        agent: {
          select: {
            id: true,
            name: true,
            role: true
          }
        }
      }
    })
  ]);

  const machine: StreamEntry[] = [];
  const carbon: StreamEntry[] = [];
  const memory: StreamEntry[] = [];
  let hotSwapEvents = 0;
  let amnesiaWipes = 0;
  let memoryRedactions = 0;

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

  for (const entry of memoryEntries) {
    const eventType = resolveMemoryEventType(entry);
    if (eventType === "MEMORY_REDACT") {
      memoryRedactions += 1;
    }

    const actor =
      entry.user?.username ||
      entry.user?.email ||
      entry.agent?.name ||
      (entry.agentId ? `AGENT_${entry.agentId.slice(0, 8)}` : "MEMORY_ENGINE");
    const timestamp = entry.redactedAt ?? entry.updatedAt;
    const complianceHash = buildComplianceHash({
      actionType: eventType,
      orgId: entry.orgId,
      memoryEntryId: entry.id,
      key: entry.key,
      tier: entry.tier,
      flowId: entry.flowId,
      taskId: entry.taskId,
      actor,
      timestamp: timestamp.toISOString()
    });

    memory.push({
      id: `memory-${entry.id}`,
      source: "MEMORY",
      actor,
      type: eventType,
      message: buildMemoryMessage({
        eventType,
        key: entry.key,
        tier: entry.tier,
        flowId: entry.flowId,
        taskId: entry.taskId
      }),
      timestamp,
      complianceHash
    });
  }

  machine.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  carbon.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  memory.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  return NextResponse.json({
    ok: true,
    metrics: {
      machineEvents: machine.length,
      carbonEvents: carbon.length,
      memoryEvents: memory.length,
      hotSwapEvents,
      amnesiaWipes,
      memoryRedactions,
      complianceHashes: compliance.length + memory.length
    },
    streams: {
      machine: machine.slice(0, limit),
      carbon: carbon.slice(0, limit),
      memory: memory.slice(0, limit)
    },
    compliance
  });
}
