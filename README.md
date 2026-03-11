# VorldX Human Touch

VorldX Human Touch is a Next.js 14 app for organization-scoped agent operations:
flows, tasks, integrations, memory, storage, settings, and real-time updates.

## Tech stack

- Next.js 14 (App Router, TypeScript)
- Prisma + PostgreSQL
- Redis
- Inngest (durable event workflows)
- Socket.io realtime server (`realtime/server.js`)

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Copy env template and fill required values:

```bash
cp .env.example .env
```

3. Start infra (Postgres + Redis) with Docker:

```bash
docker compose up -d
```

4. Generate Prisma client and apply schema:

```bash
npm run prisma:generate
npm run prisma:push
```

5. Start app and realtime server (separate terminals):

```bash
npm run dev
npm run realtime
```

App runs on `http://localhost:3000` by default.

On Windows workspaces inside OneDrive, `npm run dev` automatically maps Next.js cache
(`.next-local-cache`) to an external junction target to reduce `EBUSY` file-lock errors.
You can override the target base folder with `NEXT_WINDOWS_CACHE_BASE_DIR`.

## Required env variables

At minimum set these for a safe local/dev run:

- `DATABASE_URL`
- `REDIS_URL`
- `ENCRYPTION_MASTER_KEY`
- `SOVEREIGN_ID_PEPPER`
- `SESSION_SECRET`
- `INTERNAL_API_KEY`
- `INNGEST_EVENT_KEY`
- `INNGEST_SIGNING_KEY`
- `REALTIME_SERVER_URL`
- `REALTIME_EMIT_TOKEN`

Optional for auth UX in dev:

- `DEV_AUTH_STATIC_OTP` (if set, login OTP must match this exact value)

Optional for integrations:

- `FEATURE_COMPOSIO_INTEGRATIONS`
- `COMPOSIO_API_KEY`
- `COMPOSIO_OAUTH_CALLBACK_URL`
- `COMPOSIO_OAUTH_STATE_SECRET`

Optional for storage safety:

- `HUB_UPLOAD_MAX_BYTES` (defaults to `15728640`, i.e. 15 MB)

Optional for Windows + OneDrive dev stability:

- `NEXT_WINDOWS_CACHE_BASE_DIR` (base folder for external Next.js cache target)

## Auth and authorization model

- API auth is enforced by `middleware.ts` for `/api/*`.
- Session cookie: `ht_session` (httpOnly, signed).
- Middleware injects `x-user-id` and `x-user-email` to downstream routes.
- Internal server-to-server API calls must send `x-internal-api-key`.
- Organization-scoped routes validate membership via `requireOrgAccess`.

## Scripts

- `npm run dev` - start Next.js dev server
- `npm run realtime` - start realtime socket server
- `npm run lint` - lint checks
- `npm run typecheck` - TypeScript check
- `npm run test:agent-run` - agent-run unit tests
- `npm run test:agent-memory` - long-term memory scoring/ranking tests
- `npm run test:composio:unit` - Composio service unit tests
- `npm run test:composio:api` - Composio smoke tests

## Database migrations

Prisma schema lives in `prisma/schema.prisma`.
Migrations are tracked under `prisma/migrations`.

Create a new migration:

```bash
npx prisma migrate dev --name <migration_name>
```

Apply existing migrations:

```bash
npx prisma migrate deploy
```

## Agent Memory (RAG)

### Architecture

- `Working memory`: short-lived task/session signals (`memoryType=WORKING`)
- `Episodic memory`: decisions, tool outcomes, final outputs (`memoryType=EPISODIC`)
- `Semantic memory`: stable facts/preferences and compacted session summaries (`memoryType=SEMANTIC`)
- `Task memory`: plan/task-specific state (`memoryType=TASK`)

Implementation is modular under `lib/agent/memory`:

- `store.ts`: pluggable memory interface (`upsertMemory`, `searchMemory`, `getRecentMemory`, `summarizeAndArchive`, `deleteMemory`, `consolidateMemory`)
- `vector-backend.ts`: vector adapter (current backend: pgvector)
- `embeddings.ts`: embedding provider adapter (OpenAI or deterministic fallback)
- `scoring.ts` + `ranking.ts`: ingestion heuristic, dedupe, similarity/recency/importance reranking

### Storage model

- Persistent records are in the `AgentMemory` table (Postgres + pgvector).
- Each record includes: `id`, `userId`, `agentId`, `sessionId`, `projectId`, `content`, `summary`, `embedding`, `memoryType`, `tags`, `source`, `timestamp`, `importance`, `recency`, and `metadata`.
- `visibility` supports private-per-agent memory and shared team memory.

### Retrieval flow

1. Embed the current query.
2. Retrieve candidate memories by vector similarity.
3. Re-rank with weighted blend: `similarity + recency + importance`.
4. Deduplicate near-identical memories.
5. Inject only top memory snippets into orchestration context (token/char budgeted).
6. Fallback to legacy `MemoryEntry` retrieval when needed.

### Local run

1. Apply migration:
```bash
npx prisma migrate dev --name agent_memory_rag
```
2. Ensure env flags are set (`FEATURE_AGENT_LONG_TERM_MEMORY=true` and `AGENT_MEMORY_*` vars in `.env.example`).
3. Regenerate Prisma client:
```bash
npx prisma generate
```
4. Run tests:
```bash
npm run test:agent-memory
```

## Operational notes

- Local file uploads are stored in `public/uploads/<orgId>/`.
- Only normalized `/uploads/...` URLs are treated as local files.
- Do not commit real API keys or secrets to `.env.example`.
