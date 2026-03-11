# Optimization Audit And Refactor Report

## 1) Current Architecture Summary

This repository runs multi-agent workflows through:

- Flow launch + task decomposition: `app/api/flows/route.ts`
- Durable event-driven orchestration: `app/api/inngest/route.ts`
- LLM runtime/provider abstraction: `lib/ai/swarm-runtime.ts`
- Context assembly: `lib/agent/orchestration/context-compiler.ts`
- Gmail workflow endpoint: `app/api/agent/run/route.ts` + `lib/agent/run/engine.ts`
- Tool execution gateway: `app/api/agent/tools/execute/route.ts` + `lib/agent/tools/execute.ts`
- Direction chat/plan control routes:
  - `app/api/control/direction-chat/route.ts`
  - `app/api/control/direction-plan/route.ts`
- Scheduler-triggered flow launch:
  - `app/api/schedules/tick/route.ts`
  - `lib/schedule/mission-runner.ts`

The original high burn came from large context packs, verbose prompt wrappers, and fallback LLM router/model hops on workflows that can be deterministic.

---

## 2) Workflow Execution Maps + Token Burn Maps

## Greeting / Direction Chat

- Step name: Greeting short-circuit
  - File/function: `app/api/control/direction-chat/route.ts` -> POST -> greeting branch
  - Why it exists: Skip model call for trivial greetings
  - Model used: None
  - Approx input tokens: 0
  - Approx output tokens: 0
  - Could this be code instead of LLM?: Yes
  - Recommendation: Keep (now strengthened with shared deterministic helper)

- Step name: Direction chat response
  - File/function: `app/api/control/direction-chat/route.ts` -> `executeSwarmAgent`
  - Why it exists: Organization-facing conversational response + optional direction candidate
  - Model used: Org-selected model via swarm runtime
  - Approx input tokens before: 900-1800
  - Approx input tokens after: 450-900
  - Approx output tokens before: up to ~420
  - Approx output tokens after: up to ~260
  - Could this be code instead of LLM?: Usually no
  - Recommendation: Keep, but with thinner prompt/context (implemented)

## Direction Plan

- Step name: Plan generation
  - File/function: `app/api/control/direction-plan/route.ts` -> `executeSwarmAgent`
  - Why it exists: Build structured execution plans + permission hints
  - Model used: Org-selected model via swarm runtime
  - Approx input tokens before: 1400-2600
  - Approx input tokens after: 700-1300
  - Approx output tokens before: up to ~680
  - Approx output tokens after: up to ~480
  - Could this be code instead of LLM?: Partially, but core planning remains LLM
  - Recommendation: Keep single-call planning, compress schema instructions/context (implemented)

## Mission Launch

- Step name: Flow decomposition + task creation
  - File/function: `app/api/flows/route.ts` -> POST -> `buildTaskPlan`
  - Why it exists: Turn mission prompt into task list + assign agents/toolkits
  - Model used: None (deterministic code)
  - Approx input/output tokens: 0
  - Could this be code instead of LLM?: Yes (already)
  - Recommendation: Keep deterministic

- Step name: Event emission / kickoff
  - File/function: `app/api/flows/route.ts` -> publish Inngest + local `/api/inngest` kick
  - Why it exists: Durable async execution
  - Model used: None
  - Recommendation: Keep (event ownership split remains a cleanup candidate)

## Meeting Scheduling

- Step name: Tool routing
  - File/function: `app/api/inngest/route.ts` -> `inferAgentToolAction`
  - Why it exists: Map task prompt to toolkit action
  - Model used before: Heuristic + optional LLM fallback
  - Model used after: Heuristic + deterministic bypass for common toolkits; filtered catalog LLM fallback only when needed
  - Approx input tokens before: 0 (heuristic) or 250-700 (LLM router)
  - Approx input tokens after: 0 for common meeting/email paths; lower fallback when used
  - Could this be code instead of LLM?: Yes for common meeting intents
  - Recommendation: Keep deterministic-first, LLM as narrowed fallback (implemented)

