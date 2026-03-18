# Production Rebuild Blueprint

This document is the implementation blueprint to replace the current monolithic orchestration path with a queue-first, idempotent, distributed-safe architecture.

## 1) Break the Monolith

Target: replace `app/api/inngest/route.ts` with bounded modules.

### 1.1 File splits

- `apps/api/src/routes/runs/create-run.route.ts`
  - Validates request, enforces idempotency, creates run + outbox event in one transaction.
- `apps/api/src/routes/events/internal-events.route.ts`
  - Optional internal event intake (restricted), writes to outbox only.
- `packages/orchestrator/src/application/orchestrator.service.ts`
  - Pure orchestration decisions and state transitions.
- `packages/orchestrator/src/application/handlers/run-created.handler.ts`
  - RUN_CREATED handler.
- `packages/orchestrator/src/application/handlers/plan-generated.handler.ts`
  - PLAN_GENERATED handler.
- `packages/orchestrator/src/application/handlers/task-ready.handler.ts`
  - TASK_READY handler.
- `packages/orchestrator/src/application/handlers/task-completed.handler.ts`
  - TASK_COMPLETED handler.
- `packages/orchestrator/src/application/handlers/run-completed.handler.ts`
  - RUN_COMPLETED handler.
- `packages/orchestrator/src/domain/task-state-machine.ts`
  - State enum, legal transitions, atomic transition helper.
- `packages/orchestrator/src/infrastructure/outbox.repository.ts`
  - Outbox insert/fetch/ack.
- `packages/orchestrator/src/infrastructure/run.repository.ts`
  - Run persistence access.
- `packages/orchestrator/src/infrastructure/task.repository.ts`
  - Task persistence access.
- `packages/queue/src/producer.ts`
  - BullMQ producer wrapper.
- `apps/orchestrator/src/workers/outbox-dispatcher.worker.ts`
  - Pulls unprocessed outbox rows, pushes jobs.
- `apps/worker-agent/src/workers/agent-task.worker.ts`
  - Executes TASK_EXECUTE jobs.
- `apps/worker-tool/src/workers/tool-call.worker.ts`
  - Executes TOOL_CALL jobs.

### 1.2 Core function signatures

```ts
// packages/orchestrator/src/application/orchestrator.service.ts
export interface OrchestratorService {
  onRunCreated(input: RunCreatedJob): Promise<void>;
  onPlanGenerated(input: PlanGeneratedJob): Promise<void>;
  onTaskReady(input: TaskReadyJob): Promise<void>;
  onTaskCompleted(input: TaskCompletedJob): Promise<void>;
  onRunCompleted(input: RunCompletedJob): Promise<void>;
}

// packages/orchestrator/src/domain/task-state-machine.ts
export function assertTransition(from: TaskState, to: TaskState): void;
export function canTransition(from: TaskState, to: TaskState): boolean;
export async function transitionTaskState(input: TransitionTaskInput): Promise<TransitionTaskResult>;
```

---

## 2) Queue-First Execution (BullMQ)

Target flow:

- API -> DB transaction (`run`, `tasks`, `outbox_events`) -> Outbox Dispatcher -> BullMQ -> Workers.

### 2.1 Queue names

- `orchestrator-control`
- `planning-jobs`
- `task-lifecycle`
- `tool-execution`
- `run-completion`
- `dead-letter`

### 2.2 Job payload schema (TypeScript)

