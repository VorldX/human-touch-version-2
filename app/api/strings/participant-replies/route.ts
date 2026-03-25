export const dynamic = "force-dynamic";

import { randomUUID } from "node:crypto";

import { LogType, PersonnelStatus, PersonnelType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import type { ChatAudience, ChatMention, ChatMessage } from "@/components/chat-ui/types";
import { executeSwarmAgent } from "@/lib/ai/swarm-runtime";
import { getOrgLlmRuntime } from "@/lib/ai/org-llm-settings";
import { prisma } from "@/lib/db/prisma";
import {
  ensureCompanyDataFile,
  readOrganizationCollaboration
} from "@/lib/hub/organization-hub";
import { requireOrgAccess } from "@/lib/security/org-access";

const MAX_MESSAGE_CHARS = 1400;
const MAX_HISTORY_ITEM_CHARS = 500;
const MAX_HISTORY_TOTAL_CHARS = 3200;
const MAX_AI_RECIPIENTS = 3;
const MAX_REPLY_OUTPUT_TOKENS = 240;

interface ParticipantHistoryItem {
  role: "user" | "assistant" | "system";
  content: string;
  authorName?: string;
  authorRole?: string;
  teamLabel?: string;
}

interface ParticipantTarget {
  id: string;
  name: string;
  role: string;
  brainConfig: unknown;
  fallbackBrainConfig: unknown;
  brainKeyEnc: string | null;
  brainKeyIv: string | null;
  brainKeyAuthTag: string | null;
  brainKeyKeyVer: number | null;
  fallbackBrainKeyEnc: string | null;
  fallbackBrainKeyIv: string | null;
  fallbackBrainKeyAuthTag: string | null;
  fallbackBrainKeyKeyVer: number | null;
  reason: string;
  teamName: string | null;
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function clampText(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}

function safeAudience(value: unknown): ChatAudience | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const kind =
    record.kind === "everyone" || record.kind === "team" || record.kind === "person"
      ? record.kind
      : "";
  if (!kind) {
    return null;
  }

  const id = cleanText(record.id) || null;
  const label = cleanText(record.label) || null;

  return {
    kind,
    ...(id ? { id } : {}),
    ...(label ? { label } : {})
  };
}

function safeMentions(value: unknown): ChatMention[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }
      const record = item as Record<string, unknown>;
      const id = cleanText(record.id);
      const label = cleanText(record.label);
      const handle = cleanText(record.handle);
      const kind = record.kind === "team" || record.kind === "person" ? record.kind : null;
      const collaboratorKind =
        record.collaboratorKind === "AI" || record.collaboratorKind === "HUMAN"
          ? record.collaboratorKind
          : undefined;

      if (!id || !label || !handle || !kind) {
        return null;
      }

      return {
        id,
        label,
        handle,
        kind,
        ...(collaboratorKind ? { collaboratorKind } : {})
      } satisfies ChatMention;
    })
    .filter((item): item is ChatMention => Boolean(item))
    .slice(0, 24);
}

function safeHistory(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as ParticipantHistoryItem[];
  }

  const history: ParticipantHistoryItem[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const role =
      record.role === "user" || record.role === "assistant" || record.role === "system"
        ? record.role
        : null;
    const content = clampText(cleanText(record.content), MAX_HISTORY_ITEM_CHARS);
    if (!role || !content) {
      continue;
    }
    history.push({
      role,
      content,
      ...(cleanText(record.authorName) ? { authorName: cleanText(record.authorName) } : {}),
      ...(cleanText(record.authorRole) ? { authorRole: cleanText(record.authorRole) } : {}),
      ...(cleanText(record.teamLabel) ? { teamLabel: cleanText(record.teamLabel) } : {})
    });
  }

  const sliced = history.slice(-8);

  let totalChars = sliced.reduce((sum, entry) => sum + entry.content.length, 0);
  while (sliced.length > 1 && totalChars > MAX_HISTORY_TOTAL_CHARS) {
    const dropped = sliced.shift();
    totalChars -= dropped?.content.length ?? 0;
  }

  return sliced;
}

function historySpeaker(item: ParticipantHistoryItem) {
  if (item.role === "user") {
    return "Owner";
  }
  if (item.authorName) {
    return item.authorName;
  }
  return item.role === "assistant" ? "AI collaborator" : "Organization";
}

function buildReasonText(reason: string, teamName?: string | null) {
  if (teamName) {
    return `${reason} via ${teamName}`;
  }
  return reason;
}

function buildParticipantSystemPrompt(input: { agentName: string; agentRole: string }) {
  return [
    `You are ${input.agentName} (${input.agentRole}), an AI teammate inside a shared organization group chat.`,
    "Reply only as this teammate, not as the whole organization.",
    "Be concise, collaborative, and specific to your role.",
    "Do not invent actions, tool results, approvals, or facts.",
    "If context is missing, say `Unknown based on current context`.",
    "Keep the answer short enough for a fast-moving group thread."
  ].join("\n");
}

