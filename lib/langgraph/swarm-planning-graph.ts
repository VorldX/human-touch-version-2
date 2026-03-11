import "server-only";

import { randomUUID } from "node:crypto";

import { retrieveRelevantDnaFiles } from "@/lib/agent/orchestration/rag-retriever";
import { buildOrganizationMainAgentPrompt } from "@/lib/agent/prompts/organizationMain";
import { selectCompanyContext, type SelectedContextTrace } from "@/lib/ai/context-selector";
import {
  executeSwarmAgent,
  type AgentExecutionInput,
  type AgentExecutionResult
} from "@/lib/ai/swarm-runtime";
import { ensureCompanyDataFile } from "@/lib/hub/organization-hub";
import type { OrganizationGraphAdapters } from "@/lib/langgraph/adapters/contracts";

interface PlanningHistoryEntry {
  role: string;
  content: string;
}

export interface SwarmPlanningGraphInput {
  orgId: string;
  userId: string;
  orgName: string;
  direction: string;
  humanPlan: string;
  history: PlanningHistoryEntry[];
  personnelSummary: string;
  mainAgent: AgentExecutionInput["agent"];
  organizationRuntime?: AgentExecutionInput["organizationRuntime"];
  provider?: string;
  model?: string;
  maxSelectedContextChars: number;
  maxContextChunkChars: number;
  maxOutputTokens: number;
}

export interface SwarmPlanningGraphResult {
  ok: boolean;
  graphRunId: string;
  modelOutput?: string;
  contextSelection: SelectedContextTrace | null;
  model?: {
    provider: string | null;
    name: string | null;
    source: string | null;
  };
  tokenUsage: AgentExecutionResult["tokenUsage"] | null;
  billing: AgentExecutionResult["billing"] | null;
  warnings: string[];
  error?: string;
}

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function clampText(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}

function extractJsonObject(raw: string) {
  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = codeBlockMatch ? codeBlockMatch[1] : raw;
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    return null;
  }

  const jsonText = candidate.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(jsonText) as unknown;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function hasPlanShape(raw: string) {
  const parsed = extractJsonObject(raw);
  const record = asRecord(parsed);
  const primary = asRecord(record.primaryPlan);
  const fallback = asRecord(record.fallbackPlan);
  const primaryWorkflows = Array.isArray(primary.workflows) ? primary.workflows : [];
  const fallbackWorkflows = Array.isArray(fallback.workflows) ? fallback.workflows : [];
  const primaryDeliverables = Array.isArray(primary.deliverables) ? primary.deliverables : [];
  const fallbackDeliverables = Array.isArray(fallback.deliverables) ? fallback.deliverables : [];
  const primaryMilestones = Array.isArray(primary.milestones) ? primary.milestones : [];
  const fallbackMilestones = Array.isArray(fallback.milestones) ? fallback.milestones : [];
  const primaryObjective =
    typeof primary.objective === "string" ? primary.objective.trim() : "";
  const fallbackObjective =
    typeof fallback.objective === "string" ? fallback.objective.trim() : "";
  if (
    primaryWorkflows.length === 0 ||
    fallbackWorkflows.length === 0 ||
    primaryDeliverables.length === 0 ||
    fallbackDeliverables.length === 0 ||
    primaryMilestones.length === 0 ||
    fallbackMilestones.length === 0 ||
    !primaryObjective ||
    !fallbackObjective
  ) {
    return false;
  }

  const firstPrimary = asRecord(primaryWorkflows[0]);
  const firstFallback = asRecord(fallbackWorkflows[0]);
  const primaryTasks = Array.isArray(firstPrimary.tasks) ? firstPrimary.tasks : [];
  const fallbackTasks = Array.isArray(firstFallback.tasks) ? firstFallback.tasks : [];
  return primaryTasks.length > 0 && fallbackTasks.length > 0;
}

function looksGenericFallback(raw: string) {
  const parsed = extractJsonObject(raw);
  const record = asRecord(parsed);
  const primary = asRecord(record.primaryPlan);
  const workflows = Array.isArray(primary.workflows) ? primary.workflows : [];
  const firstWorkflow = workflows[0] && !Array.isArray(workflows[0]) ? asRecord(workflows[0]) : {};
  const tasks = Array.isArray(firstWorkflow.tasks) ? firstWorkflow.tasks : [];
  const firstTask = tasks[0] && !Array.isArray(tasks[0]) ? asRecord(tasks[0]) : {};
  const title = typeof firstTask.title === "string" ? firstTask.title.trim() : "";
  const tools = Array.isArray(firstTask.tools) ? firstTask.tools : [];
  const deliverables = Array.isArray(primary.deliverables) ? primary.deliverables : [];
  const directionGiven =
    typeof record.directionGiven === "string" ? record.directionGiven.trim() : "";
  return (
    title === "Translate direction into deliverable milestones" &&
    tools.length === 0 &&
    deliverables.length <= 1 &&
    directionGiven.toLowerCase().startsWith("the organization understands")
  );
}