```ts
// packages/queue/src/job-types.ts
export type QueueJobName =
  | "RUN_CREATED"
  | "PLAN_GENERATED"
  | "TASK_READY"
  | "TASK_EXECUTE"
  | "TOOL_CALL"
  | "TASK_COMPLETED"
  | "RUN_COMPLETED"
  | "DEAD_LETTER";

export interface QueueEnvelope<TName extends QueueJobName, TPayload> {
  id: string;                  // uuid v7
  name: TName;
  version: 1;
  orgId: string;
  runId: string;
  idempotencyKey: string;
  traceId: string;
  createdAt: string;
  payload: TPayload;
}

export type RUN_CREATED = QueueEnvelope<"RUN_CREATED", {
  initiatedByUserId: string;
  prompt: string;
  executionMode: "ECO" | "BALANCED" | "TURBO";
}>;

export type PLAN_GENERATED = QueueEnvelope<"PLAN_GENERATED", {
  plannerAgentId: string;
  planId: string;
  taskIds: string[];
}>;

export type TASK_READY = QueueEnvelope<"TASK_READY", {
  taskId: string;
  priority: number;
  attemptNo: number;
}>;

export type TASK_EXECUTE = QueueEnvelope<"TASK_EXECUTE", {
  taskId: string;
  attemptNo: number;
  agentId: string;
  contextRef: { sessionId: string; memoryCursor?: string };
}>;

export type TOOL_CALL = QueueEnvelope<"TOOL_CALL", {
  taskId: string;
  attemptNo: number;
  toolCallId: string;
  agentId: string;
  tool: string;
  action: string;
  args: Record<string, unknown>;
}>;

export type TASK_COMPLETED = QueueEnvelope<"TASK_COMPLETED", {
  taskId: string;
  attemptNo: number;
  outputRef?: string;
  outputHash?: string;
}>;

export type RUN_COMPLETED = QueueEnvelope<"RUN_COMPLETED", {
  completedTaskCount: number;
  failedTaskCount: number;
}>;

export type DEAD_LETTER = QueueEnvelope<"DEAD_LETTER", {
  failedJobName: QueueJobName;
  failedJobId: string;
  reason: string;
  retryCount: number;
  payloadSnapshot: unknown;
}>;
```

### 2.3 Producer code

```ts
// packages/queue/src/producer.ts
import { Queue } from "bullmq";
import { redisConnection } from "./redis";
import type { QueueEnvelope, QueueJobName } from "./job-types";

const queueByName = {
  "RUN_CREATED": new Queue("orchestrator-control", { connection: redisConnection }),
  "PLAN_GENERATED": new Queue("planning-jobs", { connection: redisConnection }),
  "TASK_READY": new Queue("task-lifecycle", { connection: redisConnection }),
  "TASK_EXECUTE": new Queue("task-lifecycle", { connection: redisConnection }),
  "TOOL_CALL": new Queue("tool-execution", { connection: redisConnection }),
  "TASK_COMPLETED": new Queue("task-lifecycle", { connection: redisConnection }),
  "RUN_COMPLETED": new Queue("run-completion", { connection: redisConnection }),
  "DEAD_LETTER": new Queue("dead-letter", { connection: redisConnection })
} as const;

export async function publishJob<T extends QueueJobName>(job: QueueEnvelope<T, unknown>) {
  const q = queueByName[job.name];
  await q.add(job.name, job, {
    jobId: job.idempotencyKey, // dedupe on retry
    removeOnComplete: 2000,
    removeOnFail: 10000
  });
}
```

### 2.4 Worker handlers

```ts
// apps/worker-agent/src/workers/agent-task.worker.ts
import { Worker } from "bullmq";
import { redisConnection } from "@/packages/queue/src/redis";
import { executeTaskJob } from "@/packages/orchestrator/src/application/handlers/task-execute.handler";

export const agentTaskWorker = new Worker(
  "task-lifecycle",
  async (job) => {
    if (job.name !== "TASK_EXECUTE") return;
    await executeTaskJob(job.data);
  },
  { connection: redisConnection, concurrency: 50 }
);
```

```ts
// apps/worker-tool/src/workers/tool-call.worker.ts
import { Worker } from "bullmq";
import { redisConnection } from "@/packages/queue/src/redis";
import { executeToolJob } from "@/packages/tools/src/tool-job.handler";

export const toolWorker = new Worker(
  "tool-execution",
  async (job) => {
    if (job.name !== "TOOL_CALL") return;
    await executeToolJob(job.data);
  },
  { connection: redisConnection, concurrency: 100 }
);
```

---

## 3) Idempotency + Exactly-Once Model

### 3.1 Prisma schema changes

