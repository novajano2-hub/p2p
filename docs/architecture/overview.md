# Architecture Overview

## 1. What this system is, in ten bullets

1. A responsive web marketplace where users trade **USDT for Ethiopian birr**, one asset
   and one fiat currency at launch.
2. It is **custodial**: the platform controls the blockchain keys through an external
   custody/signing provider, and users never connect their own wallet.
3. Each user gets a **unique deposit address** so incoming funds can be attributed, while
   the funds themselves are **pooled** in platform treasury wallets.
4. Ownership of money exists in an **immutable double-entry ledger in PostgreSQL**, not
   on-chain. The ledger is the source of truth; balances are a rebuildable projection.
5. **Escrow is a ledger hold, not a smart contract.** Accepting a trade moves USDT from
   the seller's available account to a trade escrow account. No chain activity, no gas.
6. The **ETB leg happens outside the platform**, bank-to-bank or via mobile money. The
   platform records intent and instructions, never money movement, for birr.
7. The blockchain is touched at exactly two boundaries: **deposit in** and
   **withdrawal out**. Both go through a `BlockchainGateway` / `CustodyProvider` adapter
   pair with deterministic mocks; the real Plasma route is UNVALIDATED.
8. The runtime is a **modular monolith**: one NestJS/Fastify application with strict
   module boundaries plus BullMQ background workers, not microservices.
9. **Every monetary mutation goes through the Ledger module.** No other module writes
   financial rows. Every external mutation carries an idempotency key backed by a unique
   database constraint.
10. Security is structural, not a final pass: deny-by-default authorization, step-up auth
    on money-moving actions, signer policy limits, append-only audit, and continuous
    reconciliation of ledger liabilities against on-chain assets.

## 2. Component map

```
                          ┌────────────────────────────────────────┐
   Browser (untrusted)    │  apps/web — Next.js App Router         │
   ──────────────────────▶│  Renders state. Computes no balances.  │
                          └───────────────┬────────────────────────┘
                                          │ HTTPS, cookie session + CSRF
                        ══════════════════╪══════════════ TRUST BOUNDARY B1
                                          ▼
   ┌───────────────────────────────────────────────────────────────────────┐
   │ apps/api — NestJS (Fastify)          modular monolith                 │
   │                                                                       │
   │  Auth │ Users │ Offers │ Trades │ Escrow │ Disputes │ Admin │ Risk     │
   │                    │        │       │                                 │
   │                    ▼        ▼       ▼                                 │
   │            ┌──────────────────────────────┐                           │
   │            │  LedgerModule                │  ← ONLY writer of money   │
   │            │  postBalancedTransaction()   │                           │
   │            └──────────────┬───────────────┘                           │
   │  Deposits │ Withdrawals │ Wallets │ Blockchain │ Reconciliation        │
   │  Audit    │ Outbox      │ Notifications                               │
   └───────┬──────────────┬──────────────┬───────────────┬─────────────────┘
           │              │              │               │
     ══════╪══════════════╪══════════════╪═══════════════╪═════ BOUNDARIES
       B2  │          B3  │          B4  │           B5  │
           ▼              ▼              ▼               ▼
   ┌─────────────┐ ┌────────────┐ ┌──────────────┐ ┌──────────────┐
   │ PostgreSQL  │ │ Redis      │ │ Custody /    │ │ S3-compatible│
   │ source of   │ │ queues,    │ │ Signing      │ │ object store │
   │ truth       │ │ rate limit │ │ provider     │ │ (evidence)   │
   └─────────────┘ └────────────┘ └──────┬───────┘ └──────────────┘
                                         │  B6
                                         ▼
                                  ┌──────────────┐
                                  │ Blockchain   │  Plasma (UNVALIDATED)
                                  │ RPC/indexer  │
                                  └──────────────┘

   Outside every boundary, invisible to us:  Ethiopian banks / mobile money (B8)
```

### Worker processes

Workers run the same codebase as the API but with a different entrypoint, so domain rules
cannot drift between them:

| Worker | Responsibility | Idempotency strategy |
|---|---|---|
| `chain-observer` | Poll/subscribe for incoming transfers to attribution addresses | Unique `(network, tx_hash, log_index)` |
| `deposit-crediter` | Advance confirmations, credit at finality | Unique `(deposit_id, 'CREDIT')` ledger idempotency key |
| `sweeper` | Move attribution-address balances to treasury | Unique sweep batch key |
| `withdrawal-builder` | Build unsigned transactions | Unique `(withdrawal_id, attempt)` |
| `withdrawal-broadcaster` | Sign via custody, broadcast, track | Provider-side client reference = `withdrawal_id` |
| `trade-expirer` | Expire unpaid trades, refund escrow | Unique `(trade_id, 'EXPIRE')` |
| `outbox-publisher` | Emit notifications and events | Row-level claim + delivery marker |
| `reconciler` | Compare on-chain totals to ledger totals, raise breaks | Read-only; never posts |