function buildDnaContextSection(input: {
  dnaPreviews: Array<{
    id: string;
    name: string;
    preview: string;
    score: number;
  }>;
  maxChars: number;
}) {
  if (input.dnaPreviews.length === 0) {
    return "";
  }
  const section = input.dnaPreviews
    .slice(0, 3)
    .map(
      (item, index) =>
        `DNA ${index + 1}: ${item.name} (relevance=${item.score.toFixed(2)})\n${item.preview}`
    )
    .join("\n\n---\n\n");
  return clampText(section, input.maxChars);
}

function safeParseCompanyIdentity(companyDataText: string) {
  try {
    const parsed = JSON.parse(companyDataText) as Record<string, unknown>;
    const company = asRecord(parsed.company);
    const name = typeof company.name === "string" ? company.name.trim() : "";
    const description =
      typeof company.description === "string" ? company.description.trim() : "";
    return {
      name,
      description
    };
  } catch {
    return {
      name: "",
      description: ""
    };
  }
}

function composePlanningPrompt(input: {
  direction: string;
  humanPlan: string;
  history: PlanningHistoryEntry[];
  orgName: string;
  orgIdentityDescription: string;
  personnelSummary: string;
  companyContext: string;
  dnaContext: string;
  retryMode: boolean;
}) {
  const historyBlock =
    input.history.length > 0
      ? [
          "Recent conversation:",
          ...input.history.map(
            (item) => `${item.role === "owner" ? "Owner" : "Organization"}: ${item.content}`
          )
        ].join("\n")
      : "Recent conversation: none";

  const retryGuard = input.retryMode
    ? [
        "Previous planning output did not meet quality gates.",
        "Do not return placeholder/general text.",
        "You must align plan steps to organization identity and operating context.",
        "You must provide concrete, non-generic workflows and tasks."
      ].join("\n")
    : "First-pass planning run.";

  return [
    `Direction: ${input.direction}`,
    input.humanPlan ? `Human plan input: ${input.humanPlan}` : "Human plan input: none",
    historyBlock,
    `Organization: ${input.orgName}`,
    input.orgIdentityDescription
      ? `Organization identity summary: ${input.orgIdentityDescription}`
      : "Organization identity summary: unavailable",
    input.personnelSummary ? `Personnel roles: ${input.personnelSummary}` : "Personnel roles: unknown",
    input.companyContext
      ? `Company context excerpt:\n${input.companyContext}`
      : "Company context: unavailable",
    input.dnaContext ? `DNA knowledge excerpt:\n${input.dnaContext}` : "DNA context: unavailable",
    "",
    "Planning quality gates (mandatory):",
    "- Align with organization identity, mission, and constraints from context.",
    "- Primary plan must contain >= 3 workflows and each workflow must contain >= 2 tasks.",
    "- Fallback plan must contain >= 2 workflows and each workflow must contain >= 2 tasks.",
    "- Include objective, organizationFitSummary, deliverables, milestones, resourcePlan, approvalCheckpoints, and dependencies.",
    "- Task owners must map to realistic workforce roles.",
    "- Include required tools, approvals, risks, and success metrics.",
    "- Workflows must map deliverables and explicit tool usage where relevant.",
    "- Do not output generic placeholder tasks.",
    "",
    retryGuard,
    "",
    "Return STRICT JSON only (no markdown) with keys:",
    "analysis, directionGiven, primaryPlan, fallbackPlan, permissions.",
    "",
    "Shape requirements:",
    "- primaryPlan/fallbackPlan => {objective, organizationFitSummary, summary, deliverables, milestones, resourcePlan, approvalCheckpoints, dependencies, workflows, risks, successMetrics}",
    "- milestones => [{title, ownerRole, dueWindow, deliverable, successSignal}]",
    "- resourcePlan => [{workforceType, role, responsibility, capacityPct, tools}]",
    "- approvalCheckpoints => [{name, trigger, requiredRole, reason}]",
    "- dependencies => [{fromWorkflow, toWorkflow, reason}]",
    "- workflows => [{title, goal, ownerRole, ownerType, dependencies, deliverables, tools, entryCriteria, exitCriteria, successMetrics, estimatedHours, tasks}]",
    "- tasks => [{title, description, ownerRole, dependsOn, subtasks, tools, expectedOutput, estimatedMinutes, requiresApproval, approvalRole, approvalReason}]",
    "- permissions => [{area, requestedFromRole, reason, workflowTitle, taskTitle}]"
  ].join("\n");
}