```prisma
// packages/db/prisma/schema.prisma
model IdempotencyKey {
  id             String   @id @default(cuid())
  orgId          String
  scope          String   // e.g. RUN_CREATE, TASK_TRANSITION, TOOL_CALL
  key            String
  requestHash    String
  responseCode   Int?
  responseBody   Json?
  status         String   @default("IN_PROGRESS") // IN_PROGRESS|SUCCEEDED|FAILED
  expiresAt      DateTime
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([orgId, scope, key])
  @@index([expiresAt])
}

model OutboxEvent {
  id             String   @id @default(cuid())
  orgId          String
  runId          String
  eventName      String
  eventKey       String   // deterministic unique key
  payload        Json
  traceId        String
  status         String   @default("PENDING") // PENDING|DISPATCHED|FAILED
  retryCount     Int      @default(0)
  availableAt    DateTime @default(now())
  dispatchedAt   DateTime?
  lastError      String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([orgId, eventKey])
  @@index([status, availableAt])
  @@index([runId])
}

model ToolExecutionReceipt {
  id             String   @id @default(cuid())
  orgId          String
  runId          String
  taskId         String
  attemptNo      Int
  toolCallId     String
  agentId        String
  tool           String
  action         String
  argsHash       String
  resultHash     String?
  status         String   // REQUESTED|SUCCEEDED|FAILED|TIMEOUT
  errorCode      String?
  errorMessage   String?
  latencyMs      Int?
  createdAt      DateTime @default(now())

  @@unique([orgId, toolCallId])
  @@index([taskId, attemptNo])
}
```

### 3.2 Idempotency middleware

```ts
// apps/api/src/middleware/idempotency.ts
export async function withIdempotency<T>(input: {
  orgId: string;
  scope: string;
  key: string;
  requestHash: string;
  ttlSeconds?: number;
  execute: () => Promise<{ code: number; body: T }>;
}): Promise<{ code: number; body: T }> {
  const existing = await prisma.idempotencyKey.findUnique({
    where: { orgId_scope_key: { orgId: input.orgId, scope: input.scope, key: input.key } }
  });

  if (existing?.status === "SUCCEEDED" && existing.responseBody) {
    return { code: existing.responseCode ?? 200, body: existing.responseBody as T };
  }

  if (!existing) {
    await prisma.idempotencyKey.create({
      data: {
        orgId: input.orgId,
        scope: input.scope,
        key: input.key,
        requestHash: input.requestHash,
        expiresAt: new Date(Date.now() + (input.ttlSeconds ?? 24 * 3600) * 1000)
      }
    });
  }

  const out = await input.execute();

  await prisma.idempotencyKey.update({
    where: { orgId_scope_key: { orgId: input.orgId, scope: input.scope, key: input.key } },
    data: { status: "SUCCEEDED", responseCode: out.code, responseBody: out.body }
  });

  return out;
}
```

### 3.3 Flow launch logic

```ts
// apps/api/src/routes/runs/create-run.route.ts
export async function createRunRoute(req: Request) {
  const body = await req.json();
  const idempotencyKey = req.headers.get("x-idempotency-key");
  if (!idempotencyKey) return json(400, { ok: false, message: "x-idempotency-key required" });

  return withIdempotency({
    orgId: body.orgId,
    scope: "RUN_CREATE",
    key: idempotencyKey,
    requestHash: sha256(JSON.stringify(body)),
    execute: async () => {
      const result = await prisma.$transaction(async (tx) => {
        const run = await tx.run.create({ data: { orgId: body.orgId, prompt: body.prompt, status: "CREATED" } });
        await tx.outboxEvent.create({
          data: {
            orgId: run.orgId,
            runId: run.id,
            eventName: "RUN_CREATED",
            eventKey: `run:${run.id}:RUN_CREATED`,
            payload: { initiatedByUserId: body.userId, prompt: body.prompt },
            traceId: crypto.randomUUID()
          }
        });
        return run;
      });

      return { code: 202, body: { ok: true, runId: result.id, status: "QUEUED" } };
    }
  });
}
```

---

## 4) Task State Machine (Critical)

### 4.1 Tables

