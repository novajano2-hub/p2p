import { createPrismaClient, type PrismaClient } from "@abay/database";
import { type NestFastifyApplication } from "@nestjs/platform-fastify";

import { createApp } from "@/app";
import { loadEnv } from "@/config/env";
import { PrismaService } from "@/infra/prisma/prisma.service";
import { accounts, parseAccountCode } from "@/modules/ledger/account-code";
import { InsufficientFundsError } from "@/modules/ledger/ledger.errors";
import { LedgerService, type PostedTransaction } from "@/modules/ledger/ledger.service";
import { naturalDelta, type PostingRequest } from "@/modules/ledger/posting";

/*
  The two Phase 2 properties that are stated over "any sequence of operations"
  rather than over one carefully chosen example:

    AT-18  balances never go negative, under any operation sequence, with
           concurrency, and it is the database - not the application - that
           refuses the invalid ones.
    AT-11  rebuilding every balance from the entries alone gives exactly the
           projection.

  Both are driven by the same thing: a small seeded generator that plays
  random deposits, escrow locks, releases, refunds, withdrawal holds and hold
  releases against a handful of customers, some of them deliberately
  unaffordable, and a model of what the balances must be that is kept in
  memory and compared to the database after every step. A failure prints the
  seed; LEDGER_PROPERTY_SEED=<seed> replays exactly that sequence.

  Every owner id and correlation id starts with "test-", which is how
  global-teardown.js knows which immutable rows are its to clear.
*/

let app: NestFastifyApplication;
let db: PrismaClient;
let prisma: PrismaService;
let ledger: LedgerService;

const USDT = 1_000_000n;
const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let counter = 0;
const uniq = (label: string) => `test-${run}-${label}-${++counter}`;

beforeAll(async () => {
  const env = loadEnv();
  app = await createApp(env);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  db = createPrismaClient(env.DATABASE_URL);
  prisma = app.get(PrismaService);
  ledger = app.get(LedgerService);
});

afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

/*
  AT-10, as the plan words it: not a test but a hook. Whatever the test above
  it was doing, if anything in this file managed to write an unbalanced
  transaction, the file fails.
*/
afterEach(async () => {
  const rows = await db.$queryRaw<{ transaction_id: string }[]>`
    SELECT transaction_id FROM ledger_entries
     GROUP BY transaction_id, asset
    HAVING sum(signed_amount) <> 0 OR count(*) < 2`;
  expect(rows).toEqual([]);
  const assets = await db.$queryRaw<{ transaction_id: string }[]>`
    SELECT transaction_id FROM ledger_entries
     GROUP BY transaction_id HAVING count(DISTINCT asset) <> 1`;
  expect(assets).toEqual([]);
});

/* ------------------------------------------------------------ randomness */

/** mulberry32: small, fast, and the same sequence for the same seed on every machine. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFor(label: string): number {
  const fromEnv = process.env.LEDGER_PROPERTY_SEED;
  if (fromEnv !== undefined && fromEnv !== "") return Number(fromEnv) >>> 0;
  return (Math.floor(Math.random() * 0xffffffff) ^ label.length) >>> 0;
}

/* ----------------------------------------------------------------- world */

interface Trade {
  id: string;
  seller: string;
  buyer: string;
  amount: bigint;
  lockId: string;
  settled: boolean;
}

interface Op {
  kind: "deposit" | "lock" | "release" | "refund" | "hold" | "holdRelease";
  request: PostingRequest;
  /** The USER/TRADE accounts money leaves, and how much. What decides validity. */
  debits: { account: string; amount: bigint }[];
  /** Bookkeeping to apply when the posting succeeds. */
  onSuccess?: (posted: PostedTransaction) => void;
}

/*
  The model. It knows the balance every customer and trade account must hold
  given the postings that succeeded, and nothing about how the database got
  there. Platform accounts are shared with every other test in the run, so
  they are checked by invariant (AT-11) rather than by prediction.
*/
class World {
  readonly random: () => number;
  readonly users: string[];
  readonly trades: Trade[] = [];
  readonly model = new Map<string, bigint>();