function buildParticipantUserPrompt(input: {
  message: string;
  audience: ChatAudience | null;
  mentions: ChatMention[];
  history: ParticipantHistoryItem[];
  teamLabel: string;
  target: ParticipantTarget;
}) {
  const audienceLine =
    input.audience?.kind && input.audience.kind !== "everyone"
      ? `Conversation target: ${input.audience.label || input.audience.kind}`
      : "Conversation target: everyone in the string";
  const mentionLine =
    input.mentions.length > 0
      ? `Mentioned entities: ${input.mentions.map((item) => `@${item.handle} (${item.label})`).join(", ")}`
      : "Mentioned entities: none";
  const teamLine = input.teamLabel ? `Relevant team context: ${input.teamLabel}` : "Relevant team context: none";
  const historyLines =
    input.history.length > 0
      ? input.history.map((item) => `${historySpeaker(item)}: ${item.content}`).join("\n")
      : "No prior group history.";

  return [
    `Why you are replying: ${input.target.reason}.`,
    audienceLine,
    mentionLine,
    teamLine,
    "",
    "Recent group chat:",
    historyLines,
    "",
    `Latest owner message: ${input.message}`,
    "",
    "Respond to the group in 2-5 sentences. Speak as this teammate and focus on what you can contribute next."
  ].join("\n");
}

async function writeReplyMetricLog(input: {
  orgId: string;
  threadId: string;
  agentName: string;
  reason: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  latencyMs: number;
  provider?: string | null;
  model?: string | null;
}) {
  try {
    await prisma.log.create({
      data: {
        orgId: input.orgId,
        type: LogType.EXE,
        actor: "STRING_MENTION_REPLY",
        message: `thread=${input.threadId}; agent=${input.agentName}; reason=${input.reason}; latencyMs=${input.latencyMs}; promptTokens=${input.promptTokens ?? 0}; completionTokens=${input.completionTokens ?? 0}; totalTokens=${input.totalTokens ?? 0}; provider=${input.provider ?? "none"}; model=${input.model ?? "none"}`
      }
    });
  } catch {
    // Best-effort only.
  }
}

