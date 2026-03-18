import "server-only";

import type { OrchestratorTaskPlan, OrchestratorTaskResult } from "@/src/orchestrator/types";

function inferChannelHints(text: string) {
  const lower = text.toLowerCase();
  const hints: string[] = [];
  if (/\b(email|gmail|mail)\b/.test(lower)) hints.push("gmail");
  if (/\b(meeting|calendar|invite|schedule)\b/.test(lower)) hints.push("googlecalendar");
  if (/\b(meet|google meet|gmeet)\b/.test(lower)) hints.push("googlemeet");
  return [...new Set(hints)];
}

export function executeDeterministicTask(input: {
  orgId: string;
  workflowId: string;
  requestId: string;
  task: OrchestratorTaskPlan;
  now?: () => number;
}): OrchestratorTaskResult {
  const now = input.now ?? (() => Date.now());
  const startTs = now();
  const instruction = input.task.instructions.trim();
  const channelHints = inferChannelHints(`${input.task.title} ${instruction}`);

  const outputLines = [
    `Task "${input.task.title}" executed deterministically.`,
    `Instruction: ${instruction}`,
    channelHints.length > 0
      ? `Suggested integrations: ${channelHints.join(", ")}`
      : "Suggested integrations: none"
  ];

  const endTs = Math.max(startTs + 25, now());
  return {
    workflowId: input.workflowId,
    orgId: input.orgId,
    requestId: input.requestId,
    taskId: input.task.taskId,
    status: "COMPLETED",
    output: outputLines.join(" "),
    details: {
      expectedOutput: input.task.expectedOutput,
      channelHints,
      deterministic: true
    },
    startedAt: new Date(startTs).toISOString(),
    completedAt: new Date(endTs).toISOString(),
    latencyMs: endTs - startTs,
    retryCount: 0
  };
}