```prisma
model Task {
  id             String   @id @default(cuid())
  orgId          String
  runId          String
  objective      String
  state          TaskState @default(CREATED)
  assignedAgentId String?
  priority       Int       @default(100)
  version        Int       @default(1)
  lastError      String?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  attempts       TaskAttempt[]

  @@index([runId, state, priority])
}

model TaskAttempt {
  id             String   @id @default(cuid())
  orgId          String
  runId          String
  taskId         String
  attemptNo      Int
  state          TaskState
  startedAt      DateTime @default(now())
  endedAt        DateTime?
  workerId       String?
  errorCode      String?
  errorMessage   String?
  tokenInput     Int?
  tokenOutput    Int?
  latencyMs      Int?

  task           Task @relation(fields: [taskId], references: [id], onDelete: Cascade)

  @@unique([taskId, attemptNo])
  @@index([runId, state])
}

enum TaskState {
  CREATED
  QUEUED
  RUNNING
  WAITING_TOOL
  RETRYING
  FAILED
  COMPLETED
}
```

### 4.2 Transition rules

```ts
// packages/core/src/task-state.ts
export enum TaskState {
  CREATED = "CREATED",
  QUEUED = "QUEUED",
  RUNNING = "RUNNING",
  WAITING_TOOL = "WAITING_TOOL",
  RETRYING = "RETRYING",
  FAILED = "FAILED",
  COMPLETED = "COMPLETED"
}

const ALLOWED: Record<TaskState, TaskState[]> = {
  [TaskState.CREATED]: [TaskState.QUEUED, TaskState.FAILED],
  [TaskState.QUEUED]: [TaskState.RUNNING, TaskState.RETRYING, TaskState.FAILED],
  [TaskState.RUNNING]: [TaskState.WAITING_TOOL, TaskState.COMPLETED, TaskState.RETRYING, TaskState.FAILED],
  [TaskState.WAITING_TOOL]: [TaskState.RUNNING, TaskState.RETRYING, TaskState.FAILED],
  [TaskState.RETRYING]: [TaskState.QUEUED, TaskState.FAILED],
  [TaskState.FAILED]: [],
  [TaskState.COMPLETED]: []
};

export function canTransition(from: TaskState, to: TaskState): boolean {
  return from === to || ALLOWED[from].includes(to);
}
```

### 4.3 Atomic transition function

```ts
// packages/orchestrator/src/domain/task-transition.service.ts
export async function transitionTask(input: {
  taskId: string;
  from: TaskState;
  to: TaskState;
  reason?: string;
  expectedVersion: number;
}) {
  if (!canTransition(input.from, input.to)) {
    throw new Error(`invalid transition ${input.from} -> ${input.to}`);
  }

  const updated = await prisma.task.updateMany({
    where: { id: input.taskId, state: input.from, version: input.expectedVersion },
    data: {
      state: input.to,
      version: { increment: 1 },
      ...(input.reason ? { lastError: input.reason } : {})
    }
  });

  if (updated.count !== 1) {
    throw new Error("state transition race conflict");
  }
}
```

### 4.4 Worker state flow

```ts
// packages/orchestrator/src/application/handlers/task-execute.handler.ts
export async function executeTaskJob(job: TASK_EXECUTE) {
  const task = await prisma.task.findUniqueOrThrow({ where: { id: job.payload.taskId } });

  await transitionTask({
    taskId: task.id,
    from: task.state as TaskState,
    to: TaskState.RUNNING,
    expectedVersion: task.version
  });

  const attemptNo = job.payload.attemptNo;
  await prisma.taskAttempt.create({
    data: {
      orgId: job.orgId,
      runId: job.runId,
      taskId: task.id,
      attemptNo,
      state: TaskState.RUNNING,
      workerId: process.env.WORKER_ID ?? "worker-agent"
    }
  });

  // invoke agent runtime -> maybe emits TOOL_CALL jobs
  // on success -> TASK_COMPLETED
  // on transient failure -> RETRYING -> QUEUED
  // on permanent failure -> FAILED
}
```

---

## 5) Memory System Unification

Target: one interface and three explicit storage domains.

