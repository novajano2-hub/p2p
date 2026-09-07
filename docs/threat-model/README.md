# Threat Model

Scope: the ETB/USDT P2P platform as described in [CLAUDE.md] and
[../architecture/overview.md](../architecture/overview.md). Method: trust-boundary
enumeration (B1–B9 from the overview), STRIDE per boundary, then a ranked risk register
with owners and controls.

This is a Phase 0 document. It describes threats against a system that does not exist yet,
so its purpose is to constrain the design rather than to audit an implementation. It must
be revisited at the end of each phase, and it is **not** a substitute for the independent
security review, custody architecture review and penetration test the brief requires
before real funds.

---

## 1. What an attacker actually wants

Ranked by what they would realistically go after:

| Target                                            | Why                                        | Reachable via                                                                    |
| ------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------- |
| **Hot treasury USDT**                             | Irreversible, liquid, no chargeback        | Custody compromise, signer policy gap, application RCE reaching the signing path |
| **Another user's balance**                        | Directly monetizable                       | Broken object-level authorization, ledger race, escrow double-release            |
| **Free USDT via the fiat leg**                    | Cheapest attack, no technical skill needed | Trade fraud at boundary B8 — claim payment, receive USDT, never pay              |
| **Deposit credited twice**                        | Mint money from nothing                    | Webhook replay, reorg handling gap, non-idempotent worker                        |
| **Users' payment instructions and identity data** | Fraud, resale, targeting                   | Object-level authorization gaps, log leakage, dispute-evidence access            |
| **Admin capability**                              | Everything above at once                   | Credential theft, session hijack, privilege escalation, insider                  |
| **Availability**                                  | Extortion, or cover for another attack     | Resource exhaustion on expensive endpoints                                       |

**The cheapest attack on this platform requires no code.** It is a person who accepts a
trade, clicks "I have paid", sends nothing, and argues in the dispute. Every technical
control below matters, but this one is worth stating first because it is the one that will
actually happen, at volume, from day one.

## 2. Attacker personas

| Persona                                   | Capability                                                                                                        | Motivation                                                      | Primary boundaries |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------ |
| **P1 — Fraudulent counterparty**          | Ordinary user account, patient, social engineering, doctored screenshots, possibly reversible payment instruments | Free USDT                                                       | B1, B8             |
| **P2 — Opportunistic external attacker**  | Automated scanning, credential stuffing, known CVEs, no insider knowledge                                         | Any monetizable access                                          | B1, B5, B9         |
| **P3 — Targeted external attacker**       | Reads our public code and docs, studies the flows, chains subtle bugs, patient                                    | Hot treasury                                                    | B1, B4, B6         |
| **P4 — Malicious or compromised insider** | Legitimate admin credentials, knows the review thresholds                                                         | Treasury, or targeted theft via dispute resolution              | B7                 |
| **P5 — Supply-chain attacker**            | Compromised npm package, compromised CI, typosquat                                                                | Code execution inside the API or CI with production credentials | B9                 |
| **P6 — Compromised third party**          | Control of the custody provider, RPC node, or email/SMS provider                                                  | Depends; worst case is signing capability                       | B4, B6             |

## 3. STRIDE by trust boundary

Abbreviations: **S**poofing, **T**ampering, **R**epudiation, **I**nformation disclosure,
**D**enial of service, **E**levation of privilege.

### B1 — Browser → API

