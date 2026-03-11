import type {
  ApprovalRequest,
  CreatedAgentSpec,
  ExistingSquadMember,
  SharedKnowledgeRef,
  SquadWriteResult,
  SwarmTeamType,
  ToolRequest
} from "../state.ts";

export interface LangGraphOrganizationContext {
  orgId: string;
  orgName: string;
  workspaceId: string;
  managerName: string;
  availableToolkits: string[];
}

export interface ToolExecutionResult {
  ok: boolean;
  toolkit: string;
  action: string;
  toolSlug?: string;
  data?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    retryable?: boolean;
  };
}

export interface HubEntryResult {
  entryId: string;
  category: string;
}

export interface HubContextResult {
  workspaceId: string;
  existed: boolean;
  missionEntryId: string | null;
}

export interface ApprovalRequestResult {
  checkpointId: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
}

export interface OrganizationGraphAdapters {
  loadOrganizationContext(input: {
    orgId: string;
    userId: string;
  }): Promise<LangGraphOrganizationContext>;
  loadExistingSquad(input: { orgId: string }): Promise<ExistingSquadMember[]>;
  persistSquadAgents(input: {
    orgId: string;
    userId: string;
    teamType: SwarmTeamType;
    graphRunId: string;
    mission: string;
    agents: CreatedAgentSpec[];
    reuseExistingAgents: boolean;
  }): Promise<SquadWriteResult[]>;
  initializeOrReuseHubContext(input: {
    orgId: string;
    teamType: SwarmTeamType;
    mission: string;
    graphRunId: string;
  }): Promise<HubContextResult>;
  publishHubEntry(input: {
    orgId: string;
    teamType: SwarmTeamType;
    graphRunId: string;
    category: string;
    title: string;
    content: string;
    role?: string;
  }): Promise<HubEntryResult>;
  searchSharedKnowledge(input: {
    orgId: string;
    userId: string;
    query: string;
    limit: number;
  }): Promise<SharedKnowledgeRef[]>;
  executeToolRequest(input: {
    orgId: string;
    userId: string;
    request: ToolRequest;
  }): Promise<ToolExecutionResult>;
  createApprovalRequest(input: {
    orgId: string;
    reason: string;
    metadata: Record<string, unknown>;
  }): Promise<ApprovalRequestResult>;
  logGraphEvent(input: {
    orgId: string;
    graphRunId: string;
    traceId: string;
    stage: string;
    latencyMs: number;
    message: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

export interface OrganizationGraphRuntimeOptions {
  adapters: OrganizationGraphAdapters;
}

export interface OrganizationGraphRunInput {
  orgId: string;
  userId: string;
  sessionId: string;
  traceId: string;
  userRequest: string;
  featureFlagEnabled: boolean;
  preseedToolRequests?: ToolRequest[];
}

export interface OrganizationGraphRunResult {
  handled: boolean;
  reply: string;
  reason: string;
  graphRunId: string;
  requestType: string;
  warnings: string[];
  createdAgentCount: number;
  reusedAgentCount: number;
  approvalPendingCount: number;
}

export interface ApprovalSubgraphInput {
  orgId: string;
  request: ApprovalRequest;
}
