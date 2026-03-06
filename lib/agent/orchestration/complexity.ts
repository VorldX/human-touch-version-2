import "server-only";

import type { TaskComplexityAssessment } from "@/lib/agent/orchestration/types";

function countWords(input: string) {
  return input
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean).length;
}

export function assessTaskComplexity(input: {
  prompt: string;
  requiredFiles: string[];
  requestedToolkits: string[];
}): TaskComplexityAssessment {
  const prompt = input.prompt.trim();
  const lower = prompt.toLowerCase();
  const wordCount = countWords(prompt);
  const toolkitCount = input.requestedToolkits.length;
  const requiredFileCount = input.requiredFiles.length;

  const hasPlanningSignals =
    /\b(plan|planning|strategy|roadmap|multi-step|decompose|break down|orchestrate)\b/i.test(
      lower
    );
  const hasDecompositionSignals =
    /\b(subtask|subtasks|dependency|dependencies|workflow|workflows|execution step|mission planning)\b/i.test(
      lower
    );
  const hasTeamSignals =
    /\b(team|squad|agent|agents|delegate|delegation|manager|worker)\b/i.test(lower);
  const hasConcurrencySignals =
    /\bparallel|concurrent|in parallel|simultaneous|batch\b/i.test(lower);
  const hasRiskSignals =
    /\bdelete|drop|revoke|prod|production|financial|payment|legal|compliance|security\b/i.test(
      lower
    );
  const hasExternalCoordination =
    /\bemail|slack|notion|crm|calendar|api|integration|oauth|connect\b/i.test(lower);

  const promptComplexity = Math.min(1, wordCount / 220);
  const toolkitComplexity = Math.min(1, toolkitCount / 4);
  const fileComplexity = Math.min(1, requiredFileCount / 6);
  const planningWeight = hasPlanningSignals ? 0.2 : 0;
  const decompositionWeight = hasDecompositionSignals ? 0.18 : 0;
  const teamWeight = hasTeamSignals ? 0.12 : 0;
  const coordinationWeight = hasExternalCoordination ? 0.15 : 0;
  const longInstructionWeight = wordCount > 50 ? 0.08 : 0;

  const score = Math.min(
    1,
    promptComplexity * 0.35 +
      toolkitComplexity * 0.2 +
      fileComplexity * 0.15 +
      planningWeight +
      decompositionWeight +
      teamWeight +
      longInstructionWeight +
      coordinationWeight
  );

  const parallelizationBenefit = Math.min(
    1,
    (hasConcurrencySignals ? 0.4 : 0.12) +
      (hasDecompositionSignals ? 0.16 : 0) +
      (hasTeamSignals ? 0.08 : 0) +
      Math.min(0.35, toolkitCount * 0.08) +
      Math.min(0.25, requiredFileCount * 0.04)
  );

  const riskScore = Math.min(
    1,
    (hasRiskSignals ? 0.42 : 0.08) +
      Math.min(0.25, toolkitCount * 0.06) +
      Math.min(0.2, requiredFileCount * 0.03)
  );

  const signals: string[] = [];
  if (hasPlanningSignals) signals.push("planning");
  if (hasDecompositionSignals) signals.push("decomposition");
  if (hasTeamSignals) signals.push("team-routing");
  if (hasConcurrencySignals) signals.push("parallelizable");
  if (hasExternalCoordination) signals.push("external-tools");
  if (hasRiskSignals) signals.push("high-risk");
  if (wordCount > 140) signals.push("long-prompt");
  if (requiredFileCount > 2) signals.push("multi-file");

  return {
    score: Number(score.toFixed(4)),
    parallelizationBenefit: Number(parallelizationBenefit.toFixed(4)),
    riskScore: Number(riskScore.toFixed(4)),
    signals
  };
}