| #    | Threat                                                                                      | STRIDE | Control                                                                                                                                                                 | Enforced where          |
| ---- | ------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| B1.1 | Session theft via XSS                                                                       | S, E   | Strict CSP with no inline script, HTTP-only + `Secure` + `SameSite=Lax` cookies, React auto-escaping, no `dangerouslySetInnerHTML` on user content                      | Web + API headers       |
| B1.2 | CSRF forcing a withdrawal or release                                                        | T, E   | Double-submit CSRF token on every cookie-authenticated mutation, `SameSite`, origin check                                                                               | API middleware          |
| B1.3 | **IDOR — reading or acting on another user's trade, address, withdrawal or payment method** | I, E   | Deny-by-default authorization; ownership is a `WHERE` clause in the query, never a post-fetch `if`; a dedicated object-level authorization test per user-owned resource | Repository layer + AT-6 |
| B1.4 | Client-supplied role, price, fee or amount trusted                                          | T, E   | Zod `.strict()` rejects unknown fields; price and fee are re-read server-side from the offer, never taken from the request; roles come from the session, never the body | API                     |
| B1.5 | Credential stuffing, account enumeration                                                    | S      | Argon2id, per-account and per-IP rate limits, generic responses for login/recovery/registration, MFA                                                                    | API                     |
| B1.6 | Double-click or retry causing a double release                                              | T      | `Idempotency-Key` + unique constraint                                                                                                                                   | AT-5                    |
| B1.7 | Expensive endpoints exhausted (search, history, uploads)                                    | D      | Mandatory pagination, query cost limits, per-action rate limits, upload size/type limits                                                                                | API                     |
| B1.8 | Stolen session used for a withdrawal                                                        | E      | Step-up authentication at the action, not at login; cooldown after password/MFA/email changes                                                                           | API                     |

### B2 — API → PostgreSQL

| #    | Threat                                                  | STRIDE  | Control                                                                                                                        | Enforced where       |
| ---- | ------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| B2.1 | SQL injection                                           | T, I, E | Parameterized queries via Prisma; raw SQL only in reviewed, parameterized ledger helpers                                       | Repository layer     |
| B2.2 | **Race producing a negative or double-spent balance**   | T       | Row lock on the balance row before any debit, fixed lock ordering, plus a `CHECK (balance >= 0)` the application cannot bypass | ADR-0009, AT-2, AT-3 |
| B2.3 | Application bug writes an unbalanced transaction        | T       | Deferred constraint trigger `SUM(signed_amount) = 0` per transaction and asset                                                 | ADR-0003, AT-10      |
| B2.4 | Ledger history edited to hide theft                     | T, R    | `REVOKE UPDATE, DELETE` from the application role plus a raising trigger; corrections are compensating entries only            | ADR-0003             |
| B2.5 | Compromised app role reads everything                   | I       | Least-privilege database role, no `SUPERUSER`, no DDL at runtime; migrations run under a separate role in a separate step      | Infra                |
| B2.6 | Long transaction holding locks while calling a provider | D       | Lint/review rule: no network I/O between `BEGIN` and `COMMIT`; statement and lock timeouts set                                 | ADR-0007             |

### B3 — API → Redis / BullMQ

| #    | Threat                                          | STRIDE | Control                                                                                                                      | Enforced where  |
| ---- | ----------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------- | --------------- |
| B3.1 | **Redis lock treated as financial correctness** | T      | Prohibited by ADR-0009. Redis is for rate limits, queues and disposable cache only; money is protected by database row locks | Design + review |
| B3.2 | Duplicate job execution credits twice           | T      | Every handler idempotent; natural or explicit idempotency keys                                                               | AT-1, AT-5      |
| B3.3 | Job payload tampering by a Redis-level attacker | T      | Jobs carry IDs, never amounts or authorization decisions; the handler re-reads and re-authorizes from PostgreSQL             | Workers         |
| B3.4 | Redis unavailable causes a fail-open            | E      | Rate limiter fails closed; risk engine unavailability routes to `RISK_REVIEW`, never to `APPROVED`                           | API             |
| B3.5 | Sensitive data cached in Redis                  | I      | No payment instructions, tokens or personal data in cache values                                                             | Review          |

### B4 — API ↔ Custody provider (the critical boundary)

