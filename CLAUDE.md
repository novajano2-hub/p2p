# ETB/USDT P2P Platform — Claude Build Brief

## How to use this file

This file is the durable project brief for Claude Code. Read it completely before planning or changing code. If a later user instruction conflicts with this file, ask for confirmation when the conflict affects custody, accounting, security, or irreversible data.

Do not attempt to build the entire production platform in one response. Work in small, reviewable phases. Before each phase, state the intended changes, important assumptions, and acceptance criteria. After each phase, run the relevant tests and report exact results.

## Product objective

Build a web-first peer-to-peer marketplace where users trade Ethiopian birr (ETB) for USDT.

The platform is a **custodial, pooled-wallet system with internal ledger escrow**:

- Users do not connect MetaMask or another external wallet.
- Every user receives a unique USDT deposit address on the supported network.
- The platform controls the corresponding blockchain signing keys through a dedicated custody/signing provider; application servers must never store raw private keys.
- On-chain funds may be swept into platform-controlled pooled treasury wallets.
- A double-entry internal ledger records which customer owns each amount.
- P2P escrow is an internal ledger hold, not an on-chain smart contract.
- ETB payment happens outside the platform using payment instructions agreed by the buyer and seller. The platform does not directly integrate Ethiopian banks in the initial version.
- The initial product is a responsive web application. A mobile app is not part of the first release, but the API must be designed so a mobile client can be added later.

For this technical exercise, assume there are no legal constraints. Still keep identity-verification, limits, sanctions/risk screening, and reporting behind replaceable interfaces so they can be added later. Do not claim that production custody is safe merely because tests pass.

## Decisions already made

