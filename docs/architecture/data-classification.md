# Data Classification and Secret Inventory

## 1. Classification levels

| Level | Definition | Handling |
|---|---|---|
| **PUBLIC** | Safe to expose to anyone | No restriction |
| **INTERNAL** | Operational data; harmless individually, useful to an attacker in aggregate | Authenticated access; no special encryption |
| **CONFIDENTIAL** | User-owned data; disclosure harms that user | Object-level authorization on every access; redacted from logs |
| **RESTRICTED** | Disclosure enables fraud against a user or the platform | Encrypted at field level with managed keys; access logged and attributable; never in logs, errors, analytics or CI |
| **SECRET** | Disclosure compromises the system or its funds | Managed secrets service only; never in the repository, `.env` committed files, logs, database, queues or CI logs; rotation runbook required |

## 2. Data inventory

| Data | Class | Where it lives | Notes |
|---|---|---|---|
| Offer price, limits, terms, public trader stats | PUBLIC | PostgreSQL | Deliberately public; the marketplace does not work otherwise |
| Deposit address (public key) | INTERNAL | PostgreSQL | Public on-chain, but linking it to a user identity is CONFIDENTIAL |
| Ledger accounts, transactions, entries | INTERNAL | PostgreSQL | Aggregate is INTERNAL; a specific user's rows are CONFIDENTIAL |
| Trade history, balances, transaction history | CONFIDENTIAL | PostgreSQL | Object-level authorization on every read — AT-6 |
| Email address, phone number | CONFIDENTIAL | PostgreSQL | Partially masked in admin views |
| Session identifiers | CONFIDENTIAL | Cookie + PostgreSQL/Redis | HTTP-only, `Secure`, `SameSite`; rotated on privilege change |
| Audit events | CONFIDENTIAL | PostgreSQL, append-only | Retained independently of the records they describe |
| **ETB payment instructions** (bank name, account number, account holder, mobile-money number) | **RESTRICTED** | PostgreSQL, field-encrypted | The highest-value user data here. Visible to a counterparty only for the duration of an active trade, snapshotted onto that trade |
| **Dispute evidence** (screenshots, statements) | **RESTRICTED** | Object storage, private | Malware-scanned before staff access; time-limited signed URLs; may contain third-party personal data |
| Identity-verification documents *(not in initial scope)* | **RESTRICTED** | Object storage, private | Interface exists; storage deferred |
| Risk scores and rules | RESTRICTED | PostgreSQL | Disclosure teaches an attacker the thresholds |
| Password hashes (Argon2id) | RESTRICTED | PostgreSQL | Never logged, never returned by any endpoint, never in a shared type |
| MFA seeds / passkey credentials | **SECRET** | PostgreSQL, encrypted | Treated as key material |
| **Blockchain private keys** | **SECRET** | **Custody provider only** | **Never present in this system in any form, at any time.** Not in code, database, logs, queues, environment, CI or a developer machine |

## 3. Secret inventory

Every secret the system needs, where it lives, and what an attacker gains by having it.
"Blast radius" is deliberately blunt.

| Secret | Purpose | Storage | Rotation | Blast radius if leaked |
|---|---|---|---|---|
| `DATABASE_URL` | Application database role | Managed secrets service | 90d / on incident | Read and write all customer and ledger data. Ledger history still protected by `REVOKE UPDATE, DELETE` on that role |
| `DATABASE_MIGRATION_URL` | Separate DDL role | Secrets service, CI-only at deploy time | 90d / on incident | Schema destruction, including dropping the append-only triggers |
| `REDIS_URL` | Queues, rate limits, cache | Secrets service | 90d | Job manipulation, rate-limit bypass. **Not** direct financial impact by design (ADR-0009) |
| `SESSION_SECRET` | Session cookie signing | Secrets service | 90d, rotate-with-overlap | Forge any user session |
| `CSRF_SECRET` | CSRF token derivation | Secrets service | 90d | CSRF bypass when combined with another flaw |
| `FIELD_ENCRYPTION_KEK` | Wraps the data keys for payment instructions | KMS, never exported | Annual + on incident | Decrypt all stored payment instructions |
| `CUSTODY_API_KEY` / `CUSTODY_API_SECRET` | Authenticate to the custody provider | Secrets service, IP-allowlisted, per-environment | 30d + on incident | **Attempt to move funds.** Bounded by provider-side policy: allowed asset, contract, network, destinations, caps, velocity, approvals (ADR-0010) |
| `CUSTODY_WEBHOOK_SIGNING_SECRET` | Verify inbound webhooks | Secrets service | 90d, rotate-with-overlap | Forge deposit notifications. **Bounded**: a forged webhook still cannot credit, because credits require independent chain verification (B4.1) |
| `BLOCKCHAIN_RPC_KEY` | Chain reads and broadcast | Secrets service | 90d | Quota theft; chain-state lying if it is the only source — hence multiple sources for confirmation-critical reads |
| `OBJECT_STORAGE_CREDENTIALS` | Dispute evidence bucket | Secrets service, scoped IAM role | 90d | Read all dispute evidence |
| `SMTP` / SMS provider credentials | Notifications | Secrets service | 90d | Send mail as the platform — phishing our own users |
| `SENTRY_DSN` | Error reporting | Secrets service | As needed | Error-stream injection |
| `CI_DEPLOY_IDENTITY` | Deploy to production | OIDC federation, **no long-lived key** | N/A (short-lived) | Deploy arbitrary code — mitigated by protected branches and required review |

### Rules

1. **No production secret ever enters this repository, a chat window, a ticket, a log
   line, a screenshot, or a `.env` file that is committed.** `.env.example` contains names
   and dummy values only.
2. Local development uses obviously-fake values (`sk_test_local_not_a_real_key`) against
   Docker Compose services and the deterministic mocks. There is no path from a developer
   machine to a real signing capability, and there will not be one.
3. CI holds no production custody credentials. Deployment authenticates via short-lived
   OIDC federation.
4. Secret scanning runs on every push and blocks the merge on a hit.
5. Rotation is a documented runbook per secret, not an ad-hoc action — a secret that
   cannot be rotated calmly will not be rotated during an incident.

## 4. Log redaction

Pino is configured with an **allowlist** for request/response bodies and a redaction path
list. Allowlist rather than denylist, because a denylist silently fails the moment someone
adds a field.

Always redacted, everywhere, including error reports and traces:

```
authorization, cookie, set-cookie, x-csrf-token, *.password, *.passwordHash,
*.mfaSecret, *.recoveryCode, *.privateKey, *.seed, *.mnemonic, *.signature,
*.signedTransaction, *.apiKey, *.secret, *.token,
*.accountNumber, *.bankAccount, *.paymentInstructions, *.phone, *.email,
custodyPayload, webhookBody
```

Money amounts, account IDs, trade IDs, correlation IDs and state names **are** logged —
they are what makes an incident investigable, and none of them are secret.

AT-13 asserts this: it drives representative flows with sentinel values planted in every
sensitive field, then greps the entire captured log and error stream for those sentinels.
Any hit fails the build. This is a test rather than a convention because redaction
regresses silently.
