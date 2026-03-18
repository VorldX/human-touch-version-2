# vorldX DNA Memory Engine - Phase 1 Foundation

## Baseline (before this change)
- DNA profiles were persisted as JSON blobs in `MemoryEntry` (`tier = ORG`) with no strict schema versioning.
- `AgentMemory` used `vector(1536)` but was not partitioned by tenant/user pair.
- No dedicated RLS policies for a central DNA memory table.
- No OCC version field enforcement for memory writes.
- No dedicated relational graph tables (`nodes`, `edges`) for GraphRAG traversal.

## Phase 1 delivered in this repository
- Added dedicated Phase 1 storage schema in Postgres: `dna_memory`.
- Added partitioned central vector memory table: `dna_memory.central_memory`.
  - Partition key: `LIST (tenant_id, user_id)`.
  - Embedding shape: `vector(512)` for RAM-efficient vector footprint.
  - Mandatory metadata columns: `document_id`, `chunk_index`, `token_count`.
  - Includes `schema_version` + `version` for OCC.
- Added relational graph tables:
  - `dna_memory.nodes (id, label, properties_jsonb, tenant_id, user_id, schema_version, version, ...)`
  - `dna_memory.edges (source_id, target_id, relationship_type, weight, tenant_id, user_id, schema_version, version, ...)`
- Added RLS policies (tenant/user strict isolation) for central memory, nodes, and edges.
- Added helper functions:
  - `dna_memory.ensure_partition_for_subject(...)`
  - `dna_memory.update_central_memory_occ(...)`
  - `dna_memory.traverse_graph(...)` (recursive CTE graph walk)
  - `dna_memory.set_rls_context(...)`
- Added strand views:
  - `long_term_strand`, `archive_strand`, `staging_strand`
  - `contextual_memory`, `working_memory`

## Pydantic v2 contracts
- Added Phase 1 models with `schema_version` + OCC fields in:
  - `memory_engine/phase1/pydantic_models.py`
- Core models:
  - `CentralMemoryChunkPayload`
  - `GraphNodePayload`
  - `GraphEdgePayload`
  - `OCCUpdateResult`

## Frontend observability (embedded in Memory section)
- Added API status endpoint:
  - `GET /api/dna/memory/phase1?orgId=...`
- Added Zustand-backed observability panel:
  - `components/hub/dna-phase1-foundation-panel.tsx`
  - `lib/store/dna-phase1-memory-store.ts`
- Embedded panel inside existing DNA Memory UI:
  - `components/hub/dna-memory-panel.tsx`

## Migration file
- `prisma/migrations/20260316162000_dna_memory_phase1_foundation/migration.sql`
