export interface BudgetContextBlock {
  id: string;
  name: string;
  amnesiaProtected: boolean;
  content: string;
}

export interface BudgetContextCandidate extends BudgetContextBlock {
  priority: number;
  relevance: number;
}

export interface ContextSelectionTrace {
  budgetTokens: number;
  usedTokens: number;
  includedSections: Array<{
    id: string;
    name: string;
    priority: number;
    estimatedTokens: number;
    reason: string;
  }>;
  omittedSections: Array<{
    id: string;
    name: string;
    priority: number;
    estimatedTokens: number;
    reason: string;
  }>;
}

const MIN_SECTION_TOKENS = 48;

function truncateByTokenBudget(value: string, maxTokens: number) {
  const maxChars = Math.max(80, maxTokens * 4);
  if (value.length <= maxChars) {
    return value;
  }
  const kept = value.slice(0, Math.max(0, maxChars - 28)).trimEnd();
  const omitted = Math.max(0, value.length - kept.length);
  return `${kept}\n[TRUNCATED ${omitted} chars]`;
}

export function estimateTextTokens(value: string) {
  return Math.max(1, Math.ceil(value.length / 4));
}

export function selectContextBlocksByPriority(input: {
  candidates: BudgetContextCandidate[];
  budgetTokens: number;
  sectionMaxTokens: number;
}): { blocks: BudgetContextBlock[]; trace: ContextSelectionTrace } {
  const sorted = [...input.candidates]
    .filter((candidate) => candidate.content.trim().length > 0)
    .sort((left, right) => {
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }
      if (right.relevance !== left.relevance) {
        return right.relevance - left.relevance;
      }
      return left.name.localeCompare(right.name);
    });

  const blocks: BudgetContextBlock[] = [];
  const includedSections: ContextSelectionTrace["includedSections"] = [];
  const omittedSections: ContextSelectionTrace["omittedSections"] = [];
  let usedTokens = 0;

  for (const candidate of sorted) {
    const initialTokens = estimateTextTokens(candidate.content);
    const remaining = input.budgetTokens - usedTokens;
    if (remaining < MIN_SECTION_TOKENS) {
      omittedSections.push({
        id: candidate.id,
        name: candidate.name,
        priority: candidate.priority,
        estimatedTokens: initialTokens,
        reason: "budget_exhausted"
      });
      continue;
    }

    const sectionBudget = Math.max(
      MIN_SECTION_TOKENS,
      Math.min(input.sectionMaxTokens, remaining)
    );
    const normalizedContent = truncateByTokenBudget(candidate.content, sectionBudget);
    const estimatedTokens = estimateTextTokens(normalizedContent);

    if (estimatedTokens > remaining) {
      omittedSections.push({
        id: candidate.id,
        name: candidate.name,
        priority: candidate.priority,
        estimatedTokens,
        reason: "section_over_budget"
      });
      continue;
    }

    blocks.push({
      id: candidate.id,
      name: candidate.name,
      amnesiaProtected: candidate.amnesiaProtected,
      content: normalizedContent
    });
    usedTokens += estimatedTokens;
    includedSections.push({
      id: candidate.id,
      name: candidate.name,
      priority: candidate.priority,
      estimatedTokens,
      reason:
        estimatedTokens < initialTokens
          ? "included_truncated_for_budget"
          : "included_full"
    });
  }

  return {
    blocks,
    trace: {
      budgetTokens: input.budgetTokens,
      usedTokens,
      includedSections,
      omittedSections
    }
  };
}
