# Architecture Decision Record

Ten decisions, recorded together for Phase 0 review. Each has a stable ID. When a decision
is later amended or superseded it will be split into its own numbered file and this table
will point there.

| ID                                                                                                     | Decision                                                                         | Status   |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | -------- |
| [ADR-0001](#adr-0001--modular-monolith-in-an-npm-workspacesturborepo-monorepo)                         | Modular monolith in an npm workspaces/Turborepo monorepo                         | Accepted |
| [ADR-0002](#adr-0002--custodial-pooled-wallets-with-per-user-attribution-addresses)                    | Custodial pooled wallets with per-user attribution addresses                     | Accepted |
| [ADR-0003](#adr-0003--an-immutable-double-entry-ledger-is-the-sole-source-of-monetary-truth)           | Immutable double-entry ledger is the sole source of monetary truth               | Accepted |
| [ADR-0004](#adr-0004--escrow-is-an-internal-ledger-hold-in-a-per-trade-account)                        | Escrow is an internal ledger hold in a per-trade account                         | Accepted |
| [ADR-0005](#adr-0005--value-representation-money-time-and-identifiers)                                 | Value representation: money, time and identifiers                                | Accepted |
| [ADR-0006](#adr-0006--chain-and-custody-behind-adapters-bsc-is-the-network)                            | Chain and custody behind adapters; Plasma is a hypothesis                        | Accepted |
| [ADR-0007](#adr-0007--idempotency-keys-and-a-transactional-outbox-for-every-external-effect)           | Idempotency keys and a transactional outbox for every external effect            | Accepted |
| [ADR-0008](#adr-0008--zod-as-the-single-validation-and-contract-library)                               | Zod as the single validation and contract library                                | Accepted |
| [ADR-0009](#adr-0009--balances-are-a-transactional-projection-row-locks-are-the-concurrency-primitive) | Balances are a transactional projection; row locks are the concurrency primitive | Accepted |
| [ADR-0010](#adr-0010--withdrawal-authorisation-is-separated-from-signing)                              | Withdrawal authorization is separated from signing                               | Accepted |

---

## ADR-0001 — Modular monolith in an npm workspaces/Turborepo monorepo

**Context.** The system has a dozen bounded contexts (auth, ledger, wallets, deposits,
withdrawals, offers, trades, escrow, disputes, risk, admin, reconciliation) and a small
team. The most dangerous operations — escrow lock, escrow release, withdrawal hold — must
change domain state and post ledger entries **in a single database transaction**.

**Decision.** One deployable NestJS/Fastify application containing all modules, plus
worker entrypoints running the same codebase. One PostgreSQL database. Code lives in an
npm workspaces monorepo with Turborepo for task orchestration and caching. (The brief
named pnpm; the owner chose npm on 2026-09-07. Nothing architectural depends on the choice.)

Module boundaries are enforced socially and by lint rules, not by network calls:

- Only `LedgerModule` may write to `ledger_transaction`, `ledger_entry`,
  `ledger_account`, `ledger_account_balance`. Other modules call its service.
- An ESLint boundary rule forbids importing another module's internal directories;
  only its public `*.service.ts` / exported types are importable.

**Consequences.** We keep ACID transactions across contexts, which is the whole point.
We give up independent scaling and independent deploys, which we do not need. If a
context later genuinely needs to be extracted, the module boundary is the seam.

**Alternatives rejected.** Microservices, which would force the escrow lock and its ledger
entries into a distributed transaction or a saga — replacing a solved problem (a database
transaction) with an unsolved one (compensating money movements across services) at the
exact point where correctness matters most.

---

## ADR-0002 — Custodial pooled wallets with per-user attribution addresses

**Context.** The product target is Ethiopian users who should not need to understand seed
phrases, gas, or wallet software. The brief mandates custody.

**Decision.** The platform is custodial. Each user is issued a unique deposit address on
the supported network. Incoming funds are attributed by address, then swept into pooled
treasury wallets. All signing happens inside an external custody provider.

The application stores, per address: the public address, network, custody-provider wallet
and account references, status, and the owning user. **It never stores key material,
seeds, derivation secrets, or anything from which a key could be reconstructed.**

Treasury is split:

- **Hot treasury** — reachable by automated signing, funds outgoing withdrawals, sized to
  a bounded operational float.
- **Cold treasury** — the remainder, requiring stronger human authorization to move.

**Consequences.** Ownership exists only in our ledger (see ADR-0003), so a ledger bug is
a money bug. The platform becomes a concentrated target; the threat model treats custody
compromise as the highest-impact scenario. Users cannot self-recover funds if we fail —
this is a real product risk we accept by being custodial.

**Alternatives rejected.** One on-chain wallet per user (operationally expensive, and gas
costs to sweep dust make small deposits uneconomic). Non-custodial with user wallets
(contradicts the brief and the target user).

---

## ADR-0003 — An immutable double-entry ledger is the sole source of monetary truth

**Context.** Invariants 1–11 of the brief all reduce to one requirement: it must be
impossible for the system to create or destroy money without a detectable trace.

**Decision.** Three core tables:

- `ledger_account` — the chart of accounts. Immutable definition rows.
- `ledger_transaction` — one row per business event, with reference, actor, reason code,
  correlation ID, idempotency key and timestamp.
- `ledger_entry` — the posting lines. `(transaction_id, account_id, asset, direction,
amount)` where `amount` is a **positive** `BIGINT` and `direction` is `DEBIT`/`CREDIT`.

A generated stored column `signed_amount = amount * CASE direction WHEN 'DEBIT' THEN 1
ELSE -1 END` lets the balance invariant be checked in SQL. A deferred constraint trigger
enforces `SUM(signed_amount) = 0` per `(transaction_id, asset)` at commit time.

Rows in `ledger_entry` and `ledger_transaction` are **append-only**. This is enforced by
`REVOKE UPDATE, DELETE` on those tables from the application role, plus a `BEFORE UPDATE
OR DELETE` trigger that raises. Corrections are new, balanced, compensating transactions
carrying a `reverses_transaction_id` reference and a reason code.

**Consequences.** Every balance is derivable by summing entries, so the system can always
be audited and rebuilt (AT-11). Storage grows monotonically; that is acceptable and
archival is a later operational concern. Developers must learn debits and credits — the
[glossary](../glossary.md) exists for that.

There is deliberately **no admin "set balance" function**. Corrections go through a typed,
balanced adjustment workflow with reason, evidence, authorization and audit.

**Alternatives rejected.** A mutable `balance` column as the authority (no redundancy,
silent corruption). Event sourcing over the whole domain (more machinery than needed;
we event-source only the money, which is the part that requires it).

---

## ADR-0004 — Escrow is an internal ledger hold in a per-trade account

**Context.** When Dawit accepts Sara's offer to sell 100 USDT, that 100 must become
unspendable by Sara without moving on-chain.

**Decision.** Escrow is a transfer between two liability accounts. Each trade gets its own
escrow liability account, created lazily when the trade is created:
`LIAB:TRADE:{tradeId}:USDT:ESCROW`.

Locking is `DR seller available / CR trade escrow`. Release is `DR trade escrow / CR buyer
available`. Refund is `DR trade escrow / CR seller available`. See
[ledger-taxonomy.md](../ledger-taxonomy.md) for worked entries.

**The escrow is always funded by whoever is giving up USDT**, regardless of who published
the offer. On a _sell_ offer the publisher funds it; on a _buy_ offer the accepting user
funds it. This is stated explicitly because it is easy to get backwards.

**Consequences.** A per-trade account gives a strong, cheap invariant: **a settled trade's
escrow account balance is exactly zero, and an open trade's is exactly the trade amount.**
That single check catches partial releases, double releases and rounding errors. It also
makes the trade room's "where is my money" question answerable by pointing at one account.

The cost is row count — one account row per trade. Accounts are narrow rows; at any
plausible launch volume this is irrelevant, and "total escrowed" is maintained as a
projection rather than a scan.

**Alternatives rejected.** A single pooled escrow account with a per-trade reference
column (cheaper, but a partial-release bug is invisible because the pooled balance still
looks plausible). An on-chain escrow contract (gas per trade, no dispute override,
contradicts the brief).

---

## ADR-0005 — Value representation: money, time and identifiers

**Context.** Floating-point money, ambiguous timezones and guessable sequential IDs are
three of the most common sources of financial and security bugs.

**Decision.**

_Money._ Stored and computed as `BIGINT` atomic units. USDT = micro-USDT
(1 USDT = 1,000,000). ETB = santim (1 ETB = 100). In TypeScript, amounts are carried as
`bigint` behind a branded type (`type MicroUsdt = bigint & { readonly __brand: 'MicroUsdt' }`)
so a raw number cannot be passed by accident. `number` is forbidden for money by lint rule.
At the API boundary money is `{ "amount": "100.500000", "currency": "USDT", "decimals": 6 }`
— a decimal _string_ plus explicit metadata — parsed and validated at the edge. JSON
numbers are never used for money in either direction.

_Time._ All storage is `TIMESTAMPTZ` in UTC. APIs emit ISO 8601 with offset. Anywhere
ordering or expiry affects money, the timestamp comes from `now()` **in the database**,
not from an application clock, because application clocks drift and there are several of
them.

_Identifiers._ UUIDv7 — sortable by creation time (good index locality) and not guessable
(unlike a sequence). Generated in the application so tests are deterministic and so we do
not depend on a PostgreSQL 18 built-in; the column type is `UUID`.

**Consequences.** Slightly more ceremony at boundaries; no rounding class of bug. `bigint`
does not serialize to JSON natively, which is a feature here: it forces an explicit
conversion at the edge where the currency and decimals are also stated.

---

## ADR-0006 — Chain and custody behind adapters; BSC is the network

**Context.** The brief targets Plasma because eligible USDT transfers can use sponsored
gas. **None of this has been verified.** Sponsored-gas eligibility rules, rate limits,
the USDT contract identity on that network, deposit indexing quality, reorg/finality
behavior, and — critically — whether any custody provider supports the network at all are
all unknown at the time of writing.

**Decision.** No domain code references a network, a token contract, an RPC provider or a
custody vendor. Three interfaces (`BlockchainGateway`, `CustodyProvider`, `RiskEngine`)
sit at the edge, with:

- a **deterministic in-memory/Postgres-backed mock** used for all of Phases 0–5, capable
  of simulating duplicate webhooks, delayed confirmations, reorgs, broadcast timeouts with
  unknown outcome, and signing refusals;
- a real adapter written only in Phase 6, only after explicit approval.

Network parameters (chain id, token contract address, decimals, confirmation threshold,
reorg depth, dust threshold, sponsored-gas eligibility predicate) live in configuration,
never in code.

**Everything about the real chain route is UNVALIDATED** and is tracked in
[open-questions.md](../../open-questions.md). Specific claims that must not be made in
code, copy or documentation until proven:

- that withdrawals are free — user-facing copy says _"No platform fee. The network or a
  third party may charge a fee."_
- that a sweep transaction qualifies for sponsored gas (it may not; only direct eligible
  USDT transfers may)
- that a user can easily _obtain_ USDT on this network from the exchanges they actually
  use — if major exchanges do not support withdrawals to it, deposits are hard regardless
  of how good our code is. This is a product-viability risk, not merely a technical one.

**Consequences.** We can build and fully test the entire product without a provider. If
the network turns out to be unworkable, the change is one adapter and a config file, not a
rewrite. The cost is that our mock's behavior is our _assumption_ about the chain, so
Phase 6 must re-run the full acceptance suite against the sandbox.

**Amendment, 2026-09-12 — the network is BNB Smart Chain.** The context above was written
when Plasma was the target; it is kept because it explains why the adapters exist. The
owner chose BSC at the start of Phase 3, and it is the better-founded choice on every
axis the questions above raise: custody providers support it as a matter of course
(Q6), it is one of the most widely offered USDT withdrawal networks on the exchanges
customers already use (Q7), its finality behaviour is documented and ordinary, and gas is
a fraction of a cent, paid in BNB by the platform at sweep and at withdrawal, never by a
customer trading. What was "sponsored gas" is now simply "cheap gas".

The facts of the network live in configuration (`apps/api/src/config/env.ts`, all with
defaults): chain id 56, the BEP-20 USDT contract, 18 token decimals against the ledger's
6 (converted once, at the edge, `common/money/units.ts`), 15 confirmations before a
deposit is credited, and a transfer absent for 30 blocks treated as gone. The two
finality numbers remain **UNVALIDATED** until Phase 6 exercises them against the live
network (open-questions Q5). Nothing about Plasma remains in code.

---

## ADR-0007 — Idempotency keys and a transactional outbox for every external effect

**Context.** Networks retry. Users double-click. Queues deliver twice. Webhooks arrive
out of order and more than once. None of these may result in money moving twice.

**Decision.**

_Inbound._ Every mutating financial endpoint requires an `Idempotency-Key` header. The key
is claimed by inserting into `idempotency_key (key, user_id, endpoint, request_hash,
status, response_body, created_at)` with a unique constraint on `(user_id, endpoint, key)`
**inside the same transaction as the work**. A replay with the same key and same request
hash returns the stored response; the same key with a _different_ body is a `409`, not a
silent overwrite.

Chain events use a natural key instead: unique `(network, tx_hash, log_index)`. A webhook
that duplicates one is acknowledged and dropped. AT-1.

_Outbound._ Anything with an external side effect — notification, email, event publish —
is written to `outbox_event` in the same transaction as the domain change, and delivered
later by a worker. Nothing is sent from inside a request handler.

_Workers._ Every job handler is idempotent by construction, because at-least-once delivery
is assumed rather than defended against.

**Consequences.** One extra table and one extra insert per financial write. In exchange,
retries become boring. The `idempotency_key` table needs a retention policy (proposed:
30 days, longer than any plausible client retry window).

_As built (Phase 3, stage 1)._ The outbox and the workers that follow it are polled from
PostgreSQL - rows claimed with `FOR UPDATE SKIP LOCKED` under a short lease, retried with
backoff, parked as `FAILED` after the last attempt - rather than pushed through BullMQ as
earlier phases anticipated. The outbox row is already the durable record; putting a
second datastore between it and delivery would have added a place for money-relevant
work to be lost without adding a property. Redis keeps only a lock so that one worker
replica polls at a time. Inbound keys are claimed in the same transaction as the work
and answered from the stored response (`common/idempotency`).

---

## ADR-0008 — Zod as the single validation and contract library

**Context.** The brief says "Zod or class-validator; choose one consistent approach". Two
validation systems in one codebase means two sets of rules, two failure formats, and gaps
between them.

**Decision.** Zod, everywhere: HTTP request bodies, query and path params, environment
variables at boot, webhook payloads, queue job payloads, and external API responses.
Schemas live in `packages/contracts` and are the single definition from which TypeScript
types (`z.infer`) and the OpenAPI document are generated.

All object schemas are `.strict()` — unknown fields are rejected, not stripped, so a
client sending `{ amount, isAdmin }` gets an error instead of a silently ignored field.

`packages/contracts` contains **only** wire schemas. Prisma models are never exported to
the browser; the API response type is written deliberately, field by field. This is how a
`passwordHash` or an internal risk score fails to leak by accident.

**Consequences.** One mental model, one error shape, and validation that composes with
the type system rather than sitting beside it via decorators. NestJS integration is a
small custom `ZodValidationPipe` rather than the built-in `class-validator` pipe.

---

## ADR-0009 — Balances are a transactional projection; row locks are the concurrency primitive

**Context.** Invariant 5 says available funds cannot go negative. Invariant 6 says
escrowed funds cannot simultaneously be available. Both are _concurrency_ problems: two
requests read the same balance, both see enough money, both proceed.

**Decision.** A `ledger_account_balance` table holds one row per `(account_id, asset)`
with `balance BIGINT`, `entry_count`, `last_transaction_id`, `version`, updated **in the
same transaction** as the entries that change it.

To move money out of an account you must first `SELECT ... FOR UPDATE` its balance row.
Locks are taken in ascending `account_id` order to avoid deadlock. This makes the balance
row the serialization point: two concurrent trades against the same seller's account
queue up, and the second one sees the balance the first one left. AT-2, AT-3.

The database enforces the floor, not the application:
`ALTER TABLE ledger_account_balance ADD CONSTRAINT non_negative CHECK (balance >= 0 OR allows_negative)`
where `allows_negative` is true only for accounts where a negative balance is meaningful
(equity and revenue/expense contra positions). Customer available, escrow and pending-
withdrawal accounts can never go negative, and the guarantee is a constraint rather than
an `if`.

**Reconciliation is read-only.** The `reconciler` worker compares
`sum(customer liabilities)` against `sum(controlled on-chain assets)` adjusted for pending
deposits and in-flight withdrawals, and raises a `reconciliation_break` row plus an alert.
It never posts a correcting entry. Only an authorized human adjustment workflow does that,
with a reason code and evidence. AT-12.

**Consequences.** Writes to a single very active account serialize. For customer accounts
this is correct and desirable. If a platform account ever becomes a hotspot we split it
rather than weakening the lock.

Redis is used for rate limits, queues and disposable cache only. **A Redis lock is never
the thing standing between two requests and the same money**, because its lease can expire
while a database transaction is still open.

**Alternatives rejected.** Optimistic concurrency with retry (works, but under contention
degrades to the same serialization with more failed work and more ways to get the retry
wrong). `SERIALIZABLE` isolation globally (correct, but converts contention into
application-visible serialization failures everywhere, including on read paths).

---

## ADR-0010 — Withdrawal authorization is separated from signing

**Context.** The worst realistic outcome for this platform is that a compromised
application server drains the hot treasury. If the same code path that accepts an HTTP
request can also cause a signature, then one application-level vulnerability is total loss.

**Decision.** A withdrawal passes through four separations:

1. **Request** (API handler) only creates a `WithdrawalRequest` and moves the user's funds
   from available to pending-withdrawal liability. It cannot cause a signature.
2. **Authorization** (risk engine + policy + human approval above thresholds) is a
   distinct state transition with its own audit event. High-value or high-risk
   withdrawals require manual review, and — before real funds — dual approval.
3. **Signing** happens inside the custody provider, which enforces **its own** policy that
   the application cannot alter at runtime: allowed asset, allowed contract, allowed
   network, destination allowlist/denylist, per-transaction cap, velocity caps, and
   required approvals.
4. **Broadcast and confirmation** are tracked as separate states with explicit handling
   of the ambiguous case.

The custody-side policy is the last line of defense and is deliberately redundant with our
application checks. Redundancy is the point: it must hold even if our code is wrong.

**The ambiguous-broadcast rule.** If broadcast times out or returns an unknown result, the
withdrawal moves to `MANUAL_INVESTIGATION`. It is **never** automatically retried and
**never** automatically refunded, because both actions can send the money twice. The
user's funds stay in pending-withdrawal liability — visibly held, not lost — until a human
resolves it against chain state. AT-9.

**Consequences.** Withdrawals are slower and involve operational work. Some withdrawals
will sit in review. That is the correct trade for an irreversible transfer. A runbook for
resolving `MANUAL_INVESTIGATION` is required before Phase 6
(`docs/runbooks/ambiguous-broadcast.md`).

**Never**: a browser, an ordinary API handler, or a single unaudited administrator
directly signing and broadcasting a production withdrawal.
