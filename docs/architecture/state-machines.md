# State Transition Tables

Three state machines control every movement of money: **deposit** (money in),
**withdrawal** (money out) and **trade** (money between users). Every transition below
names its actor, its preconditions, its ledger effect, its idempotency key and its audit
event. A transition not listed here does not exist — the service layer rejects it, and a
database `CHECK`/trigger on the status column rejects it again.

Ledger entries are referenced as `JE-n` from
[ledger-taxonomy.md](ledger-taxonomy.md).

**Universal rules for all three machines:**

- The state change and its ledger entries commit in one PostgreSQL transaction, or neither
  happens. INVARIANT.
- Every transition writes an `audit_event` and, where anyone needs telling, an
  `outbox_event`, in that same transaction.
- Replaying a transition with the same idempotency key returns the first result and posts
  nothing new.
- Any transition whose preconditions cannot be evaluated with certainty **fails closed**.

---

## 1. Deposit

Tracks one incoming on-chain transfer to a user's attribution address, from first sighting
to credited balance.

```
                    ┌──────────────┐
   chain event ────▶│  DETECTED    │
                    └──────┬───────┘
                           │ passes token/address/amount checks
                  ┌────────┴─────────┐
                  ▼                  ▼
          ┌───────────────┐   ┌──────────────┐
          │  CONFIRMING   │   │ UNATTRIBUTED │──▶ MANUAL_REVIEW ──▶ CREDITED
          └───────┬───────┘   └──────────────┘        (JE-10b)      or REJECTED
                  │
        ┌─────────┼──────────┐
        ▼         ▼          ▼
   ┌──────────┐ ┌──────────┐ ┌───────────────┐
   │ CREDITED │ │ ORPHANED │ │ MANUAL_REVIEW │
   └──────────┘ └──────────┘ └───────────────┘
     terminal      terminal
```

| From            | Event                                                                                               | To              | Actor                             | Preconditions                                                                                                                                                                                              | Ledger effect                                                     | Idempotency key                 | Audit event               |
| --------------- | --------------------------------------------------------------------------------------------------- | --------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------- | ------------------------- |
| —               | Transfer observed by chain observer, or webhook received and signature-verified                     | `DETECTED`      | System                            | Unique `(network, tx_hash, log_index)`. Webhook signature valid over the **raw body**, timestamp within replay window. Transfer independently re-read from the chain — a webhook alone is never sufficient | none                                                              | `(network, tx_hash, log_index)` | `deposit.detected`        |
| `DETECTED`      | Validation passes                                                                                   | `CONFIRMING`    | System                            | Token contract matches the configured USDT contract exactly; destination is an `ACTIVE` attribution address owned by a user; amount ≥ dust threshold; user account not frozen                              | none                                                              | `deposit:{id}:confirming`       | `deposit.confirming`      |
| `DETECTED`      | Destination is not a known active address, or token is not the configured one, or amount below dust | `UNATTRIBUTED`  | System                            | —                                                                                                                                                                                                          | JE-10a _(only if the funds are genuinely under platform control)_ | `deposit:{id}:unattributed`     | `deposit.unattributed`    |
| `CONFIRMING`    | Confirmations ≥ finality policy                                                                     | `CREDITED`      | System                            | Confirmations threshold met **and** the transaction is still present on the canonical chain at read time; deposit not already credited                                                                     | **JE-1**                                                          | `deposit:{id}:credit`           | `deposit.credited`        |
| `CONFIRMING`    | Transaction no longer on canonical chain (reorg)                                                    | `ORPHANED`      | System                            | Absent for ≥ reorg-depth blocks                                                                                                                                                                            | none — nothing was ever credited                                  | `deposit:{id}:orphan`           | `deposit.orphaned`        |
| `CONFIRMING`    | Risk flag, sanctioned counterparty, or amount over review threshold                                 | `MANUAL_REVIEW` | System (RiskEngine)               | —                                                                                                                                                                                                          | none                                                              | `deposit:{id}:review`           | `deposit.held_for_review` |
| `MANUAL_REVIEW` | Staff approves                                                                                      | `CREDITED`      | Admin (role `deposit_reviewer`)   | Reason code + evidence recorded                                                                                                                                                                            | **JE-1**                                                          | `deposit:{id}:credit`           | `deposit.credited.manual` |
| `MANUAL_REVIEW` | Staff rejects                                                                                       | `REJECTED`      | Admin                             | Reason code recorded                                                                                                                                                                                       | none                                                              | `deposit:{id}:reject`           | `deposit.rejected`        |
| `UNATTRIBUTED`  | Staff attributes to a user                                                                          | `CREDITED`      | Admin (role `financial_adjuster`) | Evidence recorded; dual approval above threshold                                                                                                                                                           | **JE-10b**                                                        | `deposit:{id}:attribute`        | `deposit.attributed`      |

