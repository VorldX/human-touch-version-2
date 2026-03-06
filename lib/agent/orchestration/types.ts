import type {
  AgentDecisionType,
  AgentRole,
  OrgExecutionMode
} from "@prisma/client";

import type { AgentContextBlock } from "@/lib/ai/swarm-runtime";

export type AgentExecutionMode = OrgExecutionMode;
export type AgentLogicalRole = AgentRole;
export type DelegationDecisionType = AgentDecisionType;

export interface AgentBudgetSnapshot {
  monthlyBudgetUsd: number;
  currentSpendUsd: number;
  remainingBudgetUsd: number;
  monthlyBtuCap: number;
  currentBtuBurn: number;
  remainingBtu: number;
  flowPredictedBurn: number;
}

export interface TaskComplexityAssessment {
  score: number;
  parallelizationBenefit: number;
  riskScore: number;
  signals: string[];
}

export interface DelegationPolicyInput {
  executionMode: AgentExecutionMode;
  agentRole: AgentLogicalRole;
  budget: AgentBudgetSnapshot;
  complexity: TaskComplexityAssessment;
  estimatedSelfCostUsd: number;
  estimatedDelegationCostUsd: number;
  requiredToolkits: string[];
  missingToolkits: string[];
  requiresApproval: boolean;
  blockedByPolicy: boolean;
  availableChildAgents: number;
  multiAgentRequested?: boolean;
  taskStage?: "PLANNING" | "EXECUTION" | "GENERAL";
  stepIndex?: number | null;
  totalSteps?: number | null;
}

export interface DelegationPolicyDecision {
  decision: DelegationDecisionType;
  reason: string;
  targetRole: AgentLogicalRole | null;
  shouldCreateChild: boolean;
  estimatedCostUsd: number;
  estimatedDelegationCostUsd: number;
}

export interface AgentContextPack {
  summary: string;
  blocks: AgentContextBlock[];
  memoryHighlights: Array<{
    id: string;
    key: string;
    tier: string;
    score: number;
  }>;
  dnaHighlights: Array<{
    id: string;
    name: string;
    score: number;
    amnesiaProtected: boolean;
  }>;
  executionMode: AgentExecutionMode;
  budgetSnapshot: AgentBudgetSnapshot;
}
