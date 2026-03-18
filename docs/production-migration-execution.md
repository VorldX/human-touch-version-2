# Production Migration Execution Plan

This is the live migration plan to implement `docs/production-rebuild-blueprint.md` without breaking production.

## 1) Migration Strategy (Strangler Fig)

### Old System Boundary
- Ingress + execution: `app/api/inngest/route.ts`
- Event dispatch: `lib/inngest/publish.ts` (HTTP kick/fallback)
- Source-of-truth task state + memory: existing `Task`, `MemoryEntry`, `AgentMemory`

### New System Boundary
- Queue contracts: `lib/queue/job-types.ts`
- Outbox + queue dispatch: `lib/queue/outbox.ts`, `workers/outbox-dispatcher.ts`
- Runtime workers: `workers/queue-shadow-worker.ts` (shadow mode now)
- New state + receipts tables: additive Prisma models in `prisma/schema.prisma`

### Routing Strategy
- Strangler decision utility: `lib/migration/strangler-router.ts`
- Modes:
  - `legacy_only`: old system only
  - `shadow`: old system authoritative + new system mirror
  - `queue_primary`: new system authoritative, old system fallback enabled unless explicitly disabled
- Safety default: `FEATURE_DISABLE_LEGACY_INNGEST_DISPATCH=false`, so old path remains operable.

## 2) Feature Flag System

Implemented in `lib/config/feature-flags.ts`:
- `USE_QUEUE_EXECUTION`
- `USE_NEW_MEMORY_SERVICE`
- `USE_AGENT_REGISTRY`
- `USE_TOOL_GATEWAY`
- `USE_TASK_STATE_MACHINE`

Additional safe rollout flags:
- `FEATURE_QUEUE_EXECUTION_SHADOW`
- `FEATURE_QUEUE_EXECUTION_CANARY_PERCENT`
- `FEATURE_DISABLE_LEGACY_INNGEST_DISPATCH`
- `FEATURE_TOOL_GATEWAY_ENFORCE`
- `FEATURE_AGENT_REGISTRY_ENFORCE`

Example usage:
```ts
import { featureFlags } from "@/lib/config/feature-flags";

if (featureFlags.useToolGateway) {
  // new path in audit/enforce mode
} else {
  // legacy path
}
```

## 3) Step-by-Step Implementation (No Big Bang)

### STEP 1
🎯 Goal
- Introduce BullMQ and queue contracts with no behavior change.

🔧 Code changes
- Created `lib/queue/job-types.ts`
- Created `lib/queue/connection.ts`
- Created `lib/queue/queues.ts`
- Created `lib/queue/producer.ts`
- Created `lib/queue/event-mapper.ts`
- Added worker entrypoints:
  - `workers/queue-shadow-worker.ts`
  - `workers/outbox-dispatcher.ts`
- Added npm scripts in `package.json`:
  - `worker:queue-shadow`
  - `worker:outbox-dispatcher`

Integration points:
- `lib/inngest/publish.ts` now supports queue shadow publishing path.

⚠️ Risks
- Queue config missing (`REDIS_URL`) results in no queue write.

✅ Validation checks
- `npm run test:migration`
- Confirm logs include shadow worker startup.

### STEP 2
🎯 Goal
- Run old path as source-of-truth and queue path in shadow mode.

🔧 Code changes
- `lib/inngest/publish.ts`:
  - Mirrors eligible events to queue outbox when `FEATURE_QUEUE_EXECUTION_SHADOW=true`
  - Keeps legacy dispatch active by default.
- `lib/migration/strangler-router.ts` defines mode selection.

Integration points:
- Existing APIs calling `publishInngestEvent` automatically dual-write in shadow mode.

⚠️ Risks
- Event mapping coverage gaps.

✅ Validation checks
- Outbox rows are created for mapped events.
- Legacy responses remain unchanged.

### STEP 3
🎯 Goal
- Add task state machine and outbox/idempotency schema in shadow write mode.

🔧 Code changes
- Additive Prisma models + enums:
  - `IdempotencyKey`
  - `ExecutionOutboxEvent`
  - `TaskExecutionState`
  - `TaskExecutionAttempt`
  - `ToolExecutionReceipt`
  - `DeadLetterEvent`
- Files:
  - `prisma/schema.prisma`
  - `prisma/migrations/20260317130500_execution_migration_scaffold/migration.sql`
- Added shadow state writer:
  - `lib/migration/task-state-machine-shadow.ts`
- Hooked shadow writes in:
  - `app/api/inngest/route.ts` (best-effort, non-blocking)

Integration points:
- Legacy event handling unchanged; shadow table writes are side-channel only.

⚠️ Risks
- Unmapped events do not populate shadow state.

✅ Validation checks
- Verify `TaskExecutionState` rows appear for resumed/completed/failed events.
- No change in existing `Task.status` read paths.

### STEP 4
🎯 Goal
- Introduce `MemoryService` in adapter mode.

🔧 Code changes
- Created:
  - `lib/memory/memory-service.ts` (unified interface)
  - `lib/memory/legacy-memory-service.ts` (adapter over current memory stack)
  - `lib/memory/index.ts`