**Notes.**

- `CREDITED` is terminal and irreversible in the forward direction. If a credit later
  proves wrong, it is corrected by a compensating transaction, never by moving the deposit
  back to `CONFIRMING`.
- A duplicate webhook for an already-`CREDITED` deposit is acknowledged with `200` and
  ignored. Returning an error would cause the provider to retry forever — AT-1.
- **Reorg policy is UNVALIDATED.** The confirmation threshold and reorg depth are
  configuration values with deliberately conservative defaults until the target network's
  actual finality characteristics are confirmed. See
  [open-questions.md](../open-questions.md) Q5.
- Sweeping (JE-2a/JE-2b) is tracked on a separate `sweep` entity, not on the deposit. A
  deposit's lifecycle ends at `CREDITED`; where the coins subsequently sit is a treasury
  concern and must never affect a customer balance.

**Screens (Phase 3, stage 5).** The three human transitions have an interface at
`/admin/deposits`, in two queues rather than one list: "held for review" asks should this
be credited, "nobody to credit" asks whose is this, and mixing them makes a reviewer skip
rows of the other job. One decision worth recording: an unattributed deposit that landed
on an address we issued **names the customer it was issued to**, resolved through the
address rather than the deposit, so the commonest case - a retired address, or an account
suspended between issuing and arrival - is a decision read off the screen rather than a
guess. Attribution to anybody else goes through a search (see data-classification.md).

**Built (Phase 3, stage 2).** `apps/api/src/modules/deposits/` implements this table as
written, with the table itself in `deposit.machine.ts` and every transition checked
against it before a write. Three things the code is more specific about than the text:

- **Detection and classification are one transaction.** `DETECTED` exists for the length
  of a transaction: the row is inserted (idempotent on the transfer), audited, and moved
  to `CONFIRMING` or `UNATTRIBUTED` before the commit. Both the webhook and the observer
  re-read the transfer from the chain first; a claim the chain does not have is
  acknowledged and not recorded.
- **"Absent for ≥ reorg-depth blocks"** is read as: the transfer is missing from the
  canonical chain and the head has advanced `REORG_DEPTH` past the block it was in. A
  transfer merely not yet indexed is left to wait.
- **The roles are `DEPOSIT_REVIEWER` for all three human transitions** (approve, reject,
  attribute), rather than `financial_adjuster` for attribution: deciding whose money a
  deposit is belongs to one capability. Dual approval of a high-value attribution is
  deferred to stage 5, where withdrawal approvals bring the mechanism. A rejected deposit
  posts nothing, as the table says; the coins it leaves at our address surface as a
  reconciliation surplus (stage 4) until a person attributes or returns them.

Proven in `apps/api/test/api/deposits.spec.ts`: AT-1 (six deliveries around the credit,
one JE-1), AT-20 (orphaned before finality; the credit stands after it), the held and
unattributed paths through the admin routes, and the observer finding what no webhook
mentioned.

---

## 2. Withdrawal

Tracks one outgoing transfer, from user request to confirmed on-chain. This machine has
the most states because it is the only place the platform gives up assets irreversibly.