Note that `reconciler` is deliberately read-only. It raises exceptions for humans; it does
not write correcting entries. See ADR-0009.

## 3. Trust boundaries

A trust boundary is a line across which you must stop believing what you are told and
start verifying. Everything crossing one of these lines is validated, authorized, size-
limited, rate-limited and logged.

| ID | Boundary | What crosses it | What we must never assume |
|---|---|---|---|
| **B1** | Browser → API | Session cookie, CSRF token, JSON request bodies, uploads | That the client computed anything correctly, that the user owns the ID in the URL, that a role claim in the request is real |
| **B2** | API → PostgreSQL | SQL, transactions, locks | That application-level checks are sufficient; constraints must exist in the database |
| **B3** | API → Redis/BullMQ | Jobs, rate-limit counters, leases | That a job runs exactly once, or that a Redis lock protects financial correctness |
| **B4** | API ↔ Custody provider | Address creation requests, sign requests, **inbound webhooks** | That a webhook is authentic without signature verification, or that "signed" means "broadcast", or that a timeout means "did not happen" |
| **B5** | API ↔ Object storage | Dispute evidence uploads/downloads | That an uploaded file is the type or size it claims, or that it is safe to show staff unscanned |
| **B6** | Custody → Blockchain | Broadcast transactions, chain state reads | That an RPC node is honest, current, or that a confirmed transaction is final before the policy threshold |
| **B7** | Admin human → API | Privileged actions: dispute resolution, withdrawal approval, adjustments | That an admin account is not compromised, or that one admin should be able to move funds alone above a threshold |
| **B8** | Users ↔ Ethiopian banks | ETB payment, entirely outside our systems | **That a payment happened.** We have no visibility, no proof and no ability to reverse. Everything here is claim, not fact |
| **B9** | CI/CD → Production | Container images, migrations, secrets | That the build pipeline is trusted infrastructure by default |

**B8 is the boundary that most shapes the product.** Every technical control we build for
trades exists because the money we care most about moves where we cannot see it.

## 4. Request path for a money-moving action

The generic shape every financial endpoint follows. Deviating from it is a review-blocking
issue.

```
1.  Authenticate session            → fail closed if absent/expired
2.  CSRF check (cookie auth)        → fail closed
3.  Rate limit (account, IP, action)→ fail closed
4.  Validate body with Zod          → reject unknown fields
5.  Resolve + authorize the object  → deny-by-default, ownership checked in the query
6.  Step-up auth if policy requires → fail closed
7.  Claim Idempotency-Key           → INSERT ... unique; on conflict return prior result
8.  BEGIN TRANSACTION
      a. SELECT ... FOR UPDATE the balance rows involved, in a fixed account-id order
      b. Check preconditions and state-machine legality
      c. Write domain state change
      d. LedgerModule.postBalancedTransaction(...)
      e. Write audit_event
      f. Write outbox_event
    COMMIT
9.  Return with correlation ID
10. Workers pick up the outbox asynchronously
```

Rules that follow from this shape:

- No network I/O — signing, email, chain polling — happens between `BEGIN` and `COMMIT`.
  Slow external work is enqueued via the outbox. INVARIANT.
- Locks are always acquired in a deterministic order (ascending account UUID) so two
  concurrent transfers cannot deadlock each other.
- The state change and its ledger entries commit together or not at all. There is no
  window where a trade is `COMPLETED` but the money has not moved.

## 5. What is deliberately not here

Per the brief, and worth restating so nobody adds them by reflex:

no order book or matching engine · no on-chain escrow contract · no user-connected
wallets · no second asset or second network · no direct bank/mobile-money API · no
margin, lending, staking or swaps · no microservices · no Kubernetes · no native mobile
app · **no real private keys and no real money at any point in Phases 0–5**.

## 6. Honest statement of maturity

Phases 0–5 produce a system that is *internally* correct: the ledger balances, escrow
cannot be double-spent, authorization holds, and every external integration is a
deterministic mock. That is a meaningful engineering result and it is **not** evidence
that custody is safe.

Before any real funds, the brief requires independent application security review, custody
architecture review, penetration testing, a disaster-recovery exercise, and ledger/on-chain
reconciliation testing. AI-written code, including everything in this repository, does not
substitute for any of those.
