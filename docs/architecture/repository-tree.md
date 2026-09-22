# Repository Tree

npm workspaces + Turborepo (the brief says pnpm; the owner chose npm). This is the layout
as built through Phase 4, not a proposal: everything below exists unless the line says
otherwise. Phase 5 and Phase 6 will add to it, and this document is rewritten when they
do rather than left describing an intention.

```text
p2p/
├── CLAUDE.md                        # the project brief (authoritative)
├── README.md                        # how to run it locally
├── package.json                     # workspace root; scripts delegate to turbo
├── scripts/pin-versions.mjs         # rewrites ranges to installed exact versions
├── package-lock.json                # committed; CI uses npm ci
├── turbo.json
├── docker-compose.yml               # postgres and redis, with least-privilege roles
├── .env.example                     # names and dummy values only — never real secrets
├── .nvmrc
├── .github/
│   └── workflows/
│       └── ci.yml                   # format, lint, typecheck, web tests, build;
│                                    # the API suite against real postgres and redis;
│                                    # Playwright; dependency audit and secret scan
│
├── apps/
│   ├── web/                         # Next.js App Router client
│   │   ├── app/
│   │   │   ├── (marketing)/         # landing page, /terms, /privacy — no auth, no money
│   │   │   ├── (auth)/              # /login, /register, /recover
│   │   │   ├── (app)/               # the customer, behind a session
│   │   │   │   ├── account/         # balances, active trades, the market at a glance
│   │   │   │   ├── wallet/          # deposit, withdraw, transfer, history
│   │   │   │   ├── trade/           # the marketplace, an offer, my ads, payment methods
│   │   │   │   ├── orders/          # open and finished trades; [id] is the trade itself
│   │   │   │   ├── verify/          # identity submission
│   │   │   │   └── settings/
│   │   │   └── (admin)/admin/       # role-protected, separate layout, separate session
│   │   │       ├── page.tsx         # identity verification queue
│   │   │       ├── submissions/     # one submission
│   │   │       ├── deposits/        # held and unattributed deposits
│   │   │       ├── withdrawals/     # approvals and ambiguous broadcasts
│   │   │       ├── disputes/        # the queue, and one case at [id]
│   │   │       ├── reconciliation/  # positions, breaks, sweeps
│   │   │       ├── ledger/          # accounts, transactions, the trial balance
│   │   │       └── login/
│   │   ├── components/
│   │   │   ├── ui/                  # hand-written primitives on the design tokens
│   │   │   ├── app/                 # the shell: nav, session, socket, notifications
│   │   │   ├── account/  wallet/    # the customer's money screens
│   │   │   ├── market/              # marketplace, order page, chat, dispute panel
│   │   │   ├── admin/               # the administration screens and their shared kit
│   │   │   ├── auth/  legal/  brand/  marketing/  motion/  three/
│   │   ├── lib/
│   │   │   ├── auth/                # the customer client, one place for CSRF
│   │   │   ├── market/              # market client, birr money, the words on screen
│   │   │   ├── admin/               # the administrator's client, kept apart
│   │   │   ├── realtime/            # one WebSocket per tab, reconnect and catch-up
│   │   │   ├── money.ts             # USDT millionths; the only arithmetic in the browser
│   │   │   └── wallet/  theme.ts  site.ts  cn.ts
│   │   ├── e2e/                     # Playwright + axe (AT-22)
│   │   ├── scripts/                 # import-boundary check for the marketing group
│   │   └── next.config.ts
│   │
│   └── api/                         # NestJS + Fastify; API and workers, one codebase
│       ├── src/
│       │   ├── main.ts              # HTTP entrypoint
│       │   ├── worker.ts            # timers entrypoint — same modules, no HTTP
│       │   ├── app.ts               # createApp(): the pipeline, shared with the tests
│       │   ├── app.module.ts        # HTTP module tree; worker.module.ts is it minus HTTP
│       │   ├── config/              # the env schema and the ENV token
│       │   ├── common/
│       │   │   ├── errors/          # AppError, the mapping, the global filter
│       │   │   ├── idempotency/     # claim in the caller's transaction, replay, 409
│       │   │   ├── io/              # the transaction scope and afterCommit()
│       │   │   ├── logging/         # pino config + redaction allowlist
│       │   │   ├── money/           # 18→6 decimals, birr arithmetic, formatting
│       │   │   ├── rate-limit/      # the policy decorators and the guard
│       │   │   ├── security/        # CSRF, origin checks, cookies
│       │   │   ├── state-machine/   # TransitionTable, assertTransition, terminalStates
│       │   │   ├── logging/         # pino, and the sensitive-fields registry AT-13 is built from
│       │   │   └── validation/      # ZodValidationPipe
│       │   ├── infra/               # prisma, redis, mail, object storage
│       │   └── modules/
│       │       ├── ledger/          # ← the only writer of money
│       │       ├── auth/  customers/  kyc/  audit/  notifications/  outbox/  health/
│       │       ├── wallets/         # attribution addresses
│       │       ├── blockchain/      # gateway interface + deterministic mock chain
│       │       ├── custody/         # provider interface + mock + signed webhooks
│       │       ├── deposits/  withdrawals/  sweeps/  reconciliation/
│       │       ├── payment-methods/ # encrypted instructions, snapshotted onto trades
│       │       ├── offers/  trades/ # the marketplace and the escrow it locks
│       │       ├── chat/  realtime/ # the trade chat, and the socket that carries it
│       │       ├── disputes/        # opening, evidence, and the decision
│       │       ├── risk/            # RiskEngine interface + rule-based mock
│       │       └── admin/           # isolated controllers + role guards
│       └── test/
│           ├── ledger-invariants.ts # AT-10 and AT-14, after every test in the project
│           ├── setup-env.ts  setup-timeout.ts  global-teardown.js
│           └── api/                 # Supertest against a real database and Redis;
│                                    # access.spec.ts is AT-6, redaction.spec.ts AT-13
│                                    # (unit tests live beside the code as *.spec.ts)
│
├── packages/
│   ├── contracts/                   # Zod shapes for everything crossing the boundary
│   ├── database/
│   │   ├── prisma/schema.prisma
│   │   ├── prisma/migrations/
│   │   ├── sql/                     # what Prisma's schema language cannot express
│   │   │   ├── roles.sql            # least-privilege database roles
│   │   │   ├── ledger-invariants.sql        # deferred balance trigger
│   │   │   ├── ledger-immutability.sql      # no UPDATE, no DELETE, for anyone
│   │   │   ├── ledger-balance-projection.sql
│   │   │   ├── ledger-chart-of-accounts.sql
│   │   │   └── audit-append-only.sql
│   │   └── scripts/                 # admin.mjs (issue an administrator),
│   │                                # chain.mjs (move the mock chain), migrate-check.mjs
│   └── config/                      # shared TypeScript and lint configuration
│
└── docs/
    ├── README.md
    ├── architecture/
    │   ├── overview.md  state-machines.md  ledger-taxonomy.md
    │   ├── data-classification.md  glossary.md  repository-tree.md
    │   └── adr/README.md            # ADR-0001 … ADR-0010
    ├── threat-model/README.md
    ├── testing/acceptance-test-plan.md
    ├── open-questions.md
    └── runbooks/
        ├── dispute-resolution.md    # written with the screen, Phase 4 stage 6
        ├── ambiguous-broadcast.md   # owed before Phase 6 (ADR-0010)
        ├── reconciliation-break.md  # owed before Phase 6
        ├── secret-rotation.md       # owed before Phase 6
        └── restore-from-backup.md   # owed before Phase 6 (risk register R-14)
```

