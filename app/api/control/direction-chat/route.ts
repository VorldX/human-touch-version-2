export const dynamic = "force-dynamic";

import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { selectCompanyContext } from "@/lib/ai/context-selector";
import { executeSwarmAgent } from "@/lib/ai/swarm-runtime";
import { getOrgLlmRuntime } from "@/lib/ai/org-llm-settings";
import { prisma } from "@/lib/db/prisma";
import { ensureCompanyDataFile } from "@/lib/hub/organization-hub";
import { requireOrgAccess } from "@/lib/security/org-access";

interface DirectionMessageInput {
  role: "owner" | "organization";
  content: string;
}

type DirectionIntentRoute = "CHAT_RESPONSE" | "PLAN_REQUIRED";

interface DirectionIntentRouting {
  route: DirectionIntentRoute;
  reason: string;
  toolkitHints: string[];
  squadRoleHints: string[];
  cadenceHint?: "DAILY" | "WEEKLY" | "MONTHLY" | "CUSTOM";
}

const MAX_OWNER_MESSAGE_CHARS = 2000;
const MAX_HISTORY_ITEM_CHARS = 1200;
const MAX_HISTORY_TOTAL_CHARS = 7000;

function positiveEnvInt(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

const MAX_PROMPT_COMPANY_CONTEXT_CHARS = positiveEnvInt(
  "DIRECTION_CHAT_SELECTED_CONTEXT_MAX_CHARS",
  2200
);
const MAX_CONTEXT_SELECTOR_CHUNK_CHARS = positiveEnvInt(
  "DIRECTION_CONTEXT_SELECTOR_CHUNK_CHARS",
  700
);
const DIRECTION_CHAT_MAX_OUTPUT_TOKENS = positiveEnvInt(
  "DIRECTION_CHAT_MAX_OUTPUT_TOKENS",
  420
);

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function clampText(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}
function safeHistory(value: unknown): DirectionMessageInput[] {
  if (!Array.isArray(value)) return [];
  const history: DirectionMessageInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const role = raw.role === "owner" || raw.role === "organization" ? raw.role : null;
    const content = clampText(cleanText(raw.content), MAX_HISTORY_ITEM_CHARS);
    if (!role || !content) continue;
    history.push({ role, content });
  }

  const sliced = history.slice(-12);
  let totalChars = sliced.reduce((sum, entry) => sum + entry.content.length, 0);
  while (sliced.length > 1 && totalChars > MAX_HISTORY_TOTAL_CHARS) {
    const dropped = sliced.shift();
    totalChars -= dropped?.content.length ?? 0;
  }

  return sliced;
}

function extractDirectionCandidate(text: string) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const markers = ["Direction:", "DIRECTION:", "Direction Candidate:", "DIRECTION CANDIDATE:"];
  for (const marker of markers) {
    const idx = normalized.indexOf(marker);
    if (idx >= 0) {
      return normalized
        .slice(idx + marker.length)
        .trim()
        .split("\n")
        .slice(0, 8)
        .join("\n")
        .trim();
    }
  }
  return normalized
    .split("\n")
    .slice(0, 6)
    .join("\n")
    .trim();
}

function inferToolkitHints(text: string) {
  const lower = text.toLowerCase();
  const compact = lower.replace(/[^a-z0-9]/g, "");
  const requested = new Set<string>();

  const toolkitAliases: Record<string, string[]> = {
    gmail: ["gmail", "email", "inbox", "mailbox"],
    slack: ["slack", "channel", "workspace", "direct message", "dm"],
    notion: ["notion", "wiki", "knowledge base", "docs", "documentation"],
    github: ["github", "repository", "repo", "pull request", "commit", "issue"],
    googlemeet: ["googlemeet", "google meet", "gmeet", "meet.google.com"],
    googlecalendar: ["googlecalendar", "google calendar", "calendar", "schedule", "availability"],
    googledrive: ["googledrive", "google drive", "drive"],
    googledocs: ["googledocs", "google docs", "document"],
    googlesheets: ["googlesheets", "google sheets", "spreadsheet", "sheet"],
    outlook: ["outlook"],
    microsoftteams: ["microsoftteams", "microsoft teams", "teams"],
    jira: ["jira", "ticket", "backlog", "sprint"],
    trello: ["trello", "board", "card"],
    asana: ["asana"],
    monday: ["monday", "monday.com"],
    linear: ["linear"],
    shopify: ["shopify", "storefront"],
    stripe: ["stripe", "payment"],
    salesforce: ["salesforce", "crm", "opportunity", "pipeline"],
    hubspot: ["hubspot", "crm", "lead"],
    pipedrive: ["pipedrive"],
    quickbooks: ["quickbooks", "quick books", "accounting"],
    zendesk: ["zendesk", "support ticket"],
    whatsapp: ["whatsapp"],
    twitter: ["twitter", "x.com"],
    linkedin: ["linkedin"],
    youtube: ["youtube"],
    zoom: ["zoom", "video call", "video meeting", "webinar", "meeting link"],
    intercom: ["intercom"],
    typeform: ["typeform", "form", "survey"]
  };

  for (const [toolkit, aliases] of Object.entries(toolkitAliases)) {
    const matched = aliases.some((alias) => {
      const normalizedAlias = alias.trim().toLowerCase();
      if (!normalizedAlias) return false;
      const compactAlias = normalizedAlias.replace(/[^a-z0-9]/g, "");
      return lower.includes(normalizedAlias) || (compactAlias && compact.includes(compactAlias));
    });
    if (matched) {
      requested.add(toolkit);
    }
  }

  return [...requested];
}

