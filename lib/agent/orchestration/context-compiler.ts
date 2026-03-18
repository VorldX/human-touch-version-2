import "server-only";

import type { OrgExecutionMode } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import {
  getDirection,
  listDirectionFlowLinksByFlow
} from "@/lib/direction/directions";
import { ensureCompanyDataFile } from "@/lib/hub/organization-hub";
import { listDnaProfiles } from "@/lib/dna/profiles";
import {
  selectContextBlocksByPriority
} from "@/lib/agent/orchestration/context-budget";

import type {
  AgentBudgetSnapshot,
  AgentContextPack
} from "@/lib/agent/orchestration/types";
import {
  retrieveRelevantDnaFiles,
  retrieveRelevantMemoryEntries
} from "@/lib/agent/orchestration/rag-retriever";

interface ContextCandidate {
  id: string;
  name: string;
  priority: number;
  relevance: number;
  amnesiaProtected: boolean;
  content: string;
}

interface GraphHighlightCandidate {
  id: number;
  label: string;
  degree: number;
  score: number;
}

const MIN_SECTION_TOKENS = 48;
const DEFAULT_CONTEXT_BUDGET_TOKENS = 980;
const DEFAULT_CONTEXT_SECTION_MAX_TOKENS = 280;

function parsePositiveEnvInt(name: string, fallback: number) {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw) || raw <= 0) {
    return fallback;
  }
  return Math.floor(raw);
}

const HARD_CONTEXT_BUDGET_TOKENS = parsePositiveEnvInt(
  "AGENT_CONTEXT_MAX_TOKENS",
  DEFAULT_CONTEXT_BUDGET_TOKENS
);
const HARD_SECTION_MAX_TOKENS = parsePositiveEnvInt(
  "AGENT_CONTEXT_MAX_SECTION_TOKENS",
  DEFAULT_CONTEXT_SECTION_MAX_TOKENS
);

function compact(input: string) {
  return input.replace(/\s+/g, " ").trim();
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3);
}

function scoreRelevance(prompt: string, candidate: string) {
  const promptTokens = new Set(tokenize(prompt));
  if (promptTokens.size === 0) return 0;
  const candidateTokens = tokenize(candidate);
  if (candidateTokens.length === 0) return 0;
  let hits = 0;
  for (const token of candidateTokens) {
    if (promptTokens.has(token)) {
      hits += 1;
    }
  }
  return Number((Math.min(1, hits / Math.max(6, promptTokens.size))).toFixed(4));
}

function clampText(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}

function stringifyPreview(value: unknown, maxChars: number) {
  let text = "";
  try {
    text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  } catch {
    text = "";
  }
  return clampText(compact(text), maxChars);
}

function determineLimits(mode: OrgExecutionMode) {
  if (mode === "ECO") {
    return {
      memoryLimit: 3,
      dnaLimit: 1,
      priorRunLimit: 1,
      contextBudgetTokens: 720,
      sectionMaxTokens: 190
    };
  }
  if (mode === "TURBO") {
    return {
      memoryLimit: 7,
      dnaLimit: 3,
      priorRunLimit: 3,
      contextBudgetTokens: 1350,
      sectionMaxTokens: 340
    };
  }
  return {
    memoryLimit: 5,
    dnaLimit: 2,
    priorRunLimit: 2,
    contextBudgetTokens: 980,
    sectionMaxTokens: 260
  };
}

function compactHistoryReason(value: unknown) {
  const text = typeof value === "string" ? compact(value) : "";
  return text ? clampText(text, 160) : "";
}

function buildTaskRequestSection(input: {
  taskPrompt?: string | null;
  flowPrompt?: string | null;
  status?: string | null;
}) {
  const taskPrompt = compact(input.taskPrompt ?? "");
  const flowPrompt = compact(input.flowPrompt ?? "");
  return compact(
    [
      taskPrompt ? `Task request: ${clampText(taskPrompt, 720)}` : "",
      flowPrompt && flowPrompt !== taskPrompt ? `Mission: ${clampText(flowPrompt, 340)}` : "",
      input.status ? `Task status: ${input.status}` : ""
    ]
      .filter(Boolean)
      .join(" | ")
  );
}

function buildOrganizationSection(input: {
  name?: string | null;
  description?: string | null;
  mode: OrgExecutionMode;
  monthlyBudget?: number;
  currentSpend?: number;
}) {
  return compact(
    JSON.stringify(
      {
        name: input.name ?? "",
        description: clampText(compact(input.description ?? ""), 220),
        executionMode: input.mode,
        monthlyBudgetUsd: input.monthlyBudget ?? 0,
        currentSpendUsd: input.currentSpend ?? 0
      },
      null,
      2
    )
  );
}

