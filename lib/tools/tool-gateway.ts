import "server-only";

import { createHash } from "node:crypto";

import { PolicyDecision, Prisma } from "@prisma/client";

import { checkAgentCapability } from "@/lib/agents/capability-guard";
import { findRuntimeAgent } from "@/lib/agents/registry";
import { featureFlags } from "@/lib/config/feature-flags";
import { prisma } from "@/lib/db/prisma";
import {
  executeAgentTool,
  type ExecuteAgentToolInput,
  type ExecuteAgentToolResult
} from "@/lib/agent/tools/execute";

export interface ToolGatewayInput extends ExecuteAgentToolInput {
  agentId?: string;
  runId?: string;
}

function hashJson(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

async function assertOrgUserMembership(input: { orgId: string; userId: string }) {
  const membership = await prisma.orgMember.findFirst({
    where: {
      orgId: input.orgId,
      userId: input.userId
    },
    select: {
      userId: true
    }
  });
  return Boolean(membership);
}

function toolCallId(input: ToolGatewayInput) {
  const digest = hashJson({
    orgId: input.orgId,
    userId: input.userId,
    toolkit: input.toolkit,
    action: input.action,
    args: input.arguments ?? {},
    taskId: input.taskId ?? null
  }).slice(0, 20);

  return `${input.taskId ?? "task-na"}:${input.toolkit}:${input.action}:${digest}`;
}

async function writePolicyLog(input: {
  orgId: string;
  subjectId: string;
  decision: PolicyDecision;
  reason: string;
  meta?: Record<string, unknown>;
}) {
  await prisma.policyLog
    .create({
      data: {
        orgId: input.orgId,
        subjectType: "AGENT_TOOL_GATEWAY",
        subjectId: input.subjectId,
        decision: input.decision,
        reason: input.reason,
        meta: (input.meta ?? {}) as Prisma.InputJsonValue
      }
    })
    .catch(() => null);
}

export async function executeToolViaGateway(input: ToolGatewayInput): Promise<{
  result: ExecuteAgentToolResult;
  receiptId: string | null;
}> {
  const startedAt = Date.now();
  const runId = input.runId ?? input.taskId ?? "run-na";
  const argsHash = hashJson(input.arguments ?? {});
  const callId = toolCallId(input);

  const receipt = await prisma.toolExecutionReceipt.create({
    data: {
      orgId: input.orgId,
      runId,
      taskId: input.taskId ?? "task-na",
      attemptNo: 1,
      toolCallId: callId,
      agentId: input.agentId ?? null,
      tool: input.toolkit,
      action: input.action,
      argsHash,
      status: "REQUESTED"
    },
    select: {
      id: true
    }
  });

  const hasMembership = await assertOrgUserMembership({
    orgId: input.orgId,
    userId: input.userId
  });
  if (!hasMembership) {
    await prisma.toolExecutionReceipt.update({
      where: { id: receipt.id },
      data: {
        status: "FAILED",
        errorCode: "ORG_SCOPE_DENIED",
        errorMessage: "User does not belong to org.",
        latencyMs: Date.now() - startedAt
      }
    });
    return {
      result: {
        ok: false,
        attempts: 1,
        error: {
          code: "TOOLS_UNAVAILABLE",
          message: "User does not have access to this organization.",
          toolkit: input.toolkit,
          action: input.action,
          retryable: false
        }
      },
      receiptId: receipt.id
    };
  }

  if (featureFlags.useAgentRegistry && input.agentId) {
    const agent = await findRuntimeAgent({
      orgId: input.orgId,
      agentId: input.agentId
    });

    if (!agent) {
      await writePolicyLog({
        orgId: input.orgId,
        subjectId: input.agentId,
        decision: PolicyDecision.WARN,
        reason: "Agent not found in registry (soft enforcement path).",
        meta: { tool: input.toolkit, action: input.action }
      });
    } else {
      const capability = checkAgentCapability({
        agent,
        requiredCapabilities: ["tool.execute"],
        requiredTools: [input.toolkit]
      });

      if (!capability.ok) {
        const reason = `Missing capabilities=${capability.missingCapabilities.join(",") || "none"} tools=${capability.missingTools.join(",") || "none"}`;
        await writePolicyLog({
          orgId: input.orgId,
          subjectId: agent.id,
          decision: featureFlags.agentRegistryEnforce ? PolicyDecision.DENY : PolicyDecision.WARN,
          reason,
          meta: {
            toolkit: input.toolkit,
            action: input.action,
            missingCapabilities: capability.missingCapabilities,
            missingTools: capability.missingTools
          }
        });

        if (featureFlags.agentRegistryEnforce) {
          await prisma.toolExecutionReceipt.update({
            where: { id: receipt.id },
            data: {
              status: "FAILED",
              errorCode: "AGENT_CAPABILITY_DENIED",
              errorMessage: reason,
              latencyMs: Date.now() - startedAt
            }
          });
          return {
            result: {
              ok: false,
              attempts: 1,
              error: {
                code: "INVALID_TOOL_ACTION",
                message: "Agent capability policy denied this tool call.",
                toolkit: input.toolkit,
                action: input.action
              }
            },
            receiptId: receipt.id
          };
        }
      }
    }
  }

  const result = await executeAgentTool({
    orgId: input.orgId,
    userId: input.userId,
    toolkit: input.toolkit,
    action: input.action,
    arguments: input.arguments,
    taskId: input.taskId
  });

  if (!result.ok) {
    await prisma.toolExecutionReceipt.update({
      where: { id: receipt.id },
      data: {
        status: "FAILED",
        errorCode: result.error.code,
        errorMessage: result.error.message.slice(0, 500),
        latencyMs: Date.now() - startedAt
      }
    });
    return {
      result,
      receiptId: receipt.id
    };
  }

  await prisma.toolExecutionReceipt.update({
    where: { id: receipt.id },
    data: {
      status: "SUCCEEDED",
      resultHash: hashJson(result.data),
      latencyMs: Date.now() - startedAt
    }
  });

  return {
    result,
    receiptId: receipt.id
  };
}