async function resolveParticipantTargets(input: {
  orgId: string;
  audience: ChatAudience | null;
  mentions: ChatMention[];
}) {
  const directPersonIds = new Set<string>();
  const teamIds = new Set<string>();
  const reasonById = new Map<string, string>();
  const teamNameByPersonnelId = new Map<string, string>();

  if (input.audience?.kind === "person" && input.audience.id) {
    directPersonIds.add(input.audience.id);
    reasonById.set(input.audience.id, "Directly targeted in the conversation");
  }
  if (input.audience?.kind === "team" && input.audience.id) {
    teamIds.add(input.audience.id);
  }

  for (const mention of input.mentions) {
    if (mention.kind === "person" && mention.id) {
      directPersonIds.add(mention.id);
      if (!reasonById.has(mention.id)) {
        reasonById.set(mention.id, `Directly mentioned as @${mention.handle}`);
      }
    }
    if (mention.kind === "team" && mention.id) {
      teamIds.add(mention.id);
    }
  }

  const company = await ensureCompanyDataFile(input.orgId);
  const collaboration = readOrganizationCollaboration(company.file.metadata);
  const teamById = new Map(collaboration.teams.map((team) => [team.id, team] as const));
  const aiIdsFromTeams = new Set<string>();

  for (const teamId of teamIds) {
    const team = teamById.get(teamId);
    if (!team) {
      continue;
    }
    const teamReason =
      input.audience?.kind === "team" && input.audience.id === teamId
        ? `Conversation targeted to team ${input.audience.label || team.name}`
        : `Mentioned through team @${team.name}`;
    for (const personnelId of team.personnelIds) {
      aiIdsFromTeams.add(personnelId);
      if (
        input.audience?.kind === "team" && input.audience.id === teamId
          ? true
          : !reasonById.has(personnelId)
      ) {
        reasonById.set(personnelId, teamReason);
      }
      if (
        input.audience?.kind === "team" && input.audience.id === teamId
          ? true
          : !teamNameByPersonnelId.has(personnelId)
      ) {
        teamNameByPersonnelId.set(personnelId, team.name);
      }
    }
  }

  const candidateIds = [...new Set([...directPersonIds, ...aiIdsFromTeams])].slice(
    0,
    MAX_AI_RECIPIENTS
  );
  if (candidateIds.length === 0) {
    return [] as ParticipantTarget[];
  }

  const personnel = await prisma.personnel.findMany({
    where: {
      orgId: input.orgId,
      id: {
        in: candidateIds
      },
      type: PersonnelType.AI,
      status: {
        not: PersonnelStatus.DISABLED
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
  });

  const targets: ParticipantTarget[] = [];
  for (const id of candidateIds) {
    const target = personnel.find((item) => item.id === id);
    if (!target) {
      continue;
    }
    targets.push({
      ...target,
      reason: buildReasonText(
        reasonById.get(id) || "Selected for the group conversation",
        teamNameByPersonnelId.get(id) ?? null
      ),
      teamName: teamNameByPersonnelId.get(id) ?? null
    });
  }

  return targets;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as
      | {
          orgId?: string;
          threadId?: string;
          message?: string;
          history?: unknown;
          audience?: unknown;
          mentions?: unknown;
          teamLabel?: string;
        }
      | null;

    const orgId = cleanText(body?.orgId);
    const threadId = clampText(cleanText(body?.threadId).replace(/[^a-zA-Z0-9:_-]/g, ""), 96);
    const message = clampText(cleanText(body?.message), MAX_MESSAGE_CHARS);
    const teamLabel = clampText(cleanText(body?.teamLabel), 120);
    const history = safeHistory(body?.history);
    const audience = safeAudience(body?.audience);
    const mentions = safeMentions(body?.mentions);

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

    const targets = await resolveParticipantTargets({
      orgId,
      audience,
      mentions
    });
    if (targets.length === 0) {
      return NextResponse.json({
        ok: true,
        replies: []
      });
    }

    const organizationRuntime = await getOrgLlmRuntime(orgId);
    const replies: ChatMessage[] = [];
    const failures: string[] = [];

    for (const target of targets) {
      const startedAt = Date.now();
      const promptTeamLabel =
        audience?.kind === "team"
          ? audience.label || teamLabel || target.teamName || ""
          : target.teamName || "";
      const execution = await executeSwarmAgent({
        taskId: `string-mention-${randomUUID().slice(0, 8)}`,
        flowId: "string-mention-reply",
        prompt: message,
        agent: {
          id: target.id,
          name: target.name,
          role: target.role,
          brainConfig: target.brainConfig ?? {},
          fallbackBrainConfig: target.fallbackBrainConfig ?? {},
          brainKeyEnc: target.brainKeyEnc,
          brainKeyIv: target.brainKeyIv,
          brainKeyAuthTag: target.brainKeyAuthTag,
          brainKeyKeyVer: target.brainKeyKeyVer,
          fallbackBrainKeyEnc: target.fallbackBrainKeyEnc,
          fallbackBrainKeyIv: target.fallbackBrainKeyIv,
          fallbackBrainKeyAuthTag: target.fallbackBrainKeyAuthTag,
          fallbackBrainKeyKeyVer: target.fallbackBrainKeyKeyVer
        },
        contextBlocks: [],
        organizationRuntime,
        systemPromptOverride: buildParticipantSystemPrompt({
          agentName: target.name,
          agentRole: target.role
        }),
        userPromptOverride: buildParticipantUserPrompt({
          message,
          audience,
          mentions,
          history,
          teamLabel: promptTeamLabel,
          target
        }),
        maxOutputTokens: MAX_REPLY_OUTPUT_TOKENS
      });

      if (!execution.ok || !execution.outputText?.trim()) {
        failures.push(target.name);
        continue;
      }

      const latencyMs = Math.max(0, Date.now() - startedAt);
      const replyTeamLabel =
        audience?.kind === "team"
          ? audience.label || teamLabel || target.teamName || null
          : target.teamName || null;
      const reply: ChatMessage = {
        id: `message-${randomUUID()}`,
        role: "assistant",
        content: execution.outputText.trim(),
        createdAt: new Date().toISOString(),
        authorId: target.id,
        authorName: target.name,
        authorRole: target.role,
        authorKind: "AI",
        ...(replyTeamLabel
          ? {
              teamLabel: replyTeamLabel
            }
          : {}),
        ...(audience ? { audience } : {}),
        ...(mentions.length > 0 ? { mentions } : {}),
        metrics: {
          latencyMs,
          ...(typeof execution.tokenUsage?.promptTokens === "number"
            ? { promptTokens: execution.tokenUsage.promptTokens }
            : {}),
          ...(typeof execution.tokenUsage?.completionTokens === "number"
            ? { completionTokens: execution.tokenUsage.completionTokens }
            : {}),
          ...(typeof execution.tokenUsage?.totalTokens === "number"
            ? { totalTokens: execution.tokenUsage.totalTokens }
            : {}),
          ...(execution.usedProvider ? { provider: execution.usedProvider } : {}),
          ...(execution.usedModel ? { model: execution.usedModel } : {}),
          ...(execution.apiSource ? { source: execution.apiSource } : {})
        }
      };

      replies.push(reply);
      await writeReplyMetricLog({
        orgId,
        threadId: threadId || "adhoc",
        agentName: target.name,
        reason: target.reason,
        promptTokens: execution.tokenUsage?.promptTokens,
        completionTokens: execution.tokenUsage?.completionTokens,
        totalTokens: execution.tokenUsage?.totalTokens,
        latencyMs,
        provider: execution.usedProvider,
        model: execution.usedModel
      });
    }

    return NextResponse.json({
      ok: true,
      replies,
      ...(replies.length === 0 && failures.length > 0
        ? { message: "No AI teammate could generate a reply right now." }
        : {})
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to generate AI teammate replies.";
    console.error("[api/strings/participant-replies][POST] unexpected error", error);
    return NextResponse.json(
      {
        ok: false,
        message
      },
      { status: 500 }
    );
  }
}
