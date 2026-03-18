import type {
  AgentMemory,
  AgentMemoryType,
  AgentMemoryVisibility,
  Prisma
} from "@prisma/client";

export type AgentMemoryTypeValue = AgentMemoryType;
export type AgentMemoryVisibilityValue = AgentMemoryVisibility;

export interface AgentMemoryRecord {
  id: string;
  orgId: string;
  userId: string | null;
  agentId: string | null;
  sessionId: string | null;
  projectId: string | null;
  content: string;
  summary: string;
  embedding: number[] | null;
  memoryType: AgentMemoryTypeValue;
  visibility: AgentMemoryVisibilityValue;
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
  sessionId?: string | null;
  projectId?: string | null;
  content: string;
  summary?: string;
  memoryType: AgentMemoryTypeValue;
  visibility?: AgentMemoryVisibilityValue;
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