function inferSquadRoleHints(message: string) {
  const lower = message.toLowerCase();
  const agentLikeIntent =
    /\b(ai|a\.i\.|agent|agents|agnt|agnets|age?nts?|agebnts?)\b/.test(lower) ||
    /\b(automation|automate|autonomous)\b/.test(lower);
  const looksLikeHumanHiringOnly =
    /\b(hire|recruit|interview|headcount)\b/.test(lower) && !agentLikeIntent;
  const wantsTeam =
    !looksLikeHumanHiringOnly &&
    /\b(create|build|form|assemble|set up|setup|make|start|launch)\b/.test(lower) &&
    /\b(team|squad)\b/.test(lower) &&
    agentLikeIntent;
  if (!wantsTeam) return [] as string[];

  if (/\b(marketing|campaign|growth|content|seo|social)\b/.test(lower)) {
    return [
      "Marketing Strategist Agent",
      "Content Strategy Agent",
      "Campaign Automation Agent",
      "Lead Research Agent"
    ];
  }
  if (/\b(sales|pipeline|prospect|outreach)\b/.test(lower)) {
    return [
      "Sales Operations Agent",
      "Prospecting Agent",
      "Outreach Copy Agent",
      "CRM Hygiene Agent"
    ];
  }
  if (/\b(support|customer success|helpdesk)\b/.test(lower)) {
    return [
      "Support Triage Agent",
      "Knowledge Base Agent",
      "Escalation Manager Agent"
    ];
  }

  return ["Manager Agent", "Execution Worker Agent"];
}