- Short-term memory (session-based): recent turns, task scratchpad, TTL.
- Long-term semantic memory (vector-based): summaries, episodic learnings, retrieved by relevance.
- Structured system memory: facts/preferences/policies with deterministic keys.

### 5.1 Unified memory interface

```ts
// packages/memory/src/memory.service.ts
export interface MemoryContextQuery {
  orgId: string;
  userId: string;
  runId: string;
  taskId?: string;
  agentId?: string;
  query: string;
  maxTokens: number;
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
  }): Promise<Array<{ id: string; content: string; score: number; source: string }>>;
}
```

### 5.2 Backing tables (canonical)

- `memory_events` (short-term + auditable event stream)
- `memory_chunks` (vector indexed semantic chunks)
- `memory_facts` (key/value structured memory)

Existing tables map:

- `MemoryEntry` -> migrate to `memory_events`
- `AgentMemory` + `dna_memory.central_memory` -> merge into `memory_chunks`
- `dna_memory.rules/pathways` -> map to `memory_facts` or `memory_chunks(kind=RULE|SOP)`

### 5.3 Retrieval pipeline

```ts
// packages/memory/src/retrieval.pipeline.ts
export async function retrieveRelevantPipeline(input: {
  orgId: string;
  userId: string;
  query: string;
  topK: number;
  includeStructured?: boolean;
}) {
  const embedding = await embed(input.query);

  const vector = await searchVectorChunks({
    orgId: input.orgId,
    userId: input.userId,
    embedding,
    topK: input.topK * 4
  });

  const lexical = await searchLexicalFallback({
    orgId: input.orgId,
    userId: input.userId,
    query: input.query,
    topK: input.topK * 2
  });

  const structured = input.includeStructured
    ? await fetchStructuredFacts({ orgId: input.orgId, userId: input.userId, query: input.query })
    : [];

  const merged = dedupeById([...vector, ...lexical, ...structured]);
  const reranked = rerankByHybridScore(merged, { query: input.query, topK: input.topK });

  return reranked;
}
```

### 5.4 Context builder logic

```ts
// packages/memory/src/context-builder.ts
export async function buildAgentContext(input: MemoryContextQuery) {
  const base = await memoryService.retrieveRelevant({
    orgId: input.orgId,
    userId: input.userId,
    query: input.query,
    topK: 12,
    includeStructured: true
  });

  const selected = selectByTokenBudget(base, input.maxTokens, {
    maxItems: 8,
    reserveTokens: 300
  });

  return {
    snippets: selected.map((x) => ({ source: x.source, content: x.content, score: x.score })),
    cursor: makeCursor(selected)
  };
}
```

---

## 6) Agent System Fix

### 6.1 Agent schema

```ts
// packages/agents/src/types.ts
export interface Agent {
  id: string;
  orgId: string;
  role: "CEO" | "MANAGER" | "PLANNER" | "WORKER" | "TOOL_AGENT";
  capabilities: string[];
  allowedTools: string[];
  policyVersion: string;
  status: "ACTIVE" | "PAUSED" | "DISABLED";
}
```

### 6.2 Agent registry service

```ts
// packages/agents/src/agent-registry.service.ts
export interface AgentRegistryService {
  getById(orgId: string, agentId: string): Promise<Agent | null>;
  listByRole(orgId: string, role: Agent["role"]): Promise<Agent[]>;
  resolveExecutor(input: { orgId: string; taskType: string; requiredTools: string[] }): Promise<Agent>;
}
```

### 6.3 Capability enforcement middleware

```ts
// packages/agents/src/capability-guard.ts
export function assertAgentCapability(input: {
  agent: Agent;
  requiredCapabilities: string[];
  requiredTools?: string[];
}) {
  const missingCaps = input.requiredCapabilities.filter((c) => !input.agent.capabilities.includes(c));
  if (missingCaps.length > 0) {
    throw new Error(`agent capability denied: ${missingCaps.join(",")}`);
  }

  if (input.requiredTools?.length) {
    const missingTools = input.requiredTools.filter((t) => !input.agent.allowedTools.includes(t));
    if (missingTools.length > 0) {
      throw new Error(`agent tool policy denied: ${missingTools.join(",")}`);
    }
  }
}
```