function buildDirectionSection(direction: {
  id: string;
  title: string;
  summary: string;
  direction: string;
  status: string;
  tags: string[];
}) {
  return compact(
    JSON.stringify(
      {
        id: direction.id,
        title: direction.title,
        summary: clampText(compact(direction.summary), 260),
        direction: clampText(compact(direction.direction), 420),
        status: direction.status,
        tags: direction.tags.slice(0, 8)
      },
      null,
      2
    )
  );
}

function buildMemorySection(
  entries: Array<{
    id: string;
    key: string;
    tier: string;
    value: unknown;
    score: number;
  }>,
  maxItems: number
) {
  return compact(
    JSON.stringify(
      entries.slice(0, maxItems).map((entry) => ({
        id: entry.id,
        key: entry.key,
        tier: entry.tier,
        score: entry.score,
        preview: stringifyPreview(entry.value, 220)
      })),
      null,
      2
    )
  );
}

function buildGraphSection(
  entries: Array<{
    id: number;
    label: string;
    degree: number;
    score: number;
  }>
) {
  return compact(
    JSON.stringify(
      entries.map((entry) => ({
        id: entry.id,
        label: entry.label,
        degree: entry.degree,
        score: entry.score
      })),
      null,
      2
    )
  );
}

export async function buildAgentContextPack(input: {
  orgId: string;
  flowId: string;
  taskId: string;
  prompt: string;
  mode: OrgExecutionMode;
  agentId?: string | null;
  userId?: string | null;
  parentRunId?: string | null;
  requiredToolkits: string[];
  budgetSnapshot: AgentBudgetSnapshot;
}): Promise<AgentContextPack> {
  const limits = determineLimits(input.mode);
  const budgetTokens = Math.max(
    300,
    Math.min(HARD_CONTEXT_BUDGET_TOKENS, limits.contextBudgetTokens)
  );
  const sectionMaxTokens = Math.max(
    MIN_SECTION_TOKENS,
    Math.min(HARD_SECTION_MAX_TOKENS, limits.sectionMaxTokens)
  );

  const [org, flow, task, companyData] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: input.orgId },
      select: {
        id: true,
        name: true,
        description: true,
        monthlyBudget: true,
        currentSpend: true
      }
    }),
    prisma.flow.findUnique({
      where: { id: input.flowId },
      select: {
        id: true,
        prompt: true,
        status: true,
        progress: true
      }
    }),
    prisma.task.findUnique({
      where: { id: input.taskId },
      select: {
        id: true,
        prompt: true,
        requiredFiles: true,
        status: true
      }
    }),
    ensureCompanyDataFile(input.orgId).catch(() => null)
  ]);

  const directionLinks = await listDirectionFlowLinksByFlow(input.orgId, input.flowId);
  const direction = directionLinks[0]?.directionId
    ? await getDirection(input.orgId, directionLinks[0].directionId)
    : null;

  const [memoryEntries, dnaFiles, dnaProfiles, priorRuns, parentRun, graphNodeRows] = await Promise.all([
    retrieveRelevantMemoryEntries({
      orgId: input.orgId,
      prompt: input.prompt,
      flowId: input.flowId,
      taskId: input.taskId,
      agentId: input.agentId ?? null,
      userId: input.userId ?? null,
      limit: limits.memoryLimit
    }),
    retrieveRelevantDnaFiles({
      orgId: input.orgId,
      prompt: input.prompt,
      limit: limits.dnaLimit
    }),
    listDnaProfiles(input.orgId, "ORGANIZATION").catch(() => []),
    prisma.agentRun.findMany({
      where: {
        orgId: input.orgId,
        flowId: input.flowId
      },
      orderBy: { startedAt: "desc" },
      take: limits.priorRunLimit,
      select: {
        id: true,
        decisionType: true,
        decisionReason: true,
        status: true,
        startedAt: true,
        completedAt: true
      }
    }),
    input.parentRunId
      ? prisma.agentRun.findUnique({
          where: { id: input.parentRunId },
          select: {
            id: true,
            decisionType: true,
            decisionReason: true
          }
        })
      : Promise.resolve(null),
    input.userId
      ? prisma.$queryRawUnsafe<
          Array<{
            id: number;
            label: string;
            propertiesJsonb: unknown;
            degree: number;
          }>
        >(
          `
            WITH edge_counts AS (
              SELECT source_id AS node_id, COUNT(*)::int AS degree
              FROM dna_memory.edges
              WHERE tenant_id = $1
                AND user_id = $2
              GROUP BY source_id
              UNION ALL
              SELECT target_id AS node_id, COUNT(*)::int AS degree
              FROM dna_memory.edges
              WHERE tenant_id = $1
                AND user_id = $2
              GROUP BY target_id
            ),
            totals AS (
              SELECT node_id, SUM(degree)::int AS degree
              FROM edge_counts
              GROUP BY node_id
            )
            SELECT
              n.id,
              n.label,
              n.properties_jsonb AS "propertiesJsonb",
              COALESCE(t.degree, 0)::int AS degree
            FROM dna_memory.nodes n
            LEFT JOIN totals t
              ON t.node_id = n.id
            WHERE n.tenant_id = $1
              AND n.user_id = $2
            ORDER BY COALESCE(t.degree, 0) DESC, n.updated_at DESC
            LIMIT 40
          `,
          input.orgId,
          input.userId
        )
      : Promise.resolve([])
  ]);

  const prompt = task?.prompt ?? input.prompt;
  const taskSection = buildTaskRequestSection({
    taskPrompt: prompt,
    flowPrompt: flow?.prompt,
    status: task?.status
  });
  const directionSection = direction
    ? buildDirectionSection({
        id: direction.id,
        title: direction.title,
        summary: direction.summary,
        direction: direction.direction,
        status: direction.status,
        tags: direction.tags
      })
    : "";

  const requiredToolkits = [...new Set(input.requiredToolkits.map((item) => item.trim()).filter(Boolean))];
  const toolSignalEntries = memoryEntries.filter((entry) =>
    /tool|gmail|meeting|calendar|composio|invite|email/i.test(entry.key)
  );
  const nonToolMemoryEntries = memoryEntries.filter(
    (entry) => !toolSignalEntries.some((toolEntry) => toolEntry.id === entry.id)
  );
  const graphHighlights: GraphHighlightCandidate[] = graphNodeRows
    .map((node) => {
      const combined = `${node.label} ${stringifyPreview(node.propertiesJsonb, 180)}`;
      const relevance = scoreRelevance(prompt, combined);
      return {
        id: node.id,
        label: node.label,
        degree: node.degree,
        score: Number(Math.max(0.08, relevance + Math.min(0.2, node.degree * 0.01)).toFixed(4))
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 12);

  const priorRunSignals = compact(
    JSON.stringify(
      priorRuns.map((run) => ({
        id: run.id,
        status: run.status,
        decisionType: run.decisionType,
        decisionReason: compactHistoryReason(run.decisionReason),
        startedAt: run.startedAt,
        completedAt: run.completedAt
      })),
      null,
      2
    )
  );

  const candidates: ContextCandidate[] = [];
  if (taskSection) {
    candidates.push({
      id: `task:${input.taskId}:request`,
      name: "Task Request",
      priority: 1,
      relevance: 1,
      amnesiaProtected: false,
      content: taskSection
    });
  }

  const entitySection = compact(
    [
      requiredToolkits.length > 0
        ? `Required toolkits: ${requiredToolkits.join(", ")}`
        : "",
      flow
        ? `Mission status: ${flow.status}; progress=${flow.progress}; flow=${flow.id}`
        : "",
      task?.requiredFiles.length
        ? `Required file ids: ${task.requiredFiles.slice(0, 8).join(", ")}`
        : "",
      directionSection ? `Direction summary: ${directionSection}` : ""
    ]
      .filter(Boolean)
      .join(" | ")
  );
  if (entitySection) {
    candidates.push({
      id: `entities:${input.taskId}`,
      name: "Task Entities",
      priority: 2,
      relevance: Math.max(0.45, scoreRelevance(prompt, entitySection)),
      amnesiaProtected: false,
      content: entitySection
    });
  }

  if (toolSignalEntries.length > 0) {
    const toolSignals = buildMemorySection(
      toolSignalEntries.map((entry) => ({
        id: entry.id,
        key: entry.key,
        tier: entry.tier,
        value: entry.value,
        score: entry.score
      })),
      3
    );
    candidates.push({
      id: `memory:${input.taskId}:tool-signals`,
      name: "Essential Tool Signals",
      priority: 3,
      relevance: Math.max(0.42, scoreRelevance(prompt, toolSignals)),
      amnesiaProtected: false,
      content: toolSignals
    });
  }

  if (priorRunSignals) {
    candidates.push({
      id: `runs:${input.flowId}`,
      name: "Recent Mission History",
      priority: 4,
      relevance: Math.max(0.28, scoreRelevance(prompt, priorRunSignals)),
      amnesiaProtected: false,
      content: priorRunSignals
    });
  }

  if (nonToolMemoryEntries.length > 0) {
    const relevantMemory = buildMemorySection(
      nonToolMemoryEntries.map((entry) => ({
        id: entry.id,
        key: entry.key,
        tier: entry.tier,
        value: entry.value,
        score: entry.score
      })),
      input.mode === "TURBO" ? 4 : 3
    );
    candidates.push({
      id: `memory:${input.taskId}:general`,
      name: "Relevant Memory",
      priority: 5,
      relevance: Math.max(0.2, scoreRelevance(prompt, relevantMemory)),
      amnesiaProtected: false,
      content: relevantMemory
    });
  }

  if (graphHighlights.length > 0) {
    const graphSection = buildGraphSection(graphHighlights.slice(0, input.mode === "TURBO" ? 8 : 5));
    candidates.push({
      id: `graph:${input.taskId}`,
      name: "Graph Nodes",
      priority: 5,
      relevance: Math.max(0.16, scoreRelevance(prompt, graphSection)),
      amnesiaProtected: false,
      content: graphSection
    });
  }

  if (org) {
    const orgSection = buildOrganizationSection({
      name: org.name,
      description: org.description ?? "",
      mode: input.mode,
      monthlyBudget: Number(org.monthlyBudget),
      currentSpend: Number(org.currentSpend)
    });
    candidates.push({
      id: `org:${org.id}`,
      name: "Organization Profile",
      priority: 6,
      relevance: scoreRelevance(prompt, `${org.name} ${org.description ?? ""}`),
      amnesiaProtected: false,
      content: orgSection
    });
  }

  if (companyData?.content) {
    const companyPreview = clampText(
      companyData.content,
      input.mode === "TURBO" ? 900 : 640
    );
    candidates.push({
      id: `hub:company-data:${companyData.file.id}`,
      name: "Company Data Excerpt",
      priority: 6,
      relevance: scoreRelevance(prompt, companyPreview),
      amnesiaProtected: false,
      content: companyPreview
    });
  }

  if (dnaProfiles.length > 0) {
    const profile = dnaProfiles[0];
    const profileSection = compact(
      [
        `Title: ${profile.title}`,
        profile.coreTraits.length > 0 ? `Traits: ${profile.coreTraits.slice(0, 8).join(", ")}` : "",
        profile.summary ? `Summary: ${clampText(compact(profile.summary), 480)}` : "",
        `Source assets: ${profile.sourceAssetIds.length}`
      ]
        .filter(Boolean)
        .join(" | ")
    );
    if (profileSection) {
      candidates.push({
        id: `dna:profile:${profile.id}`,
        name: "DNA Profile",
        priority: 6,
        relevance: Math.max(0.2, scoreRelevance(prompt, profileSection)),
        amnesiaProtected: false,
        content: profileSection
      });
    }
  }

  if (parentRun) {
    const parentSection = compact(
      JSON.stringify(
        {
          parentRunId: parentRun.id,
          decisionType: parentRun.decisionType,
          decisionReason: compactHistoryReason(parentRun.decisionReason)
        },
        null,
        2
      )
    );
    candidates.push({
      id: `inherit:${parentRun.id}`,
      name: "Parent Run Decision",
      priority: 6,
      relevance: Math.max(0.1, scoreRelevance(prompt, parentSection)),
      amnesiaProtected: false,
      content: parentSection
    });
  }

  for (const dna of dnaFiles) {
    const preview = clampText(dna.preview, dna.amnesiaProtected ? 220 : 480);
    candidates.push({
      id: `dna:${dna.id}`,
      name: `DNA ${dna.name}`,
      priority: 6,
      relevance: Math.max(dna.score, scoreRelevance(prompt, preview)),
      amnesiaProtected: dna.amnesiaProtected,
      content: preview
    });
  }

  const { blocks, trace } = selectContextBlocksByPriority({
    candidates,
    budgetTokens,
    sectionMaxTokens
  });

  const summary = compact(
    [
      org ? `${org.name} (${input.mode})` : "Organization context",
      direction ? `Direction: ${direction.title}` : "No linked direction",
      `Task: ${input.taskId}`,
      `Context budget: ${trace.usedTokens}/${trace.budgetTokens} tokens`,
      trace.omittedSections.length > 0
        ? `Omitted sections: ${trace.omittedSections.length}`
        : "No omitted context"
    ].join(" | ")
  );

  return {
    summary,
    blocks,
    selectionTrace: trace,
    memoryHighlights: memoryEntries.map((entry) => ({
      id: entry.id,
      key: entry.key,
      tier: entry.tier,
      score: entry.score,
      similarity: typeof entry.similarity === "number" ? entry.similarity : undefined,
      timeDecayScore: typeof entry.timeDecayScore === "number" ? entry.timeDecayScore : undefined,
      hybridScore: typeof entry.hybridScore === "number" ? entry.hybridScore : undefined,
      rerankScore: typeof entry.rerankScore === "number" ? entry.rerankScore : undefined
    })),
    graphHighlights,
    dnaHighlights: dnaFiles.map((dna) => ({
      id: dna.id,
      name: dna.name,
      score: dna.score,
      amnesiaProtected: dna.amnesiaProtected
    })),
    executionMode: input.mode,
    budgetSnapshot: input.budgetSnapshot
  };
}
