# Ledger Account Taxonomy and Journal Entries

If you read only one document in this repository, read this one. Everything else exists to
protect what is described here.

New to double-entry? Read [glossary.md](glossary.md) first — specifically the section
explaining that **a customer's balance is a liability of the platform, not an asset.**

---

## 1. The mental model in one picture

```
        WHAT WE CONTROL                        WHO IT BELONGS TO
        (assets, real coins)                   (liabilities, promises)

   ┌──────────────────────────┐          ┌──────────────────────────────┐
   │ Deposit addresses        │          │ Sara — available      120    │
   │ Hot treasury             │  ═════   │ Dawit — available      45    │
   │ Cold treasury            │  MUST    │ Dawit — pending w/d    50    │
   │ In transit               │  EQUAL   │ Trade T-123 — escrow  100    │
   │                          │  (±)     │ Unidentified deposits   0    │
   │              total 315   │          │              total    315    │
   └──────────────────────────┘          └──────────────────────────────┘
              ▲                                        ▲
              │                                        │
     verified against the chain              maintained by our ledger
     by the reconciler                       every transaction balances
```

The left column is physics: coins exist at addresses and anyone can check. The right
column is bookkeeping: it exists only in our PostgreSQL. **Reconciliation is the process
of proving the two columns still agree.** When they stop agreeing, either we have a bug or
we have been robbed, and either way a human needs to know within minutes.

Note that the two columns are equal here only because platform revenue and expense are
zero. The general identity is:

```
  Σ Assets  =  Σ Liabilities  +  Σ Equity  +  Σ Revenue  −  Σ Expenses
```

---

## 2. Account naming scheme

```
{TYPE}:{SCOPE}:{OWNER}:{ASSET}:{PURPOSE}
```

| Segment   | Values                                                   |
| --------- | -------------------------------------------------------- |
| `TYPE`    | `ASSET` · `LIAB` · `EQUITY` · `REV` · `EXP`              |
| `SCOPE`   | `USER` · `TRADE` · `PLATFORM`                            |
| `OWNER`   | a UUIDv7, or omitted for `PLATFORM`                      |
| `ASSET`   | `USDT` (only asset at launch — see §7)                   |
| `PURPOSE` | free segment, e.g. `AVAILABLE`, `ESCROW`, `TREASURY_HOT` |

The string is a human-readable _code_; the primary key is a UUID. The code is stored in a
`UNIQUE` column so that "get or create the account for this trade" is a single safe
upsert.

### Normal balance and negativity rules

| Type     | Increases with | Customer-facing? | May go negative?    |
| -------- | -------------- | ---------------- | ------------------- |
| `ASSET`  | Debit          | no               | no (constraint)     |
| `LIAB`   | Credit         | yes              | **no (constraint)** |
| `EQUITY` | Credit         | no               | yes                 |
| `REV`    | Credit         | no               | yes (refunds)       |
| `EXP`    | Debit          | no               | yes (recoveries)    |

The `allows_negative` flag on `ledger_account` drives a `CHECK` constraint on the balance
projection (ADR-0009). Customer accounts and escrow accounts are hard-floored at zero **in
the database**, not in application code.

---

## 3. The chart of accounts

### 3.1 Customer liability accounts — what we owe users

One set per user. Created on first use.

| Code                                         | Type | Meaning                                                                            |
| -------------------------------------------- | ---- | ---------------------------------------------------------------------------------- |
| `LIAB:USER:{userId}:USDT:AVAILABLE`          | LIAB | Spendable. This is the number the user sees as "Available".                        |
| `LIAB:USER:{userId}:USDT:PENDING_WITHDRAWAL` | LIAB | Committed to a withdrawal that has not yet left the chain. Shown as "Withdrawing". |

There is deliberately **no** per-user escrow account; escrow is per-trade (ADR-0004). The
user's "In escrow" figure in the UI is the sum of the escrow accounts of their open
trades, maintained as a projection.

### 3.2 Trade escrow accounts — money frozen inside a trade

| Code                               | Type | Meaning                                |
| ---------------------------------- | ---- | -------------------------------------- |
| `LIAB:TRADE:{tradeId}:USDT:ESCROW` | LIAB | The USDT locked for exactly one trade. |

