export type AgentRole = "CEO" | "MANAGER" | "PLANNER" | "WORKER" | "TOOL_AGENT";

export interface RuntimeAgent {
  id: string;
  orgId: string;
  role: AgentRole;
  capabilities: string[];
  allowedTools: string[];
  policyVersion: string;
  status: "ACTIVE" | "PAUSED" | "DISABLED";
}

export interface CapabilityCheckResult {
  ok: boolean;
  missingCapabilities: string[];
  missingTools: string[];
}
