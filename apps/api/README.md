# apps/api

The BIRQ API: NestJS on the Fastify adapter. One codebase, two entrypoints:
`main.ts` serves HTTP and `worker.ts` runs background jobs against the same modules.
It deploys on its own, as a container built from [Dockerfile](Dockerfile), independently
of the web app.

## What exists at this checkpoint (Phase 1, step 1)

- Validated environment (`src/config/env.ts`): the process refuses to boot on a missing
  or malformed value, and the error names the variable without printing its value.
- Structured JSON logging (pino) with a correlation id on every line, header and query
  string redaction, and a `[REDACTED]` allowlist for sensitive keys.
- One error envelope for every failure (`@abay/contracts` `ApiError`), stable
  machine-readable codes, and no 5xx message ever leaves the server.
- `/health` (liveness) and `/ready` (readiness: PostgreSQL and Redis, each ok or failed,
  503 if either fails, no internals exposed).
- Helmet headers, an exact-origin CORS allowlist from config, `cache-control: no-store`
  on everything, a 1 MB body limit, sanitised request ids.
- Graceful shutdown: drains in-flight requests for `SHUTDOWN_TIMEOUT_MS`, then exits.

Nothing here touches money, a blockchain or a custody provider. Auth arrives in step 2.

## Layout

```
src/
  main.ts / worker.ts     entrypoints; both load and validate the environment first
  app.ts                  createApp(): the whole request pipeline, used by main and tests
  app.module.ts           HTTP module tree; worker.module.ts is the same minus HTTP
  config/                 env schema + the ENV injection token
  common/
    logging/              pino configuration and the redaction paths
    errors/               AppError, the pure error mapping, the global filter
    validation/           ZodValidationPipe (zodBody(schema) at each handler)
    request-id.ts         accept a safe client id or mint a UUIDv7
  infra/
    prisma/               the process's PrismaClient (least-privilege role)
    redis/                the process's ioredis client (fail fast, never a source of truth)
  modules/
    health/               /health and /ready
test/
  api/                    Supertest against the booted app, real PostgreSQL and Redis
  unit/                   (none yet; unit specs sit beside their source as *.spec.ts)
```

## Running locally

Requires Docker for PostgreSQL and Redis.

```bash
cp .env.example .env            # from the repository root; the values match docker-compose
docker compose up -d
npm run build -w @abay/contracts -w @abay/database
npm run dev -w api               # http://127.0.0.1:3001/health
```

## Checks

```bash
npm run lint -w api
npm run typecheck -w api
npm run test -w api              # unit only, no infrastructure
npm run test:api -w api          # boots the app against PostgreSQL and Redis
npm run build -w api
docker build -f apps/api/Dockerfile -t birq-api .
```

CI runs all of the above with service containers on every pull request.

## Rules for this app

- Nothing reads `process.env` except `src/config/env.ts`.
- Every handler validates its input with `zodBody(schema)`; schemas live in
  `@abay/contracts`, never in the handler file.
- Every thrown error is an `AppError` with a stable code. Anything else is a bug and is
  reported as `INTERNAL` with a generic message.
- Only the ledger module will write money. Nothing else touches ledger tables (Phase 2).
- The runtime database role cannot change the schema. Migrations use `DIRECT_DATABASE_URL`.