| Area | Decision |
| --- | --- |
| Client | Responsive Next.js web app |
| Backend runtime | Node.js with TypeScript |
| Backend framework | NestJS using the Fastify adapter |
| Primary database | PostgreSQL |
| Accounting | Immutable double-entry ledger; balances derived from ledger entries |
| P2P escrow | Internal ledger holds and releases |
| Custody | Pooled custodial wallet with unique per-user deposit addresses |
| Signing | External custody/signing provider behind an adapter; no raw keys in the app |
| Asset | USDT only at launch |
| Fiat | ETB only at launch; payment occurs out of band |
| Chain | One network at launch; target Plasma because eligible USDT transfers can use sponsored gas |
| Fees | Platform P2P fee initially zero; internal escrow transfers have no blockchain fee |
| Delivery | Web first; no native mobile app initially |
| Package manager | npm workspaces (not pnpm) with Turborepo; exact version pinning via `npm run pin` |
| Admin identity | Separate admin realm (own table and auth), not a role flag on `User` |
| Fees at launch | Zero P2P fee; ledger and UI shaped so a buyer-pays percentage can be enabled later without schema change |
| Brand | Placeholder name "BIRQ"; English-first UI for an Ethiopian audience |
| Sign-in identifier | Email only at launch (decided 2026-09-08). Phone sign-in waits for an SMS provider decision |
| OAuth | Google only (decided 2026-09-08). No Apple, no others without a new decision |
| Password policy | Binance parity for familiarity: 8+ characters, a number, an upper case letter. Argon2id on the server is authoritative; the client checklist is a mirror |
| Auth flow shape | Identifier first, password second, one step per screen (Binance's pattern). The response to the identifier step never reveals whether an account exists |

### Brand and design system (decided 2026-09-07)

The visual language is the "Quiet Capital" UI kit. It is a visual language, not a page template.

- Colors: Canvas `#F6F4EE` (page), Surface `#FFFFFF`, Forest `#183D32` (the only accent), Ink `#202622` (text), Sage `#ADB9A9` (secondary surfaces and decoration, never body text), Border `#DADFD6`. Destructive is a muted clay red. Status pills: Complete (green tint), Pending (amber tint), Needs attention (red tint), Neutral (grey tint).
- **Dark mode is required on every surface, from the first line of markup.** The landing page and any signed-out page follow the operating system (`prefers-color-scheme`). Once a customer has an account they choose system / light / dark, which sets `data-theme="light"` or `data-theme="dark"` on `<html>`. `data-theme="light"` is wired today; **`data-theme="dark"` is not** — building the preference control also means moving the dark tokens to a selector shared by the media query and `[data-theme="dark"]`, rather than duplicating the block and letting the two drift. `:root` must always declare `color-scheme: light dark`: a single value tells Samsung Internet and Chrome's Auto Dark Theme the page has no dark theme, and they force-invert it into a half-light mess. Dark values for the kit: Canvas `#121614`, Surface `#1A201D`, foreground `#E9EDE8`, muted `#A3ADA6`, Border `#2B332F`, accent `#6CC39C` on `#0D1411`.
- Dark is not the light palette inverted. Forest `#183D32` is a near-black on a dark ground and cannot carry an accent, so the accent lifts and its text colour flips. Shadows switch from tinted to black, because a tinted shadow is invisible on a dark surface.
- Every semantic token indirects through a raw variable in `globals.css`, so a theme is defined once by redefining those raw variables. Do not add `dark:` variants to components; if a component needs one, the missing value belongs in the token layer.
- Anything that paints its own colours outside CSS (a canvas, a 3D scene, a generated image, a chart) must be passed the resolved theme and have a palette for each. It will not inherit one.
- Type: IBM Plex Sans throughout, for display headings as well as interface and body. It is the open-source parent of Binance's proprietary BinancePlex, which cannot be licensed. Headings are separated from body by weight (600) and tighter tracking, never by a second family. IBM Plex Mono for ledger and money figures; amounts always use tabular numerals.
- Restraint in scale: hero headline caps around 3.25rem, section headings around 2.125rem. Large type is not how this brand signals quality.
- Shape: 6px radius on controls, 8px on surfaces and cards, pills for status. Fine 1px borders, minimal tinted shadow.
- Motion: GSAP (ScrollTrigger, SplitText) for DOM animation and three.js via react-three-fiber for 3D. No other animation library; never mix Framer Motion into the same tree. Every animation must be gated on `prefers-reduced-motion` and have a stated purpose (hierarchy, storytelling, feedback, state). **Never take the scrollbar away from the reader**: no pinning, no scrub, no scroll snapping. Reveals animate `opacity`, never `visibility`, so off-screen content stays focusable and in the accessibility tree.
- 3D is a desktop flourish. It loads lazily in the browser only, never below 1024px, and never fetches assets from third-party CDNs.
- Buttons are physical: a resting shadow, a 1px lift and deeper shadow on hover, a pressed inset on click, all dropped under reduced motion.
- Copy: plain, concrete, no em dashes as punctuation, one label per call-to-action intent ("Create account", "Log in"), no fabricated statistics or customer logos.
- Tokens live in `apps/web/app/globals.css`; the brand name lives only in `apps/web/lib/site.ts`.

### Important network qualification

Treat Plasma support as a launch hypothesis that must be validated before real-money integration. Do not hard-code network behavior throughout the domain. Implement a `BlockchainGateway` interface and a Plasma adapter later.

The application must distinguish:

1. **Internal P2P settlement:** off-chain ledger entries, so no blockchain gas.
2. **Deposit:** the platform can charge zero, but the sending wallet or exchange may charge its own fee.
3. **Withdrawal:** the platform should use an eligible sponsored-gas route where available. Never promise a universally free withdrawal until custody-provider, paymaster eligibility, rate limits, and third-party fees have been validated.

User-facing copy should say “No platform deposit fee; the sender or third party may charge a fee” unless the complete route is known to be free.

## Recommended technology stack

### Repository and applications

Use an npm workspaces monorepo with Turborepo (npm, not pnpm; decided 2026-09-07):

```text
apps/
  web/                 Next.js client
  api/                 NestJS API and workers
packages/
  contracts/           Shared API schemas/types only
  config/              Shared lint, TypeScript and formatting config
  database/            Prisma schema, migrations and DB helpers
  test-utils/          Fixtures and test utilities
docs/
  architecture/
  threat-model/
  runbooks/
```

Do not share database models directly with the browser. Shared contracts must expose only intentional API fields.

### Frontend

- Next.js with the App Router and TypeScript
- Tailwind CSS and shadcn/ui
- TanStack Query for server state
- React Hook Form plus Zod for form validation
- Accessible, responsive components
- Never calculate authoritative balances or trade states in the browser

### Backend

- Node.js current production LTS
- NestJS with Fastify
- REST API with generated OpenAPI documentation
- Zod or class-validator at every external boundary; choose one consistent approach
- Pino structured logging with automatic secret and personal-data redaction
- BullMQ with Redis for asynchronous jobs

Use Nest modules with strict responsibilities:

```text
AuthModule
UsersModule
AccountsModule
LedgerModule
WalletsModule
BlockchainModule
DepositsModule
WithdrawalsModule
OffersModule
TradesModule
EscrowModule
DisputesModule
NotificationsModule
RiskModule
AdminModule
AuditModule
ReconciliationModule
```

The Ledger module owns all monetary mutations. Other modules must request ledger operations through its service; they must not create ledger entries or update financial tables directly.

### Data and infrastructure

- PostgreSQL as the source of truth
- Prisma for ordinary persistence and migrations
- Explicit SQL transactions, constraints, and row locking where financial correctness requires them
- Redis only for queues, rate limits, locks with bounded leases, and disposable cache; never as the balance source of truth
- S3-compatible object storage for dispute evidence, using private objects and time-limited access
- Docker Compose for local PostgreSQL, Redis, and supporting services
- AWS production target: managed PostgreSQL, managed Redis, object storage, container runtime, KMS/secrets manager, WAF/CDN
- Infrastructure as code after the local vertical slice is stable

### Quality and operations

- Unit tests for domain state machines and ledger rules
- Integration tests against a real ephemeral PostgreSQL instance
- Supertest for API tests
- Playwright for critical end-to-end journeys
- GitHub Actions for lint, typecheck, tests, migration checks, dependency/security scans, and build
- OpenTelemetry-compatible tracing and metrics
- Sentry-compatible error reporting, without secrets or sensitive financial payloads

## Core domain model

Use UUIDv7 or another sortable, non-guessable identifier consistently. Store monetary amounts as integers in atomic units:

- USDT: integer micro-USDT (`1 USDT = 1,000,000` units)
- ETB: integer cents/santim (`1 ETB = 100` units)
- Never use JavaScript floating-point numbers for money
- API money fields should be decimal strings plus currency metadata, converted and validated at boundaries

Minimum conceptual entities:

- `User`
- `AuthIdentity`, `Session`, `MfaMethod`
- `PaymentMethod` — user-provided ETB payment instructions, encrypted where appropriate
- `WalletAddress` — user attribution address, network, custody-provider reference, status
- `BlockchainTransaction` — normalized deposit/withdrawal transaction and confirmations
- `LedgerAccount`
- `LedgerTransaction`
- `LedgerEntry`
- `Offer` — buy or sell advertisement with price, limits and terms
- `Trade`
- `EscrowHold`
- `Dispute`
- `WithdrawalRequest`
- `AuditEvent`
- `IdempotencyKey`
- `OutboxEvent`

Do not add a mutable `users.balance` field as an authoritative balance. A cached balance may exist only as a transactionally maintained projection that can be rebuilt and reconciled against ledger entries.

## Non-negotiable accounting invariants

Every monetary event must satisfy all of these:

1. Each ledger transaction has at least two entries.
2. Total debits equal total credits for the same asset and ledger transaction.
3. One ledger transaction contains only one asset unless an explicit clearing model is designed later.
4. Posted ledger entries are immutable. Corrections are compensating transactions, never edits or deletes.
5. Available funds cannot become negative.
6. Escrowed funds cannot simultaneously be available for withdrawal or another trade.
7. Every external operation uses an idempotency key and a database uniqueness constraint.
8. State transition and corresponding ledger entries commit in one PostgreSQL transaction.
9. All ledger writes carry a business reference, actor, reason, timestamp, and correlation ID.
10. The sum of customer USDT liabilities must be continuously reconcilable with controlled on-chain assets, accounting for pending deposits, pending withdrawals, and fees.

Prefer database constraints over application-only checks. For contested balances or escrow, use a database transaction and row locks or another explicitly proven concurrency strategy. Do not rely on a Redis lock alone for financial correctness.

## Wallet and custody behavior

### Address creation

1. A verified/eligible user asks for a deposit address.
2. The API requests a new address from the custody adapter.
3. The API stores only the public address, provider wallet/account reference, derivation/reference metadata needed for operations, and status.
4. The private key remains inside the custody/signing system.
5. The deposit screen displays the address, QR code, exact network, asset, and strong wrong-network warning.

Do not generate or persist production private keys in Node.js, PostgreSQL, logs, queues, environment files, CI, or analytics.

### Deposit

1. A user sends USDT to their unique address.
2. A chain observer or custody webhook detects the transaction.
3. Verify the webhook signature and independently validate transaction details through the blockchain adapter when appropriate.
4. Insert the blockchain event idempotently.
5. Mark it `DETECTED`, then `CONFIRMING`.
6. After the configured finality policy, create one balanced ledger transaction crediting the customer liability account and debiting the appropriate platform on-chain asset/clearing account.
7. Mark the deposit `CREDITED` in the same database transaction.
8. Later sweep funds to a pooled treasury wallet if the treasury policy requires it. Sweeping must not change customer ownership in the internal ledger.

Handle duplicate webhooks, delayed events, chain reorganization policy, unsupported tokens, wrong amounts, and transfer events emitted by token contracts. Never credit merely because an HTTP webhook says so.

### Withdrawal

1. User submits network, destination address, and amount.
2. Validate address format, network, amount, account state, velocity limits, available balance, and destination policy.
3. Require step-up authentication. Apply a cooldown after password/MFA/security changes.
4. Atomically move the amount from available liability to withdrawal-pending liability. Include an explicit fee entry even when the platform fee is zero.
5. Run risk and approval policy. High-risk or high-value withdrawals require manual review and, later, dual approval.
6. A worker creates the unsigned transaction through `BlockchainGateway`.
7. A separate signer/custody adapter authorizes and signs according to policy.
8. Broadcast idempotently and track `BROADCAST` then `CONFIRMED`.
9. On definitive pre-broadcast failure, release the hold with a compensating ledger transaction. Ambiguous broadcast outcomes must be reconciled, not automatically refunded.

Never let a browser, ordinary API handler, or single unaudited administrator directly sign and broadcast a production withdrawal.

### Pooling

Unique deposit addresses identify who deposited; pooling identifies where the assets are ultimately stored. These concepts are compatible. After funds are credited and optionally swept, individual ownership exists in the ledger rather than as separate on-chain coins.

## P2P marketplace and escrow flow

Initial marketplace model: users publish advertisements; another user accepts an advertisement to create a trade. This is not an exchange order book or automated matching engine.

Example: Sara sells 100 USDT for ETB to Dawit.

1. Sara has at least 100 USDT available.
2. Dawit accepts Sara’s sell offer.
3. In one transaction, create the trade and move 100 USDT from Sara’s available liability account to a trade-specific escrow liability account.
4. Dawit sees Sara’s permitted ETB payment instructions and pays outside the platform.
5. Dawit clicks **I have paid**. This changes state only; it does not release USDT.
6. Sara verifies receipt of ETB and confirms release using step-up authentication where policy requires it.
7. In one transaction, move 100 USDT from the escrow liability account to Dawit’s available liability account and mark the trade completed.
8. No blockchain transaction occurs in steps 3–7.
9. If there is a disagreement, either party can open a dispute. An authorized admin can release to the buyer or refund to the seller. Every action is reasoned and audited.

Never automatically release USDT based solely on a buyer clicking **I have paid**, a screenshot, client-side timer, or unverified text message.

### Trade state machine

Use an explicit state machine. A reasonable initial model is:

```text
CREATED
  -> AWAITING_FIAT_PAYMENT
  -> BUYER_MARKED_PAID
  -> COMPLETED

AWAITING_FIAT_PAYMENT -> CANCELLED or EXPIRED
BUYER_MARKED_PAID -> DISPUTED
DISPUTED -> COMPLETED or REFUNDED
```

Define allowed actor, preconditions, ledger effect, audit event, notification, and idempotency behavior for every transition. Once the buyer marks paid, ordinary cancellation must be disabled; resolution goes through release or dispute.

## Security baseline

Security is part of the domain, not a final cleanup step.

- Secure, HTTP-only, SameSite cookies; short-lived sessions and rotation
- Argon2id if passwords are supported
- MFA/passkeys and step-up authentication for withdrawals, payment-method changes, and escrow release
- CSRF protection for cookie-authenticated mutations
- Strict CORS allowlist
- CSP and standard browser security headers
- Rate limits by account, IP, device/risk signal, and action
- Generic authentication and recovery responses to reduce account enumeration
- Email/phone changes and credential resets trigger withdrawal cooldowns
- Encrypt sensitive payment information at field or storage level with managed keys
- Redact tokens, cookies, authorization headers, wallet-provider payload secrets, payment details, and personal data from logs
- Verify all webhook signatures using the raw request body; protect against replay
- Store secrets only in a managed secrets service in production
- Separate hot operational funds from treasury reserves; keep the minimum required in signing scope
- Policy-based signer limits: allowed contract, asset, network, destinations, amounts, velocity and approvals
- Append-only audit trail for admin and financial actions
- Least-privilege admin roles; financial overrides require reason codes and later dual control
- Dependency pinning, lockfile, automated vulnerability scanning, secret scanning and protected production branch
- Encrypted backups plus tested point-in-time recovery and restoration runbook
- Deny-by-default authorization; never trust role or ownership information supplied by the client
- Object-level authorization tests for every user-owned resource

AI-generated code must not be treated as security review. Before real funds, require independent application security review, custody architecture review, penetration testing, disaster-recovery exercise, and ledger/on-chain reconciliation testing.

## API and reliability rules

- Use versioned endpoints such as `/v1/...`.
- Mutating financial requests require an `Idempotency-Key`.
- Return stable machine-readable error codes and a correlation ID.
- Use an outbox table written in the same transaction as domain changes; workers publish notifications and downstream events from the outbox.
- Jobs are at-least-once. Every worker must therefore be idempotent.
- Use UTC timestamps in storage and ISO 8601 at APIs.
- Use database time where ordering or expiry affects money.
- Paginate all potentially unbounded lists.
- Validate request size and file type; dispute uploads are private and malware-scanned before staff access.
- Never perform signing, chain confirmation polling, email, or other slow external work while holding a database transaction open.
- Use explicit timeouts, bounded retries with jitter, and dead-letter handling for external calls.
- Health endpoints must distinguish liveness from readiness without exposing sensitive internals.

## Initial user experience

The first web release needs:

### Customer

- Registration, login, recovery and security settings
- Dashboard with available, escrowed and withdrawal-pending USDT
- Deposit page with Plasma network name, address, QR, warning and deposit status
- Withdrawal page with address, network, amount, confirmation and status
- Marketplace offer list with filters
- Create/edit/pause an offer
- Trade room showing amount, rate, ETB total, payment instructions, countdown/state, actions and dispute entry
- Transaction and trade history
- Notifications

### Administrator

- Role-protected admin area isolated from customer routes
- User and account status view
- Deposit and withdrawal investigation queues
- Withdrawal approval queue
- Dispute queue with evidence and complete event timeline
- Ledger transaction viewer; no direct editing
- Reconciliation status and exceptions
- Audit-event search

Do not build an admin “set balance” function. Any correction must invoke a typed, balanced adjustment workflow with reason, evidence, authorization and audit trail.

## MVP scope and non-goals

### Include

- A complete mocked vertical slice of deposit → offer → escrow → manual fiat-payment confirmation → release → withdrawal request
- Real PostgreSQL ledger behavior
- Authentication and object authorization
- Admin dispute resolution
- Blockchain and custody interfaces with deterministic sandbox/mock implementations
- Clear replacement points for real Plasma/custody integration
- Responsive web UI
- Tests for happy paths, failure paths, retries and concurrent requests

### Do not include initially

- Native mobile applications
- Multiple cryptocurrencies or networks
- ETB bank or mobile-money API integration
- User-connected external wallets
- On-chain escrow smart contracts
- Automated exchange order book or market maker
- Margin, lending, staking, swaps or yield
- Real production private keys or real-money transfers
- Microservices; start as a modular monolith with background workers
- Kubernetes unless scale measurements later justify it

## Required interfaces

Create interfaces before external integrations:

```ts
interface BlockchainGateway {
  validateAddress(address: string): Promise<boolean>;
  getTransaction(txHash: string): Promise<NormalizedChainTransaction | null>;
  getConfirmations(txHash: string): Promise<number>;
  buildTokenTransfer(input: BuildTransferInput): Promise<UnsignedTransaction>;
  broadcast(signedTransaction: SignedTransaction): Promise<BroadcastResult>;
}

interface CustodyProvider {
  createDepositAddress(userReference: string): Promise<CustodyAddress>;
  signTransaction(input: SignRequest): Promise<SignedTransaction>;
}

interface RiskEngine {
  evaluateWithdrawal(input: WithdrawalRiskInput): Promise<RiskDecision>;
  evaluateTrade(input: TradeRiskInput): Promise<RiskDecision>;
}
```

Exact types should be designed in the codebase. Do not couple core domain services to a vendor SDK. Webhook controllers translate vendor payloads into normalized commands.

## Critical acceptance tests

At minimum, automate these cases:

1. Duplicate deposit webhooks credit exactly once.
2. Two simultaneous trades cannot lock the same USDT.
3. A withdrawal and trade started concurrently cannot overspend.
4. Buyer marking paid does not release escrow.
5. Repeated release requests credit the buyer exactly once.
6. An unauthorized user cannot view or mutate another trade, address, withdrawal or payment method.
7. A cancelled/expired unpaid trade returns the full escrow exactly once.
8. A disputed trade can only be resolved by an authorized role and produces a complete audit record.
9. A broadcast timeout with unknown result does not cause an automatic duplicate withdrawal or refund.
10. Every test ledger transaction is balanced.
11. Rebuilding balance projections from the immutable ledger produces identical balances.
12. Reconciliation detects a deliberate difference between on-chain controlled assets and customer liabilities.
13. Logs and error reports do not contain secrets or full sensitive payment instructions.

## Build sequence

### Phase 0 — Decisions and threat model

Produce, without coding application features:

- A concise architecture decision record
- Trust boundaries and threat model
- Ledger account taxonomy and example journal entries
- Trade, deposit and withdrawal state-transition tables
- Data classification and secret inventory
- Open questions, especially custody-provider and Plasma sponsored-gas compatibility

Stop for user review after Phase 0.

### Phase 1 — Foundation

- Monorepo, local containers, linting, formatting, typecheck and CI
- NestJS/Fastify API and Next.js shell
- PostgreSQL migrations
- Authentication foundation and authorization policy
- Structured logging, correlation IDs and error format

### Phase 2 — Ledger vertical slice

- Ledger accounts, balanced posting service, idempotency and balance projection
- Property/invariant and concurrency tests
- Admin read-only ledger viewer

Do not build P2P financial mutations until the ledger tests pass.

### Phase 3 — Mock wallet operations

- Custody and blockchain interfaces
- Unique mock deposit addresses
- Idempotent mock deposit confirmation and credit
- Withdrawal hold, review, mock signing/broadcast and confirmation
- Reconciliation job

### Phase 4 — P2P escrow

- Offers, trade state machine, escrow lock/release/refund
- Out-of-band ETB payment instructions
- Expiry, disputes, audit events and notifications
- Concurrency and authorization tests

### Phase 5 — UX hardening

- Complete responsive customer and admin flows
- Accessibility, error states and recovery paths
- Playwright critical journeys

### Phase 6 — Real provider sandbox

Only after explicit approval:

- Select and validate custody/signing provider
- Validate Plasma USDT asset representation, deposit indexing, confirmation policy, sponsored transfer eligibility, limits, and exchange/wallet compatibility
- Integrate provider sandbox/test environment
- Complete security and operational reviews before any production activation

## Instructions for Claude’s first response

After reading this file:

1. Restate the architecture in no more than ten bullets.
2. Identify contradictions, unsafe assumptions, and unanswered decisions. Do not silently choose custody-critical behavior.
3. Propose the Phase 0 deliverables and exact filenames.
4. Show the proposed repository tree.
5. List the first acceptance tests to be written.
6. Ask only the questions that block Phase 0. Brand name, colors, and cosmetic preferences do not block architecture work and may use temporary placeholders.
7. Do not write production feature code until Phase 0 is reviewed.

## Engineering behavior required from Claude

- Inspect existing files before editing.
- Never overwrite unrelated user changes.
- Make small commits or clearly separable changes.
- Explain migrations before applying them.
- Never delete financial data to fix a migration or test.
- Keep all external services behind adapters and provide deterministic mocks.
- Use secure defaults and fail closed.
- Do not leave security-critical `TODO` comments hidden in code; track unresolved items visibly in `docs/open-questions.md`.
- Run formatting, lint, typecheck, unit tests, integration tests and build as applicable before reporting completion.
- Report what was verified, what remains mocked, and what is unsafe for production.
- If a request threatens ledger invariants, custody separation, idempotency or authorization, stop and explain the conflict.

## First prompt to send Claude

Paste the following after attaching this file or placing it at the repository root as `CLAUDE.md`:

> Read `CLAUDE.md` completely and treat it as the current project specification. We are beginning from an empty repository. Start with Phase 0 only. Do not build production features yet. Produce the architecture decision record, threat model, ledger account taxonomy with example balanced journal entries, state-transition tables for deposits/withdrawals/trades, proposed repository tree, acceptance-test plan, and a short list of genuinely blocking questions. Clearly mark all real blockchain and custody behavior as unvalidated until provider compatibility is confirmed. Keep the explanation understandable to a developer who knows web programming but is new to exchange custody and accounting.

## Information the owner must provide later

These are not required to start Phase 0, but Claude must request them before the relevant integration:

- Final product name and brand assets
- Chosen authentication/email/SMS providers
- Chosen custody/signing provider and sandbox documentation
- Confirmed Plasma/USDT route and token contract/network identifiers from authoritative sources
- Paymaster or sponsored-gas eligibility and credentials
- Blockchain RPC/indexing provider
- Treasury policy, withdrawal approval thresholds and operational roles
- Deposit confirmation/finality policy
- Trading limits, offer limits, expiry times and dispute-service targets
- Notification templates and support channels
- Production infrastructure account and secret-management access

Never paste seed phrases, private keys, production API secrets, database passwords, recovery codes or real customer information into Claude chat or repository files.
