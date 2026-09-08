# Abay (placeholder name)

A peer-to-peer marketplace for trading USDT against Ethiopian birr. Custodial, pooled
wallets; an immutable double-entry ledger; escrow as an internal ledger hold; the birr leg
settled out of band.

The durable project brief is [CLAUDE.md](CLAUDE.md). Architecture, threat model, ledger
design and the acceptance-test plan are under [docs/](docs/README.md).

## Status

| Phase                               | State                                      |
| ----------------------------------- | ------------------------------------------ |
| 0. Decisions and threat model       | Done, under review                         |
| 0.5 Landing page and monorepo shell | Done: landing, auth pages (preview), legal |
| 1. Foundation (API, database, auth) | **In progress**: step 1 of 3, API scaffold |
| 2. Ledger vertical slice            | Not started                                |
| 3. Mock wallet operations           | Not started                                |
| 4. P2P escrow                       | Not started                                |
| 5. UX hardening                     | Not started                                |
| 6. Real provider sandbox            | Not started; requires explicit approval    |

No real blockchain, custody or money behaviour exists in this repository. Everything about
the real chain route is marked UNVALIDATED in [docs/open-questions.md](docs/open-questions.md).

## Layout

npm workspaces with Turborepo.

```
apps/web            Next.js client (App Router, Tailwind v4)
apps/api            NestJS + Fastify API and workers; deploys on its own (apps/api/Dockerfile)
packages/contracts  Zod schemas for everything that crosses the API boundary. No DB types.
packages/database   Prisma schema, migrations, hand-written SQL (roles, later triggers)
packages/config     Shared TypeScript configuration
docs/               Architecture, threat model, testing, open questions
scripts/            Repository utilities (dependency pinning)
docker-compose.yml  Local PostgreSQL and Redis with least-privilege roles
```

## Running locally

Requires Node 24 (`.nvmrc`) and npm 10 or later.

```bash
npm install
cp .env.example .env        # placeholder values that match docker-compose.yml
docker compose up -d        # PostgreSQL 17 + Redis 7, bound to 127.0.0.1
npm run dev
```

Then open http://localhost:3000 (web) and http://127.0.0.1:3001/health (API).
`npm run dev` builds the shared packages first, then starts both apps. To run one:
`npm run dev -w web` or `npm run dev -w api`.

Database migrations use the schema-owning role (`DIRECT_DATABASE_URL`); the running API uses
a role that cannot alter the schema (`DATABASE_URL`). Both are created by
`packages/database/sql/roles.sql` on first `docker compose up`.

```bash
npm run db:migrate -- --name <change>   # create and apply a migration locally
npm run db:status                       # what is applied where
```

## Checks

```bash
npm run check                       # format, lint, typecheck, build
npm run check:boundaries -w web
npm run test:e2e -w web             # once: npm exec -w web -- playwright install chromium
```

Dependencies are pinned exactly. After adding or upgrading a package, run `npm run pin`
and commit `package-lock.json` with it.

CI runs all of the above plus a dependency audit and secret scan on every pull request.