| #    | Threat                                                 | STRIDE | Control                                                                                                                                                                                                                                           | Enforced where        |
| ---- | ------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| B4.1 | **Forged deposit webhook mints a balance**             | S, T   | Signature verified over the **raw** request body before parsing; timestamp/nonce replay window; and the transfer is independently re-read from the chain before crediting. A webhook alone never credits                                          | Deposit state machine |
| B4.2 | Replayed genuine webhook credits twice                 | T      | Unique `(network, tx_hash, log_index)`; duplicates return `200` and do nothing                                                                                                                                                                    | AT-1                  |
| B4.3 | **Application compromise reaches the signing path**    | E      | Signing separated from request handling (ADR-0010); provider-side policy — asset, contract, network, destination, per-transaction cap, velocity, approvals — that the application cannot change at runtime; hot treasury sized to a bounded float | ADR-0010              |
| B4.4 | Custody API credential leaked                          | S, E   | Managed secrets service, short-lived credentials where supported, IP allowlist, rotation runbook, separate credentials per environment; a leaked credential still faces the provider policy                                                       | Infra                 |
| B4.5 | **Ambiguous broadcast → double send or double refund** | T      | `BROADCAST_UNKNOWN` never auto-retries and never auto-refunds; human resolution against chain state                                                                                                                                               | ADR-0010, AT-9        |
| B4.6 | Provider compromised (P6)                              | E      | Hot/cold split; velocity and destination policy; reconciliation alerting on unexpected outflow; documented incident response. Honestly: this is a residual risk we mitigate but cannot eliminate by being custodial                               | Design                |
| B4.7 | Vendor payload secrets logged                          | I      | Pino redaction allowlist covering provider payloads, headers and signatures                                                                                                                                                                       | Logging config, AT-13 |

### B5 — API ↔ Object storage (dispute evidence)

| #    | Threat                                        | STRIDE | Control                                                                                                                                                                                                                      |
| ---- | --------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B5.1 | Malware or a polyglot file served to staff    | T, E   | Size and MIME/magic-byte validation, malware scan **before** staff access, private objects, download via time-limited signed URL, served with `Content-Disposition: attachment` and a restrictive CSP from a separate origin |
| B5.2 | Evidence from one dispute readable in another | I      | Object keys are unguessable; every access is authorized against the dispute, never by URL possession alone                                                                                                                   |
| B5.3 | Storage bucket public by misconfiguration     | I      | Public access blocked at the account level; IaC assertion plus a CI check                                                                                                                                                    |
| B5.4 | Uploads used as free storage / DoS            | D      | Per-dispute count and size caps, per-user rate limit                                                                                                                                                                         |

### B6 — Custody ↔ Blockchain

| #    | Threat                                                                                                   | STRIDE | Control                                                                                                                                                    |
| ---- | -------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B6.1 | Deposit credited then reversed by a reorg                                                                | T      | Confirmation threshold and reorg-depth policy before `CREDITED`; conservative defaults. **UNVALIDATED for the target network** — Q5                        |
| B6.2 | Fake token contract with the same symbol                                                                 | S      | Exact configured contract address match; symbol and name are never used for identification                                                                 |
| B6.3 | A dishonest or stale RPC node lies about state                                                           | S, T   | Multiple independent RPC sources for confirmation-critical reads; disagreement fails closed to manual review                                               |
| B6.4 | Transfer-event semantics differ from balance changes (fee-on-transfer, rebasing, unusual token behavior) | T      | Credit from verified balance/transfer semantics for the specific configured contract, validated in Phase 6 sandbox before any real credit. **UNVALIDATED** |
| B6.5 | Dust/spam transfers flood the observer                                                                   | D      | Dust threshold, unattributed handling, per-address rate limits                                                                                             |

### B7 — Admin human → API

