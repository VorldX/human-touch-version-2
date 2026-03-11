# LangGraph Organization Orchestration

## Purpose
- Additive LangGraph-style orchestration for Swarm team bootstrap and coordination.
- No rewrite of existing Swarm, tool execution, approval, RAG, Hub, or Squad systems.

## Entry Integration
- Control Deck route: `app/api/control/direction-chat/route.ts`
- New feature-gated hook: `lib/langgraph/swarm-organization-entry.ts`
- Behavior:
  - Feature flag off or non-team request: legacy Swarm path unchanged.
  - Feature flag on and team intent: execute organization graph path.

## Feature Flags
- `FEATURE_LANGGRAPH_ORGANIZATION_TEAMS`
- `FEATURE_LANGGRAPH_ORGANIZATION_ORG_ALLOWLIST`
- `FEATURE_LANGGRAPH_ORGANIZATION_USER_ALLOWLIST`

## Graph Modules
- `lib/langgraph/state.ts`
- `lib/langgraph/swarm-organization-graph.ts`
- `lib/langgraph/nodes/*`
- `lib/langgraph/subgraphs/*`
- `lib/langgraph/templates/*`
- `lib/langgraph/adapters/*`
- `lib/langgraph/utils/*`

## Existing Systems Preserved
- Tool execution remains via `executeAgentTool` (`lib/agent/tools/execute.ts`) through existing Composio path.
- Approval requests persist through `ApprovalCheckpoint` (existing approval system contracts).
- Memory retrieval uses existing `searchAgentMemory`.
- Hub collaboration uses existing Hub file model and `ensureCompanyDataFile`.
- Squad population uses existing `personnel` model and keeps manual workflows unchanged.

## Team Bootstrap Flow
1. Ingest + classify request
2. Load org/squad context + shared memory references
3. Generate validated team blueprint from template registry
4. Generate role prompts and tool profiles
5. Persist/reuse agents into Squad
6. Initialize/reuse Hub mission context
7. Assign initial tasks and run safe collaboration cycle
8. Create approval checkpoints for high-sensitivity actions
9. Return manager-style Swarm summary

## Safety Notes
- Retrieved memory is handled as reference context, not trusted policy.
- No new raw SQL introduced in LangGraph module.
- Tool and approval contracts are adapter-based, not bypassed.
- Legacy Swarm path remains default fallback.

## Next Hardening Steps
- Move graph runs to queue/worker jobs for long-running collaboration cycles.
- Add retry policies and DLQ semantics for tool/approval failures.
- Expand graph telemetry into centralized metrics dashboards.