function buildContextBlocks(input: { companyContext: string; dnaContext: string }) {
  const blocks: AgentExecutionInput["contextBlocks"] = [];
  if (input.companyContext.trim()) {
    blocks.push({
      id: "company-data",
      name: "Company Data",
      content: input.companyContext,
      amnesiaProtected: false
    });
  }
  if (input.dnaContext.trim()) {
    blocks.push({
      id: "dna-context",
      name: "DNA Context",
      content: input.dnaContext,
      amnesiaProtected: false
    });
  }
  return blocks;
}

function resolveRetryTokens(value: number) {
  const proposed = Math.floor(value * 1.55);
  return Math.max(value + 180, Math.min(1400, proposed));
}

export class SwarmPlanningGraph {
  private readonly adapters: Pick<OrganizationGraphAdapters, "logGraphEvent">;

  constructor(input: { adapters: Pick<OrganizationGraphAdapters, "logGraphEvent"> }) {
    this.adapters = input.adapters;
  }

  private async stage<T>(input: {
    orgId: string;
    graphRunId: string;
    traceId: string;
    stage: string;
    run: () => Promise<T>;
  }) {
    const started = Date.now();
    const result = await input.run();
    const latencyMs = Date.now() - started;
    await this.adapters
      .logGraphEvent({
        orgId: input.orgId,
        graphRunId: input.graphRunId,
        traceId: input.traceId,
        stage: input.stage,
        latencyMs,
        message: `Planning stage ${input.stage} completed.`,
        metadata: {}
      })
      .catch(() => undefined);
    return result;
  }

