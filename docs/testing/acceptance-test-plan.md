# Acceptance Test Plan

These tests are the definition of "correct" for this platform. AT-1 through AT-13 are the
thirteen mandated by the brief; AT-14 onward are additions Phase 0 identified as necessary
to cover the state machines and the ledger taxonomy.

A phase is not complete until its tests are green. "Green light to proceed" means exactly
this list, not a demo.

## Test layers

| Layer | Runs against | Speed | Used for |
|---|---|---|---|
| **Unit** | Pure functions, in memory | ms | State-machine tables, money arithmetic, balance derivation |
| **Integration** | **A real ephemeral PostgreSQL** (Testcontainers or a per-worker template database) | seconds | Everything involving locks, constraints, triggers or transactions |
| **Concurrency** | Real PostgreSQL, **multiple genuine connections in parallel** | seconds | AT-2, AT-3 — the ones that matter most |
| **API** | Supertest against the booted app | seconds | Authorization, idempotency, error shapes |
| **E2E** | Playwright against web + api + docker services | minutes | Critical journeys only |

A note on why concurrency tests need real parallel connections: a test that calls a service
function twice in sequence proves nothing about row locking. These tests must open two
connections, begin two transactions, and interleave them deliberately — usually with a
barrier that releases both at the same instant, repeated enough times to be meaningful.
A single-connection "concurrency test" is the most common way this class of bug ships.

---

## The mandated thirteen

### AT-1 — Duplicate deposit webhooks credit exactly once
**Phase 3 · Integration**
Deliver the same signed webhook payload N times (N ≥ 5), including concurrently and with
delays that straddle the credit. Assert: exactly one `CREDITED` deposit; exactly one JE-1
ledger transaction; the user's available balance increased by exactly the amount once;
every duplicate returned `200` (so the provider stops retrying) and wrote nothing.
*Variant:* the same `tx_hash` with a different `log_index` is a **different** transfer and
must credit separately.

### AT-2 — Two simultaneous trades cannot lock the same USDT
**Phase 4 · Concurrency**
Seller has exactly 100 USDT available. Two buyers accept two different 100 USDT offers at
the same instant, on separate connections. Assert: exactly one trade reaches
`AWAITING_FIAT_PAYMENT`; the other fails with `INSUFFICIENT_AVAILABLE_BALANCE`; seller's
available is 0, not −100; exactly one escrow account exists with 100; the ledger balances.
Repeat ≥ 50 times to catch interleavings that pass once by luck.

### AT-3 — A withdrawal and a trade started concurrently cannot overspend
**Phase 4 · Concurrency**
Same setup, but one request is a 100 USDT withdrawal and the other is a 100 USDT trade
acceptance. Assert: exactly one succeeds; total liabilities to that user are unchanged;
`available + escrowed + pending_withdrawal` is still exactly 100.

### AT-4 — Buyer marking paid does not release escrow
**Phase 4 · Integration + E2E**
Buyer calls mark-paid, repeatedly, and waits past every timer in the system. Assert: state
is `BUYER_MARKED_PAID`; **zero ledger transactions were created by the action**; escrow
account still holds the full amount; buyer's available balance is unchanged. Additionally
assert by inspection of the transition table that **no automatic path exists** from
`BUYER_MARKED_PAID` to `COMPLETED` without a seller or admin actor.

### AT-5 — Repeated release requests credit the buyer exactly once
**Phase 4 · Integration + Concurrency**
Seller sends the release request N times — same idempotency key, different idempotency
keys, and concurrently. Assert: exactly one JE-4; buyer credited exactly once; escrow
account balance is exactly 0; subsequent attempts return the original result or a typed
`ILLEGAL_TRANSITION`, never a second credit.