```
   REQUESTED ──▶ RISK_REVIEW ──▶ APPROVED ──▶ BUILDING ──▶ SIGNING ──▶ BROADCAST ──▶ CONFIRMED
       │              │              │            │           │            │
       │              ▼              │            ▼           ▼            ▼
       │          REJECTED           │       BUILD_FAILED  SIGN_REFUSED  BROADCAST_UNKNOWN
       │              │              │            │           │            │
       ▼              ▼              ▼            ▼           ▼            ▼
   CANCELLED ◀────────┴──────────────┘◀───────────┴───────────┘     MANUAL_INVESTIGATION
       │                                                                   │
       └────────────── hold released (JE-9) ──────────────┘                ▼
                                                            CONFIRMED or FAILED_CONFIRMED
```

| From                        | Event                                                                                       | To                     | Actor                              | Preconditions                                                                                                                                                                                                                                                 | Ledger effect                                                    | Idempotency key           | Audit event                                   |
| --------------------------- | ------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------- | --------------------------------------------- |
| —                           | User submits network, destination, amount                                                   | `REQUESTED`            | User                               | Step-up auth passed; no active security-change cooldown; address format valid for the network; destination not on denylist; amount within per-transaction, daily and velocity limits; **available balance sufficient, checked under `SELECT ... FOR UPDATE`** | **JE-7** (available → pending-withdrawal, plus explicit fee leg) | client `Idempotency-Key`  | `withdrawal.requested`                        |
| `REQUESTED`                 | Risk evaluation                                                                             | `RISK_REVIEW`          | System (RiskEngine)                | Always evaluated; an unavailable risk engine fails closed to `RISK_REVIEW`, never to `APPROVED`                                                                                                                                                               | none                                                             | `wd:{id}:risk`            | `withdrawal.risk_evaluated`                   |
| `RISK_REVIEW`               | Auto-approved under policy                                                                  | `APPROVED`             | System                             | Score below threshold; amount below manual-review threshold; destination previously used or aged past the new-address cooldown                                                                                                                                | none                                                             | `wd:{id}:approve`         | `withdrawal.approved.auto`                    |
| `RISK_REVIEW`               | Staff approves                                                                              | `APPROVED`             | Admin (role `withdrawal_approver`) | Reason recorded. **Dual approval required above the high-value threshold** and required for all withdrawals before real funds                                                                                                                                 | none                                                             | `wd:{id}:approve`         | `withdrawal.approved.manual`                  |
| `RISK_REVIEW`               | Staff or policy rejects                                                                     | `REJECTED`             | Admin / System                     | Reason code recorded                                                                                                                                                                                                                                          | **JE-9** (release hold)                                          | `wd:{id}:reject`          | `withdrawal.rejected`                         |
| `REQUESTED` / `RISK_REVIEW` | User cancels                                                                                | `CANCELLED`            | User                               | Not yet `BUILDING`; owner check                                                                                                                                                                                                                               | **JE-9** (release hold)                                          | client `Idempotency-Key`  | `withdrawal.cancelled`                        |
| `APPROVED`                  | Worker builds unsigned transaction                                                          | `BUILDING` → `SIGNING` | System                             | Hot treasury balance sufficient; nonce/sequence acquired; `BlockchainGateway.buildTokenTransfer` succeeded                                                                                                                                                    | none                                                             | `wd:{id}:build:{attempt}` | `withdrawal.built`                            |
| `BUILDING`                  | Build fails deterministically                                                               | `BUILD_FAILED`         | System                             | Error is definitively pre-broadcast (invalid address, insufficient treasury, unsupported asset)                                                                                                                                                               | **JE-9** (release hold)                                          | `wd:{id}:build_fail`      | `withdrawal.build_failed`                     |
| `SIGNING`                   | Custody provider signs                                                                      | `BROADCAST`            | System + CustodyProvider           | Provider policy satisfied: asset, contract, network, destination, amount, velocity, approvals. Broadcast is idempotent at the provider via a client reference of `withdrawal_id`                                                                              | **JE-8a** (hot treasury → in transit)                            | `wd:{id}:broadcast`       | `withdrawal.broadcast`                        |
| `SIGNING`                   | Provider refuses                                                                            | `SIGN_REFUSED`         | CustodyProvider                    | Refusal is explicit and pre-broadcast                                                                                                                                                                                                                         | **JE-9** (release hold)                                          | `wd:{id}:sign_refused`    | `withdrawal.sign_refused`                     |
| `SIGNING` / `BROADCAST`     | **Timeout or unknown result**                                                               | `BROADCAST_UNKNOWN`    | System                             | Any ambiguity about whether the transaction reached the network                                                                                                                                                                                               | **none**                                                         | `wd:{id}:unknown`         | `withdrawal.broadcast_unknown`                |
| `BROADCAST_UNKNOWN`         | Escalation                                                                                  | `MANUAL_INVESTIGATION` | System → Admin                     | Automatic; alerts on-call                                                                                                                                                                                                                                     | none                                                             | `wd:{id}:investigate`     | `withdrawal.investigation_opened`             |
| `MANUAL_INVESTIGATION`      | Staff confirms the transaction exists on-chain                                              | `BROADCAST`            | Admin                              | Tx hash verified against the chain, not against provider claims                                                                                                                                                                                               | **JE-8a** if not already posted                                  | `wd:{id}:broadcast`       | `withdrawal.investigation_resolved_broadcast` |
| `MANUAL_INVESTIGATION`      | Staff confirms nothing was broadcast, after reorg-depth blocks and nonce reuse verification | `FAILED_CONFIRMED`     | Admin (dual approval)              | Chain verification, not a provider claim                                                                                                                                                                                                                      | **JE-9** (release hold)                                          | `wd:{id}:fail_confirmed`  | `withdrawal.investigation_resolved_failed`    |
| `BROADCAST`                 | Confirmations ≥ finality policy                                                             | `CONFIRMED`            | System                             | Transaction present on canonical chain with required depth                                                                                                                                                                                                    | **JE-8b** (extinguish liability)                                 | `wd:{id}:confirm`         | `withdrawal.confirmed`                        |
| `BROADCAST`                 | Transaction dropped/replaced, verified absent                                               | `MANUAL_INVESTIGATION` | System                             | —                                                                                                                                                                                                                                                             | none                                                             | `wd:{id}:dropped`         | `withdrawal.dropped`                          |

