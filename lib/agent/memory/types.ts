import type {
  AgentMemory,
  AgentMemoryLifecycleState,
  AgentMemoryType,
  AgentMemoryVisibility,
  Prisma
} from "@prisma/client";

export type AgentMemoryTypeValue = AgentMemoryType;
export type AgentMemoryVisibilityValue = AgentMemoryVisibility;
export type AgentMemoryLifecycleStateValue = AgentMemoryLifecycleState;

export const ACTIVE_AGENT_MEMORY_LIFECYCLE_STATES = [
  "SHORT_TERM",
  "LONG_TERM"
] as const satisfies readonly AgentMemoryLifecycleStateValue[];

export const SEARCHABLE_AGENT_MEMORY_LIFECYCLE_STATES = [
  ...ACTIVE_AGENT_MEMORY_LIFECYCLE_STATES,
  "ARCHIVE"
] as const satisfies readonly AgentMemoryLifecycleStateValue[];

export function resolveAgentMemorySearchLifecycleStates(
  filters: Pick<AgentMemorySearchFilters, "lifecycleStates" | "includeArchived">
) {
  if (filters.lifecycleStates && filters.lifecycleStates.length > 0) {
    return [...new Set(filters.lifecycleStates)];
  }
  if (filters.includeArchived) {
    return [...SEARCHABLE_AGENT_MEMORY_LIFECYCLE_STATES];
  }
  return [...ACTIVE_AGENT_MEMORY_LIFECYCLE_STATES];
}

export function includesArchivedAgentMemoryLifecycle(
  lifecycleStates: readonly AgentMemoryLifecycleStateValue[]
) {
  return lifecycleStates.includes("ARCHIVE");
}

export function buildActiveAgentMemoryWhere(): Prisma.AgentMemoryWhereInput {
  return {
    lifecycleState: { in: [...ACTIVE_AGENT_MEMORY_LIFECYCLE_STATES] },
    archivedAt: null
  };
}

export function buildShortTermAgentMemoryWhere(): Prisma.AgentMemoryWhereInput {
  return {
    lifecycleState: "SHORT_TERM",
    archivedAt: null
  };
}

export interface AgentMemoryRecord {
  id: string;
  orgId: string;
  userId: string | null;
  agentId: string | null;
  fileId: string | null;
  sessionId: string | null;
  projectId: string | null;
  content: string;
  summary: string;
  embedding: number[] | null;
  memoryType: AgentMemoryTypeValue;
  visibility: AgentMemoryVisibilityValue;
  lifecycleState: AgentMemoryLifecycleStateValue;
  lifecycleUpdatedAt: Date;
  pinned: boolean;
  retrievalCount: number;
  lastRetrievedAt: Date | null;
  lastUsedAt: Date | null;
  quarantineReason: string | null;
  quarantineSource: string | null;
  tags: string[];
  source: string;
  timestamp: Date;
  importance: number;
  recency: number;
  metadata: Prisma.JsonValue | null;
  contentHash: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentMemoryUpsertInput {
  id?: string;
  orgId: string;
  userId?: string | null;
  agentId?: string | null;
  fileId?: string | null;
  sessionId?: string | null;
  projectId?: string | null;
  content: string;
  summary?: string;
  memoryType: AgentMemoryTypeValue;
  visibility?: AgentMemoryVisibilityValue;
  lifecycleState?: AgentMemoryLifecycleStateValue;
  pinned?: boolean;
  quarantineReason?: string | null;
  quarantineSource?: string | null;
  tags?: string[];
  source: string;
  timestamp?: Date;
  importance?: number;
  recency?: number;
  metadata?: Prisma.InputJsonValue | null;
  embedding?: number[] | null;
}

export interface AgentMemorySearchFilters {
  orgId: string;
  userId?: string | null;
  agentId?: string | null;
  sessionId?: string | null;
  projectId?: string | null;
  memoryTypes?: AgentMemoryTypeValue[];
  lifecycleStates?: AgentMemoryLifecycleStateValue[];
  tags?: string[];
  sources?: string[];
  includeArchived?: boolean;
  includeShared?: boolean;
  includePrivate?: boolean;
}

export interface AgentMemorySearchResult {
  memory: AgentMemoryRecord;
  similarity: number;
  recencyScore: number;
  importanceScore: number;
  timeDecayScore: number;
  hybridScore: number;
  rerankScore?: number;
  score: number;
}

export interface AgentMemoryConsolidationResult {
  scannedSessions: number;
  summarizedSessions: number;
  archivedEntries: number;
  summaryMemoryIds: string[];
}

export interface AgentMemoryStore {
  upsertMemory(memoryItem: AgentMemoryUpsertInput): Promise<AgentMemoryRecord | null>;
  searchMemory(
    query: string,
    filters: AgentMemorySearchFilters,
    topK?: number
  ): Promise<AgentMemorySearchResult[]>;
  getRecentMemory(
    sessionId: string,
    limit: number,
    filters: Pick<AgentMemorySearchFilters, "orgId" | "agentId" | "userId" | "includePrivate" | "includeShared">
  ): Promise<AgentMemoryRecord[]>;
  summarizeAndArchive(
    sessionId: string,
    scope: Pick<AgentMemorySearchFilters, "orgId" | "agentId" | "userId"> & { projectId?: string | null }
  ): Promise<AgentMemoryRecord | null>;
  markMemoriesRetrieved(memoryIds: string[]): Promise<void>;
  markMemoriesUsed(memoryIds: string[]): Promise<void>;
  listPromotionCandidates(input: {
    orgId: string;
    threshold?: number;
    limit?: number;
  }): Promise<AgentMemoryRecord[]>;
  deleteMemory(memoryId: string): Promise<boolean>;
  consolidateMemory?(
    scope: Pick<AgentMemorySearchFilters, "orgId"> & { sessionIds?: string[] }
  ): Promise<AgentMemoryConsolidationResult>;
}

export type AgentMemoryRow = AgentMemory;

export interface MemoryEmbeddingTelemetry {
  provider: "openai" | "deterministic";
  model: string;
  dimensions: number;
  promptTokens: number;
  totalTokens: number;
  latencyMs: number;
}

export interface MemoryEmbeddingResult {
  embedding: number[];
  telemetry: MemoryEmbeddingTelemetry;
}

export interface MemoryEmbedder {
  embed(text: string): Promise<MemoryEmbeddingResult>;
}