## Notes on the layout

**`packages/contracts` never imports Prisma.** This is the rule that stops
`passwordHash`, internal risk scores or provider references from reaching the browser
because someone reused a database type. API response shapes are written by hand, field by
field, and the boundary is a lint rule.

**The browser re-declares what it parses.** `lib/auth`, `lib/market` and `lib/admin` each
hold their own Zod shapes rather than importing `@abay/contracts`, so the client bundle
does not depend on the API's build. The cost is duplication; what it buys is two
independently deployable apps and a schema failure that shows up as a parse error in one
screen rather than a type error across the repository.

**Workers share the codebase, not just the schema.** `worker.ts` boots the same NestJS
modules without the HTTP layer, so the escrow rules a worker applies at expiry are
literally the same code the API applies at release. Two implementations of one state
machine is how they drift.

**Hand-written SQL sits beside Prisma, not underneath it.** Deferred constraint triggers,
the immutability `REVOKE`s and the balance projection are things Prisma's schema language
cannot express. They live in `packages/database/sql/`, are applied by migrations, and are
tested directly — a test that tries to `UPDATE` a posted ledger entry and asserts that the
database refuses. The transition tables are the exception: they are TypeScript, because
the service must read them to refuse a move before it writes, and they are swept
exhaustively by AT-17 rather than enforced by a constraint.

**The admin area is a separate route group with its own layout and guards**, not a
conditional inside customer pages. Separation that is visible in the file tree is harder
to get wrong than separation expressed as an `if`.

**Runbooks are written before the phase that needs them.** A runbook authored during an
incident is not a runbook.
