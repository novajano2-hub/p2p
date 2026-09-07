# Glossary

Written for a developer who is comfortable with web programming and has not built an
exchange or worked with double-entry accounting. Read this once; the rest of the docs
assume it.

## Money and accounting

**Double-entry ledger.** A way of recording money where every event is written down
twice: once as a _debit_ and once as a _credit_, and the two sides must sum to the same
number. It is not a style preference; it is a redundancy check. If a bug drops half of a
transaction, the totals stop matching and you find out. A single mutable
`users.balance` column has no such check — a bug there silently creates or destroys money
and nothing tells you.

**Debit and credit.** They do **not** mean "add" and "subtract". They mean "left column"
and "right column". Whether a debit increases or decreases an account depends on the
account's _type_:

| Account type  | Meaning                                     | Increases with |
| ------------- | ------------------------------------------- | -------------- |
| **Asset**     | Something the platform owns or controls     | Debit          |
| **Liability** | Something the platform owes to someone else | Credit         |
| **Equity**    | The owners' residual stake                  | Credit         |
| **Revenue**   | Income earned                               | Credit         |
| **Expense**   | Cost incurred                               | Debit          |

**The crucial mental flip.** A customer's balance is a **liability**, not an asset. When
Sara deposits 100 USDT, the platform gains an asset (100 USDT it now controls on-chain)
_and_ takes on a liability (it owes Sara 100 USDT). Your intuition from a banking app —
"balance = money I have" — is the _customer's_ view. On the platform's books it is money
we owe. Most accounting mistakes in exchanges come from forgetting this.

**Journal entry / ledger transaction.** One business event (a deposit, an escrow lock)
recorded as a group of two or more debit/credit lines that balance to zero.

**Ledger entry / posting line.** One line inside a journal entry: an account, a
direction, an amount.

**Balanced.** Total debits equal total credits, for the same asset, within one journal
entry. INVARIANT.

**Immutable / append-only.** Once a journal entry is written it is never edited or
deleted. To undo something you write a _new_ entry that cancels it out.

**Compensating transaction.** That cancelling entry. If you escrowed 100 USDT and the
trade expired, you do not delete the escrow entry — you post a new entry moving the 100
back. The history then shows both events, which is exactly what an auditor and a disputed
trade both need.

**Chart of accounts / account taxonomy.** The naming scheme for accounts. See
[ledger-taxonomy.md](ledger-taxonomy.md).

**Suspense / clearing account.** A temporary holding account for money that is real but
not yet attributable to a person, or money in flight between two places. Its balance
should trend toward zero; a growing suspense balance is an alarm, not a rounding detail.

**Reconciliation.** Periodically comparing "what our ledger says we should control
on-chain" against "what the blockchain actually shows we control". A mismatch is a
**break**. Breaks are investigated by humans and never auto-corrected.

**Atomic units.** Integers, so there is no floating-point rounding. USDT is stored as
micro-USDT (1 USDT = 1,000,000). ETB is stored as santim (1 ETB = 100). `0.1 + 0.2` is
famously not `0.3` in JavaScript; money never touches a `number` in this codebase.

## Custody and blockchain

**Custodial.** The platform holds the private keys, so users never connect a wallet. The
upside is a simple product; the downside is that the platform becomes the single thing an
attacker wants to break. Non-custodial would push that risk onto users; we are explicitly
not doing that.

**Private key / signing.** The secret that authorizes moving crypto. Whoever has it can
move the money, irreversibly, with no chargeback. It must live inside a dedicated
custody/signing provider (an HSM-backed service), **never** in our Node.js process,
database, logs, environment files, queues or CI.

**Custody provider.** A vendor whose product is "we hold keys and sign transactions
according to a policy you configure". We talk to it through an adapter interface so
domain code never imports a vendor SDK.

**Pooled wallet.** All customer crypto physically sits together in a few platform
wallets, rather than one wallet per customer. Cheaper and simpler to operate; it means
ownership exists _only_ in our ledger, which is precisely why the ledger must be correct.

