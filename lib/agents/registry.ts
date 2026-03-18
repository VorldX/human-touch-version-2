import "server-only";

import { AgentRole as PrismaAgentRole, AgentStatus } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import type { RuntimeAgent } from "@/lib/agents/types";

function toRuntimeRole(role: PrismaAgentRole): RuntimeAgent["role"] {
  if (role === "MAIN") return "CEO";
  if (role === "MANAGER") return "MANAGER";
  return "WORKER";
}

function toRuntimeStatus(status: AgentStatus): RuntimeAgent["status"] {
  if (status === "ACTIVE") return "ACTIVE";
  if (status === "PAUSED" || status === "WAITING_HUMAN" || status === "BLOCKED") return "PAUSED";
  return "DISABLED";
}

function readCapabilities(metadata: unknown, fallbackRole: RuntimeAgent["role"]) {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const value = (metadata as Record<string, unknown>).capabilities;
    if (Array.isArray(value)) {
      const parsed = value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean);
      if (parsed.length > 0) {
        return [...new Set(parsed)];
      }
    }
  }

  if (fallbackRole === "CEO" || fallbackRole === "MANAGER") {
    return ["plan.create", "task.delegate", "tool.execute"];
  }
  return ["task.execute"];
}

export async function findRuntimeAgent(input: {
  orgId: string;
  agentId: string;
}): Promise<RuntimeAgent | null> {
  const row = await prisma.agent.findFirst({
    where: {
      id: input.agentId,
      orgId: input.orgId
    },
    select: {
      id: true,
      orgId: true,
      role: true,
      allowedTools: true,
      metadata: true,
      status: true
    }
  });

  if (!row) {
    return null;
  }

  const role = toRuntimeRole(row.role);
  const metadata =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};
  const policyVersion =
    typeof metadata.policyVersion === "string" ? metadata.policyVersion.trim() : "legacy-v1";

  return {
    id: row.id,
    orgId: row.orgId,
    role,
    capabilities: readCapabilities(row.metadata, role),
    allowedTools: row.allowedTools,
    policyVersion: policyVersion || "legacy-v1",
    status: toRuntimeStatus(row.status)
  };
}