INVARIANT: for a trade in a terminal state (`COMPLETED`, `CANCELLED`, `EXPIRED`,
`REFUNDED`) this balance is exactly `0`. For a trade in `AWAITING_FIAT_PAYMENT`,
`BUYER_MARKED_PAID` or `DISPUTED` it equals the trade's USDT amount. This is checked by an
invariant test over every trade in the database (AT-10, AT-14).

### 3.3 Platform asset accounts — coins we actually control

| Code                                    | Type  | Meaning                                                                                                              |
| --------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------- |
| `ASSET:PLATFORM:USDT:DEPOSIT_ADDRESSES` | ASSET | Sitting in per-user attribution addresses, not yet swept.                                                            |
| `ASSET:PLATFORM:USDT:TREASURY_HOT`      | ASSET | Pooled wallet reachable by automated signing; funds withdrawals.                                                     |
| `ASSET:PLATFORM:USDT:TREASURY_COLD`     | ASSET | Reserve; stronger authorization to move.                                                                             |
| `ASSET:PLATFORM:USDT:IN_TRANSIT`        | ASSET | Broadcast but not yet confirmed — sweeps in flight, withdrawals in flight. A clearing account; should trend to zero. |

`IN_TRANSIT` deserves emphasis. It is the account that stops us from lying to ourselves
during the seconds or minutes when a transaction has been broadcast and its outcome is
unknown. If it has a persistently non-zero balance, something is stuck and the reconciler
should say so.

### 3.4 Platform suspense and holding accounts

| Code                                         | Type | Meaning                                                                              |
| -------------------------------------------- | ---- | ------------------------------------------------------------------------------------ |
| `LIAB:PLATFORM:USDT:UNIDENTIFIED_DEPOSITS`   | LIAB | Real money arrived that we cannot attribute to a user. We hold it and owe _someone_. |
| `LIAB:PLATFORM:USDT:RECONCILIATION_SUSPENSE` | LIAB | An unexplained on-chain **surplus** under investigation. Never spent.                |

### 3.5 Platform revenue and expense

| Code                                | Type | Meaning                                                                                                                   |
| ----------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------- |
| `REV:PLATFORM:USDT:TRADE_FEES`      | REV  | P2P fee. **Zero at launch**, but the account and the posting leg exist from day one.                                      |
| `REV:PLATFORM:USDT:WITHDRAWAL_FEES` | REV  | Platform withdrawal fee. Zero at launch.                                                                                  |
| `EXP:PLATFORM:USDT:NETWORK_FEES`    | EXP  | Gas we pay, expressed in USDT when gas is denominated in USDT or when sponsorship does not apply. UNVALIDATED for Plasma. |
| `EXP:PLATFORM:USDT:LOSSES`          | EXP  | Write-offs from confirmed shortfalls, goodwill payments and unrecoverable breaks. Requires human authorization to post.   |

### 3.6 Equity