  constructor(seed: number, userCount: number) {
    this.random = prng(seed);
    this.users = Array.from({ length: userCount }, (_, i) => uniq(`u${i}`));
  }

  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.random() * items.length)];
    if (item === undefined) throw new Error("pick from empty list");
    return item;
  }

  amount(max: bigint): bigint {
    // Whole units up to max; never zero.
    const units = BigInt(Math.floor(this.random() * Number(max / USDT))) + 1n;
    return units * USDT;
  }

  balance(code: string): bigint {
    return this.model.get(code) ?? 0n;
  }

  /** Whether the model says the posting is affordable. Exact only when nothing else is running. */
  affordable(op: Op): boolean {
    const after = new Map<string, bigint>();
    for (const debit of op.debits) {
      const current = after.get(debit.account) ?? this.balance(debit.account);
      after.set(debit.account, current - debit.amount);
    }
    return [...after.values()].every((value) => value >= 0n);
  }

  /** A posting that happened: move the model the way the trigger moved the database. */
  apply(op: Op, posted: PostedTransaction): void {
    for (const line of posted.lines) {
      const descriptor = parseAccountCode(line.account);
      if (descriptor.scope === "PLATFORM") continue;
      const delta = naturalDelta(descriptor.type, line.direction, line.amount);
      this.model.set(line.account, this.balance(line.account) + delta);
    }
    op.onSuccess?.(posted);
  }

  /*
    A random operation. Roughly one in four asks for more than the model
    thinks is there - those are the ones the ledger must refuse. Deposits are
    always valid; everything else can be made unaffordable.
  */
  next(): Op {
    const user = this.pick(this.users);
    const overdraw = this.random() < 0.25;
    const spendable = (code: string) => {
      const have = this.balance(code);
      if (overdraw || have === 0n) return this.amount(5n * USDT) + have;
      return this.amount(have);
    };
    const open = this.trades.filter((t) => !t.settled);
    const roll = this.random();

    if (roll < 0.25 || (open.length === 0 && roll >= 0.45 && roll < 0.7)) {
      const amount = this.amount(20n * USDT);
      return {
        kind: "deposit",
        debits: [],
        request: this.posting("DEPOSIT_CREDITED", { type: "deposit", id: uniq("dep") }, [
          { account: accounts.platform("DEPOSIT_ADDRESSES"), direction: "DEBIT", amount },
          { account: accounts.userAvailable(user), direction: "CREDIT", amount },
        ]),
      };
    }
    if (roll < 0.45) {
      const available = accounts.userAvailable(user);
      const amount = spendable(available);
      const trade: Trade = {
        id: uniq("trade"),
        seller: user,
        buyer: this.pick(this.users.filter((u) => u !== user)),
        amount,
        lockId: "",
        settled: false,
      };
      return {
        kind: "lock",
        debits: [{ account: available, amount }],
        request: this.posting("ESCROW_LOCKED", { type: "trade", id: trade.id }, [
          { account: available, direction: "DEBIT", amount },
          { account: accounts.tradeEscrow(trade.id), direction: "CREDIT", amount },
        ]),
        onSuccess: (posted) => {
          trade.lockId = posted.id;
          this.trades.push(trade);
        },
      };
    }
    if (roll < 0.6) {
      const trade = this.pick(open);
      const escrow = accounts.tradeEscrow(trade.id);
      const amount = overdraw ? trade.amount + this.amount(3n * USDT) : trade.amount;
      return {
        kind: "release",
        debits: [{ account: escrow, amount }],
        request: this.posting("ESCROW_RELEASED", { type: "trade", id: trade.id }, [
          { account: escrow, direction: "DEBIT", amount },
          { account: accounts.userAvailable(trade.buyer), direction: "CREDIT", amount },
          { account: accounts.platform("TRADE_FEES"), direction: "CREDIT", amount: 0n },
        ]),
        onSuccess: () => {
          trade.settled = true;
        },
      };
    }
    if (roll < 0.7) {
      const trade = this.pick(open);
      const escrow = accounts.tradeEscrow(trade.id);
      const amount = overdraw ? trade.amount + this.amount(3n * USDT) : trade.amount;
      return {
        kind: "refund",
        debits: [{ account: escrow, amount }],
        request: {
          ...this.posting("ESCROW_REFUNDED_EXPIRY", { type: "trade", id: trade.id }, [
            { account: escrow, direction: "DEBIT", amount },
            { account: accounts.userAvailable(trade.seller), direction: "CREDIT", amount },
          ]),
          reversesTransactionId: trade.lockId,
        },
        onSuccess: () => {
          trade.settled = true;
        },
      };
    }
    if (roll < 0.85) {
      const available = accounts.userAvailable(user);
      const amount = spendable(available);
      return {
        kind: "hold",
        debits: [{ account: available, amount }],
        request: this.posting("WITHDRAWAL_HELD", { type: "withdrawal", id: uniq("wd") }, [
          { account: available, direction: "DEBIT", amount },
          { account: accounts.userPendingWithdrawal(user), direction: "CREDIT", amount },
          { account: accounts.platform("WITHDRAWAL_FEES"), direction: "CREDIT", amount: 0n },
        ]),
      };
    }
    const pending = accounts.userPendingWithdrawal(user);
    const amount = spendable(pending);
    return {
      kind: "holdRelease",
      debits: [{ account: pending, amount }],
      request: this.posting("WITHDRAWAL_HOLD_RELEASED", { type: "withdrawal", id: uniq("wd") }, [
        { account: pending, direction: "DEBIT", amount },
        { account: accounts.userAvailable(user), direction: "CREDIT", amount },
      ]),
    };
  }

  private posting(
    reason: PostingRequest["reason"],
    reference: PostingRequest["reference"],
    lines: PostingRequest["lines"],
  ): PostingRequest {
    return {
      reason,
      asset: "USDT",
      reference,
      actor: { type: "SYSTEM" },
      correlationId: uniq("corr"),
      idempotencyKey: uniq("key"),
      lines,
    };
  }

  /** Every USER and TRADE balance this world touched, straight from the database. */
  async actual(): Promise<Map<string, bigint>> {
    const rows = await db.ledgerAccount.findMany({
      where: { ownerId: { startsWith: `test-${run}-` } },
      include: { balance: true },
    });
    return new Map(rows.map((row) => [row.code, row.balance?.balance ?? 0n]));
  }

  /** The model and the database agree on every account, and nothing is below zero. */
  async check(where: string): Promise<void> {
    const actual = await this.actual();
    for (const [code, expected] of this.model) {
      expect([where, code, actual.get(code)]).toEqual([where, code, expected]);
    }
    for (const [code, value] of actual) {
      expect([where, code, value >= 0n]).toEqual([where, code, true]);
    }
  }
}