**Notes.**

- `BROADCAST_UNKNOWN` is the single most important state in this system. **It never
  auto-retries and it never auto-refunds** — one would send the money twice, the other
  would give it away twice. The user's funds remain visibly in "Withdrawing" until a human
  resolves it against chain state. AT-9.
- The fee leg on JE-7 is posted even at zero, so enabling withdrawal fees later is
  configuration rather than a new code path.
- `CONFIRMED` and `FAILED_CONFIRMED` are terminal. `CANCELLED`, `REJECTED`,
  `BUILD_FAILED` and `SIGN_REFUSED` are terminal and each released the hold exactly once —
  a released hold is never released again, which is guaranteed by the idempotency key and
  by the escrow-style balance floor.
- Every state that releases a hold does so **only** from a position where non-broadcast is
  certain. There is no path from `BROADCAST` or `BROADCAST_UNKNOWN` directly to a refund.

**Screens (Phase 3, stage 5).** `/admin/withdrawals`, in two queues: money held waiting
for approval, and transfers whose broadcast outcome nobody can be sure of. The second one
is shaped by what it costs to be wrong. The two outcomes are offered as a deliberate
choice, not a dropdown default; "it is on the chain" demands the transaction hash;
"nothing was ever sent" says in the screen's own words that it gives the money back, that
a mistake means the customer was paid twice, and that nothing else in the system will
catch it before the next reconciliation. The screen also tells the approver to decide
against a block explorer and not against a support reply, which is the rule ADR-0010
states and the one a tired person is most likely to break.

**Built (Phase 3, stage 3).** `apps/api/src/modules/withdrawals/` implements this table as
written, with the table itself in `withdrawal.machine.ts`. The four separations of
ADR-0010 are four different callers: the HTTP handler only requests and holds (JE-7), the
risk engine and then a person authorise, the worker signs through the custody provider,
and confirmation settles. Six places the code is more specific than the text:

