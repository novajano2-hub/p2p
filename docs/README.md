# ETB/USDT P2P Platform — Documentation

**Status: Phase 4 complete (the marketplace: offers, trades, escrow, chat, disputes and
their screens). Phase 5, UX hardening, is next.**

These documents describe what is built as well as what is intended: the design documents
carry dated **Built (Phase N, stage M)** notes where the code has caught up with them, and
where it has not they say so. What has _not_ changed is the standing caveat - nothing here
has been validated against a real custody provider, a real blockchain network, or a real
payment rail, and every claim that depends on one is marked UNVALIDATED.

## Read in this order

| #   | Document                                                                   | What it answers                                                                 |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | [architecture/glossary.md](architecture/glossary.md)                       | What the words mean, if you know web dev but not exchange custody or accounting |
| 2   | [architecture/overview.md](architecture/overview.md)                       | What the system is, what the pieces are, where the trust boundaries sit         |
| 3   | [architecture/adr/](architecture/adr/)                                     | The ten decisions that shape everything else, and why                           |
| 4   | [architecture/ledger-taxonomy.md](architecture/ledger-taxonomy.md)         | The chart of accounts and worked, balanced journal entries                      |
| 5   | [architecture/state-machines.md](architecture/state-machines.md)           | Deposit, withdrawal and trade transition tables                                 |
| 6   | [architecture/data-classification.md](architecture/data-classification.md) | Data classes and the secret inventory                                           |
| 7   | [architecture/repository-tree.md](architecture/repository-tree.md)         | The monorepo layout as built, and the rules behind it                           |
| 8   | [threat-model/README.md](threat-model/README.md)                           | Attackers, boundaries, STRIDE analysis, risk register                           |
| 9   | [testing/acceptance-test-plan.md](testing/acceptance-test-plan.md)         | The tests that define "correct"                                                 |
| 10  | [open-questions.md](open-questions.md)                                     | Blocking questions and the unvalidated-assumption register                      |
| 11  | [runbooks/](runbooks/)                                                     | What to do, for the jobs a person has to do by hand                             |

## The one-paragraph version

Users deposit USDT to an address the platform controls. The platform records who owns
what in an **internal double-entry ledger**, not on the blockchain. When two users trade
USDT for Ethiopian birr, the USDT never moves on-chain — it moves between rows in our
ledger, and the birr moves through a bank outside our system entirely. The blockchain is
only involved at two moments: money coming in (deposit) and money going out (withdrawal).
Everything in between is bookkeeping. Getting the bookkeeping provably right is the
entire engineering problem.

## Marking convention used throughout

- **UNVALIDATED** — depends on behavior of Plasma, USDT on Plasma, sponsored gas, or a
  custody provider that **has not been confirmed**. Treat as a hypothesis, never as a
  fact. Every such item is also listed in [open-questions.md](open-questions.md).
- **INVARIANT** — a rule that must hold at all times. Enforced in the database where
  possible, never only in application code.
- **AT-n** — cross-reference to a numbered acceptance test in
  [testing/acceptance-test-plan.md](testing/acceptance-test-plan.md).