**Unique deposit address (attribution address).** Each user gets their own address so we
know who sent an incoming payment. This is compatible with pooling: the address tells us
_who_, the pool tells us _where_. Funds are later **swept** from attribution addresses
into treasury.

**Sweep.** Moving funds from many deposit addresses into a treasury wallet. It is an
on-chain transaction that changes _where_ assets sit but must not change _who owns them_
in the ledger. INVARIANT.

**Hot / cold wallet.** Hot = keys reachable by automated signing, used for outgoing
withdrawals, deliberately kept small. Cold = reserve, requires stronger human
authorization to move.

**Confirmations / finality.** After a transaction appears on-chain it can still be undone
by a **reorganization (reorg)** until enough later blocks are built on top. The number of
blocks we wait before crediting a customer is the **finality policy**. Credit too early
and a reorg lets an attacker deposit and withdraw the same money twice.
UNVALIDATED for Plasma.

**Gas.** The fee paid to get a transaction included on-chain. **Sponsored gas** (a
_paymaster_) means a third party pays it so the user does not need to hold the network's
native token. Plasma advertises sponsored USDT transfers under conditions we have not
confirmed. UNVALIDATED.

**Webhook.** An HTTP callback from the custody provider saying "a deposit arrived". It is
an _untrusted hint_. We verify its signature, then verify the underlying fact
independently against the chain. We never credit a customer because an HTTP request said
so. INVARIANT.

## Marketplace

**P2P (peer-to-peer) marketplace.** Users post advertisements ("offers"); another user
accepts one, creating a **trade**. This is not an order book and there is no matching
engine.

**Offer.** An advertisement: buy or sell, price in ETB per USDT, min/max amount, accepted
payment methods, terms.

**Escrow.** Holding the seller's USDT so they cannot spend it while the buyer pays. Here
escrow is **an internal ledger hold**, not an on-chain smart contract — USDT moves from
the seller's _available_ account to a _trade escrow_ account. No blockchain involvement,
no gas, instant, reversible by policy.

**Out-of-band settlement.** The ETB half of the trade happens in a real bank or mobile
money app, outside our system. We never see it. This is the single largest source of
fraud risk and it is not technically solvable by us — see the
[threat model](../threat-model/README.md).

**Step-up authentication.** Re-proving identity (MFA/passkey) at the moment of a
dangerous action — releasing escrow, withdrawing, changing payment details — even though
the session is already logged in.

## Engineering machinery

**Idempotency key.** A caller-supplied unique string on a mutating request. If the same
key arrives twice, the second call returns the first call's result instead of doing the
work again. Backed by a database uniqueness constraint, not an in-memory map. This is how
"the user double-clicked" and "the load balancer retried" stop being financial incidents.
INVARIANT.

**At-least-once delivery.** Queues and webhooks may deliver the same message more than
once, and eventually will. There is no "exactly once" to design against; instead every
consumer is made idempotent.

**Outbox pattern.** To avoid "database committed but the notification was lost" — or
worse, "notification sent but the database rolled back" — you write the _intent_ to send
into an `outbox` table inside the same database transaction as the business change. A
separate worker reads the outbox and performs the sending.

**Row lock (`SELECT ... FOR UPDATE`).** Telling PostgreSQL "nobody else may touch this row
until my transaction ends". This is how two concurrent trades are prevented from spending
the same USDT. A Redis lock is _not_ sufficient — its lease can expire mid-transaction and
its expiry is not coordinated with the database. INVARIANT.

**Projection.** A derived, cached view that can be rebuilt from the source of truth. Our
balance table is a projection of the ledger. If it is ever wrong we recompute it from the
immutable entries. AT-11.

**Fail closed.** When something is uncertain — an unknown risk score, an unreachable
provider, an ambiguous broadcast result — the system refuses the action rather than
allowing it. The default answer to "should this money move?" is no.