- **Step-up is the account password, re-entered on the request.** Customers have no second
  factor yet, so this is the strongest step-up available; it also gives the
  security-change cooldown something to hang on, and a withdrawal is refused for 24 hours
  after a password change. WebAuthn or customer TOTP would replace it, not remove it.
- **The daily ceiling is the lower of the KYC tier and the configured maximum.** The
  approval thresholds were moved below that ceiling (500 USDT for one approver, 1,500 for
  two): above it they would be unreachable, because no customer could request enough to
  trip them. **These figures need the owner's confirmation before real funds.**
- **A withdrawal to one of our own attribution addresses is refused.** It would pay gas to
  credit the customer straight back, and it confuses reconciliation.
- **A withdrawal stuck in `SIGNING`** - a worker that died mid-call - is retried by asking
  the provider again, which is safe exactly because the client reference makes the
  provider idempotent. Without this the money would stay stuck forever.
- **`BROADCAST_UNKNOWN` escalates to `MANUAL_INVESTIGATION` in the same transaction** that
  records it. The state is real and audited, but nothing should ever sit in it waiting for
  a second process to notice.
- **Declaring a withdrawal never-sent takes two administrators**, recorded as
  `FAILED_CONFIRMED` approvals distinct from the `SEND` ones, because it is the only
  resolution here that gives money back.

Proven in `apps/api/test/api/withdrawals.spec.ts`, AT-9 included: ten further worker
passes after an ambiguous broadcast leave exactly one transfer on the chain, post no
refund and no broadcast entry, keep the funds visibly held, and the two manual
resolutions each produce exactly the right entries.

---

## 3. Trade

Tracks one P2P trade from acceptance to settlement. The USDT side is fully controlled by
the platform; the ETB side is entirely outside it.

```
        CREATED
           │ escrow locked atomically at creation (JE-3)
           ▼
   AWAITING_FIAT_PAYMENT ──────────────┬──────────────┐
           │                           │              │
           │ buyer marks paid          │ cancel       │ timer expires
           ▼                           ▼              ▼
   BUYER_MARKED_PAID              CANCELLED       EXPIRED
           │      │                (JE-5)          (JE-5)
   release │      │ dispute
           ▼      ▼
      COMPLETED  DISPUTED ──▶ COMPLETED (release, JE-6)
        (JE-4)            └──▶ REFUNDED (refund, JE-5)
```

