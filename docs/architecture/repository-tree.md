# Proposed Repository Tree

npm workspaces + Turborepo (the brief says pnpm; the owner chose npm). This is the target
layout; `docs/`, `apps/web` (landing and auth pages), `apps/api` (Phase 1 scaffold),
`packages/contracts`, `packages/database` and `packages/config` exist. Everything else
arrives with the phase that needs it.

```text
etb-usdt-p2p/
├── CLAUDE.md                        # the project brief (authoritative)
├── README.md                        # how to run it locally
├── package.json                     # workspace root; scripts delegate to turbo
├── scripts/pin-versions.mjs          # rewrites ranges to installed exact versions
├── package-lock.json                # committed; CI uses npm ci
├── turbo.json
├── docker-compose.yml               # postgres, redis, minio, mailpit
├── .env.example                     # names and dummy values only — never real secrets
├── .nvmrc
├── .github/
│   └── workflows/
│       ├── ci.yml                   # lint, typecheck, test, migration check, build
│       └── security.yml             # dependency audit, secret scan, CodeQL
│
├── apps/
│   ├── web/                         # Next.js App Router client
│   │   ├── app/
│   │   │   ├── (marketing)/         # landing page — Phase 0.5, no auth, no money
│   │   │   │   ├── page.tsx
│   │   │   │   └── layout.tsx
│   │   │   ├── (auth)/              # login, register, recovery
│   │   │   ├── (app)/               # authenticated customer area
│   │   │   │   ├── dashboard/       # available / escrowed / withdrawing
│   │   │   │   ├── deposit/         # address, QR, network warning, status
│   │   │   │   ├── withdraw/
│   │   │   │   ├── market/          # offer list + filters
│   │   │   │   ├── offers/          # create / edit / pause my offers
│   │   │   │   ├── trades/[id]/     # the trade room
│   │   │   │   └── history/
│   │   │   └── (admin)/             # role-protected, separate layout and routes
│   │   ├── components/
│   │   │   ├── ui/                  # shadcn/ui primitives
│   │   │   └── domain/              # MoneyAmount, TradeStateBadge, NetworkWarning…
│   │   ├── lib/
│   │   │   ├── api-client.ts        # typed against packages/contracts
│   │   │   ├── money.ts             # display formatting only — never arithmetic
│   │   │   └── query-keys.ts
│   │   ├── e2e/                     # Playwright specs
│   │   └── next.config.ts
│   │
│   └── api/                         # NestJS + Fastify; API and workers, one codebase
│       ├── src/
│       │   ├── main.ts              # HTTP entrypoint
│       │   ├── worker.ts            # BullMQ entrypoint — same modules, no HTTP
│       │   ├── app.module.ts
│       │   ├── common/
│       │   │   ├── auth/            # guards, session, step-up, CSRF
│       │   │   ├── authorization/   # policy engine, deny-by-default
│       │   │   ├── idempotency/     # interceptor + store
│       │   │   ├── errors/          # stable machine-readable error codes
│       │   │   ├── logging/         # pino config + redaction allowlist
│       │   │   ├── money/           # branded bigint types, parse/format at the edge
│       │   │   ├── state-machine/   # generic transition() + table loader
│       │   │   └── validation/      # ZodValidationPipe
│       │   └── modules/
│       │       ├── ledger/          # ← the only writer of money
│       │       │   ├── ledger.service.ts        # postBalancedTransaction()
│       │       │   ├── account-resolver.ts      # get-or-create by code
│       │       │   ├── balance.repository.ts    # SELECT … FOR UPDATE lives here
│       │       │   └── invariants.ts
│       │       ├── auth/  users/  accounts/
│       │       ├── wallets/         # attribution addresses
│       │       ├── blockchain/
│       │       │   ├── blockchain.gateway.ts    # interface
│       │       │   ├── mock/                    # deterministic; simulates reorgs,
│       │       │   │                            # dupes, timeouts, unknown broadcast
│       │       │   └── bsc/                     # Phase 6 only: the real adapter
│       │       ├── custody/
│       │       │   ├── custody.provider.ts      # interface
│       │       │   ├── mock/
│       │       │   └── webhooks/                # raw-body signature verification
│       │       ├── deposits/  withdrawals/
│       │       ├── offers/  trades/  escrow/  disputes/
│       │       ├── risk/            # RiskEngine interface + permissive mock
│       │       ├── customers/       # who a customer is, in the fields an admin needs
│       │       ├── notifications/  outbox/  audit/
│       │       ├── reconciliation/  # read-only; raises breaks, never posts
│       │       └── admin/           # isolated controllers + role guards
│       └── test/
│           ├── unit/                # state machines, ledger rules, money
│           ├── integration/         # real ephemeral PostgreSQL
│           │   ├── ledger/          # balance, immutability, rebuild
│           │   └── concurrency/     # AT-2, AT-3 — parallel connections
│           └── api/                 # Supertest, incl. object-level authorization
│
├── packages/
│   ├── contracts/                   # Zod schemas + inferred types ONLY.
│   │                                # No Prisma models. No database types.
│   ├── config/                      # shared eslint / tsconfig / prettier
│   ├── database/
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   └── migrations/          # forward-only; ledger triggers live here
│   │   ├── sql/                     # hand-written constraints & triggers
│   │   │   ├── ledger_balance_trigger.sql
│   │   │   ├── ledger_immutability.sql
│   │   │   └── allowed_transitions.sql
│   │   └── seed/                    # local/dev fixtures only
│   └── test-utils/                  # fixtures, ledger assertions, chain simulators
│
└── docs/
    ├── README.md
    ├── open-questions.md            # blocking questions + UNVALIDATED register
    ├── architecture/
    │   ├── overview.md
    │   ├── glossary.md
    │   ├── ledger-taxonomy.md
    │   ├── state-machines.md
    │   ├── data-classification.md
    │   ├── repository-tree.md
    │   └── adr/
    │       └── README.md            # ADR-0001 … ADR-0010
    ├── threat-model/
    │   └── README.md
    ├── testing/
    │   └── acceptance-test-plan.md
    └── runbooks/                    # written before Phase 6, not after
        ├── ambiguous-broadcast.md
        ├── reconciliation-break.md
        ├── secret-rotation.md
        └── restore-from-backup.md
```

## Notes on the layout

**`packages/contracts` never imports Prisma.** This is the rule that stops
`passwordHash`, internal risk scores or provider references from reaching the browser
because someone reused a database type. API response shapes are written by hand, field by
field, and the boundary is a lint rule.

**Workers share the codebase, not just the schema.** `worker.ts` boots the same NestJS
modules without the HTTP layer, so the escrow rules a worker applies at expiry are
literally the same code the API applies at release. Two implementations of one state
machine is how they drift.

**Hand-written SQL sits beside Prisma, not underneath it.** Deferred constraint triggers,
the `REVOKE`/immutability triggers and the allowed-transition table are things Prisma's
schema language cannot express. They live in `packages/database/sql/`, are applied by
migrations, and are tested directly — a test that tries to `UPDATE` a posted ledger entry
and asserts that the database refuses.

**The admin area is a separate route group with its own layout and guards**, not a
conditional inside customer pages. Separation that is visible in the file tree is harder
to get wrong than separation expressed as an `if`.

**Runbooks are written before the phase that needs them.** A runbook authored during an
incident is not a runbook.
