import "server-only";

import { selectCompanyContext, type SelectedContextTrace } from "@/lib/ai/context-selector";
import { retrieveRelevantDnaFiles } from "@/lib/agent/orchestration/rag-retriever";
import { listDnaProfiles } from "@/lib/dna/profiles";
import { ensureCompanyDataFile } from "@/lib/hub/organization-hub";

type ContextMode = "direction-chat" | "direction-plan";

interface ContextHistoryEntry {
  role: string;
  content: string;
}

export interface OrganizationContextBlock {
  id: string;
  name: string;
  content: string;
  amnesiaProtected: boolean;
}

export interface OrganizationContextPack {
  companyDataText: string;
  companyContext: string;
  dnaProfileContext: string;
  dnaFileContext: string;
  dnaContext: string;
  contextSelection: SelectedContextTrace | null;
  contextBlocks: OrganizationContextBlock[];
  orgIdentityDescription: string;
}

interface BuildOrganizationContextPackInput {
  orgId: string;
  mode: ContextMode;
  primaryText: string;
  history: ContextHistoryEntry[];
  maxSelectedContextChars: number;
  maxContextChunkChars: number;
  dnaFileLimit?: number;
  dnaProfileMaxChars?: number;
  dnaFileMaxChars?: number;
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

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
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

function buildDnaProfileContext(input: {
  profile: {
    title: string;
    summary: string;
    coreTraits: string[];
    sourceAssetIds: string[];
  } | null;
  maxChars: number;
}) {
  if (!input.profile) {
    return "";
  }

  const traits =
    input.profile.coreTraits.length > 0
      ? input.profile.coreTraits.slice(0, 8).join(", ")
      : "none";
  const section = [
    `DNA profile: ${input.profile.title}`,
    `Core traits: ${traits}`,
    `Summary: ${input.profile.summary}`,
    `Source assets: ${input.profile.sourceAssetIds.length}`
  ].join("\n");
  return clampText(section, input.maxChars);
}

function buildDnaFileContext(input: {
  previews: Array<{
    id: string;
    name: string;
    preview: string;
    score: number;
  }>;
  maxChars: number;
}) {
  if (input.previews.length === 0) {
    return "";
  }
  const section = input.previews
    .slice(0, 3)
    .map(
      (item, index) =>
        `DNA ${index + 1}: ${item.name} (relevance=${item.score.toFixed(2)})\n${item.preview}`
    )
    .join("\n\n---\n\n");
  return clampText(section, input.maxChars);
}

export async function buildOrganizationContextPack(
  input: BuildOrganizationContextPackInput
): Promise<OrganizationContextPack> {
  const companyData = await ensureCompanyDataFile(input.orgId);
  const selected = selectCompanyContext({
    mode: input.mode,
    companyDataText: companyData.content,
    primaryText: input.primaryText,
    history: input.history,
    maxSelectedChars: input.maxSelectedContextChars,
    maxChunkChars: input.maxContextChunkChars
  });

  let companyContext = selected.contextText;
  if (!companyContext) {
    companyContext = companyData.content.slice(0, input.maxSelectedContextChars);
  }

  const [profiles, dnaPreviews] = await Promise.all([
    listDnaProfiles(input.orgId, "ORGANIZATION").catch(() => []),
    retrieveRelevantDnaFiles({
      orgId: input.orgId,
      prompt: input.primaryText,
      limit: Math.max(1, input.dnaFileLimit ?? 3)
    }).catch(() => [])
  ]);

  const dnaProfileContext = buildDnaProfileContext({
    profile: profiles[0] ?? null,
    maxChars: Math.max(240, input.dnaProfileMaxChars ?? 560)
  });
  const dnaFileContext = buildDnaFileContext({
    previews: dnaPreviews,
    maxChars: Math.max(420, input.dnaFileMaxChars ?? 980)
  });
  const dnaContext = [dnaProfileContext, dnaFileContext].filter(Boolean).join("\n\n");

  const contextBlocks: OrganizationContextBlock[] = [];
  if (companyContext.trim()) {
    contextBlocks.push({
      id: "company-data",
      name: "Company Data",
      content: companyContext,
      amnesiaProtected: false
    });
  }
  if (dnaProfileContext.trim()) {
    contextBlocks.push({
      id: "dna-profile",
      name: "DNA Profile",
      content: dnaProfileContext,
      amnesiaProtected: false
    });
  }
  if (dnaFileContext.trim()) {
    contextBlocks.push({
      id: "dna-files",
      name: "DNA Context",
      content: dnaFileContext,
      amnesiaProtected: false
    });
  }

  const orgIdentity = safeParseCompanyIdentity(companyData.content);
  const orgIdentityDescription = compactText(
    [orgIdentity.name, orgIdentity.description].filter(Boolean).join(" | ")
  );

  return {
    companyDataText: companyData.content,
    companyContext,
    dnaProfileContext,
    dnaFileContext,
    dnaContext,
    contextSelection: selected.trace,
    contextBlocks,
    orgIdentityDescription
  };
}