| Code                                   | Type   | Meaning                                                                                                                                                               |
| -------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EQUITY:PLATFORM:USDT:OPENING_BALANCE` | EQUITY | Used only to seed a fresh environment in tests and local development, so that fixtures start from a balanced state instead of from nothing. Never used in production. |

---

## 4. Worked journal entries

Every example below balances: debits equal credits. Amounts are in micro-USDT;
`100 USDT = 100,000,000`. Read each as "what we control changed" on the asset side and
"who it belongs to changed" on the liability side.

### JE-1 — Deposit credited (finality reached)

Sara sends 100 USDT to their attribution address, and the confirmation policy is satisfied.

| Account                                 |          Dr |          Cr |
| --------------------------------------- | ----------: | ----------: |
| `ASSET:PLATFORM:USDT:DEPOSIT_ADDRESSES` | 100,000,000 |             |
| `LIAB:USER:sara:USDT:AVAILABLE`         |             | 100,000,000 |

_Reading it:_ we now control 100 more USDT (asset up → debit) and we owe Sara 100 more
(liability up → credit). Sara's app shows +100 available.

Reference: `deposit_id`. Reason: `DEPOSIT_CREDITED`. Idempotency key:
`deposit:{depositId}:credit`. This entry is the **only** thing that turns an on-chain
event into a customer balance, and it happens once — AT-1.

### JE-2 — Sweep to treasury (two steps)

Moving Sara's deposited coins into the pooled hot wallet. Note that **no liability account
appears in either step**: sweeping changes where coins sit, never who owns them.

**JE-2a — broadcast**

| Account                                 |          Dr |          Cr |
| --------------------------------------- | ----------: | ----------: |
| `ASSET:PLATFORM:USDT:IN_TRANSIT`        | 100,000,000 |             |
| `ASSET:PLATFORM:USDT:DEPOSIT_ADDRESSES` |             | 100,000,000 |

**JE-2b — confirmed**

| Account                            |          Dr |          Cr |
| ---------------------------------- | ----------: | ----------: |
| `ASSET:PLATFORM:USDT:TREASURY_HOT` | 100,000,000 |             |
| `ASSET:PLATFORM:USDT:IN_TRANSIT`   |             | 100,000,000 |

**JE-2b′ — variant where 0.1 USDT of gas is deducted from the transferred amount**

| Account                            |         Dr |          Cr |
| ---------------------------------- | ---------: | ----------: |
| `ASSET:PLATFORM:USDT:TREASURY_HOT` | 99,900,000 |             |
| `EXP:PLATFORM:USDT:NETWORK_FEES`   |    100,000 |             |
| `ASSET:PLATFORM:USDT:IN_TRANSIT`   |            | 100,000,000 |

Sara still has exactly 100 available. The platform absorbed the cost. Whether sweeps are
gas-free on the target network is UNVALIDATED — the accounting supports both outcomes,
which is the point of writing it down now.

### JE-3 — Escrow lock (Dawit accepts Sara's sell offer for 100 USDT)

| Account                         |          Dr |          Cr |
| ------------------------------- | ----------: | ----------: |
| `LIAB:USER:sara:USDT:AVAILABLE` | 100,000,000 |             |
| `LIAB:TRADE:T-123:USDT:ESCROW`  |             | 100,000,000 |

_Reading it:_ we owe Sara 100 less _available_ and we owe 100 into trade T-123. Total
liabilities are unchanged. **No asset account is touched. Nothing happens on-chain. No gas
is paid.** This single entry is the reason a P2P trade on this platform is instant and
free — and the reason the ledger has to be right.

Reference: `trade_id`. Reason: `ESCROW_LOCKED`. Idempotency key: `trade:{tradeId}:lock`.
Taken with `SELECT ... FOR UPDATE` on Sara's available balance row, which is what stops
two buyers from locking the same coins — AT-2, AT-3.

### JE-4 — Release to buyer (Sara confirms they received the birr)

Launch configuration, platform fee zero:

| Account                          |          Dr |          Cr |
| -------------------------------- | ----------: | ----------: |
| `LIAB:TRADE:T-123:USDT:ESCROW`   | 100,000,000 |             |
| `LIAB:USER:dawit:USDT:AVAILABLE` |             | 100,000,000 |
| `REV:PLATFORM:USDT:TRADE_FEES`   |             |           0 |

The zero-amount fee leg is posted deliberately (brief: _"include an explicit fee entry even
when the platform fee is zero"_). It keeps the transaction shape identical whether or not
a fee applies, so fee reporting never needs a special case and turning fees on is a
configuration change rather than a code change. The `amount >= 0` constraint permits it;
the "at least two entries" invariant is satisfied by the two non-zero legs.

Escrow account T-123 is now exactly zero.

### JE-4′ — The same release with a 0.5% fee charged to the buyer

| Account                          |          Dr |         Cr |
| -------------------------------- | ----------: | ---------: |
| `LIAB:TRADE:T-123:USDT:ESCROW`   | 100,000,000 |            |
| `LIAB:USER:dawit:USDT:AVAILABLE` |             | 99,500,000 |
| `REV:PLATFORM:USDT:TRADE_FEES`   |             |    500,000 |

Debits 100,000,000; credits 99,500,000 + 500,000 = 100,000,000. Balanced.

**Who pays the fee is an open question** — see [open-questions.md](../open-questions.md)
Q3. Charging the buyer (shown here) reduces what they receive; charging the seller means
locking `amount + fee` at JE-3, which changes the escrow amount and therefore the offer's
displayed limits. These are different products, and the decision must be made before
Phase 4.

### JE-5 — Trade expired unpaid, escrow refunded

| Account                         |          Dr |          Cr |
| ------------------------------- | ----------: | ----------: |
| `LIAB:TRADE:T-123:USDT:ESCROW`  | 100,000,000 |             |
| `LIAB:USER:sara:USDT:AVAILABLE` |             | 100,000,000 |

This is a **new** transaction carrying `reverses_transaction_id = {JE-3 id}` and reason
`ESCROW_REFUNDED_EXPIRY`. JE-3 is not edited and not deleted. The history shows the money
went in and came back, which is what a support agent needs to see. Exactly once — AT-7.

### JE-6 — Dispute resolved in the buyer's favor

Ledger shape identical to JE-4. What differs is everything around it: `actor` is the
admin's user ID, `reason` is `DISPUTE_RESOLVED_RELEASE`, and the transaction is linked to
a `dispute_id` and a mandatory free-text reason plus evidence references in the audit
trail. The ledger records what moved; the audit event records who decided and why —
AT-8.

### JE-7 — Withdrawal requested (funds held)

Dawit requests a withdrawal of 50 USDT, platform fee zero.

| Account                                   |         Dr |         Cr |
| ----------------------------------------- | ---------: | ---------: |
| `LIAB:USER:dawit:USDT:AVAILABLE`          | 50,000,000 |            |
| `LIAB:USER:dawit:USDT:PENDING_WITHDRAWAL` |            | 50,000,000 |
| `REV:PLATFORM:USDT:WITHDRAWAL_FEES`       |            |          0 |

Still purely a liability reshuffle: we owe Dawit the same total, but 50 of it is no longer
spendable. Nothing has left the platform. This is what makes AT-3 possible — the hold and
a concurrent trade both contend for the same available balance row.

### JE-8 — Withdrawal broadcast, then confirmed (two steps)

**JE-8a — broadcast: coins leave the hot wallet, outcome not yet certain**

| Account                            |         Dr |         Cr |
| ---------------------------------- | ---------: | ---------: |
| `ASSET:PLATFORM:USDT:IN_TRANSIT`   | 50,000,000 |            |
| `ASSET:PLATFORM:USDT:TREASURY_HOT` |            | 50,000,000 |

**JE-8b — confirmed: the debt is extinguished**

| Account                                   |         Dr |         Cr |
| ----------------------------------------- | ---------: | ---------: |
| `LIAB:USER:dawit:USDT:PENDING_WITHDRAWAL` | 50,000,000 |            |
| `ASSET:PLATFORM:USDT:IN_TRANSIT`          |            | 50,000,000 |

_Reading JE-8b:_ we owe Dawit 50 less (liability down → debit) and we control 50 fewer
coins (asset down → credit). After this the platform's balance sheet has shrunk by 50 on
both sides, which is exactly what a withdrawal is.

Splitting broadcast from confirmation is what makes the ambiguous case representable: if
JE-8a has posted and JE-8b has not, the money is in `IN_TRANSIT` and Dawit's funds are in
`PENDING_WITHDRAWAL`. Nobody has lost anything and nothing has been double-counted; a
human resolves it (ADR-0010, AT-9).

### JE-9 — Withdrawal failed before broadcast, hold released

| Account                                   |         Dr |         Cr |
| ----------------------------------------- | ---------: | ---------: |
| `LIAB:USER:dawit:USDT:PENDING_WITHDRAWAL` | 50,000,000 |            |
| `LIAB:USER:dawit:USDT:AVAILABLE`          |            | 50,000,000 |

Permitted **only** from states where we know with certainty that nothing was broadcast
(`REJECTED`, `CANCELLED`, `BUILD_FAILED`). Never from `BROADCAST_UNKNOWN`.

### JE-10 — Unidentified deposit, later attributed

Money arrives at a retired address, or with an amount below the dust policy, or from a
contract interaction we do not recognize.

**JE-10a — received but unattributable**

| Account                                    |         Dr |         Cr |
| ------------------------------------------ | ---------: | ---------: |
| `ASSET:PLATFORM:USDT:DEPOSIT_ADDRESSES`    | 25,000,000 |            |
| `LIAB:PLATFORM:USDT:UNIDENTIFIED_DEPOSITS` |            | 25,000,000 |

We record it honestly: we control the coins and we owe them to _someone_. We do not
discard the event and we do not guess an owner.

**JE-10b — support identifies the sender as Sara**

| Account                                    |         Dr |         Cr |
| ------------------------------------------ | ---------: | ---------: |
| `LIAB:PLATFORM:USDT:UNIDENTIFIED_DEPOSITS` | 25,000,000 |            |
| `LIAB:USER:sara:USDT:AVAILABLE`            |            | 25,000,000 |

Requires an authorized adjustment workflow with evidence and audit — not a script, and not
an admin editing a balance.

### JE-11 — Reconciliation break: unexplained on-chain surplus

The chain shows 1 USDT more in hot treasury than the ledger expects.

| Account                                      |        Dr |        Cr |
| -------------------------------------------- | --------: | --------: |
| `ASSET:PLATFORM:USDT:TREASURY_HOT`           | 1,000,000 |           |
| `LIAB:PLATFORM:USDT:RECONCILIATION_SUSPENSE` |           | 1,000,000 |

Recorded as something we may owe, never as revenue. The reconciler itself does **not**
post this — it raises a break; a human posts it through the adjustment workflow after
investigation (ADR-0009).

### JE-12 — Reconciliation break: confirmed shortfall written off

| Account                            |        Dr |        Cr |
| ---------------------------------- | --------: | --------: |
| `EXP:PLATFORM:USDT:LOSSES`         | 1,000,000 |           |
| `ASSET:PLATFORM:USDT:TREASURY_HOT` |           | 1,000,000 |

Customer liabilities are untouched — users are not made to absorb a platform loss by
having their balances quietly reduced. The platform's equity absorbs it. This entry
requires the highest authorization level in the system.

---

## 5. Full worked scenario

Starting from an empty environment, following the brief's example end to end. Balances
after each step, in whole USDT for readability.

| Step                  | Entry  | Sara avail | Dawit avail | T-123 escrow | Dawit pending | Deposit addrs | Hot treasury | In transit |
| --------------------- | ------ | ---------: | ----------: | -----------: | ------------: | ------------: | -----------: | ---------: |
| Start                 | —      |          0 |           0 |            0 |             0 |             0 |            0 |          0 |
| Sara deposits 100     | JE-1   |        100 |           0 |            0 |             0 |           100 |            0 |          0 |
| Sweep broadcast       | JE-2a  |        100 |           0 |            0 |             0 |             0 |            0 |        100 |
| Sweep confirmed       | JE-2b  |        100 |           0 |            0 |             0 |             0 |          100 |          0 |
| Dawit accepts offer   | JE-3   |          0 |           0 |      **100** |             0 |             0 |          100 |          0 |
| Dawit marks paid      | _none_ |          0 |           0 |          100 |             0 |             0 |          100 |          0 |
| Sara confirms release | JE-4   |          0 |         100 |        **0** |             0 |             0 |          100 |          0 |
| Dawit withdraws 50    | JE-7   |          0 |          50 |            0 |            50 |             0 |          100 |          0 |
| Broadcast             | JE-8a  |          0 |          50 |            0 |            50 |             0 |           50 |         50 |
| Confirmed             | JE-8b  |          0 |          50 |            0 |         **0** |             0 |           50 |          0 |

Check the final row: liabilities are Sara 0 + Dawit 50 = 50. Assets are 0 + 50 + 0 = 50.
Balanced.

Two rows deserve attention:

- **"Dawit marks paid" posts no ledger entry at all.** It is a state change and a
  notification, nothing more. A buyer clicking a button in a browser must never move
  money — AT-4. This is the single most important line in the table.
- **"Dawit accepts offer" moves 100 USDT with no on-chain transaction.** The asset columns
  do not change. That is the escrow design working as intended.

---

## 6. Invariants this taxonomy makes checkable

| #   | Invariant                                                          | How it is enforced                                                                                                     | Status                              |
| --- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| L1  | Every ledger transaction has ≥ 2 entries                           | Deferred constraint trigger `ledger_entries_balance_check`                                                             | **Built**                           |
| L2  | Debits = credits per `(transaction, asset)`                        | Same trigger, on `SUM(signed_amount) = 0`                                                                              | **Built**                           |
| L3  | One asset per ledger transaction                                   | Same trigger, on `COUNT(DISTINCT asset) = 1`                                                                           | **Built**                           |
| L4  | Entries are immutable                                              | `REVOKE UPDATE, DELETE, TRUNCATE` from `abay_app` **and** raising triggers that stop everyone else, superuser included | **Built**                           |
| L5  | Customer and escrow balances never negative                        | `CHECK (balance >= 0 OR allows_negative)` on the projection                                                            | **Built**                           |
| L6  | Escrowed funds are not simultaneously available                    | Follows from L2 + per-trade accounts + row locking; asserted by AT-2                                                   | Stage 2 (locking), Phase 4 (escrow) |
| L7  | Settled trade escrow balance is exactly 0                          | Invariant test across all trades (AT-14)                                                                               | Phase 4                             |
| L8  | Balances rebuilt from entries equal the projection                 | Rebuild-and-compare test (AT-11)                                                                                       | Stage 3                             |
| L9  | Σ controlled on-chain assets = Σ customer liabilities ± in-flight  | Reconciler; break detection tested by AT-12                                                                            | Phase 3                             |
| L10 | Every transaction carries reference, actor, reason, correlation ID | `NOT NULL` columns on `ledger_transactions`                                                                            | **Built**                           |

The built rows live in `packages/database/sql/` (`ledger-invariants.sql`,
`ledger-immutability.sql`, `ledger-balance-projection.sql`,
`ledger-chart-of-accounts.sql`), applied by migration `20260912090000_ledger`.

Three implementation notes where the code is more specific than this document was:

- **`signed_amount` is a stored column**, not computed per query, bound to `direction` and
  `amount` by a `CHECK` so the two cannot disagree. `direction` is kept alongside it
  because a zero-amount leg — the fee leg while fees are off — has no sign to infer one
  from.
- **The balance projection is maintained by a trigger on the entries**, so a posting
  cannot fail to move a balance, and the natural-sign arithmetic (debit-positive for
  assets and expenses, credit-positive for the rest) exists in exactly one place.
- **`allows_negative` lives on the balance row**, not on the account, because that is
  where the `CHECK` that consumes it lives and a constraint cannot read another table. It
  is derived from the account's type when the account is created. `ledger_account_balances`
  deliberately keeps `UPDATE` for the application role: PostgreSQL requires that privilege
  to take `SELECT ... FOR UPDATE`, which is the lock the whole concurrency design rests
  on. What makes that safe is that the table is derived — the immutable thing is the
  history, and a wrong balance is rebuilt rather than lost.

---

## 7. Why there are no ETB accounts

Ethiopian birr never enters the ledger at launch. The platform does not hold, receive,
transfer or owe birr — the buyer pays the seller directly through a bank or mobile money
service, and we never see it.

ETB therefore appears only as **reference data on the trade**: `etb_price_per_usdt`,
`etb_total_santim`, and the payment instructions shown to the buyer. These are stored as
integers (santim) with the same discipline as USDT, but there is no `LIAB:USER:...:ETB`
account because the platform owes nobody any birr.

This is worth being explicit about because it is the boundary of what the platform can
promise. **We can prove Sara's USDT was locked. We cannot prove Dawit sent any birr.** No
amount of ledger correctness changes that; see the [threat model](../threat-model/README.md),
risk R-01.

If the platform ever holds customer birr — a settlement account, a payout balance — it
becomes a different product with different obligations, and this document must be revised
before a single line of that code is written. See [open-questions.md](../open-questions.md) Q4.