- Integrated into retrieval entrypoint:
  - `lib/agent/orchestration/rag-retriever.ts` gated by `USE_NEW_MEMORY_SERVICE`

Integration points:
- Existing memory behavior remains default until flag enabled.

⚠️ Risks
- Retrieval ranking differences when flag flips.

✅ Validation checks
- Compare response quality and latency with flag off/on in staging.

### STEP 5
🎯 Goal
- Add Agent Registry and capability checks with soft enforcement.

🔧 Code changes
- Created:
  - `lib/agents/types.ts`
  - `lib/agents/registry.ts`
  - `lib/agents/capability-guard.ts`
- Capability violations are logged via policy logs in gateway path.

Integration points:
- Activated only when `USE_AGENT_REGISTRY=true`.

⚠️ Risks
- Legacy agents may have incomplete metadata/capabilities.

✅ Validation checks
- Verify warnings are logged but requests still pass when enforce=false.

### STEP 6
🎯 Goal
- Introduce Tool Gateway in audit mode (receipts + policy logging).

🔧 Code changes
- Created `lib/tools/tool-gateway.ts`
- Modified `app/api/agent/tools/execute/route.ts` to use gateway when `USE_TOOL_GATEWAY=true`
- Added receipt persistence in `ToolExecutionReceipt` table.

Integration points:
- Route keeps legacy response structure (`ok`, `result`, `error`, `attempts`), adds optional `receiptId`.

⚠️ Risks
- Missing org membership or strict enforcement can block calls if toggled.

✅ Validation checks
- Audit mode (`FEATURE_TOOL_GATEWAY_ENFORCE=false`) should not change success rate.
- Receipt rows created for every tool call through gateway.

### STEP 7
🎯 Goal
- Switch execution toward queue safely.

🔧 Code changes
- Controlled by:
  - `USE_QUEUE_EXECUTION`
  - `FEATURE_QUEUE_EXECUTION_CANARY_PERCENT`
  - `FEATURE_DISABLE_LEGACY_INNGEST_DISPATCH`
- Current safety behavior: legacy dispatch remains enabled unless explicitly disabled.

Integration points:
- `lib/inngest/publish.ts` contains fallback-to-legacy valve.

⚠️ Risks
- Full cutover before consumers are parity-complete can lose behavior.

✅ Validation checks
- Only disable legacy dispatch after queue workers are functionally equivalent.

### STEP 8
🎯 Goal
- Remove monolith pieces gradually after parity evidence.

🔧 Code changes
- Delete in slices:
  - direct local kick paths
  - inline orchestration branches in `app/api/inngest/route.ts`
  - duplicated memory/task tracking code

Integration points:
- Remove only code paths proven redundant by shadow/canary metrics.

⚠️ Risks
- Premature deletion can remove edge-case handling.

✅ Validation checks
- 7-day parity dashboard clean before each deletion batch.

## 4) Backward Compatibility

- API responses stay backward compatible:
  - Existing shape preserved.
  - New fields are additive (e.g. optional `receiptId`).
- Legacy handlers remain active by default:
  - queue path is additive unless explicit hard cutover flag is set.
- DB migrations are additive:
  - no rename/drop of old tables or old columns.

## 5) Data Migration Plan

1. Apply additive migration only.
2. Begin shadow writes:
   - task state shadow tables
   - tool execution receipts
   - outbox rows
3. Backfill (batch jobs):
   - seed `TaskExecutionState` from current `Task`
   - optional historical receipt backfill from logs
4. Versioned reads:
   - old reads remain default
   - new reads gated by feature flags

## 6) Testing Strategy

Unit tests:
- `tests/migration.event-mapper.test.ts`
- `tests/agent.capability-guard.test.ts`

Run:
```bash
npm run test:migration
```

Integration tests (next stage):
- outbox dispatcher -> queue publish
- gateway audit mode tool execution receipts
- shadow state write under concurrent events

Failure injection (staging):
- Redis unavailable
- DB transient failure
- worker crash during outbox dispatch
- tool execution timeout

## 7) Rollout Plan

1. Local dev:
   - migrate DB
   - run `worker:outbox-dispatcher` + `worker:queue-shadow`
2. Staging shadow:
   - `FEATURE_QUEUE_EXECUTION_SHADOW=true`
   - `USE_TASK_STATE_MACHINE=true`
   - `USE_TOOL_GATEWAY=true` + enforce=false
3. Canary:
   - `USE_QUEUE_EXECUTION=true`
   - `FEATURE_QUEUE_EXECUTION_CANARY_PERCENT=5`
   - keep legacy dispatch enabled
4. Ramp:
   - 5% -> 25% -> 50% -> 100%
5. Full cutover:
   - after parity/SLO pass, set `FEATURE_DISABLE_LEGACY_INNGEST_DISPATCH=true`

## 8) Failure Safety

Instant rollback:
- Flip feature flags to `false`.
- Keep legacy dispatch enabled for immediate continuity.

Queue drain strategy:
- Stop new enqueue flags.
- Continue outbox dispatcher until pending reaches zero.
- Pause worker consumers if needed.

Data consistency:
- Idempotency keys prevent duplicate mutation intents.
- Outbox event keys dedupe queue dispatch.
- Task shadow writes are version-checked and isolated from legacy source-of-truth.
