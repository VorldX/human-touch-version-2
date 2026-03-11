import type { AgentMemoryTypeValue, AgentMemoryUpsertInput } from "./types.ts";

import { agentMemoryConfig } from "./config.ts";

const BORING_PATTERNS = [
  /^ok[.!]?$/i,
  /^done[.!]?$/i,
  /^thanks[.!]?$/i,
  /^noted[.!]?$/i,
  /^received[.!]?$/i
];

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function normalizeText(input: string) {
  return input.replace(/\s+/g, " ").trim();
}

function hasAnyPattern(input: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(input));
}

function memoryTypeBaseScore(memoryType: AgentMemoryTypeValue) {
  if (memoryType === "SEMANTIC") return 0.36;
  if (memoryType === "TASK") return 0.24;
  if (memoryType === "EPISODIC") return 0.2;
  return 0.12;
}

function sourceSignalScore(source: string) {
  const lower = source.toLowerCase();
  if (/final_output|agent_output|task_result/.test(lower)) return 0.34;
  if (/tool_result|tool_error|tool_execution/.test(lower)) return 0.28;
  if (/policy|approval|human_touch|checkpoint/.test(lower)) return 0.24;
  if (/session_summary|consolidation/.test(lower)) return 0.26;
  if (/decision|delegation/.test(lower)) return 0.2;
  return 0.1;
}

function tagSignalScore(tags: string[]) {
  const normalized = tags.map((tag) => tag.toLowerCase());
  let score = 0;
  if (normalized.some((tag) => /error|failed|blocked|halt/.test(tag))) score += 0.14;
  if (normalized.some((tag) => /preference|user_fact|profile|constraint/.test(tag))) score += 0.22;
  if (normalized.some((tag) => /tool|integration|result/.test(tag))) score += 0.1;
  if (normalized.some((tag) => /summary|outcome|decision/.test(tag))) score += 0.08;
  return score;
}

export interface MemoryPersistenceScore {
  score: number;
  persist: boolean;
  reasons: string[];
}

export function summarizeMemoryContent(content: string, maxChars = 240) {
  const normalized = normalizeText(content);
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`;
}

export function scoreMemoryCandidate(input: {
  content: string;
  summary?: string;
  memoryType: AgentMemoryTypeValue;
  source: string;
  tags?: string[];
  importanceHint?: number;
}) {
  const content = normalizeText(input.content);
  const summary = normalizeText(input.summary ?? "");
  const tags = (input.tags ?? []).map((tag) => tag.trim()).filter(Boolean);
  const reasons: string[] = [];

  if (!content) {
    return {
      score: 0,
      persist: false,
      reasons: ["empty_content"]
    } satisfies MemoryPersistenceScore;
  }

  let score = 0;

  const base = memoryTypeBaseScore(input.memoryType);
  score += base;
  reasons.push(`memory_type:${input.memoryType.toLowerCase()}`);

  const sourceScore = sourceSignalScore(input.source);
  score += sourceScore;
  reasons.push(`source:${input.source.toLowerCase()}`);

  const lengthScore = clamp(content.length / 900, 0, 0.2);
  score += lengthScore;
  if (content.length >= 80) {
    reasons.push("content_substantial");
  }

  if (summary) {
    score += 0.06;
    reasons.push("has_summary");
  }

  const tagScore = tagSignalScore(tags);
  score += tagScore;
  if (tagScore > 0) {
    reasons.push("tag_signal");
  }

  const importanceHint = clamp(input.importanceHint ?? 0.5, 0, 1);
  score += importanceHint * 0.3;

  if (hasAnyPattern(content, BORING_PATTERNS)) {
    score -= 0.45;
    reasons.push("low_information");
  }

  const normalized = clamp(Number(score.toFixed(4)), 0, 1);
  return {
    score: normalized,
    persist: normalized >= agentMemoryConfig.ingestion.persistThreshold,
    reasons
  } satisfies MemoryPersistenceScore;
}

export function extractSemanticFacts(text: string) {
  const content = normalizeText(text);
  if (!content) return [] as string[];

  const facts = new Set<string>();
  const patterns: Array<{ regex: RegExp; label: string }> = [
    { regex: /\bmy name is\s+([a-z][a-z\s'-]{1,60})/i, label: "name" },
    { regex: /\bi prefer\s+([^.!?]{3,120})/i, label: "preference" },
    { regex: /\btimezone\s+is\s+([^.!?]{2,80})/i, label: "timezone" },
    { regex: /\bworking hours\s+are\s+([^.!?]{2,120})/i, label: "working_hours" },
    { regex: /\balways\s+([^.!?]{3,140})/i, label: "constraint" },
    { regex: /\bnever\s+([^.!?]{3,140})/i, label: "constraint" }
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern.regex);
    if (!match || !match[1]) continue;
    const value = normalizeText(match[1]);
    if (!value) continue;
    facts.add(`${pattern.label}: ${value}`);
  }

  return [...facts].slice(0, 8);
}

export function toPersistableMemory(input: AgentMemoryUpsertInput) {
  const content = normalizeText(input.content);
  if (!content) return null;

  const maxChars = Math.max(200, agentMemoryConfig.ingestion.maxContentChars);
  const clippedContent =
    content.length > maxChars
      ? `${content.slice(0, Math.max(0, maxChars - 3))}...`
      : content;

  return {
    ...input,
    content: clippedContent,
    summary: normalizeText(input.summary ?? "") || summarizeMemoryContent(clippedContent)
  } satisfies AgentMemoryUpsertInput;
}