---

## 7) Tool Security Layer (Critical)

### 7.1 Tool gateway wrapper

```ts
// packages/tools/src/tool-gateway.ts
export interface ToolExecutionRequest {
  orgId: string;
  runId: string;
  taskId: string;
  attemptNo: number;
  agentId: string;
  userId: string;
  tool: string;
  action: string;
  args: Record<string, unknown>;
  traceId: string;
}

export interface ToolExecutionResult {
  ok: boolean;
  output?: unknown;
  error?: { code: string; message: string };
  receiptId: string;
}

export async function executeToolWithReceipt(req: ToolExecutionRequest): Promise<ToolExecutionResult> {
  const agent = await agentRegistry.getById(req.orgId, req.agentId);
  if (!agent) throw new Error("agent not found");

  assertAgentCapability({
    agent,
    requiredCapabilities: ["tool.execute"],
    requiredTools: [req.tool]
  });

  await assertOrgUserScope({ orgId: req.orgId, userId: req.userId, tool: req.tool });

  const argsHash = sha256(JSON.stringify(req.args));
  const start = Date.now();

  let receipt = await prisma.toolExecutionReceipt.create({
    data: {
      orgId: req.orgId,
      runId: req.runId,
      taskId: req.taskId,
      attemptNo: req.attemptNo,
      toolCallId: `${req.taskId}:${req.attemptNo}:${req.tool}:${req.action}`,
      agentId: req.agentId,
      tool: req.tool,
      action: req.action,
      argsHash,
      status: "REQUESTED"
    }
  });

  try {
    const output = await toolAdapter.execute(req.tool, req.action, req.args);
    const resultHash = sha256(JSON.stringify(output));

    receipt = await prisma.toolExecutionReceipt.update({
      where: { id: receipt.id },
      data: { status: "SUCCEEDED", resultHash, latencyMs: Date.now() - start }
    });

    return { ok: true, output, receiptId: receipt.id };
  } catch (e) {
    await prisma.toolExecutionReceipt.update({
      where: { id: receipt.id },
      data: {
        status: "FAILED",
        errorCode: "TOOL_EXECUTION_FAILED",
        errorMessage: e instanceof Error ? e.message.slice(0, 500) : "unknown",
        latencyMs: Date.now() - start
      }
    });

    return {
      ok: false,
      error: { code: "TOOL_EXECUTION_FAILED", message: e instanceof Error ? e.message : "unknown" },
      receiptId: receipt.id
    };
  }
}
```

### 7.2 Receipt schema

Use `ToolExecutionReceipt` model above. Mandatory fields:

- `toolCallId`, `agentId`, `argsHash`, `resultHash`, `status`, `latencyMs`, timestamps.

---

## 8) Remove Process-Local State

### 8.1 Replace maps/timers

- In-memory actor run guards -> Redis token bucket.
- In-memory draft sessions -> Redis hash with TTL (`session:draft:{org}:{user}`).
- In-memory idle timers -> delayed queue jobs (`SESSION_IDLE_CHECK`).
- In-memory realtime presence -> Socket.IO Redis adapter.

### 8.2 Distributed-safe replacements

```ts
// packages/core/src/rate-limit.ts
export async function consumeActorToken(input: { orgId: string; userId: string; windowMs: number; max: number }) {
  // Lua script: increment + expire atomically
  // key: rl:{orgId}:{userId}
}
```

```ts
// packages/core/src/session-store.ts
export async function loadDraftSession(orgId: string, userId: string) {
  const raw = await redis.get(`session:draft:${orgId}:${userId}`);
  return raw ? JSON.parse(raw) : null;
}

export async function saveDraftSession(orgId: string, userId: string, payload: unknown, ttlSec = 6 * 3600) {
  await redis.set(`session:draft:${orgId}:${userId}`, JSON.stringify(payload), { EX: ttlSec });
}
```

