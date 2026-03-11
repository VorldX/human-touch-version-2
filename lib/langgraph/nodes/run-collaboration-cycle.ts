import { randomUUID } from "node:crypto";

import type { OrganizationGraphAdapters } from "../adapters/contracts.ts";
import type { ApprovalRequest, SwarmOrganizationState } from "../state.ts";
import { normalizeToolOutputForHub } from "../utils/tool-output-normalizer.ts";

function toApprovalRequest(reason: string, metadata: Record<string, unknown>): ApprovalRequest {
  return {
    requestId: `lg-approval-${randomUUID().slice(0, 8)}`,
    reason,
    status: "PENDING",
    checkpointId: null,
    metadata
  };
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function toolRequestSignature(input: {
  toolkit: string;
  action: string;
  arguments: Record<string, unknown>;
}) {
  return `${input.toolkit.toLowerCase()}:${input.action.toUpperCase()}:${stableStringify(
    input.arguments
  )}`;
}

export async function runCollaborationCycleNode(
  state: SwarmOrganizationState,
  adapters: OrganizationGraphAdapters
) {
  if (!state.teamBlueprint) {
    return state;
  }

  const pendingTasks = [...state.pendingTasks];
  const inProgressTasks = [] as typeof state.inProgressTasks;
  const blockedTasks = [] as typeof state.blockedTasks;
  const completedTasks = [] as typeof state.completedTasks;
  const approvalRequests = [...state.approvalRequests];
  const agentOutputs = [...state.agentOutputs];
  const warnings = [...state.warnings];
  const toolRequestCache = new Map<
    string,
    {
      sourceRequestId: string;
      summary: string;
      deliverable: string;
    }
  >();
  let toolCallsExecuted = 0;

  for (const task of pendingTasks) {
    if (task.requiresApproval) {
      blockedTasks.push(task);
      approvalRequests.push(
        toApprovalRequest(`Approval required for task: ${task.title}`, {
          taskId: task.taskId,
          role: task.role,
          source: "task_assignment"
        })
      );
      continue;
    }

    inProgressTasks.push(task);
    completedTasks.push(task);
    agentOutputs.push({
      role: task.role,
      taskId: task.taskId,
      summary: `Task accepted: ${task.title}`,
      deliverable: `Initial progress recorded for "${task.title}".`,
      usedToolRequestIds: []
    });
  }

  for (const request of state.toolRequests) {
    if (request.requiresApproval) {
      approvalRequests.push(
        toApprovalRequest(request.reason || `Approval required for ${request.toolkit}:${request.action}`, {
          requestId: request.requestId,
          taskId: request.taskId,
          role: request.role,
          toolkit: request.toolkit,
          action: request.action,
          source: "tool_request"
        })
      );
      continue;
    }

    const signature = toolRequestSignature({
      toolkit: request.toolkit,
      action: request.action,
      arguments: request.arguments
    });
    const cached = toolRequestCache.get(signature);
    if (cached) {
      agentOutputs.push({
        role: request.role,
        taskId: request.taskId,
        summary: `Reused prior tool result for ${request.toolkit}:${request.action}.`,
        deliverable: cached.deliverable,
        usedToolRequestIds: [cached.sourceRequestId]
      });
      continue;
    }

    const toolResult = await adapters.executeToolRequest({
      orgId: state.orgId,
      userId: state.userId,
      request
    });

    if (!toolResult.ok) {
      warnings.push(
        `Tool request failed for ${request.role} (${request.toolkit}:${request.action}): ${toolResult.error?.message ?? "Unknown error"}`
      );
      continue;
    }

    toolCallsExecuted += 1;
    const normalized = normalizeToolOutputForHub({
      role: request.role,
      toolkit: request.toolkit,
      action: request.action,
      data: toolResult.data ?? {}
    });

    await adapters.publishHubEntry({
      orgId: state.orgId,
      teamType: state.teamBlueprint.teamType,
      graphRunId: state.graphRunId,
      category: normalized.category,
      title: normalized.title,
      content: normalized.content,
      role: request.role
    });

    agentOutputs.push({
      role: request.role,
      taskId: request.taskId,
      summary: normalized.summary,
      deliverable: normalized.content.slice(0, 600),
      usedToolRequestIds: [request.requestId]
    });
    toolRequestCache.set(signature, {
      sourceRequestId: request.requestId,
      summary: normalized.summary,
      deliverable: normalized.content.slice(0, 600)
    });
  }

  return {
    ...state,
    pendingTasks: [],
    inProgressTasks,
    blockedTasks,
    completedTasks,
    approvalRequests,
    agentOutputs,
    warnings,
    collaborationSummary: {
      completedTasks: completedTasks.length,
      blockedTasks: blockedTasks.length,
      approvalsRequired: approvalRequests.length,
      toolCallsExecuted
    }
  };
}
