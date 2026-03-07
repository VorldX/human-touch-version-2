type SelectorMode = "direction-chat" | "direction-plan";

interface SelectorMessage {
  role: string;
  content: string;
}

export interface SelectedContextTrace {
  mode: SelectorMode;
  strategy: "json" | "text";
  totalSourceChars: number;
  totalChunks: number;
  selectedChunks: number;
  discardedChunks: number;
  selectedChars: number;
  queryTokenCount: number;
  selectedSections: string[];
}

export interface SelectedContextResult {
  contextText: string;
  trace: SelectedContextTrace;
}

interface SelectorInput {
  mode: SelectorMode;
  companyDataText: string;
  primaryText: string;
  history?: SelectorMessage[];
  maxSelectedChars: number;
  maxChunkChars?: number;
}

interface ContextChunk {
  id: string;
  label: string;
  content: string;
  score: number;
  critical: boolean;
}

const DEFAULT_MAX_CHUNK_CHARS = 900;
const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "for",
  "with",
  "from",
  "that",
  "this",
  "those",
  "these",
  "into",
  "onto",
  "about",
  "your",
  "their",
  "they",
  "them",
  "you",
  "our",
  "ours",
  "his",
  "her",
  "its",
  "was",
  "were",
  "are",
  "is",
  "am",
  "be",
  "been",
  "being",
  "will",
  "would",
  "should",
  "could",
  "can",
  "may",
  "might",
  "must",
  "need",
  "want",
  "please",
  "make",
  "do",
  "does",
  "did",
  "done",
  "have",
  "has",
  "had",
  "it",
  "as",
  "at",
  "to",
  "of",
  "on",
  "in",
  "by",
  "if",
  "then",
  "than",
  "also",
  "not",
  "only",
  "any",
  "all",
  "each",
  "every",
  "per",
  "via"
]);

function cleanText(value: string) {
  return value.replace(/\r\n/g, "\n").trim();
}

function clampText(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3 && !STOP_WORDS.has(item));
}

function asObject(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function safeJsonStringify(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? "");
  }
}

function splitByLength(value: string, maxChars: number) {
  const normalized = cleanText(value);
  if (normalized.length <= maxChars) {
    return normalized.length > 0 ? [normalized] : [];
  }

  const parts: string[] = [];
  let cursor = 0;
  while (cursor < normalized.length) {
    const next = normalized.slice(cursor, cursor + maxChars).trim();
    if (next.length > 0) {
      parts.push(next);
    }
    cursor += maxChars;
  }
  return parts;
}

function splitArrayByLength(value: unknown[], maxChars: number) {
  const chunks: string[] = [];
  let current = "";

  for (const item of value) {
    const candidate = safeJsonStringify(item);
    const next = current.length > 0 ? `${current},\n${candidate}` : candidate;

    if (next.length <= maxChars) {
      current = next;
      continue;
    }

    if (current.length > 0) {
      chunks.push(`[${current}]`);
      current = "";
    }

    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    const sliced = splitByLength(candidate, maxChars).map((part) => `[${part}]`);
    chunks.push(...sliced);
  }

  if (current.length > 0) {
    chunks.push(`[${current}]`);
  }

  return chunks;
}