- Step name: Meeting tool execution
  - File/function: `app/api/inngest/route.ts` -> `/api/agent/tools/execute`
  - Why it exists: Execute external action
  - Model used: None
  - Recommendation: Keep deterministic

- Step name: Final response synthesis
  - File/function: `app/api/inngest/route.ts` -> deterministic summary or `executeSwarmAgent`
  - Why it exists: User-facing completion text
  - Model used before: Often still LLM with large context
  - Model used after: deterministic short-circuit for common meeting/email tool outcomes
  - Approx tokens before: 800-2500
  - Approx tokens after: 0 in deterministic short-circuit; otherwise significantly lower from slim context/prompt
  - Could this be code instead of LLM?: Yes for standard tool outcomes
  - Recommendation: Keep deterministic short-circuit path (implemented/expanded)

## Meeting Details Sharing

- Step name: Follow-up email decision + template payload
  - File/function: `app/api/inngest/route.ts` + `lib/agent/orchestration/meeting-workflow.ts`
  - Why it exists: Send meeting details via Gmail after meeting creation
  - Model used: None
  - Approx input/output tokens: 0
  - Could this be code instead of LLM?: Yes
  - Recommendation: Keep deterministic template (implemented with reusable parser/template utility)

## Gmail Send/Search/Read/Summarize

- Step name: Planner
  - File/function: `app/api/agent/run/route.ts` -> `runJsonTask("planner")` + `lib/agent/run/engine.ts`
  - Why it exists: Intent planning when deterministic planner is unknown
  - Model used before: Enabled by default when fallback intent unknown
  - Model used after: Disabled by default (`AGENT_RUN_ENABLE_LLM_PLANNER=false`)
  - Approx input tokens before: 180-600 when invoked
  - Approx input tokens after: 0 for default path
  - Could this be code instead of LLM?: Yes for most Gmail intents
  - Recommendation: Deterministic-first (implemented)

- Step name: Writer
  - File/function: `app/api/agent/run/route.ts` -> `runJsonTask("writer")` + engine fallback
  - Why it exists: Draft generation
  - Model used: Optional; deterministic fallback available
  - Recommendation: Keep off by default, deterministic templates for common cases (implemented)

- Step name: Gmail action
  - File/function: `lib/agent/run/engine.ts` -> `executeGmailAction` -> tool executor
  - Why it exists: Actual Gmail operation
  - Model used: None
  - Recommendation: Keep deterministic

## Scheduler-triggered Flow Execution

- Step name: due schedule fetch + launch
  - File/function: `app/api/schedules/tick/route.ts` + `lib/schedule/mission-runner.ts`
  - Why it exists: Trigger flow launch on cadence
  - Model used: None
  - Recommendation: Keep deterministic

---

## 3) Root Causes Identified

### A. Prompt inflation
- Runtime system prompts contained repeated identity/philosophy boilerplate.
- Direction plan prompt embedded very long schema scaffolding text.
- Time-awareness block was always injected even when not needed.

### B. Context inflation
- Context compiler included broad organization, company, direction, memory, DNA, and prior run payloads by default.
- No hard token-budget-aware section selector.
- Tool result context could include oversized payload structures.

### C. Agent inflation
- Tool router could invoke an LLM fallback even on common deterministic meeting/email intents.
- Gmail planner LLM path was default-enabled for unknown fallback cases.

### D. Runtime inefficiency
- No prompt token estimation/trimming before provider dispatch in swarm runtime.
- Concurrency guard for LLM calls was not centralized at runtime layer.
- Per-task token telemetry lacked standardized workflow-step breakdown in orchestration path.

### E. Data/state inefficiency
- Cross-step data handoff relied heavily on unstructured text/trace fields.
- No normalized tool result state shape alongside raw output in orchestration trace.

---

## 4) Target Architecture Implemented

Applied principle: **State owns truth; agents read/write structured fields.**

Implemented:

- Structured context selection trace with included/omitted section reasons and token estimates.
- Structured workflow state payload in task execution trace:
  - `tool_results_raw`
  - `tool_results_normalized`
  - `workflowState` with request/context/entities/decisions/final output preview