/** Runs one op, returning the outcome with the op attached so a failure can say what it was. */
async function attempt(world: World, op: Op): Promise<{ op: Op; error?: unknown }> {
  try {
    const posted = await ledger.post(op.request);
    // "At any point": the balances this posting left behind, not only the end state.
    for (const [code, value] of Object.entries(posted.balances)) {
      if (parseAccountCode(code).scope !== "PLATFORM") {
        expect([code, value >= 0n]).toEqual([code, true]);
      }
    }
    world.apply(op, posted);
    return { op };
  } catch (error) {
    return { op, error };
  }
}

function describeOp(op: Op): string {
  return `${op.kind} ${op.debits.map((d) => `${d.account} -${d.amount.toString()}`).join(", ")}`;
}

/* =================================================================== AT-18 */

describe("AT-18: balances never go negative, under any operation sequence", () => {
  /*
    One operation at a time, so the model can say in advance exactly which
    postings are affordable. Every affordable one must succeed; every other
    one must be refused as insufficient funds, with nothing written; and the
    database must agree with the model after each step.
  */
  it("sequentially: exactly the affordable operations succeed, all others are refused", async () => {
    for (let round = 0; round < 3; round++) {
      const seed = seedFor(`sequential-${round}`);
      const tag = `seed=${seed}`;
      const world = new World(seed, 4);
      let refused = 0;
      for (let step = 0; step < 60; step++) {
        const op = world.next();
        const predicted = world.affordable(op);
        const outcome = await attempt(world, op);
        const succeeded = outcome.error === undefined;
        expect([tag, step, describeOp(op), succeeded]).toEqual([
          tag,
          step,
          describeOp(op),
          predicted,
        ]);
        if (!succeeded) {
          expect(outcome.error).toBeInstanceOf(InsufficientFundsError);
          refused++;
        }
        if (step % 10 === 9) await world.check(`${tag} step=${step}`);
      }
      await world.check(`${tag} end`);
      // A run that refused nothing would have proved nothing about refusals.
      expect([tag, refused > 0]).toEqual([tag, true]);
    }
  }, 120_000);

  /*
    Now with concurrency: batches of operations fired at once against the
    same few accounts. Which of a batch's competing spends win is up to the
    row locks, so the model follows the outcomes rather than predicting them
    - but whatever won, no balance may ever be negative, every refusal must
    be a clean insufficient-funds answer, and the database must agree with
    the model after every batch.
  */
  it("concurrently: whichever operations win, no balance is ever negative", async () => {
    for (let round = 0; round < 2; round++) {
      const seed = seedFor(`concurrent-${round}`);
      const tag = `seed=${seed}`;
      const world = new World(seed, 3);
      let refused = 0;
      for (let batch = 0; batch < 12; batch++) {
        const ops = Array.from({ length: 8 }, () => world.next());
        const outcomes = await Promise.all(ops.map((op) => attempt(world, op)));
        for (const outcome of outcomes) {
          if (outcome.error !== undefined) {
            refused++;
            expect([tag, batch, describeOp(outcome.op), outcome.error]).toEqual([
              tag,
              batch,
              describeOp(outcome.op),
              expect.any(InsufficientFundsError),
            ]);
          }
        }
        await world.check(`${tag} batch=${batch}`);
      }
      expect([tag, world.trades.length > 0, refused > 0]).toEqual([tag, true, true]);
    }
  }, 120_000);

  /*
    The plan's last clause: it is the database, not the application, that
    refuses. The service and its overdraw check are bypassed entirely and a
    perfectly balanced transaction that spends more than the customer has is
    written by hand. The floor constraint on the projection must be what
    stops it, by name, and nothing may remain.
  */
  it("the database constraint refuses an overdraw when the application is bypassed", async () => {
    const user = uniq("user");
    const trade = uniq("trade");
    await ledger.post({
      reason: "OPENING_BALANCE",
      asset: "USDT",
      reference: { type: "fixture", id: uniq("fixture") },
      actor: { type: "SYSTEM" },
      correlationId: uniq("corr"),
      idempotencyKey: uniq("seed"),
      lines: [
        { account: accounts.platform("OPENING_BALANCE"), direction: "DEBIT", amount: 1n * USDT },
        { account: accounts.userAvailable(user), direction: "CREDIT", amount: 1n * USDT },
      ],
    });
    const escrow = await ledger.ensureAccount(accounts.tradeEscrow(trade));
    const available = await db.ledgerAccount.findUniqueOrThrow({
      where: { code: accounts.userAvailable(user) },
    });
    const key = uniq("bypass");

    const bypass = prisma.client.$transaction(async (tx) => {
      const t = await tx.ledgerTransaction.create({
        data: {
          asset: "USDT",
          reason: "ESCROW_LOCKED",
          referenceType: "trade",
          referenceId: trade,
          actorType: "SYSTEM",
          correlationId: uniq("corr"),
          idempotencyKey: key,
        },
      });
      const amount = 2n * USDT;
      await tx.ledgerEntry.createMany({
        data: [
          {
            transactionId: t.id,
            accountId: available.id,
            direction: "DEBIT",
            amount,
            signedAmount: amount,
            asset: "USDT",
          },
          {
            transactionId: t.id,
            accountId: escrow.id,
            direction: "CREDIT",
            amount,
            signedAmount: -amount,
            asset: "USDT",
          },
        ],
      });
    });
    await expect(bypass).rejects.toThrow(/ledger_account_balances_floor/);

    expect(await ledger.balance(accounts.userAvailable(user))).toBe(1n * USDT);
    expect(await ledger.balance(accounts.tradeEscrow(trade))).toBe(0n);
    expect(await db.ledgerTransaction.count({ where: { idempotencyKey: key } })).toBe(0);
  });
});