function chunkJsonRecord(
  root: Record<string, unknown>,
  maxChunkChars: number
): ContextChunk[] {
  const chunks: ContextChunk[] = [];

  for (const [rootKey, rootValue] of Object.entries(root)) {
    const nested = asObject(rootValue);
    if (nested) {
      for (const [subKey, subValue] of Object.entries(nested)) {
        const label = `${rootKey}.${subKey}`;
        const serialized = safeJsonStringify(subValue);
        const split = splitByLength(serialized, maxChunkChars);
        if (split.length === 0) {
          continue;
        }
        split.forEach((part, index) => {
          chunks.push({
            id: `${label}:${index}`,
            label,
            content: part,
            score: 0,
            critical: isCriticalSection(label)
          });
        });
      }

      if (Object.keys(nested).length === 0) {
        chunks.push({
          id: `${rootKey}:0`,
          label: rootKey,
          content: "{}",
          score: 0,
          critical: isCriticalSection(rootKey)
        });
      }
      continue;
    }

    if (Array.isArray(rootValue)) {
      const split = splitArrayByLength(rootValue, maxChunkChars);
      if (split.length === 0) {
        continue;
      }
      split.forEach((part, index) => {
        chunks.push({
          id: `${rootKey}:${index}`,
          label: rootKey,
          content: part,
          score: 0,
          critical: isCriticalSection(rootKey)
        });
      });
      continue;
    }

    const serialized = safeJsonStringify(rootValue);
    const split = splitByLength(serialized, maxChunkChars);
    if (split.length === 0) {
      continue;
    }
    split.forEach((part, index) => {
      chunks.push({
        id: `${rootKey}:${index}`,
        label: rootKey,
        content: part,
        score: 0,
        critical: isCriticalSection(rootKey)
      });
    });
  }

  return chunks;
}

function chunkPlainText(raw: string, maxChunkChars: number): ContextChunk[] {
  const normalized = cleanText(raw);
  if (!normalized) {
    return [];
  }

  const paragraphs = normalized
    .split(/\n{2,}/g)
    .map((item) => item.trim())
    .filter(Boolean);

  const chunks: ContextChunk[] = [];
  const source = paragraphs.length > 0 ? paragraphs : [normalized];
  let buffer = "";
  let index = 0;

  for (const paragraph of source) {
    const next = buffer.length > 0 ? `${buffer}\n\n${paragraph}` : paragraph;
    if (next.length <= maxChunkChars) {
      buffer = next;
      continue;
    }

    if (buffer.length > 0) {
      chunks.push({
        id: `text:${index}`,
        label: `text-block-${index + 1}`,
        content: buffer,
        score: 0,
        critical: false
      });
      index += 1;
      buffer = "";
    }

    const split = splitByLength(paragraph, maxChunkChars);
    if (split.length === 0) {
      continue;
    }
    split.forEach((part) => {
      chunks.push({
        id: `text:${index}`,
        label: `text-block-${index + 1}`,
        content: part,
        score: 0,
        critical: false
      });
      index += 1;
    });
  }

  if (buffer.length > 0) {
    chunks.push({
      id: `text:${index}`,
      label: `text-block-${index + 1}`,
      content: buffer,
      score: 0,
      critical: false
    });
  }

  return chunks;
}

function isCriticalSection(label: string) {
  const normalized = label.toLowerCase();
  return (
    normalized === "company" ||
    normalized === "company.name" ||
    normalized === "company.description" ||
    normalized.startsWith("founder") ||
    normalized.startsWith("orchestration") ||
    normalized.startsWith("oauthproviders")
  );
}

function deriveQueryTokens(input: {
  primaryText: string;
  history?: SelectorMessage[];
  mode: SelectorMode;
}) {
  const recentOwnerHistory = (input.history ?? [])
    .filter((item) => item.role === "owner")
    .slice(-3)
    .map((item) => item.content)
    .join("\n");

  const modeTerms =
    input.mode === "direction-plan"
      ? "plan workflow tasks approvals tools agent owner role risk success metrics"
      : "response action direction toolkit context summary execution";

  return new Set(tokenize([input.primaryText, recentOwnerHistory, modeTerms].join("\n")));
}