  async run(input: SwarmPlanningGraphInput): Promise<SwarmPlanningGraphResult> {
    const graphRunId = `lg-plan-${randomUUID().slice(0, 10)}`;
    const traceId = `lg-plan-trace-${randomUUID().slice(0, 10)}`;
    const warnings: string[] = [];

    try {
      const primaryText = [input.direction, input.humanPlan, ...input.history.map((item) => item.content)].join(
        "\n"
      );

      const companyData = await this.stage({
        orgId: input.orgId,
        graphRunId,
        traceId,
        stage: "load_org_context",
        run: async () => ensureCompanyDataFile(input.orgId)
      });

      const selected = await this.stage({
        orgId: input.orgId,
        graphRunId,
        traceId,
        stage: "select_company_context",
        run: async () =>
          selectCompanyContext({
            mode: "direction-plan",
            companyDataText: companyData.content,
            primaryText,
            history: input.history,
            maxSelectedChars: input.maxSelectedContextChars,
            maxChunkChars: input.maxContextChunkChars
          })
      });

      let companyContext = selected.contextText;
      const contextSelection = selected.trace;
      if (!companyContext) {
        companyContext = companyData.content.slice(0, input.maxSelectedContextChars);
      }

      const dnaPreviews = await this.stage({
        orgId: input.orgId,
        graphRunId,
        traceId,
        stage: "retrieve_dna_context",
        run: async () =>
          retrieveRelevantDnaFiles({
            orgId: input.orgId,
            prompt: primaryText,
            limit: 3
          }).catch(() => [])
      });

      const dnaContext = buildDnaContextSection({
        dnaPreviews,
        maxChars: 1400
      });

      const orgIdentity = safeParseCompanyIdentity(companyData.content);
      const orgIdentityDescription = compactText(
        [orgIdentity.name, orgIdentity.description].filter(Boolean).join(" | ")
      );

      const runPlanner = async (retryMode: boolean, maxOutputTokens: number) => {
        const userPrompt = composePlanningPrompt({
          direction: input.direction,
          humanPlan: input.humanPlan,
          history: input.history,
          orgName: input.orgName,
          orgIdentityDescription,
          personnelSummary: input.personnelSummary,
          companyContext,
          dnaContext,
          retryMode
        });

        return executeSwarmAgent({
          taskId: `direction-plan-${randomUUID().slice(0, 8)}`,
          flowId: "direction-plan",
          prompt: input.direction,
          agent: input.mainAgent,
          contextBlocks: buildContextBlocks({
            companyContext,
            dnaContext
          }),
          organizationRuntime: input.organizationRuntime,
          ...(input.provider || input.model
            ? {
                modelPreference: {
                  ...(input.provider ? { provider: input.provider } : {}),
                  ...(input.model ? { model: input.model } : {})
                }
              }
            : {}),
          systemPromptOverride: [
            buildOrganizationMainAgentPrompt({
              orgName: input.orgName,
              mode: "planning",
              contextAvailable: Boolean(companyContext || dnaContext)
            }),
            "",
            "You are running inside LangGraph planning orchestration stage.",
            "The output must align with organizational context and planning quality gates."
          ].join("\n"),
          userPromptOverride: userPrompt,
          maxOutputTokens
        });
      };

      const firstExecution = await this.stage({
        orgId: input.orgId,
        graphRunId,
        traceId,
        stage: "run_main_agent_planner",
        run: async () => runPlanner(false, input.maxOutputTokens)
      });

      if (!firstExecution.ok || !firstExecution.outputText) {
        return {
          ok: false,
          graphRunId,
          contextSelection,
          model: {
            provider: firstExecution.usedProvider ?? null,
            name: firstExecution.usedModel ?? null,
            source: firstExecution.apiSource ?? null
          },
          tokenUsage: firstExecution.tokenUsage ?? null,
          billing: firstExecution.billing ?? null,
          warnings,
          error: firstExecution.error ?? "LangGraph planning stage failed."
        };
      }

      const firstNeedsRetry =
        !hasPlanShape(firstExecution.outputText) || looksGenericFallback(firstExecution.outputText);
      if (!firstNeedsRetry) {
        return {
          ok: true,
          graphRunId,
          modelOutput: firstExecution.outputText,
          contextSelection,
          model: {
            provider: firstExecution.usedProvider ?? null,
            name: firstExecution.usedModel ?? null,
            source: firstExecution.apiSource ?? null
          },
          tokenUsage: firstExecution.tokenUsage ?? null,
          billing: firstExecution.billing ?? null,
          warnings
        };
      }

      warnings.push("First planning pass did not meet quality gates. Retrying with stricter constraints.");

      const retryExecution = await this.stage({
        orgId: input.orgId,
        graphRunId,
        traceId,
        stage: "retry_main_agent_planner",
        run: async () => runPlanner(true, resolveRetryTokens(input.maxOutputTokens))
      });

      if (!retryExecution.ok || !retryExecution.outputText) {
        warnings.push(
          "Planner retry failed. Falling back to first-pass planner output and deterministic plan normalization."
        );
        return {
          ok: true,
          graphRunId,
          modelOutput: firstExecution.outputText,
          contextSelection,
          model: {
            provider: firstExecution.usedProvider ?? retryExecution.usedProvider ?? null,
            name: firstExecution.usedModel ?? retryExecution.usedModel ?? null,
            source: firstExecution.apiSource ?? retryExecution.apiSource ?? null
          },
          tokenUsage: firstExecution.tokenUsage ?? retryExecution.tokenUsage ?? null,
          billing: firstExecution.billing ?? retryExecution.billing ?? null,
          warnings
        };
      }

      if (!hasPlanShape(retryExecution.outputText) || looksGenericFallback(retryExecution.outputText)) {
        warnings.push(
          "Planner output still failed strict quality gates after retry. Continuing with deterministic plan normalization fallback."
        );
        return {
          ok: true,
          graphRunId,
          modelOutput: retryExecution.outputText,
          contextSelection,
          model: {
            provider: retryExecution.usedProvider ?? null,
            name: retryExecution.usedModel ?? null,
            source: retryExecution.apiSource ?? null
          },
          tokenUsage: retryExecution.tokenUsage ?? null,
          billing: retryExecution.billing ?? null,
          warnings
        };
      }

      return {
        ok: true,
        graphRunId,
        modelOutput: retryExecution.outputText,
        contextSelection,
        model: {
          provider: retryExecution.usedProvider ?? null,
          name: retryExecution.usedModel ?? null,
          source: retryExecution.apiSource ?? null
        },
        tokenUsage: retryExecution.tokenUsage ?? null,
        billing: retryExecution.billing ?? null,
        warnings
      };
    } catch (error) {
      return {
        ok: false,
        graphRunId,
        contextSelection: null,
        model: {
          provider: null,
          name: null,
          source: null
        },
        tokenUsage: null,
        billing: null,
        warnings,
        error: error instanceof Error ? error.message : "Unexpected LangGraph planning failure."
      };
    }
  }
}