| From                    | Event                                       | To                                  | Actor                             | Preconditions                                                                                                                                                                                                                                                                                                                        | Ledger effect                                                           | Idempotency key          | Audit event                          |
| ----------------------- | ------------------------------------------- | ----------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ------------------------ | ------------------------------------ |
| —                       | User accepts an offer                       | `CREATED` → `AWAITING_FIAT_PAYMENT` | Buyer or seller (whoever accepts) | Offer `ACTIVE` and not the acceptor's own; amount within offer min/max and remaining volume; price snapshot taken from the offer at acceptance and frozen on the trade; **the USDT-giving party has sufficient available balance under `SELECT ... FOR UPDATE`**; neither party frozen; per-user concurrent-trade limit not exceeded | **JE-3** — escrow locked in the same transaction that creates the trade | client `Idempotency-Key` | `trade.created`, `escrow.locked`     |
| `AWAITING_FIAT_PAYMENT` | Buyer clicks **I have paid**                | `BUYER_MARKED_PAID`                 | Buyer only                        | Trade in `AWAITING_FIAT_PAYMENT`; actor is the buyer; within the payment window                                                                                                                                                                                                                                                      | **none — this moves no money**                                          | client `Idempotency-Key` | `trade.marked_paid`                  |
| `AWAITING_FIAT_PAYMENT` | Either party cancels                        | `CANCELLED`                         | Buyer or seller                   | Buyer has **not** marked paid                                                                                                                                                                                                                                                                                                        | **JE-5** — full escrow refund to the seller                             | client `Idempotency-Key` | `trade.cancelled`, `escrow.refunded` |
| `AWAITING_FIAT_PAYMENT` | Payment window elapses                      | `EXPIRED`                           | System (`trade-expirer`)          | `now()` from the **database** exceeds `payment_deadline`; buyer has not marked paid                                                                                                                                                                                                                                                  | **JE-5** — full escrow refund to the seller                             | `trade:{id}:expire`      | `trade.expired`, `escrow.refunded`   |
| `BUYER_MARKED_PAID`     | Seller confirms receipt of ETB and releases | `COMPLETED`                         | **Seller only**                   | Step-up auth passed; actor is the seller; escrow account balance equals the trade amount                                                                                                                                                                                                                                             | **JE-4** — escrow → buyer available, plus fee leg                       | client `Idempotency-Key` | `trade.completed`, `escrow.released` |
| `BUYER_MARKED_PAID`     | Either party opens a dispute                | `DISPUTED`                          | Buyer or seller                   | Trade in `BUYER_MARKED_PAID`; dispute reason and optional evidence supplied                                                                                                                                                                                                                                                          | none — escrow stays locked                                              | client `Idempotency-Key` | `trade.disputed`                     |
| `BUYER_MARKED_PAID`     | Auto-release timer                          | —                                   | —                                 | **Does not exist.** There is no automatic release path                                                                                                                                                                                                                                                                               | —                                                                       | —                        | —                                    |
| `DISPUTED`              | Admin resolves for the buyer                | `COMPLETED`                         | Admin (role `dispute_resolver`)   | Reason code, free-text rationale and evidence references recorded; resolver is not a party to the trade                                                                                                                                                                                                                              | **JE-6** — escrow → buyer available                                     | `trade:{id}:resolve`     | `dispute.resolved_release`           |
| `DISPUTED`              | Admin resolves for the seller               | `REFUNDED`                          | Admin (role `dispute_resolver`)   | As above                                                                                                                                                                                                                                                                                                                             | **JE-5** — escrow → seller available                                    | `trade:{id}:resolve`     | `dispute.resolved_refund`            |

**Notes.**

- **`BUYER_MARKED_PAID` posts no ledger entry.** It changes a status, starts a seller
  notification and disables ordinary cancellation. A buyer clicking a button in a browser
  cannot move USDT, and no screenshot, SMS, client-side timer or elapsed duration can
  either. AT-4.
- Once the buyer has marked paid, **ordinary cancellation is gone**. The only exits are
  release by the seller or dispute resolution by an admin. This is what stops a buyer from
  paying and then having the seller quietly cancel.
- Expiry uses database time, not application time, because several application processes
  exist and their clocks differ. Whether a trade expired is a question about money.
- Both dispute outcomes are ledger-identical to a normal release or refund. The difference
  lives in the actor, the reason code and the audit trail — AT-8.
- `COMPLETED`, `CANCELLED`, `EXPIRED` and `REFUNDED` are terminal, and each moves the
  escrow account to exactly zero, exactly once. A repeated release request returns the
  original result and credits nobody twice — AT-5.
- Escrow is funded by whoever gives up USDT (ADR-0004), which on a _buy_ offer is the
  accepting user rather than the publisher.

---

## 4. How these are enforced in code

1. **A single `transition()` function per aggregate.** Nothing else writes the `status`
   column. It takes `(currentState, event, context)`, looks the row up in a table
   generated from the tables above, and either returns the new state or throws a typed
   `IllegalTransitionError`.
2. **The transition table is data, not `if` statements**, so it can be exhaustively
   property-tested: for every (state, event) pair not in the table, the call must be
   rejected and nothing must be written. This is one test that covers the whole surface.
3. **A database `CHECK` constraint** restricts the status column to the known enum, and a
   trigger rejects transitions not present in a `allowed_transition` table. The database
   refuses an illegal state even if the application is wrong.
4. **Preconditions are re-checked inside the transaction, after the row lock.** A check
   performed before `BEGIN` is a suggestion, not a guarantee.
5. **The ledger call is made by the same function that writes the state change**, so the
   two cannot drift apart.
