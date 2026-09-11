# Open Questions and Unvalidated Assumptions

Two lists. **Section 1** blocks work and needs an answer from the project owner.
**Section 2** is the register of things stated as if true anywhere in this repository that
have not actually been verified. Nothing in Section 2 may be relied on in code, in copy,
or in a promise to a user until it moves out of this list.

This file is the visible home for unresolved security- and money-critical items. The brief
forbids hiding them as `TODO` comments in code, so they live here.

---

## 1. Blocking questions

Ordered by how soon an answer is needed.

### Q1 — Where does this project's repository live? **Blocks Phase 0.5**

The current working tree is a git worktree of a repository whose root is
`C:\Users\hp` — the Windows home directory — and it contains an unrelated Java/Spring
project (`liwatch`: barter, community groups, chat). `C:\Users\hp\Desktop\p2p`, where
`CLAUDE.md` lives, is **not** a git repository.

So "beginning from an empty repository" is not currently true of the checkout, and any
commit made here lands in the history of an unrelated project. It also means the home
directory is under version control, which will eventually try to track `.ssh`,
`.aws`, browser profiles and similar.

**Proposed:** `git init` a fresh repository at `C:\Users\hp\Desktop\p2p`, move these docs
into it as the first commit, and leave the `liwatch` repository alone. **Please confirm
before I create or move anything**, since it touches your existing repository layout.

### Q2a — The admin realm is reachable from the open internet with only a password. **Blocks any deployment on a public hostname**

Built (2026-09-10, commit c313670 on `feat/admin-realm`): a separate `AdminUser` realm,
its own session, its own routes under `/v1/admin` and `/admin`, append-only audit events.
What it is not: restricted to who can even attempt to sign in. Today `/admin/login` is
served to anyone who requests it, from anywhere, and a correct password alone is enough to
open an identity-verification queue holding RESTRICTED personal data.

That is acceptable right now. Nothing here is reachable except on localhost or this LAN,
and there is no attacker on either. It stops being acceptable the moment this application
is reachable at a public hostname, or the moment a real customer's identity documents land
in the queue — whichever comes first.

**Decision, recorded so it cannot quietly slip:** before either of those happens, put the
admin realm behind an edge-level gate the application itself cannot be bypassed to reach -
Cloudflare Access is the natural choice, since the project already holds a Cloudflare
account for R2. Free for a team this size; pure configuration, no code. MFA on the
`AdminUser` account itself and a rate limit on `/v1/admin/auth/login` (both already named
in the threat model, B7.3) are the defense-in-depth layer to add once Access is live, not
a substitute for it.

**Update:** two of the three defence-in-depth layers are now built. The rate limit -
ten attempts per IP and five per account in a quarter of an hour, asserted in
`apps/api/test/api/security.spec.ts`. And MFA - mandatory TOTP on every admin account
(`apps/api/test/api/admin-mfa.spec.ts`, threat model note 3), though hardware keys
rather than authenticator apps remain the eventual goal. What is still **not** built is
the Access gate itself: the admin login is reachable from the open internet, now behind
a password and a code rather than a password alone, but still reachable. A limit and a
second factor make the door far harder to force; they do not take it off the internet,
which is what this entry is about. **Not discharged.**

This is a go/no-go gate for the first public deployment, not a backlog item.

### Q2 — Is admin identity a role on `User`, or a separate account realm? **Blocks Phase 1**

Two workable designs with different security properties:

- **(a) Roles on `User`.** Simpler; one auth system; admin capability is a role plus route
  guards. Risk: a customer-account compromise path is also an admin-account compromise
  path.
- **(b) Separate `AdminUser` table and auth realm.** Stronger isolation, mandatory
  hardware MFA, no shared session infrastructure, admins cannot also trade. More work.

**Recommendation: (b).** The threat model rates insider and admin-compromise risk as
Medium-residual (R-08), and separation is far cheaper to build now than to retrofit once
sessions, audit and notifications assume a single user table.

### Q3 — Who pays the P2P trade fee, and is it a fixed amount or a percentage? **Blocks Phase 4, wanted for Phase 0.5 copy**

The fee is zero at launch, but its _shape_ changes the escrow amount and therefore the
trade creation entry:

- **Buyer pays** — escrow the trade amount, split the release (JE-4′). Buyer receives less
  than the headline amount.
- **Seller pays** — escrow `amount + fee` at trade creation. Changes offer limits and the
  balance a seller needs to publish an offer.
- **Split** — both of the above.

These are different products from the user's point of view. Even at 0%, pick one now so
the ledger shape and the UI copy do not need reworking later.
**Recommendation: buyer pays a percentage**, which is the common convention in P2P crypto
marketplaces and keeps "list 100, escrow 100" simple for sellers.

### Q4 — Will the platform ever hold customer ETB? **Blocks the ledger taxonomy being final**

Phase 0 assumes **no**: birr moves bank-to-bank between users and appears only as
reference data on a trade. There are no ETB ledger accounts
([ledger-taxonomy.md](architecture/ledger-taxonomy.md) §7).

