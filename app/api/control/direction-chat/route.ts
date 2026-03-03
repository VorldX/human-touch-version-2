import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { executeSwarmAgent } from "@/lib/ai/swarm-runtime";
import { getOrgLlmRuntime } from "@/lib/ai/org-llm-settings";
import { prisma } from "@/lib/db/prisma";
import { ensureCompanyDataFile } from "@/lib/hub/organization-hub";

interface DirectionMessageInput {
  role: "owner" | "organization";
  content: string;
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function safeHistory(value: unknown): DirectionMessageInput[] {
  if (!Array.isArray(value)) return [];
  const history: DirectionMessageInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const role = raw.role === "owner" || raw.role === "organization" ? raw.role : null;
    const content = cleanText(raw.content);
    if (!role || !content) continue;
    history.push({ role, content });
  }
  return history.slice(-12);
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

export async function POST(request: NextRequest) {
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
  const message = cleanText(body?.message);
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
  try {
    const companyData = await ensureCompanyDataFile(orgId);
    companyContext = companyData.content.slice(0, 8000);
  } catch {
    companyContext = "";
  }

  const userPrompt = [
    "Owner-to-organization conversation transcript:",
    ...history.map((entry) => `${entry.role === "owner" ? "Owner" : "Organization"}: ${entry.content}`),
    `Owner: ${message}`,
    "",
    "Respond as the Main Agent representing the organization.",
    "Give a concise answer and end with a concrete section titled 'Direction:' that can be executed by agents."
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
      "Always end with a 'Direction:' section."
    ].join("\n"),
    userPromptOverride: userPrompt
  });

  if (!execution.ok || !execution.outputText) {
    return NextResponse.json(
      {
        ok: false,
        message: execution.error ?? "Direction chat failed."
      },
      { status: 502 }
    );
  }

  const directionCandidate = extractDirectionCandidate(execution.outputText);
  return NextResponse.json({
    ok: true,
    reply: execution.outputText,
    directionCandidate,
    model: {
      provider: execution.usedProvider ?? null,
      name: execution.usedModel ?? null,
      source: execution.apiSource ?? null
    },
    tokenUsage: execution.tokenUsage ?? null,
    billing: execution.billing ?? null
  });
}
