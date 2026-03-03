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

## Operational notes

- Local file uploads are stored in `public/uploads/<orgId>/`.
- Only normalized `/uploads/...` URLs are treated as local files.
- Do not commit real API keys or secrets to `.env.example`.