```ts
// apps/orchestrator/src/workers/session-idle.worker.ts
// enqueue delayed idle check instead of setTimeout()
await queue.add("SESSION_IDLE_CHECK", { orgId, userId, sessionId }, { delay: 10 * 60 * 1000 });
```

---

## 9) Observability (Debuggable)

### 9.1 Trace ID propagation

- API request gets `traceId` (or uses incoming `x-trace-id`).
- `traceId` and `spanId` added to outbox payload.
- Dispatcher writes into BullMQ job data.
- Workers start child spans using parent `traceId`.

### 9.2 Logging schema

```ts
// packages/observability/src/logger.ts
export interface LogEvent {
  ts: string;
  level: "debug" | "info" | "warn" | "error";
  service: string;
  traceId: string;
  orgId?: string;
  runId?: string;
  taskId?: string;
  jobName?: string;
  event: string;
  message: string;
  meta?: Record<string, unknown>;
}
```

### 9.3 Metrics (required)

- `task_latency_ms` (histogram)
- `queue_lag_ms` (histogram)
- `task_failure_total` (counter)
- `llm_token_input_total` (counter)
- `llm_token_output_total` (counter)
- `llm_cost_usd_total` (counter)

```ts
// packages/observability/src/metrics.ts
export const metrics = {
  taskLatencyMs: histogram("task_latency_ms", [50, 100, 250, 500, 1000, 2000, 5000]),
  queueLagMs: histogram("queue_lag_ms", [10, 50, 100, 250, 500, 1000, 5000]),
  taskFailureTotal: counter("task_failure_total"),
  llmTokenInputTotal: counter("llm_token_input_total"),
  llmTokenOutputTotal: counter("llm_token_output_total"),
  llmCostUsdTotal: counter("llm_cost_usd_total")
};
```

### 9.4 Tracing middleware

```ts
// apps/api/src/middleware/tracing.ts
export async function withTrace<T>(handler: (ctx: { traceId: string }) => Promise<T>) {
  const traceId = getOrCreateTraceId();
  return runSpan("api.request", { traceId }, () => handler({ traceId }));
}
```

---

## 10) Failure Handling System

### 10.1 Retry policy

```ts
// packages/core/src/retry-policy.ts
export const RETRY_POLICY = {
  TASK_EXECUTE: { attempts: 5, backoff: [1000, 3000, 10000, 30000, 120000] },
  TOOL_CALL: { attempts: 4, backoff: [500, 2000, 10000, 30000] },
  PLANNING: { attempts: 2, backoff: [2000, 10000] }
} as const;
```

### 10.2 Dead letter queue worker

```ts
// apps/orchestrator/src/workers/dead-letter.worker.ts
import { Worker } from "bullmq";

new Worker("dead-letter", async (job) => {
  await prisma.deadLetterEvent.create({
    data: {
      orgId: job.data.orgId,
      runId: job.data.runId,
      failedJobName: job.data.payload.failedJobName,
      failedJobId: job.data.payload.failedJobId,
      reason: job.data.payload.reason,
      payload: job.data.payload.payloadSnapshot
    }
  });

  // emit alert + realtime incident event
});
```

### 10.3 Compensation flow

- If `TOOL_CALL` succeeded but `TASK_COMPLETE` persist failed:
  - replay from receipt (`tool_call_id` unique).
- If task stuck in `RUNNING` over SLA:
  - transition `RUNNING -> RETRYING -> QUEUED` until max attempts.
- If max attempts exceeded:
  - transition to `FAILED`, push `DEAD_LETTER`, continue run if policy allows partial completion.

---

## 11) Clean Folder Structure