If an ETB balance, settlement account or payout feature is ever intended, the taxonomy,
the reconciliation model and the entire threat model change materially and must be
revised before that code is written. Confirming "no, not ever, in this product" now is
worth thirty seconds.

### Q5 — Deposit finality policy: how many confirmations, and what reorg depth? **Blocks Phase 3 defaults, needs real data before Phase 6**

Crediting too early lets an attacker deposit, trade, withdraw, and then have the deposit
reorged away. Crediting too late makes the product feel broken.

I cannot answer this without confirmed data about the target network's finality
characteristics, which I do not have. Phase 3 will use a deliberately conservative
configurable default and the mock will simulate reorgs at that depth (AT-20). **A real
number must come from authoritative network documentation before Phase 6**, not from an
estimate.

### Q6 — Which custody/signing provider, and does it support the target network at all? **Blocks Phase 6; shapes the `CustodyProvider` interface now**

Two sub-questions with different urgency:

1. _Interface shape (soon):_ does the provider issue per-user deposit addresses natively,
   or do we derive addresses and register them? Does it expose a policy engine, and does
   it support the idempotent client-reference pattern ADR-0010 depends on?
2. _Feasibility (before committing to the network):_ **does any provider you would
   actually use support this network?** Custody support for newer networks is typically
   the binding constraint, not the network's own capabilities.

The adapter design means a wrong guess is cheap. But if the answer to (2) is "none", the
network choice is decided for us, and it is better to learn that before Phase 6.

### Q7 — Can your users actually get USDT onto the target network today? **Should be answered before Phase 1**

The one question here that no amount of correct code can compensate for. If the exchanges
and wallets Ethiopian users actually hold funds in do not support withdrawing USDT to this
network, then deposits are impractical regardless of how good the platform is. Risk R-12.

This is a market question, answerable in an afternoon by checking the withdrawal network
options on the two or three services your target users actually use. **I would strongly
suggest answering it before we build on the assumption**, because the alternative — a
better-supported network with ordinary gas costs — is a change of one config file now and
a much larger change later.

### Q8 — Product name, or shall I use a placeholder? **Needed for Phase 0.5 only**

The brief says brand does not block architecture, and it does not. But the landing page
you asked for next needs _something_. If you have a name, colors, or a tone in mind, tell
me. Otherwise I will use a clearly-temporary placeholder and keep all branding in one
theme file so swapping it is a five-minute change.

Also useful for the landing page, though not blocking: is the primary audience
Amharic-speaking, English-speaking, or both? It affects layout decisions (text expansion,
font stack) that are cheap now and annoying later.

---

## 2. Unvalidated assumption register

Every claim marked **UNVALIDATED** in this repository, collected. None of these has been
verified by me against authoritative sources, and I am not able to verify several of them
without provider access. Treat each as a hypothesis with an owner.

| #    | Assumption stated somewhere in these docs                                                                  | Where              | Impact if false                                                         | How it gets validated                                                          |
| ---- | ---------------------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| U-1  | Plasma supports USDT with a stable, identifiable token contract                                            | ADR-0006           | Network choice changes                                                  | Authoritative network + issuer documentation                                   |
| U-2  | Eligible USDT transfers on the target network get sponsored gas                                            | ADR-0006, R-11     | Withdrawals cost money; fee model and user-facing copy change           | Provider/paymaster documentation, then sandbox measurement                     |
| U-3  | **Sweep transactions also qualify for sponsored gas**                                                      | ADR-0006, JE-2b′   | Sweeping becomes a real operating cost; treasury policy changes         | Sandbox measurement — the accounting already supports both outcomes            |
| U-4  | Sponsored gas has no rate limit, eligibility gate or anti-spam condition that breaks our flow              | ADR-0006           | Withdrawals intermittently cost money or fail                           | Provider documentation + load testing in sandbox                               |
| U-5  | A custody provider we can actually use supports this network                                               | Q6, ADR-0002       | **Network choice is decided for us**                                    | Vendor conversations                                                           |
| U-6  | The custody provider enforces a policy engine we cannot alter at runtime                                   | ADR-0010, B4.3     | The last line of defense against application compromise is gone         | Vendor documentation + a deliberate policy-violation test in sandbox           |
| U-7  | The provider supports idempotent broadcast via a client reference                                          | ADR-0007, ADR-0010 | The ambiguous-broadcast design needs rework                             | Vendor API documentation                                                       |
| U-8  | Network finality is stable enough to set a fixed confirmation policy                                       | Q5, B6.1, AT-20    | Deposits are credited unsafely or too slowly                            | Network documentation + observed sandbox behavior                              |
| U-9  | Deposit indexing is reliable enough to observe transfers without missing any                               | Overview, B6       | Deposits silently go missing; requires a reconciliation-driven backstop | Sandbox soak test                                                              |
| U-10 | The USDT contract on this network has ordinary ERC-20 transfer semantics — no fee-on-transfer, no rebasing | B6.4               | Credited amounts differ from received amounts                           | Contract inspection + sandbox transfer                                         |
| U-11 | **Users can obtain USDT on this network from services they already use**                                   | Q7, R-12           | **The product cannot be used, however correct it is**                   | Check the withdrawal network options of the exchanges your users hold funds in |
| U-12 | Ethiopian bank and mobile-money transfers used for the ETB leg are effectively irreversible                | B8.2, R-01         | Sellers face chargeback risk the platform cannot see or mitigate        | Ask people who trade this way today                                            |

