import "server-only";

export interface MemoryContextQuery {
  orgId: string;
  userId: string;
  runId: string;
  taskId?: string;
  agentId?: string;
  query: string;
  maxTokens: number;
}

export interface MemoryRelevantItem {
  id: string;
  content: string;
  score: number;
  source: string;
}

export interface MemoryService {
  getContext(input: MemoryContextQuery): Promise<{
    snippets: Array<{ source: string; content: string; score: number }>;
    cursor?: string;
  }>;
  storeEvent(input: {
    orgId: string;
    userId: string;
    runId: string;
    taskId?: string;
    type: "TASK_EVENT" | "TOOL_EVENT" | "AGENT_EVENT";
    payload: Record<string, unknown>;
    ttlSeconds?: number;
  }): Promise<void>;
  storeSummary(input: {
    orgId: string;
    userId: string;
    runId: string;
    taskId?: string;
    summary: string;
    tags: string[];
    importance: number;
  }): Promise<void>;
  retrieveRelevant(input: {
    orgId: string;
    userId: string;
    query: string;
    topK: number;
    includeStructured?: boolean;
  }): Promise<MemoryRelevantItem[]>;
}