- Deterministic meeting parser + deterministic meeting details email templates.
- Deterministic-first tool routing bypass + reduced LLM router catalog scope.

---

## 5) Exact Files Changed (This Refactor)

- `lib/agent/orchestration/context-compiler.ts`
- `lib/agent/orchestration/context-budget.ts` (new)
- `lib/agent/orchestration/types.ts`
- `lib/ai/swarm-runtime.ts`
- `app/api/inngest/route.ts`
- `lib/agent/orchestration/tool-router.ts` (new)
- `lib/agent/orchestration/meeting-workflow.ts` (new)
- `lib/direction/chat-routing.ts` (new)
- `app/api/control/direction-chat/route.ts`
- `app/api/control/direction-plan/route.ts`
- `lib/agent/run/engine.ts`
- `app/api/agent/run/route.ts`
- `tests/context-budget.test.ts` (new)
- `tests/direction.chat.greeting.test.ts` (new)
- `tests/meeting.workflow.test.ts` (new)
- `tests/tool-router.test.ts` (new)

Note: Repository already had unrelated local modifications in other files before/alongside this work; they were not reverted.

---

## 6) What Changed Per File

### `lib/agent/orchestration/context-compiler.ts`
- Reworked context assembly to priority-tier candidate selection.
- Enforced hard token budget + per-section cap.
- Added omission reasoning + token usage instrumentation via `selectionTrace`.
- Reduced default retrieval/context breadth and oversized payload inclusion.

### `lib/agent/orchestration/context-budget.ts` (new)
- Added reusable deterministic context budget selector:
  - token estimation
  - priority sort
  - truncation + omission reasons

### `lib/agent/orchestration/types.ts`
- Extended `AgentContextPack` with optional `selectionTrace`.

### `lib/ai/swarm-runtime.ts`
- Added concise-mode prompt composition by default.
- Added conditional time-awareness injection (instead of always-on).
- Added prompt budget estimation/trimming before model dispatch.
- Added process-local LLM concurrency guard.
- Added richer trace metadata: estimated prompt tokens, time-awareness flag, output cap.

### `app/api/inngest/route.ts`
- Integrated deterministic meeting/email utilities.
- Added deterministic router human-input checks for missing send fields.
- Added deterministic bypass for common toolkit intents (LLM router fallback reduced).
- Filtered/truncated action catalog before any LLM router call.
- Reduced tool binding/result context payload size.
- Added normalized tool result context for downstream model calls.
- Added structured workflow state (`workflowState`) and per-step workflow telemetry.
- Added internal fetch timeout wrapper for tool execution calls.

### `lib/agent/orchestration/tool-router.ts` (new)
- Added pure deterministic router helpers:
  - LLM bypass decision
  - missing-field human-input detection
  - relevance-based catalog filtering

### `lib/agent/orchestration/meeting-workflow.ts` (new)
- Added deterministic meeting intent parser.
- Added deterministic meeting details email template generator.

### `lib/direction/chat-routing.ts` (new)
- Added deterministic greeting detector utility.

### `app/api/control/direction-chat/route.ts`
- Reduced history/context window sizes and output token cap.
- Shortened system/user prompt scaffolding.
- Switched greeting check to shared deterministic helper.

### `app/api/control/direction-plan/route.ts`
- Reduced history/context window sizes and output token cap.
- Compressed verbose JSON instruction scaffolding.
- Reduced personnel context footprint.

### `lib/agent/run/engine.ts`
- Set planner LLM fallback default to off (`false`).
- Added non-Gmail fast-fail guard to avoid irrelevant planner calls.
- Improved deterministic fallback template for meeting-detail email drafts.

### `app/api/agent/run/route.ts`
- Standardized per-stage telemetry with:
  - `workflow_id`
  - `retry_count`
  - `fallback_count`
  - per-step `fallback_used`
- Logged richer metrics summary.