function inferRecurringCadence(ownerMessage: string) {
  const lower = ownerMessage.toLowerCase();
  const hasRecurringSignal =
    /\b(recurring|repeat|repeating|recur|cadence|cron)\b/.test(lower) ||
    /\b(daily|weekly|monthly|quarterly|yearly|annually)\b/.test(lower) ||
    /\b(every|each)\s+(day|week|month|quarter|year|weekday|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(
      lower
    );

  if (!hasRecurringSignal) {
    return null;
  }

  const hasActionIntent =
    /\b(schedule|create|send|email|mail|meeting|report|run|execute|trigger|sync|notify|remind|generate|post|update|check|monitor)\b/.test(
      lower
    );
  if (!hasActionIntent) {
    return null;
  }

  if (
    /\b(daily|every day|each day|weekday|weekend|every monday|every tuesday|every wednesday|every thursday|every friday|every saturday|every sunday)\b/.test(
      lower
    )
  ) {
    return "DAILY" as const;
  }
  if (/\b(weekly|every week|each week)\b/.test(lower)) {
    return "WEEKLY" as const;
  }
  if (/\b(monthly|every month|each month)\b/.test(lower)) {
    return "MONTHLY" as const;
  }

  return "CUSTOM" as const;
}

function inferIntentRouting(input: {
  ownerMessage: string;
  modelReply: string;
  directionCandidate: string;
}): DirectionIntentRouting {
  const ownerLower = input.ownerMessage.toLowerCase();
  const ownerTrimmed = ownerLower.trim();
  const recurringCadence = inferRecurringCadence(input.ownerMessage);

  const explicitActionIntent = /\b(create|build|launch|implement|execute|automate|orchestrate|run|set up|setup|deploy|delegate)\b/.test(
    ownerLower
  );
  const explicitPlanningIntent =
    /\b(workflow|plan|roadmap|steps|mission|task breakdown|decompose)\b/.test(ownerLower) ||
    /\b(team|squad)\b/.test(ownerLower);
  const explicitExecutionIntent = explicitActionIntent || explicitPlanningIntent;

  const directQuestionIntent = /^(what|why|how|when|where|who|which|can|could|is|are|do|does|tell me|explain|summarize|list)\b/.test(
    ownerTrimmed
  );
  const chatOnlyIntent =
    directQuestionIntent &&
    !explicitExecutionIntent &&
    !/\b(do this|perform this|execute this|run this|launch this|set this up)\b/.test(ownerLower);

  if (recurringCadence) {
    return {
      route: "PLAN_REQUIRED",
      reason:
        "Recurring execution intent detected. Route through Direction planning and approvals before workflow launch.",
      toolkitHints: inferToolkitHints(input.ownerMessage),
      squadRoleHints: inferSquadRoleHints(input.ownerMessage),
      cadenceHint: recurringCadence
    };
  }

  // Model output can contain planning terms by default, so owner message intent is primary.
  if (chatOnlyIntent) {
    return {
      route: "CHAT_RESPONSE",
      reason: "User asked an informational question that can be handled directly in chat.",
      toolkitHints: inferToolkitHints(input.ownerMessage),
      squadRoleHints: []
    };
  }

  if (!explicitExecutionIntent) {
    return {
      route: "CHAT_RESPONSE",
      reason: "No explicit execution/delegation intent detected, so response stays in chat.",
      toolkitHints: inferToolkitHints(input.ownerMessage),
      squadRoleHints: []
    };
  }

  return {
    route: "PLAN_REQUIRED",
    reason: "User intent indicates execution/planning work that should move through the plan workflow.",
    toolkitHints: inferToolkitHints(ownerLower),
    squadRoleHints: inferSquadRoleHints(input.ownerMessage)
  };
}

function statusFromExecutionError(message: string) {
  const match = message.match(/\b(?:OpenAI|Anthropic|Gemini)\s+(\d{3})\b/i);
  if (!match) {
    return 502;
  }

  const code = Number(match[1]);
  if (!Number.isInteger(code) || code < 400 || code > 599) {
    return 502;
  }
  return code;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as
      | {
          orgId?: string;
          message?: string;
          history?: unknown;
          provider?: string;
          model?: string;
        }
      | null;

    const orgId = cleanText(body?.orgId);
    const message = clampText(cleanText(body?.message), MAX_OWNER_MESSAGE_CHARS);
    const provider = cleanText(body?.provider);
    const model = cleanText(body?.model);
    const history = safeHistory(body?.history);

    if (!orgId || !message) {
      return NextResponse.json(
        {
          ok: false,
          message: "orgId and message are required."
        },
        { status: 400 }
      );
    }

    const access = await requireOrgAccess({ request, orgId });
    if (!access.ok) {
      return access.response;
    }

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true }
    });

    if (!org) {
      return NextResponse.json(
        {
          ok: false,
          message: "Organization not found."
        },
        { status: 404 }
      );
    }

    const mainAgent =
      (await prisma.personnel.findFirst({
        where: {
          orgId,
          type: "AI",
          role: {
            contains: "Main",
            mode: "insensitive"
          }
        },
        select: {
          id: true,
          name: true,
          role: true,
          brainConfig: true,
          fallbackBrainConfig: true,
          brainKeyEnc: true,
          brainKeyIv: true,
          brainKeyAuthTag: true,
          brainKeyKeyVer: true,
          fallbackBrainKeyEnc: true,
          fallbackBrainKeyIv: true,
          fallbackBrainKeyAuthTag: true,
          fallbackBrainKeyKeyVer: true
        }
      })) ??
      (await prisma.personnel.findFirst({
        where: {
          orgId,
          type: "AI",
          role: {
            contains: "Boss",
            mode: "insensitive"
          }
        },
        select: {
          id: true,
          name: true,
          role: true,
          brainConfig: true,
          fallbackBrainConfig: true,
          brainKeyEnc: true,
          brainKeyIv: true,
          brainKeyAuthTag: true,
          brainKeyKeyVer: true,
          fallbackBrainKeyEnc: true,
          fallbackBrainKeyIv: true,
          fallbackBrainKeyAuthTag: true,
          fallbackBrainKeyKeyVer: true
        }
      }));

    let companyContext = "";
    let contextSelection: ReturnType<typeof selectCompanyContext>["trace"] | null = null;
    try {
      const companyData = await ensureCompanyDataFile(orgId);
      const selected = selectCompanyContext({
        mode: "direction-chat",
        companyDataText: companyData.content,
        primaryText: [message, ...history.map((entry) => entry.content)].join("\n"),
        history,
        maxSelectedChars: MAX_PROMPT_COMPANY_CONTEXT_CHARS,
        maxChunkChars: MAX_CONTEXT_SELECTOR_CHUNK_CHARS
      });
      companyContext = selected.contextText;
      contextSelection = selected.trace;
      if (!companyContext) {
        companyContext = companyData.content.slice(0, MAX_PROMPT_COMPANY_CONTEXT_CHARS);
      }
    } catch {
      companyContext = "";
      contextSelection = null;
    }

    const preIntentRouting = inferIntentRouting({
      ownerMessage: message,
      modelReply: "",
      directionCandidate: ""
    });

    const userPrompt = [
      "Owner-to-organization conversation transcript:",
      ...history.map((entry) => `${entry.role === "owner" ? "Owner" : "Organization"}: ${entry.content}`),
      `Owner: ${message}`,
      "",
      companyContext
        ? ["Company Data Context (selector-brain curated, authoritative excerpt):", companyContext].join("\n")
        : "Company Data Context: unavailable.",
      "",
      "Respond as the Main Agent representing the organization.",
      preIntentRouting.route === "PLAN_REQUIRED"
        ? "Give a concise answer and end with a concrete section titled 'Direction:' that can be executed by agents."
        : "Give a concise direct chat answer. Do not append a synthetic 'Direction:' section unless the user explicitly asks for planning/execution."
    ].join("\n");

    const organizationRuntime = await getOrgLlmRuntime(orgId);
    const execution = await executeSwarmAgent({
      taskId: `direction-chat-${randomUUID().slice(0, 8)}`,
      flowId: "direction-chat",
      prompt: message,
      agent:
        mainAgent ?? {
          id: "main-agent-proxy",
          name: "Main Agent",
          role: "Organization Interface",
          brainConfig: {},
          fallbackBrainConfig: {},
          brainKeyEnc: null,
          brainKeyIv: null,
          brainKeyAuthTag: null,
          brainKeyKeyVer: null,
          fallbackBrainKeyEnc: null,
          fallbackBrainKeyIv: null,
          fallbackBrainKeyAuthTag: null,
          fallbackBrainKeyKeyVer: null
        },
      contextBlocks: companyContext
        ? [
            {
              id: "company-data",
              name: "Company Data",
              content: companyContext,
              amnesiaProtected: false
            }
          ]
        : [],
      organizationRuntime,
      ...(provider || model
        ? {
            modelPreference: {
              ...(provider ? { provider } : {}),
              ...(model ? { model } : {})
            }
          }
        : {}),
      systemPromptOverride: [
        `You are the Main Agent for organization ${org.name}.`,
        "You represent the company as a coherent operating intelligence.",
        "Speak clearly, avoid hype, and produce execution-ready guidance.",
        "Do not fabricate facts, metrics, IDs, links, or completion claims.",
        "Ground responses only in conversation + provided company context.",
        companyContext
          ? "Company Data Context is selector-curated and provided in the user prompt; use it as authoritative scope."
          : "If Company Data Context is unavailable, ask for missing details instead of guessing.",
        "If information is missing, explicitly say what is unknown and ask for clarification.",
        preIntentRouting.route === "PLAN_REQUIRED"
          ? "End with a 'Direction:' section."
          : "Keep this as a normal conversational response unless planning/execution intent is explicit."
      ].join("\n"),
      userPromptOverride: userPrompt,
      maxOutputTokens: DIRECTION_CHAT_MAX_OUTPUT_TOKENS
    });

    if (!execution.ok || !execution.outputText) {
      const message = execution.error ?? "Direction chat failed.";
      return NextResponse.json(
        {
          ok: false,
          message
        },
        { status: statusFromExecutionError(message) }
      );
    }

    const directionCandidate = extractDirectionCandidate(execution.outputText);
    const intentRouting = inferIntentRouting({
      ownerMessage: message,
      modelReply: execution.outputText,
      directionCandidate
    });
    return NextResponse.json({
      ok: true,
      reply: execution.outputText,
      directionCandidate,
      intentRouting,
      model: {
        provider: execution.usedProvider ?? null,
        name: execution.usedModel ?? null,
        source: execution.apiSource ?? null
      },
      tokenUsage: execution.tokenUsage ?? null,
      billing: execution.billing ?? null,
      contextSelection
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Direction chat failed.";
    console.error("[api/control/direction-chat] unexpected error", error);
    return NextResponse.json(
      {
        ok: false,
        message
      },
      { status: 500 }
    );
  }
}