| #    | Threat                                                                | STRIDE | Control                                                                                                                                                                                                                                                                                                               |
| ---- | --------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B7.1 | **Malicious or compromised admin resolves disputes to an accomplice** | E, R   | Least-privilege roles (`dispute_resolver` ≠ `withdrawal_approver` ≠ `financial_adjuster`); mandatory reason codes and evidence; append-only audit; resolver may not be a party to the trade; **anomaly reporting on resolution patterns per admin** — the control here is detection, because prevention is impossible |
| B7.2 | Admin moves funds directly                                            | E      | No "set balance" function exists. Adjustments go through a typed, balanced workflow; dual approval above thresholds                                                                                                                                                                                                   |
| B7.3 | Admin session hijacked                                                | S, E   | Separate admin origin/routes, mandatory hardware-backed MFA, short sessions, IP/device constraints, step-up per privileged action                                                                                                                                                                                     |
| B7.4 | Admin denies having acted                                             | R      | Append-only `audit_event` with actor, correlation ID, before/after, reason; retained independently of the record acted upon                                                                                                                                                                                           |
| B7.5 | Admin reads customer payment details at will                          | I      | Access is logged and attributable; sensitive fields decrypted only on justified access with a reason code                                                                                                                                                                                                             |

### B8 — Users ↔ Ethiopian banks (outside our systems)

**We have no technical controls here. Everything below is product policy and process.**

| #    | Threat                                                                         | Control                                                                                                                                                      | Residual                                                                                                                                                    |
| ---- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B8.1 | Buyer claims payment, sends nothing                                            | No auto-release ever; seller confirms; dispute with evidence                                                                                                 | **High** — resolution quality depends entirely on human judgment                                                                                            |
| B8.2 | Buyer pays, then reverses or disputes the bank transfer after USDT is released | Seller education, payment-method policy favoring irreversible rails, reputation and limits for new accounts, optional holding periods for new counterparties | **High — the platform cannot detect or reverse this.** This is the defining risk of out-of-band settlement and must be surfaced to the business, not buried |
| B8.3 | Seller receives ETB and stalls without releasing                               | Dispute path, resolution SLA, seller reputation and completion-rate metrics                                                                                  | Medium                                                                                                                                                      |
| B8.4 | Third-party payer used to launder funds through the trade                      | Payment instructions must name the trading account holder; mismatch is grounds for dispute; `RiskEngine` hook                                                | Medium                                                                                                                                                      |
| B8.5 | Doctored payment screenshots as dispute evidence                               | Evidence is one input among several; resolution weighs account history, patterns and both parties' accounts; screenshots are never dispositive alone         | Medium                                                                                                                                                      |
| B8.6 | Payment instructions altered mid-trade                                         | Instructions are snapshotted onto the trade at creation and immutable thereafter; changing a payment method never affects an open trade                      | Low                                                                                                                                                         |

### B9 — CI/CD → Production

| #    | Threat                                            | STRIDE | Control                                                                                                                                                               |
| ---- | ------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B9.1 | Malicious dependency executes in CI or production | T, E   | Lockfile committed and enforced (`--frozen-lockfile`), pinned versions, `ignore-scripts` where feasible, automated vulnerability scanning, review of new dependencies |
| B9.2 | Production secrets exfiltrated from CI            | I      | CI holds no production signing credentials; deployment via short-lived OIDC federation, not long-lived keys; secrets scanning on every push                           |
| B9.3 | Unreviewed code reaches production                | T, E   | Protected branch, required review, required checks; **no direct push to the production branch**                                                                       |
| B9.4 | A migration destroys financial data               | T      | Migrations reviewed and explained before applying; forward-only; no destructive operation on ledger tables; backup verified before release                            |

---

## 4. Risk register

Ranked by residual risk after the controls above. Likelihood and impact are qualitative.