### Tests Added
- `tests/direction.chat.greeting.test.ts`
- `tests/meeting.workflow.test.ts`
- `tests/context-budget.test.ts`
- `tests/tool-router.test.ts`

---

## 7) Before/After Workflow Diagrams

### Direction Chat

Before:
`request -> select context -> big prompt -> LLM -> infer routing`

After:
`request -> deterministic greeting check -> (if greeting: return) else select thinner context -> concise prompt -> LLM -> infer routing`

### Direction Plan

Before:
`request -> large history + company + personnel + verbose JSON schema prompt -> LLM`

After:
`request -> slim history/context/personnel -> compact JSON contract prompt -> LLM`

### Meeting Scheduling / Share

Before:
`task -> heuristic router -> possible LLM router -> tool execute -> often LLM response synthesis`

After:
`task -> deterministic-first router (bypass common toolkit LLM) -> tool execute -> deterministic summary when possible -> optional LLM only when needed`

### Gmail Run

Before:
`prompt -> deterministic planner fallback -> if unknown then planner LLM -> optional writer LLM -> tool execute`

After:
`prompt -> deterministic planner -> deterministic writer/template by default -> tool execute`

---

## 8) Before/After Comparison Table

| Workflow | LLM Calls Before | LLM Calls After | Approx Tokens Before | Approx Tokens After | Major Reason |
|---|---:|---:|---:|---:|---|
| Direction chat greeting | 0 | 0 | 0 | 0 | Deterministic greeting path retained and hardened |
| Direction plan | 1 | 1 | ~2200-3300 | ~1200-1800 | Prompt/context compression + lower output cap |
| Meeting scheduling | 1-2 | 0-1 | ~2500-8000 | ~900-2200 | Deterministic tool routing/summary + thin context |
| Meeting scheduling + email details | 1-3 | 0-1 | ~3500-9000 | ~1000-2200 | Deterministic meeting parser + email template + short-circuit |
| Gmail send flow | 1-2 | 0-1 | ~600-2000 | ~150-900 | Planner LLM default-off + deterministic drafting |
| Mission/task execution | 1-2 (+router fallback) | 1 (often) | ~8000 typical observed | ~1500-3200 typical target path | Context budgeting + prompt trimming + router bypass |

---

## 9) Expected Token Savings by Workflow

- Mission/task execution path: ~50-80% depending on context density and tool path.
- Meeting + follow-up email path: often ~70-95% when deterministic short-circuit applies.
- Gmail send/search/read/summarize: ~40-90% depending on whether planner/writer LLM was previously invoked.
- Direction plan/chat: ~25-50% from prompt/context compression.

Meeting/email standard workflows are now designed to fall under ~2000 tokens in common deterministic paths; complex multi-context missions can still exceed this and are listed under remaining bottlenecks.

---

## 10) Remaining Risks / Bottlenecks

- Process-local concurrency/rate limits are still not distributed across multi-instance deployments.
- Inngest event ownership still split between:
  - `/api/inngest/serve` (Inngest functions)
  - `/api/inngest` (custom internal orchestrator endpoint)
- Memory model still uses broad `MemoryEntry` with mixed domains; deeper typed segmentation would reduce retrieval ambiguity further.
- Complex direction planning can still be expensive for large context-heavy org data.

---

## 11) Recommended Next Steps

1. Add distributed concurrency/rate controls (Redis or queue-level) for LLM paths.
2. Consolidate or explicitly partition Inngest ownership between `/serve` and internal `/route`.
3. Introduce typed memory-domain fields (or typed wrapper tables) to reduce mixed retrieval noise.
4. Add runtime dashboards over new `workflowTelemetry` for continuous token budget enforcement.
5. Optionally lower global default output caps further for ECO mode.

---

## 12) Verification

Typecheck:

- `npx tsc --noEmit --pretty false` -> passed

Tests run:

- `node --test --test-isolation=none --experimental-strip-types tests/agent.run.engine.test.ts tests/direction.chat.greeting.test.ts tests/meeting.workflow.test.ts tests/context-budget.test.ts tests/tool-router.test.ts` -> passed