function scoreChunks(chunks: ContextChunk[], queryTokens: Set<string>) {
  const queryTokenCount = Math.max(1, queryTokens.size);

  return chunks
    .map((chunk) => {
      const contentTokens = tokenize(`${chunk.label} ${chunk.content}`);
      const tokenSet = new Set(contentTokens);

      let hits = 0;
      for (const token of queryTokens) {
        if (tokenSet.has(token)) {
          hits += 1;
        }
      }

      const overlap = hits / queryTokenCount;
      const density = contentTokens.length > 0 ? hits / contentTokens.length : 0;
      const labelBoost = tokenize(chunk.label).some((token) => queryTokens.has(token)) ? 0.12 : 0;
      const criticalBoost = chunk.critical ? 0.08 : 0;
      const lengthPenalty = Math.min(0.08, Math.max(0, chunk.content.length - 700) / 5000);

      const score = Number(
        (overlap * 0.72 + density * 0.2 + labelBoost + criticalBoost - lengthPenalty).toFixed(5)
      );

      return {
        ...chunk,
        score
      };
    })
    .sort((a, b) => b.score - a.score);
}

function buildOutputContext(chunks: ContextChunk[], maxSelectedChars: number) {
  const selected: ContextChunk[] = [];
  const selectedIds = new Set<string>();
  let usedChars = 0;

  const pushChunk = (chunk: ContextChunk) => {
    if (selectedIds.has(chunk.id)) {
      return;
    }
    const section = `Section: ${chunk.label}\n${chunk.content}`;
    const candidateSize = section.length + (selected.length > 0 ? 10 : 0);
    if (usedChars + candidateSize > maxSelectedChars && selected.length > 0) {
      return;
    }

    if (usedChars + candidateSize > maxSelectedChars && selected.length === 0) {
      selected.push({
        ...chunk,
        content: clampText(chunk.content, Math.max(120, maxSelectedChars - 40))
      });
      selectedIds.add(chunk.id);
      usedChars = selected[0].content.length + chunk.label.length + 10;
      return;
    }

    selected.push(chunk);
    selectedIds.add(chunk.id);
    usedChars += candidateSize;
  };

  const critical = chunks.filter((chunk) => chunk.critical);
  critical.forEach(pushChunk);

  chunks.forEach(pushChunk);

  if (selected.length === 0 && chunks.length > 0) {
    pushChunk(chunks[0]);
  }

  const contextText = selected
    .map((chunk) => `Section: ${chunk.label}\n${chunk.content}`)
    .join("\n\n---\n\n");

  return {
    contextText: clampText(contextText, maxSelectedChars),
    selected
  };
}

export function selectCompanyContext(input: SelectorInput): SelectedContextResult {
  const source = cleanText(input.companyDataText);
  if (!source) {
    return {
      contextText: "",
      trace: {
        mode: input.mode,
        strategy: "text",
        totalSourceChars: 0,
        totalChunks: 0,
        selectedChunks: 0,
        discardedChunks: 0,
        selectedChars: 0,
        queryTokenCount: 0,
        selectedSections: []
      }
    };
  }

  const maxChunkChars =
    input.maxChunkChars && input.maxChunkChars > 120
      ? input.maxChunkChars
      : DEFAULT_MAX_CHUNK_CHARS;

  const asJson = (() => {
    try {
      return JSON.parse(source) as unknown;
    } catch {
      return null;
    }
  })();

  const strategy: "json" | "text" = asJson && asObject(asJson) ? "json" : "text";
  const chunks =
    strategy === "json"
      ? chunkJsonRecord(asJson as Record<string, unknown>, maxChunkChars)
      : chunkPlainText(source, maxChunkChars);

  const queryTokens = deriveQueryTokens({
    primaryText: input.primaryText,
    history: input.history,
    mode: input.mode
  });
  const ranked = scoreChunks(chunks, queryTokens);
  const output = buildOutputContext(ranked, input.maxSelectedChars);

  return {
    contextText: output.contextText,
    trace: {
      mode: input.mode,
      strategy,
      totalSourceChars: source.length,
      totalChunks: ranked.length,
      selectedChunks: output.selected.length,
      discardedChunks: Math.max(0, ranked.length - output.selected.length),
      selectedChars: output.contextText.length,
      queryTokenCount: queryTokens.size,
      selectedSections: output.selected.map((item) => item.label)
    }
  };
}