/* =================================================================== AT-11 */

/*
  After everything above has run - hundreds of postings, some concurrent -
  photograph the projection, then inside one transaction wipe every balance
  to zero, rebuild all of them from the entries alone, read the result, and
  roll back. The rebuild must equal the photograph exactly, for every account
  in the database and not only this run's: balance and entry count both. If
  the trigger ever applied a sign backwards or skipped an entry, this is the
  test that says so.
*/
describe("AT-11: rebuilding balances from the entries reproduces the projection exactly", () => {
  interface BalanceRow {
    account_id: string;
    balance: bigint;
    entry_count: number;
  }
  const shape = (rows: BalanceRow[]) =>
    rows.map((row) => `${row.account_id} ${row.balance.toString()} ${row.entry_count}`);

  it("truncate, rebuild, compare", async () => {
    const before = await db.$queryRaw<BalanceRow[]>`
      SELECT account_id, balance, entry_count FROM ledger_account_balances ORDER BY account_id`;
    expect(before.length).toBeGreaterThan(11);

    const ROLLBACK = new Error("rollback: the rebuild is a measurement, not a change");
    let rebuilt: BalanceRow[] = [];
    await expect(
      db.$transaction(
        async (tx) => {
          await tx.$executeRaw`UPDATE ledger_account_balances SET balance = 0, entry_count = 0`;
          await tx.$executeRaw`
            UPDATE ledger_account_balances b
               SET balance = agg.balance, entry_count = agg.entries
              FROM (SELECT e.account_id,
                           sum(CASE WHEN a.type IN ('ASSET', 'EXPENSE')
                                    THEN e.signed_amount ELSE -e.signed_amount END) AS balance,
                           count(*)::int AS entries
                      FROM ledger_entries e
                      JOIN ledger_accounts a ON a.id = e.account_id
                     GROUP BY e.account_id) agg
             WHERE agg.account_id = b.account_id`;
          rebuilt = await tx.$queryRaw<BalanceRow[]>`
            SELECT account_id, balance, entry_count FROM ledger_account_balances ORDER BY account_id`;
          throw ROLLBACK;
        },
        { timeout: 60_000 },
      ),
    ).rejects.toBe(ROLLBACK);

    expect(rebuilt.length).toBe(before.length);
    expect(shape(rebuilt)).toEqual(shape(before));

    // And the rollback held: the projection is exactly what it was.
    const after = await db.$queryRaw<BalanceRow[]>`
      SELECT account_id, balance, entry_count FROM ledger_account_balances ORDER BY account_id`;
    expect(shape(after)).toEqual(shape(before));
  }, 120_000);
});