### AT-6 — Cross-user access is denied
**Phase 1 (auth foundation), extended every phase · API**
A parameterized test over **every** user-owned resource — trade, offer, deposit address,
withdrawal, payment method, dispute, evidence file, notification — for both read and
mutate, as: the owner, a different authenticated user, an unauthenticated caller, and a
counterparty who has a legitimate but limited relationship to the object. Assert: only
the intended actor succeeds; the response for a non-owner does not leak existence
differently from a genuine 404.
*This test is table-driven and a new resource without an entry fails CI* — otherwise it
decays the moment someone adds an endpoint.

### AT-7 — A cancelled or expired unpaid trade returns the full escrow exactly once
**Phase 4 · Integration**
Both paths: user cancellation and timer expiry. Assert: exactly one JE-5; seller's
available is restored to exactly the pre-trade amount; escrow account is exactly 0; the
original JE-3 still exists unmodified and the refund carries `reverses_transaction_id`.
Run the expirer worker repeatedly against the same trade — it must be a no-op after the
first run.

### AT-8 — A disputed trade is resolvable only by an authorized role, with a complete audit record
**Phase 4 · API + Integration**
Attempt resolution as the buyer, the seller, an unauthenticated caller, an admin without
`dispute_resolver`, and an admin who is a party to the trade — all denied. As a valid
resolver, both outcomes succeed and produce: the correct ledger entries (JE-6 or JE-5), an
`audit_event` containing actor, reason code, free-text rationale, evidence references,
correlation ID and before/after state, and a reconstructable timeline from trade creation
to resolution.

### AT-9 — Ambiguous broadcast causes neither a duplicate withdrawal nor an automatic refund
**Phase 3 · Integration**
The mock custody provider is instructed to time out with an unknown outcome. Assert: the
withdrawal is `BROADCAST_UNKNOWN` then `MANUAL_INVESTIGATION`; **no second broadcast is
attempted, ever, including after worker restarts and retries**; **no refund is posted**;
the user's funds remain in `PENDING_WITHDRAWAL` and are visible in the UI as "Withdrawing";
an alert was raised. Then resolve manually both ways and assert each produces exactly the
right entries.

### AT-10 — Every ledger transaction in every test is balanced
**All phases · Integration harness**
Not a single test but a global assertion. A shared afterEach hook queries
`SELECT transaction_id FROM ledger_entry GROUP BY transaction_id, asset HAVING SUM(signed_amount) <> 0`
and fails if it returns any row. It also asserts that every transaction has ≥ 2 entries
and exactly one asset. Any test in the suite that manages to write an unbalanced
transaction fails, regardless of what it was testing.

### AT-11 — Rebuilding balance projections from the ledger produces identical balances
**Phase 2 · Integration**
After an arbitrary randomized sequence of operations, truncate
`ledger_account_balance`, recompute every balance from `ledger_entry` alone, and compare
to a snapshot of the projection taken beforehand. Assert exact equality for every account.
*Property-test variant:* generate random valid operation sequences and assert the property
holds for all of them.

### AT-12 — Reconciliation detects a deliberate difference
**Phase 3 · Integration**
Inject a discrepancy into the mock chain state — a surplus, then a shortfall, then a
transfer the ledger does not know about. Assert: the reconciler produces a
`reconciliation_break` with the correct direction and amount; an alert is raised; and
**the reconciler posted no ledger entries of its own**. Then post the corrective entry
through the adjustment workflow and assert the break clears.

### AT-13 — Logs and error reports contain no secrets or sensitive payment details
**Phase 1, re-run every phase · Integration**
Plant unique sentinel values in every RESTRICTED and SECRET field (payment instructions,
password, MFA seed, custody API key, webhook signature, session cookie). Drive
representative flows including deliberate failures and unhandled exceptions. Capture the
complete log stream, the error-reporter payloads, and any trace attributes. Assert that no
sentinel appears anywhere. A new sensitive field without a sentinel fails a companion
completeness check.

---

## Additions identified in Phase 0