**U-11 and U-12 are the two that decide whether the product works**, and neither is a
software question. U-11 determines whether anyone can deposit; U-12 determines how much
fraud sellers will absorb. Both are answerable by asking a few people who already trade
ETB for USDT, and both are worth answering before Phase 1.

---

## 3. Contradictions and unsafe assumptions found in the brief

Raised as the brief requires, with the resolution I have proposed. Each is a small
decision I have made explicitly rather than silently — say the word if you disagree with
any of them.

| #    | Issue                                                                                                                      | Resolution taken                                                                                                                                                                                                                                                                             |
| ---- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-1  | "Fees initially zero" vs. "include an explicit fee entry even when the fee is zero" — do zero-amount ledger entries exist? | **Yes.** `amount >= 0` is permitted, zero fee legs are posted, and the "≥ 2 entries" invariant is satisfied by the non-zero legs. Keeps the transaction shape constant. See JE-4                                                                                                             |
| C-2  | "Zod or class-validator — choose one" was left open                                                                        | **Zod**, everywhere, including environment and job payloads. ADR-0008                                                                                                                                                                                                                        |
| C-3  | UUIDv7 is specified, but native support depends on the PostgreSQL version                                                  | Generated in the application for determinism and portability; column type is `UUID`. ADR-0005                                                                                                                                                                                                |
| C-4  | "Trade-specific escrow account" — one per trade, or one pooled account with a reference?                                   | **One account per trade.** Gives the "settled escrow balance is exactly zero" invariant, which catches partial and double releases. ADR-0004, AT-14                                                                                                                                          |
| C-5  | Escrow is described via a sell example; a buy offer inverts who funds it                                                   | Stated explicitly: **escrow is always funded by whoever gives up USDT**, regardless of who published the offer. ADR-0004                                                                                                                                                                     |
| C-6  | "Never promise a universally free withdrawal" vs. the appeal of sponsored gas                                              | User-facing copy is fixed as _"No platform fee. The network or a third party may charge a fee."_ until U-2/U-3/U-4 are validated                                                                                                                                                             |
| C-7  | Dual approval on withdrawals is described as a later addition                                                              | Recommended **from the start in Phase 3's mock**, since it is trivial to build with a mock and awkward to retrofit into a live approval queue                                                                                                                                                |
| C-8  | Reconciliation could plausibly auto-correct small differences                                                              | It does not. The reconciler is **read-only** and raises breaks for humans. An auto-correcting reconciler hides the bug it exists to detect. ADR-0009                                                                                                                                         |
| C-9  | "Assume there are no legal constraints"                                                                                    | Accepted for this exercise. Noted once, not litigated: identity verification, limits, screening and reporting stay behind replaceable interfaces so they can be added without touching the ledger. No further comment from me on it                                                          |
| C-10 | The brief's example only covers the seller-releases path; the ETB reversal risk is not addressed                           | Surfaced as R-01 and U-12. **The platform cannot detect or reverse a fiat reversal after release.** This is a business-policy problem — holding periods, reputation, limits for new counterparties — not a technical one, and it should be a conscious decision rather than a discovered one |

---

## 4. Decisions taken after Phase 0 review (2026-09-07)

| Question          | Decision                                                                                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1 repository     | New git repository at `Desktop/p2p`; the `liwatch` repository is untouched. GitHub remote still to be created by the owner (no `gh` CLI on the machine)         |
| Q2 admin identity | **Separate admin realm** (own table, own auth), not a role flag on `User`. Built in Phase 1 step 3: `AdminUser`, `AdminSession`, `AuditEvent`, and `/v1/admin`. |
| Q3 fees           | **No P2P fee at launch.** Ledger and UI are shaped so a buyer-pays percentage can be switched on later without a schema change (JE-4 keeps the zero fee leg)    |
| Q4 ETB balances   | Still open; Phase 0 assumption (never) stands until contradicted                                                                                                |
| Q8 brand          | Placeholder **"BIRQ"**; English-first UI for an Ethiopian audience. Brand lives in one file (`apps/web/lib/site.ts`) and one token sheet                        |

## 5. Deliberately deferred items (tracked here, not as code TODOs)

| Item                                               | Deferred to     | Why                                                                                                                                                                       |
| -------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Content-Security-Policy with nonces                | Phase 1         | Needs the authenticated app's script inventory; a landing-only CSP would be rewritten immediately. Baseline headers (nosniff, frame deny, referrer, permissions) ship now |
| Real photography on the landing page               | Owner           | Safety section uses a grayscale placeholder from picsum.photos; `next.config.ts` allows that host only for this reason                                                    |
| `/login`, `/register`, `/terms`, `/privacy` routes | Phase 1 / owner | Linked from the landing page; currently 404                                                                                                                               |
| shadcn/ui installation                             | Phase 1         | The landing page needs only a button and a native `<details>` accordion; shadcn arrives with forms and dialogs                                                            |