```txt
/apps
  /api
    /src
      /routes
        /runs/create-run.route.ts
        /runs/get-run.route.ts
        /tasks/get-task.route.ts
      /middleware
        idempotency.ts
        tracing.ts
        auth.ts
  /orchestrator
    /src
      /workers
        outbox-dispatcher.worker.ts
        run-completion.worker.ts
        dead-letter.worker.ts
  /worker-agent
    /src
      /workers
        agent-task.worker.ts
  /worker-tool
    /src
      /workers
        tool-call.worker.ts

/packages
  /core
    /src
      task-state.ts
      retry-policy.ts
      rate-limit.ts
      session-store.ts
      errors.ts
  /agents
    /src
      types.ts
      agent-registry.service.ts
      capability-guard.ts
  /memory
    /src
      memory.service.ts
      retrieval.pipeline.ts
      context-builder.ts
      adapters/
        short-term.adapter.ts
        vector.adapter.ts
        structured.adapter.ts
  /queue
    /src
      job-types.ts
      redis.ts
      producer.ts
      queues.ts
  /tools
    /src
      tool-gateway.ts
      tool-job.handler.ts
      receipts.ts
  /db
    /prisma
      schema.prisma
    /src
      repositories/
        task.repository.ts
        run.repository.ts
        outbox.repository.ts
        idempotency.repository.ts
  /orchestrator
    /src
      application/
        orchestrator.service.ts
        handlers/
          run-created.handler.ts
          plan-generated.handler.ts
          task-ready.handler.ts
          task-completed.handler.ts
          run-completed.handler.ts
      domain/
        task-state-machine.ts
  /observability
    /src
      logger.ts
      tracing.ts
      metrics.ts
```

---

## 12) Step-by-Step Migration Plan

### Step 1: Extract orchestrator

- Change:
  - Move orchestration logic from `app/api/inngest/route.ts` into `packages/orchestrator/*` handlers.
  - Keep old route as thin adapter (temporary).
- Delete:
  - Inline business logic from route file incrementally.
- Test:
  - Unit tests for each handler + transition rules.
  - Snapshot parity tests: old vs new decisions for same inputs.

### Step 2: Introduce queue + outbox

- Change:
  - Add `OutboxEvent` table.
  - API writes outbox events in same tx as run/task creation.
  - Add outbox dispatcher worker -> BullMQ.
- Delete:
  - Local HTTP kick calls to `/api/inngest` from flow/task routes.
- Test:
  - Transactional outbox test: no event loss on crash.
  - Dispatcher retry + dedupe tests.

### Step 3: Add idempotency

- Change:
  - Add `IdempotencyKey` table and middleware.
  - Require `x-idempotency-key` for mutating APIs.
- Delete:
  - Any ad-hoc duplicate suppression relying only on logs/memory keys.
- Test:
  - Concurrent duplicate requests return same response and no duplicate run.

### Step 4: Replace task tracking with state machine

- Change:
  - Add `Task.state`, `Task.version`, `TaskAttempt`.
  - All workers use atomic `updateMany where state+version` transitions.
- Delete:
  - JSON-blob-only task state as source of truth.
- Test:
  - Race condition tests: dual workers cannot both claim same transition.
  - Retry and terminal-state tests.

### Step 5: Unify memory layer

- Change:
  - Introduce `MemoryService` and route all context read/write through it.
  - Create migration adapters from old tables.
- Delete:
  - Direct scattered memory writes across routes/workers.
  - Process-local draft/session state.
- Test:
  - Context quality regression tests.
  - Latency benchmarks for retrieval pipeline.

### Step 6: Move execution fully to workers

- Change:
  - API becomes command ingress only.
  - Agent/tool executions happen only in worker processes.
- Delete:
  - In-request sequential task execution loops.
- Test:
  - Load test: 1000 concurrent users.
  - Queue lag, throughput, and failure recovery tests.

### Step 7: Add observability and hardening

- Change:
  - Add tracing middleware, structured logger, metrics exporter.
  - Add DLQ worker and alerting hooks.
- Delete:
  - Best-effort-only critical telemetry paths.
- Test:
  - Chaos tests: Redis down, DB failover, tool timeout, worker crash.

---

## 13) Immediate Cutover Rules

- No new logic in legacy `app/api/inngest/route.ts`.
- All new features must enter through command -> outbox -> queue -> worker.
- Every mutating API requires idempotency key.
- Every tool call requires receipt.
- Every task transition must be state-machine validated and version-checked.

This blueprint is designed for 1000+ concurrent users with deterministic replayability, bounded failure domains, and debuggable distributed execution.
