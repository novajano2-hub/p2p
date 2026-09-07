# Abay (placeholder name)

A peer-to-peer marketplace for trading USDT against Ethiopian birr. Custodial, pooled
wallets; an immutable double-entry ledger; escrow as an internal ledger hold; the birr leg
settled out of band.

The durable project brief is [CLAUDE.md](CLAUDE.md). Architecture, threat model, ledger
design and the acceptance-test plan are under [docs/](docs/README.md).

## Status

| Phase                               | State                                   |
| ----------------------------------- | --------------------------------------- |
| 0. Decisions and threat model       | Done, under review                      |
| 0.5 Landing page and monorepo shell | **In progress**                         |
| 1. Foundation (API, database, auth) | Not started                             |
| 2. Ledger vertical slice            | Not started                             |
| 3. Mock wallet operations           | Not started                             |
| 4. P2P escrow                       | Not started                             |
| 5. UX hardening                     | Not started                             |
| 6. Real provider sandbox            | Not started; requires explicit approval |

No real blockchain, custody or money behaviour exists in this repository. Everything about
the real chain route is marked UNVALIDATED in [docs/open-questions.md](docs/open-questions.md).

## Layout

npm workspaces with Turborepo.

```
apps/web         Next.js client (App Router, Tailwind v4)
packages/config  Shared TypeScript configuration
docs/            Architecture, threat model, testing, open questions
scripts/         Repository utilities (dependency pinning)
```

## Running locally

Requires Node 24 (`.nvmrc`) and npm 10 or later.

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

## Checks

```bash
npm run check                       # format, lint, typecheck, build
npm run check:boundaries -w web
npm run test:e2e -w web             # once: npm exec -w web -- playwright install chromium
```

Dependencies are pinned exactly. After adding or upgrading a package, run `npm run pin`
and commit `package-lock.json` with it.

CI runs all of the above plus a dependency audit and secret scan on every pull request.
