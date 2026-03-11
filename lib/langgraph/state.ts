export type SwarmOrganizationRequestType =
  | "NORMAL_SWARM_REQUEST"
  | "SINGLE_AGENT_TASK"
  | "TEAM_CREATION_REQUEST"
  | "TEAM_UPDATE_REQUEST"
  | "TEAM_ACTIVATION_REQUEST"
  | "COLLABORATIVE_EXECUTION_REQUEST";

export type SwarmTeamOperation = "CREATE" | "UPDATE" | "ACTIVATE" | "NONE";

export type SwarmTeamType =
  | "marketing"
  | "sales"
  | "research"
  | "product"
  | "content"
  | "general";

export type ApprovalSensitivity = "LOW" | "MEDIUM" | "HIGH";

export interface ExistingSquadMember {
  personnelId: string;
  name: string;
  role: string;
  type: "HUMAN" | "AI";
  status: string;
  assignedOAuthIds: string[];
}

export interface ExistingTeamMatch {
  teamType: SwarmTeamType;
  matchedRoles: string[];
  memberIds: string[];
  matchScore: number;
}

export interface TeamIntent {
  requested: boolean;
  operation: SwarmTeamOperation;
  teamType: SwarmTeamType | null;
  confidence: number;
  reason: string;
}

export interface TeamBlueprintRole {
  roleName: string;
  description: string;
  responsibilities: string[];
  collaborationStyle: string;
  toolCategories: string[];
  approvalSensitivity: ApprovalSensitivity;
  defaultInitialTasks: string[];
  exampleDeliverables: string[];
}

export interface TeamBlueprint {
  teamType: SwarmTeamType;
  mission: string;
  objective: string;
  successCriteria: string[];
  sharedMemoryScope: string;
  collaborationStyle: string;
  approvalSensitivity: ApprovalSensitivity;
  roles: TeamBlueprintRole[];
  toolCategories: string[];
  exampleDeliverables: string[];
}

export interface CreatedAgentSpec {
  agentTempId: string;
  name: string;
  role: string;
  description: string;
  responsibilities: string[];
  prompt: string;
  toolCategories: string[];
  toolkits: string[];
  approvalSensitivity: ApprovalSensitivity;
  defaultInitialTasks: string[];
  metadata: Record<string, unknown>;
}

export interface SquadWriteResult {
  role: string;
  personnelId: string | null;
  agentId: string | null;
  status: "created" | "reused" | "failed";
  error?: string;
}

export interface HubContext {
  workspaceId: string;
  existed: boolean;
  missionEntryId: string | null;
}

export interface SharedKnowledgeRef {
  id: string;
  source: string;
  title: string;
  summary: string;
  score: number;
}

export interface PendingTask {
  taskId: string;
  role: string;
  title: string;
  description: string;
  toolHints: string[];
  requiresApproval: boolean;
}

export interface ToolRequest {
  requestId: string;
  taskId: string;
  role: string;
  toolkit: string;
  action: string;
  arguments: Record<string, unknown>;
  requiresApproval: boolean;
  reason?: string;
}

export interface ApprovalRequest {
  requestId: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  checkpointId: string | null;
  metadata: Record<string, unknown>;
}

export interface AgentOutput {
  role: string;
  taskId: string;
  summary: string;
  deliverable: string;
  usedToolRequestIds: string[];
}

export interface CollaborationSummary {
  completedTasks: number;
  blockedTasks: number;
  approvalsRequired: number;
  toolCallsExecuted: number;
}

export interface SwarmOrganizationState {
  userRequest: string;
  requestType: SwarmOrganizationRequestType;
  userId: string;
  orgId: string;
  workspaceId: string;
  orgName: string;
  managerName: string;
  availableToolkits: string[];
  sessionId: string;
  graphRunId: string;
  traceId: string;
  swarmGoal: string;
  teamIntent: TeamIntent;
  existingSquadState: ExistingSquadMember[];
  existingTeamMatch: ExistingTeamMatch | null;
  teamBlueprint: TeamBlueprint | null;
  createdAgents: CreatedAgentSpec[];
  squadWriteResults: SquadWriteResult[];
  hubContext: HubContext | null;
  sharedKnowledgeRefs: SharedKnowledgeRef[];
  pendingTasks: PendingTask[];
  inProgressTasks: PendingTask[];
  blockedTasks: PendingTask[];
  completedTasks: PendingTask[];
  toolRequests: ToolRequest[];
  approvalRequests: ApprovalRequest[];
  approvalStatus: "NONE" | "PENDING" | "PARTIAL" | "APPROVED";
  agentOutputs: AgentOutput[];
  collaborationSummary: CollaborationSummary | null;
  finalUserResponse: string;
  warnings: string[];
  errors: string[];
  wantsCreate: boolean;
  wantsUpdate: boolean;
  wantsActivate: boolean;
  reuseExistingAgents: boolean;
  humansAlreadyInSquad: boolean;
  hubWorkspaceExists: boolean;
  featureFlagEnabled: boolean;
  fallbackToLegacySwarmPath: boolean;
}

export function createInitialSwarmOrganizationState(input: {
  userRequest: string;
  userId: string;
  orgId: string;
  sessionId: string;
  graphRunId: string;
  traceId: string;
  featureFlagEnabled: boolean;
  workspaceId?: string;
}): SwarmOrganizationState {
  return {
    userRequest: input.userRequest,
    requestType: "NORMAL_SWARM_REQUEST",
    userId: input.userId,
    orgId: input.orgId,
    workspaceId: input.workspaceId ?? input.orgId,
    orgName: "Organization",
    managerName: "Swarm",
    availableToolkits: [],
    sessionId: input.sessionId,
    graphRunId: input.graphRunId,
    traceId: input.traceId,
    swarmGoal: "",
    teamIntent: {
      requested: false,
      operation: "NONE",
      teamType: null,
      confidence: 0,
      reason: "Not classified yet."
    },
    existingSquadState: [],
    existingTeamMatch: null,
    teamBlueprint: null,
    createdAgents: [],
    squadWriteResults: [],
    hubContext: null,
    sharedKnowledgeRefs: [],
    pendingTasks: [],
    inProgressTasks: [],
    blockedTasks: [],
    completedTasks: [],
    toolRequests: [],
    approvalRequests: [],
    approvalStatus: "NONE",
    agentOutputs: [],
    collaborationSummary: null,
    finalUserResponse: "",
    warnings: [],
    errors: [],
    wantsCreate: false,
    wantsUpdate: false,
    wantsActivate: false,
    reuseExistingAgents: true,
    humansAlreadyInSquad: false,
    hubWorkspaceExists: false,
    featureFlagEnabled: input.featureFlagEnabled,
    fallbackToLegacySwarmPath: false
  };
}
