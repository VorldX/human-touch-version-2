# Token Optimization Report (Meeting + Email Workflows)

## Current architecture (before refactor)
- API entrypoints: `app/api/flows/route.ts` and `app/api/inngest/route.ts`
- Tool routing path:
  1. Heuristic routing attempt (`inferAgentToolActionHeuristic`)
  2. LLM router fallback (`inferAgentToolAction` -> `executeSwarmAgent`)
  3. Tool execution (`/api/agent/tools/execute`)
  4. Final LLM response generation (`executeSwarmAgent`)
- Gmail-focused path:
  1. Planner LLM call (`app/api/agent/run/route.ts`)
  2. Writer LLM call (`app/api/agent/run/route.ts`)
  3. Gmail tool call

## Root causes of token burn
- LLM planner called even when intent is deterministic.
- LLM writer called for drafts that can be generated in code.
- Email summarization always used LLM in tool executor.
- Tool router LLM fallback had verbose prompt/catalog payload.
- Even after successful tool execution, final response still triggered another LLM call.
- Missing per-workflow call-level telemetry in `agent/run` path made waste hard to track.

## Implemented architecture changes
- Deterministic-first planner in `lib/agent/run/engine.ts`; LLM planner now only fallback for unknown intent.
- LLM writer disabled by default (`AGENT_RUN_ENABLE_LLM_WRITER=false`); deterministic draft/reply fallback used first.
- Email summarization now deterministic by default in `lib/agent/tools/execute.ts`; LLM summary is opt-in (`AGENT_TOOL_SUMMARY_USE_LLM=true`).
- Tool router prompt compressed + max output token cap (`TOOL_ROUTER_MAX_OUTPUT_TOKENS`).
- Tool router now emits token/cost/latency metrics in trace/log.
- Added deterministic short-circuit in `app/api/inngest/route.ts`:
  - If tool output already answers the user (meeting created, participants found, email sent), skip final LLM call entirely.
- Added `agent/run` safety guards:
  - timeout
  - per-actor concurrency cap
  - per-actor rate limiting
  - max output token caps for planner/writer
- Added `agent/run` observability:
  - per-step tokens, latency, cost, retries
  - per-workflow token burn map in response + log summary

## Token burn map (main workflows, estimated)

### Before (typical meeting setup path)
| Agent/Step | Model | Input tokens | Output tokens | Tools passed | Purpose |
|---|---:|---:|---:|---:|---|
| Tool Router | Gemini/OpenAI/Anthropic | 1200-2200 | 120-220 | 30-40 catalog entries | Infer tool action |
| Main Runtime Response | Gemini/OpenAI/Anthropic | 3500-5200 | 350-700 | tool result context + files | Compose final response |
| Optional follow-up formatting | LLM | 300-800 | 100-250 | n/a | Reformat/confirm text |
| **Total** |  | **~5000-8200** |  |  |  |

### After (current refactor)
| Agent/Step | Model | Input tokens | Output tokens | Tools passed | Purpose |
|---|---:|---:|---:|---:|---|
| Heuristic router | none | 0 | 0 | n/a | Deterministic route selection |
| Tool execution | none | 0 | 0 | 1 | Execute meeting/email action |
| Deterministic response | none | 0 | 0 | n/a | Final user response from tool result |
| LLM router fallback (only when needed) | Gemini/OpenAI/Anthropic | 350-1200 | 60-140 | capped catalog | Edge routing |
| **Total (common case)** |  | **0-1200** |  |  |  |

## Before/after table for main workflows (estimated)
| Workflow | Before total tokens | After total tokens | Expected reduction |
|---|---:|---:|---:|
| Setup meeting (+ share details) | ~6000-8000 | ~500-1800 | ~70-92% |
| Find participants | ~4500-7000 | ~400-1500 | ~67-91% |
| Generate/share meeting details + confirmation email | ~5500-8000 | ~600-1800 | ~67-89% |
| Gmail summarize/search/send in `/api/agent/run` | ~1800-3800 | ~300-1400 | ~50-83% |

## Follow-up improvements
1. Persist workflow-level metrics in a dedicated table (not only logs/trace) for dashboards and alerting.
2. Add short-lived cache for tool binding catalogs per org to reduce repeated payload/token overhead.
3. Add deterministic argument normalizers for top 10 high-volume actions to avoid LLM router fallback even more.
4. Add adaptive history/context budgeting by execution mode (`ECO/BALANCED/TURBO`) before any LLM call.
5. Introduce provider-level circuit breaker and automatic “deterministic-only” degraded mode during outages.
