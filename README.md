# BIRQ (placeholder name)

A peer-to-peer marketplace for trading USDT against Ethiopian birr. Custodial, pooled
wallets; an immutable double-entry ledger; escrow as an internal ledger hold; the birr leg
settled out of band.

The durable project brief is [CLAUDE.md](CLAUDE.md). Architecture, threat model, ledger
design and the acceptance-test plan are under [docs/](docs/README.md).

## Status

| Phase                               | State                                                                 |
| ----------------------------------- | --------------------------------------------------------------------- |
| 0. Decisions and threat model       | Done, under review                                                    |
| 0.5 Landing page and monorepo shell | Done: landing, auth pages, legal                                      |
| 1. Foundation (API, database, auth) | Done: accounts, sessions, KYC, the admin realm with TOTP              |
| 2. Ledger vertical slice            | Done: double entry, projections, invariants in the database           |
| 3. Mock wallet operations           | Done: deposits, withdrawals, sweeps, reconciliation, mock chain       |
| 4. P2P escrow                       | Done: offers, trades, chat, disputes, and the screens for all of them |
| 5. UX hardening                     | Not started                                                           |
| 6. Real provider sandbox            | Not started; requires explicit approval                               |

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
docs/               Architecture, threat model, testing, runbooks, open questions
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

**The workers are a separate process, and `npm run dev` does not start them.** An API
process runs no timers on purpose, so without this nothing on a timer happens locally: a
deposit is never credited, a withdrawal is never built or broadcast, nothing is swept,
an unpaid trade never expires, and the outbox never drains. In another terminal:

```bash
npm run dev:worker -w api   # chain observer, deposit confirmer, withdrawal
                            # processor, treasury sweeps, trade expirer,
                            # outbox publisher
```

While the chain is mocked, `chain` is the hand that moves it. Nothing in a
deposit or a withdrawal can reach this - the domain works against whatever
chain it is given - so it is the only way to make money arrive in development.
It refuses to run against a database that is not local.

```bash
npm run chain -w @abay/database -- mint <address> <usdt>   # money arrives
npm run chain -w @abay/database -- advance                 # past finality
npm run chain -w @abay/database -- show <address>          # what is there
npm run chain -w @abay/database -- reorg <txHash>          # take it back
```

Verification codes are not emailed in development: with no `RESEND_API_KEY` the
message is written to the API log, code and all.

**On Windows, the watched API restarts when nothing of its own has changed** - the app
says "Reconnecting", and a page opened in those seconds cannot reach the server. The
cause is outside the repository. Windows records when a file was last read, and tells
file watchers when that record moves; TypeScript's watcher takes any such word about a
dependency's `package.json` as a reason to rebuild; and `nest start --watch` restarts the
app after every rebuild, whether or not anything came of it. So the first time in an hour
that anything reads those files - Next compiling a page, jest, eslint, an editor - the API
and the workers restart. (`excludeFiles` in `watchOptions` does not reach them: TypeScript
registers these watchers under back-slashed paths its own exclude patterns cannot match.)
The cure is to stop Windows recording reads, once, from an administrator's terminal, and
restart the dev servers:

```bash
fsutil behavior set disablelastaccess 1
```

The app copes either way - a dropped connection comes back by itself, as does a page
that failed to load - because in production the same seconds happen on every deploy.

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

The `overrides` block in the root `package.json` lifts two transitive packages past a
published advisory: `deepmerge-ts`, reached through the Prisma CLI that ships in the API
image for `migrate deploy`, and `fastify`, which `@nestjs/platform-fastify` pins to a
release predating the `X-Forwarded-*` spoofing fix. Editing an override does not on its own
invalidate the lockfile: run `npm update <package>` after, and check with `npm ls <package>`.
Drop an entry once the package that pulls it in asks for a fixed version itself.

CI runs all of the above plus a dependency audit and secret scan on every pull request.
