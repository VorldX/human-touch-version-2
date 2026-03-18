import "server-only";

import { prisma } from "@/lib/db/prisma";
import { dnaPhase4Config } from "@/lib/dna/phase4/config";

interface TraceRunRow {
  traceId: string;
  agentName: string | null;
  taskPrompt: string | null;
  runPrompt: string | null;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  flowId: string | null;
  taskId: string | null;
}

interface TraceDetailRow {
  id: string;
  status: string;
  prompt: string | null;
  contextPack: unknown;
  metadata: unknown;
  startedAt: Date;
  completedAt: Date | null;
  flowId: string | null;
  taskId: string | null;
  agentName: string | null;
}

interface AgentMemoryPreviewRow {
  id: string;
  summary: string | null;
  content: string;
  source: string;
  timestamp: Date;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumber(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function compact(value: string, maxChars = 220) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`;
}

function parseLimit(value: number | undefined, fallback: number, max: number) {
  if (!Number.isFinite(value) || !value || value <= 0) return fallback;
  return Math.max(1, Math.min(max, Math.floor(value)));
}

export async function listTraceRuns(input: {
  tenantId: string;
  limit?: number;
}) {
  const limit = parseLimit(
    input.limit,
    dnaPhase4Config.trace.defaultLimit,
    dnaPhase4Config.trace.maxLimit
  );

  const rows = await prisma.$queryRawUnsafe<TraceRunRow[]>(
    `
      SELECT
        ar.id::text AS "traceId",
        ag.name AS "agentName",
        t.prompt AS "taskPrompt",
        ar.prompt AS "runPrompt",
        ar.status::text AS "status",
        ar."startedAt" AS "startedAt",
        ar."completedAt" AS "completedAt",
        ar."flowId" AS "flowId",
        ar."taskId" AS "taskId"
      FROM "AgentRun" ar
      LEFT JOIN "Agent" ag
        ON ag.id = ar."agentId"
      LEFT JOIN "Task" t
        ON t.id = ar."taskId"
      WHERE ar."orgId" = $1
      ORDER BY ar."startedAt" DESC
      LIMIT $2
    `,
    input.tenantId,
    limit
  );

  return rows.map((row) => ({
    traceId: row.traceId,
    status: row.status,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    flowId: row.flowId,
    taskId: row.taskId,
    agentName: row.agentName ?? "Agent",
    responsePreview: compact(asText(row.taskPrompt) || asText(row.runPrompt) || "No prompt")
  }));
}

export async function getTraceDetail(input: {
  tenantId: string;
  traceId: string;
}) {
  const rows = await prisma.$queryRawUnsafe<TraceDetailRow[]>(
    `
      SELECT
        ar.id::text AS id,
        ar.status::text AS "status",
        ar.prompt,
        ar."contextPack" AS "contextPack",
        ar.metadata,
        ar."startedAt" AS "startedAt",
        ar."completedAt" AS "completedAt",
        ar."flowId" AS "flowId",
        ar."taskId" AS "taskId",
        ag.name AS "agentName"
      FROM "AgentRun" ar
      LEFT JOIN "Agent" ag
        ON ag.id = ar."agentId"
      WHERE ar."orgId" = $1
        AND ar.id = $2
      LIMIT 1
    `,
    input.tenantId,
    input.traceId
  );

  const run = rows[0];
  if (!run) {
    return null;
  }

  const contextPack = asRecord(run.contextPack);
  const memoryHighlights = asArray(contextPack.memoryHighlights)
    .map((item) => {
      const record = asRecord(item);
      return {
        id: asText(record.id),
        key: asText(record.key),
        tier: asText(record.tier),
        score: asNumber(record.score),
        similarity: asNumber(record.similarity),
        timeDecayScore: asNumber(record.timeDecayScore),
        hybridScore: asNumber(record.hybridScore),
        rerankScore: asNumber(record.rerankScore)
      };
    })
    .filter((item) => item.id)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);

  const graphHighlights = asArray(contextPack.graphHighlights)
    .map((item) => {
      const record = asRecord(item);
      return {
        id: asNumber(record.id),
        label: asText(record.label),
        score: asNumber(record.score),
        degree: asNumber(record.degree)
      };
    })
    .filter((item) => item.id > 0)
    .slice(0, 12);

  const memoryIds = memoryHighlights.map((item) => item.id);
  const memoryRows = memoryIds.length
    ? await prisma.$queryRawUnsafe<AgentMemoryPreviewRow[]>(
        `
          SELECT
            id,
            summary,
            content,
            source,
            timestamp
          FROM "AgentMemory"
          WHERE "orgId" = $1
            AND id = ANY($2::text[])
        `,
        input.tenantId,
        memoryIds
      )
    : [];

  const memoryById = new Map(memoryRows.map((row) => [row.id, row]));

  return {
    traceId: run.id,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    flowId: run.flowId,
    taskId: run.taskId,
    agentName: run.agentName ?? "Agent",
    prompt: asText(run.prompt),
    topRerankedVectors: memoryHighlights.map((item, index) => {
      const row = memoryById.get(item.id);
      return {
        rank: index + 1,
        memoryId: item.id,
        key: item.key,
        tier: item.tier,
        source: row?.source ?? "memory",
        summary: row?.summary ?? compact(row?.content ?? "", 280),
        snippet: compact(row?.content ?? "", 360),
        score: item.score,
        similarity: item.similarity,
        timeDecayScore: item.timeDecayScore,
        hybridScore: item.hybridScore,
        rerankScore: item.rerankScore,
        timestamp: row?.timestamp ?? null
      };
    }),
    graphNodes: graphHighlights,
    selectionTrace: contextPack.contextSelectionTrace ?? null
  };
}