| ID       | Risk                                                                                          | L           | I                      | Residual                  | Primary controls                                                                     | Verified by                               |
| -------- | --------------------------------------------------------------------------------------------- | ----------- | ---------------------- | ------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------- |
| **R-01** | **Fiat-leg fraud: buyer receives USDT without paying, or reverses payment afterwards**        | High        | Med                    | **High**                  | No auto-release, dispute process, reputation, limits, irreversible-rail preference   | Not technically verifiable — process only |
| **R-02** | Custody provider or signing path compromise drains hot treasury                               | Low         | Critical               | **High**                  | ADR-0010 separation, provider policy limits, hot/cold split, reconciliation alerting | Phase 6 review + pen test                 |
| **R-03** | Ledger race double-spends escrow or overspends a balance                                      | Med         | High                   | **Medium**                | Row locks, `CHECK (balance >= 0)`, balanced-transaction trigger                      | AT-2, AT-3                                |
| **R-04** | Deposit credited more than once                                                               | Med         | High                   | **Low**                   | Natural-key idempotency, independent chain verification, finality policy             | AT-1                                      |
| **R-05** | Object-level authorization gap exposes or mutates another user's data                         | Med         | High                   | **Medium**                | Deny-by-default, ownership in the query, per-resource authorization tests            | AT-6                                      |
| **R-06** | Reorg reverses a credited deposit                                                             | **Unknown** | High                   | **Unknown — UNVALIDATED** | Conservative confirmation policy, configurable per network                           | Q5, Phase 6 sandbox                       |
| **R-07** | Ambiguous broadcast causes a double send or double refund                                     | Med         | High                   | **Low**                   | `BROADCAST_UNKNOWN` with no automation, human resolution                             | AT-9                                      |
| **R-08** | Insider abuses dispute resolution or approval                                                 | Low         | High                   | **Medium**                | Role separation, dual approval, append-only audit, pattern monitoring                | AT-8                                      |
| **R-09** | Secrets or payment details leak into logs, errors or analytics                                | Med         | Med                    | **Low**                   | Redaction allowlist, structured logging, error-reporting scrubbing                   | AT-13                                     |
| **R-10** | Supply-chain compromise                                                                       | Low         | Critical               | **Medium**                | Lockfile, pinning, scanning, OIDC deployment, protected branches                     | CI                                        |
| **R-11** | Sponsored gas unavailable or ineligible, making withdrawals cost money we promised were free  | **Unknown** | Med                    | **Unknown — UNVALIDATED** | Copy says "no _platform_ fee"; fee accounting exists from day one                    | Q6, Phase 6                               |
| **R-12** | Users cannot obtain USDT on the target network from exchanges they use, so nobody can deposit | **Unknown** | **Critical (product)** | **Unknown — UNVALIDATED** | None. This is a market question, not an engineering one                              | Q7 — should be answered before Phase 1    |
| **R-13** | Balance projection drifts from the ledger                                                     | Low         | Med                    | **Low**                   | Same-transaction updates, periodic rebuild-and-compare                               | AT-11                                     |
| **R-14** | Loss of the database without a tested restore                                                 | Low         | Critical               | **Medium**                | Encrypted backups, PITR, **tested** restore runbook                                  | DR exercise, pre-production               |

**R-12 deserves particular attention.** It is the only risk on this list that can be
correct in every technical detail and still make the product fail. It costs an afternoon
of research to answer and should be answered before we build on the assumption.

---

## 5. Assumptions this model depends on

If any of these turn out to be false, the model must be redone:

1. The ETB leg remains entirely outside the platform, and the platform never holds birr.
2. One asset (USDT) and one network at launch.
3. Users never hold or supply private keys.
4. The custody provider's signing policy is genuinely enforced on their side and cannot be
   altered by our application at runtime. **UNVALIDATED.**
5. The target network's finality behavior is knowable and stable enough to set a
   confirmation policy. **UNVALIDATED.**
6. Admin staff are a small, identifiable group with hardware-backed MFA.
7. Phases 0–5 involve no real funds and no real keys, so a Phase 0–5 compromise is a code
   and data incident, not a financial one.

## 6. Out of scope for this document

Legal, licensing, sanctions and regulatory obligations. The brief instructs us to assume
no legal constraints for this exercise. The design keeps identity verification, limits,
screening and reporting behind replaceable interfaces (`RiskEngine` and friends) so they
can be added later without touching the ledger — but this document does not attempt to
model regulatory risk, and nothing here should be read as suggesting there is none.