### AT-14 — Trade escrow accounts are exactly zero in terminal states
**Phase 4 · Integration invariant**
Global assertion over every trade in the database: terminal trades have escrow balance
exactly 0; open trades have escrow balance exactly equal to the trade amount. Catches
partial releases and double refunds that individual tests would miss.

### AT-15 — Posted ledger entries cannot be updated or deleted
**Phase 2 · Integration**
The application role attempts `UPDATE ledger_entry SET amount = …` and
`DELETE FROM ledger_transaction …`. Assert both are refused **by the database**, not by
application code. Assert the same for a direct connection using the application role.

### AT-16 — The database rejects an unbalanced transaction
**Phase 2 · Integration**
Bypass `LedgerService` and insert entries that do not sum to zero directly. Assert the
deferred constraint trigger raises at `COMMIT`. This proves the invariant survives a
future bug in application code, which is the entire reason it is in the database.

### AT-17 — Illegal state transitions are rejected exhaustively
**Phase 4 · Unit (property)**
For every aggregate, enumerate the full cartesian product of (state × event). Every pair
not in the transition table must throw `IllegalTransitionError` and write nothing. This is
one test that covers the entire transition surface, including the pairs nobody thought of.

### AT-18 — Balances never go negative, under any operation sequence
**Phase 2 · Property + Integration**
Generate long randomized sequences of deposits, locks, releases, refunds, holds and
cancels, some invalid, executed with concurrency. Assert that no customer or escrow
balance is ever negative at any point, and that the database constraint — not the
application — is what refuses the invalid ones.

### AT-19 — No network I/O occurs inside a database transaction
**Phase 2 · Integration**
Instrument the HTTP/provider clients to throw if invoked while a transaction is open on
the current async context. Assert every financial flow completes. Prevents the class of
outage where a slow provider holds row locks across the whole system.

### AT-20 — A reorg before finality never credits; after finality raises a break
**Phase 3 · Integration**
Mock chain reorgs a transfer while `CONFIRMING`: assert the deposit becomes `ORPHANED` and
no ledger entry was ever written. Reorg one after `CREDITED`: assert the reconciler raises
a break for human handling rather than silently reversing the customer's balance.
UNVALIDATED against real network behavior until Phase 6.

### AT-21 — Money is never represented as a float anywhere on a wire
**Phase 1 · Unit + API**
Assert that every monetary field in every OpenAPI response schema is a string with
currency metadata; a lint rule forbids `number` in money positions; round-trip
parse/format tests across the full `bigint` range, including values that would lose
precision as IEEE-754 doubles.

### AT-22 — Landing page is accessible and has no client-side money logic
**Phase 0.5 · E2E**
Axe accessibility scan with zero serious or critical violations; keyboard-only navigation
of all interactive elements; renders correctly at 375px, 768px and 1440px; and a source
assertion that the marketing route group imports nothing from the API client or money
modules.

---

## Mapping to phases

| Phase | Must be green before proceeding |
|---|---|
| **0.5** — landing page + shell | AT-22 · lint, typecheck, build |
| **1** — foundation | AT-6 (auth resources) · AT-13 · AT-21 |
| **2** — ledger slice | AT-10 · AT-11 · AT-15 · AT-16 · AT-18 · AT-19 |
| **3** — mock wallet ops | AT-1 · AT-9 · AT-12 · AT-20 |
| **4** — P2P escrow | AT-2 · AT-3 · AT-4 · AT-5 · AT-7 · AT-8 · AT-14 · AT-17 |
| **5** — UX hardening | Full E2E journeys · AT-6 across every resource · AT-22 site-wide |
| **6** — real sandbox | The entire suite re-run against the provider sandbox, plus independent security review, custody architecture review, penetration test, DR exercise and reconciliation testing |

The brief's rule stands: **no P2P financial mutations are built until the Phase 2 ledger
tests pass.** The order exists because a bug found in the ledger after escrow is built is a
bug you have to find twice.
