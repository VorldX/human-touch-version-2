import type { AgentMemorySearchResult } from "./types";

const APPROX_CHARS_PER_TOKEN = 4;

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenize(value: string) {
  return normalize(value)
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function jaccardSimilarity(left: string, right: string) {
  const leftSet = new Set(tokenize(left));
  const rightSet = new Set(tokenize(right));
  if (leftSet.size === 0 || rightSet.size === 0) return 0;

  let intersect = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) intersect += 1;
  }
  const union = leftSet.size + rightSet.size - intersect;
  if (union <= 0) return 0;
  return intersect / union;
}

export function calculateRecencyScore(input: {
  timestamp: Date;
  recency: number;
  halfLifeHours: number;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const ageMs = Math.max(0, nowMs - input.timestamp.getTime());
  const ageHours = ageMs / (1000 * 60 * 60);
  const halfLifeHours = Math.max(1, input.halfLifeHours);
  const decay = Math.pow(0.5, ageHours / halfLifeHours);
  const recencyWeight = clamp(input.recency, 0, 2) / 1;
  return clamp(decay * Math.min(1.2, recencyWeight), 0, 1);
}

export function calculateExponentialTimeDecay(input: {
  timestamp: Date;
  lambdaPerHour: number;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const ageMs = Math.max(0, nowMs - input.timestamp.getTime());
  const ageHours = ageMs / (1000 * 60 * 60);
  const lambda = Math.max(0.0001, input.lambdaPerHour);
  return clamp(Math.exp(-lambda * ageHours), 0, 1);
}

export function calculateTimeWeightedHybridScore(input: {
  semanticSimilarity: number;
  timeDecayScore: number;
  alpha: number;
  beta: number;
}) {
  const alpha = clamp(input.alpha, 0, 1);
  const beta = clamp(input.beta, 0, 1);
  const denom = alpha + beta;
  const normalizedAlpha = denom > 0 ? alpha / denom : 0.5;
  const normalizedBeta = denom > 0 ? beta / denom : 0.5;
  const score =
    normalizedAlpha * clamp(input.semanticSimilarity, 0, 1) +
    normalizedBeta * clamp(input.timeDecayScore, 0, 1);
  return Number(clamp(score, 0, 1).toFixed(6));
}

export function blendRankingScores(input: {
  similarity: number;
  recency: number;
  importance: number;
  weights: {
    similarity: number;
    recency: number;
    importance: number;
  };
}) {
  const totalWeight =
    input.weights.similarity + input.weights.recency + input.weights.importance;
  const normalizedWeights =
    totalWeight > 0
      ? {
          similarity: input.weights.similarity / totalWeight,
          recency: input.weights.recency / totalWeight,
          importance: input.weights.importance / totalWeight
        }
      : {
          similarity: 0.6,
          recency: 0.25,
          importance: 0.15
        };

  const score =
    clamp(input.similarity) * normalizedWeights.similarity +
    clamp(input.recency) * normalizedWeights.recency +
    clamp(input.importance) * normalizedWeights.importance;

  return Number(clamp(score).toFixed(6));
}

export function dedupeMemoryResults(
  results: AgentMemorySearchResult[],
  threshold: number
) {
  const deduped: AgentMemorySearchResult[] = [];

  for (const candidate of results) {
    const candidateText = `${candidate.memory.summary} ${candidate.memory.content}`;
    const isDuplicate = deduped.some((existing) => {
      if (existing.memory.id === candidate.memory.id) return true;
      if (existing.memory.contentHash === candidate.memory.contentHash) return true;

      const existingText = `${existing.memory.summary} ${existing.memory.content}`;
      const overlap = jaccardSimilarity(existingText, candidateText);
      return overlap >= threshold;
    });

    if (!isDuplicate) {
      deduped.push(candidate);
    }
  }

  return deduped;
}

export function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / APPROX_CHARS_PER_TOKEN));
}

export function buildMemoryContextBlock(input: {
  results: AgentMemorySearchResult[];
  maxItems: number;
  maxChars: number;
}) {
  const selected = input.results.slice(0, Math.max(1, input.maxItems));
  const lines: string[] = [];
  let usedChars = 0;

  for (const result of selected) {
    const entry = result.memory;
    const summary = (entry.summary || entry.content || "").replace(/\s+/g, " ").trim();
    if (!summary) continue;
    const line = `[${entry.memoryType}] ${entry.source} :: ${summary}`;
    if (usedChars + line.length > input.maxChars) {
      break;
    }
    lines.push(line);
    usedChars += line.length + 1;
  }

  return lines.join("\n");
}
