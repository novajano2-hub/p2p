import { createPrismaClient, type PrismaClient } from "@abay/database";
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import { type PinoLogger } from "nestjs-pino";

import { createApp } from "@/app";
import { assertNoOpenTransaction, IoInsideTransactionError } from "@/common/io/transaction-scope";
import { loadEnv } from "@/config/env";
import { ResendMailer } from "@/infra/mail/resend.mailer";
import { PrismaService } from "@/infra/prisma/prisma.service";
import { accounts } from "@/modules/ledger/account-code";
import {
  IdempotencyConflictError,
  InsufficientFundsError,
  UnknownPlatformAccountError,
} from "@/modules/ledger/ledger.errors";
import { LedgerService } from "@/modules/ledger/ledger.service";
import { type PostingRequest } from "@/modules/ledger/posting";

/*
  The ledger service against a real PostgreSQL: that money moves only through
  it, that it refuses an overdraw while the row is locked, that a retried
  posting is answered rather than repeated, and - the properties that live in
  the database rather than in this code - that the database itself refuses an
  unbalanced transaction (AT-16) and an edit to posted history (AT-15), and
  that a transaction cannot reach out to the network from inside itself
  (AT-19).

  Every owner id and correlation id here starts with "test-", which is how
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

/** A customer given funds from the fixture-only equity account (taxonomy 3.6). */
function seed(userId: string, amount: bigint, key = uniq("seed")): PostingRequest {
  return {
    reason: "OPENING_BALANCE",
    asset: "USDT",
    reference: { type: "fixture", id: key },
    actor: { type: "SYSTEM" },
    correlationId: uniq("corr"),
    idempotencyKey: key,
    lines: [
      { account: accounts.platform("OPENING_BALANCE"), direction: "DEBIT", amount },
      { account: accounts.userAvailable(userId), direction: "CREDIT", amount },
    ],
  };
}

/** JE-3: a customer's available USDT locked into a trade's escrow. */
function lock(userId: string, tradeId: string, amount: bigint, key = uniq("lock")): PostingRequest {
  return {
    reason: "ESCROW_LOCKED",
    asset: "USDT",
    reference: { type: "trade", id: tradeId },
    actor: { type: "USER", id: userId },
    correlationId: uniq("corr"),
    idempotencyKey: key,
    lines: [
      { account: accounts.userAvailable(userId), direction: "DEBIT", amount },
      { account: accounts.tradeEscrow(tradeId), direction: "CREDIT", amount },
    ],
  };
}

describe("posting", () => {
  it("posts JE-1 and moves both balances in their natural sense", async () => {
    const user = uniq("user");
    const deposits = accounts.platform("DEPOSIT_ADDRESSES");
    const before = await ledger.balance(deposits);

    const posted = await ledger.post({
      reason: "DEPOSIT_CREDITED",
      asset: "USDT",
      reference: { type: "deposit", id: uniq("dep") },
      actor: { type: "SYSTEM" },
      correlationId: uniq("corr"),
      idempotencyKey: uniq("deposit"),
      lines: [
        { account: deposits, direction: "DEBIT", amount: 100n * USDT },
        { account: accounts.userAvailable(user), direction: "CREDIT", amount: 100n * USDT },
      ],
    });

    expect(posted.replayed).toBe(false);
    // The asset was debited and the liability credited, and BOTH read +100.
    expect(posted.balances[deposits]).toBe(before + 100n * USDT);
    expect(posted.balances[accounts.userAvailable(user)]).toBe(100n * USDT);
    expect(await ledger.balance(accounts.userAvailable(user))).toBe(100n * USDT);

    const row = await db.ledgerTransaction.findUniqueOrThrow({
      where: { id: posted.id },
      include: { entries: true },
    });
    expect(row.reason).toBe("DEPOSIT_CREDITED");
    expect(row.actorType).toBe("SYSTEM");
    expect(row.entries).toHaveLength(2);
    expect(row.entries.reduce((sum, e) => sum + e.signedAmount, 0n)).toBe(0n);
  });

  it("creates a customer's account on first use, exactly once under concurrency", async () => {
    const user = uniq("user");
    await Promise.all(Array.from({ length: 5 }, () => ledger.post(seed(user, 1n * USDT))));
    expect(await db.ledgerAccount.count({ where: { code: accounts.userAvailable(user) } })).toBe(1);
    expect(await ledger.balance(accounts.userAvailable(user))).toBe(5n * USDT);
  });

  it("reads zero for an account that does not exist yet", async () => {
    expect(await ledger.balance(accounts.userAvailable(uniq("nobody")))).toBe(0n);
  });
});

describe("refusals", () => {
  it("refuses an overdraw, names the account, and writes nothing", async () => {
    const user = uniq("user");
    await ledger.post(seed(user, 10n * USDT));
    const key = uniq("lock");

    const attempt = ledger.post(lock(user, uniq("trade"), 15n * USDT, key));
    await expect(attempt).rejects.toBeInstanceOf(InsufficientFundsError);
    await expect(attempt).rejects.toMatchObject({ accountCode: accounts.userAvailable(user) });

    expect(await ledger.balance(accounts.userAvailable(user))).toBe(10n * USDT);
    expect(await db.ledgerTransaction.count({ where: { idempotencyKey: key } })).toBe(0);
  });

  it("refuses a platform account the chart does not contain, rather than inventing one", async () => {
    const request = seed(uniq("user"), 1n * USDT);
    request.lines = [
      { account: "ASSET:PLATFORM:USDT:NOT_A_REAL_ACCOUNT", direction: "DEBIT", amount: 1n * USDT },
      request.lines[1]!,
    ];
    await expect(ledger.post(request)).rejects.toBeInstanceOf(UnknownPlatformAccountError);
  });

  /*
    AT-16. The service is bypassed entirely and the rows written by hand,
    unbalanced. The database must refuse at COMMIT - which proves the
    invariant survives a future bug in this or any other service, which is
    the entire reason it lives in the database.
  */
  it("AT-16: the database refuses an unbalanced transaction even when the service is bypassed", async () => {
    const user = uniq("user");
    await ledger.post(seed(user, 1n * USDT));
    const account = await db.ledgerAccount.findUniqueOrThrow({
      where: { code: accounts.userAvailable(user) },
    });
    const equity = await db.ledgerAccount.findUniqueOrThrow({
      where: { code: accounts.platform("OPENING_BALANCE") },
    });

    const bypass = prisma.client.$transaction(async (tx) => {
      const t = await tx.ledgerTransaction.create({
        data: {
          asset: "USDT",
          reason: "OPENING_BALANCE",
          referenceType: "fixture",
          referenceId: "bypass",
          actorType: "SYSTEM",
          correlationId: uniq("corr"),
          idempotencyKey: uniq("bypass"),
        },
      });
      await tx.ledgerEntry.createMany({
        data: [
          {
            transactionId: t.id,
            accountId: equity.id,
            direction: "DEBIT",
            amount: 5n,
            signedAmount: 5n,
            asset: "USDT",
          },
          {
            transactionId: t.id,
            accountId: account.id,
            direction: "CREDIT",
            amount: 3n,
            signedAmount: -3n,
            asset: "USDT",
          },
        ],
      });
    });
    await expect(bypass).rejects.toThrow(/does not balance/);
  });

  /* AT-15. Posted history, and the application role cannot touch it. */
  it("AT-15: the application role cannot rewrite or erase posted history", async () => {
    const user = uniq("user");
    const posted = await ledger.post(seed(user, 1n * USDT));
    await expect(
      prisma.client
        .$executeRaw`UPDATE ledger_entries SET amount = 1 WHERE transaction_id = ${posted.id}`,
    ).rejects.toThrow(/permission denied/);
    await expect(
      prisma.client.$executeRaw`DELETE FROM ledger_transactions WHERE id = ${posted.id}`,
    ).rejects.toThrow(/permission denied/);
  });
});

describe("idempotency", () => {
  it("answers a repeated posting with the original, writing nothing new", async () => {
    const user = uniq("user");
    const request = seed(user, 7n * USDT);

    const first = await ledger.post(request);
    const again = await ledger.post(request);

    expect(again.id).toBe(first.id);
    expect(again.replayed).toBe(true);
    expect(
      await db.ledgerTransaction.count({ where: { idempotencyKey: request.idempotencyKey } }),
    ).toBe(1);
    // Credited once, not twice.
    expect(await ledger.balance(accounts.userAvailable(user))).toBe(7n * USDT);
  });

  it("refuses a key reused for a different posting", async () => {
    const user = uniq("user");
    const request = seed(user, 7n * USDT);
    await ledger.post(request);

    const different = { ...request, lines: seed(user, 8n * USDT).lines };
    await expect(ledger.post(different)).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(await ledger.balance(accounts.userAvailable(user))).toBe(7n * USDT);
  });

  /* The lookup and the insert are not one step; the unique index is what settles a race. */
  it("settles a race on the same key with one transaction", async () => {
    const user = uniq("user");
    const request = seed(user, 3n * USDT);
    const results = await Promise.all(Array.from({ length: 5 }, () => ledger.post(request)));
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(
      await db.ledgerTransaction.count({ where: { idempotencyKey: request.idempotencyKey } }),
    ).toBe(1);
    expect(await ledger.balance(accounts.userAvailable(user))).toBe(3n * USDT);
  });
});

describe("reversal", () => {
  it("undoes a posting with a new transaction that points at the original, never an edit", async () => {
    const user = uniq("user");
    const trade = uniq("trade");
    await ledger.post(seed(user, 10n * USDT));
    const locked = await ledger.post(lock(user, trade, 10n * USDT));
    expect(await ledger.balance(accounts.userAvailable(user))).toBe(0n);

    const refund = await ledger.post({
      reason: "ESCROW_REFUNDED_EXPIRY",
      asset: "USDT",
      reference: { type: "trade", id: trade },
      actor: { type: "SYSTEM" },
      correlationId: uniq("corr"),
      idempotencyKey: uniq("refund"),
      reversesTransactionId: locked.id,
      lines: [
        { account: accounts.tradeEscrow(trade), direction: "DEBIT", amount: 10n * USDT },
        { account: accounts.userAvailable(user), direction: "CREDIT", amount: 10n * USDT },
      ],
    });

    expect(await ledger.balance(accounts.userAvailable(user))).toBe(10n * USDT);
    expect(await ledger.balance(accounts.tradeEscrow(trade))).toBe(0n);
    const row = await db.ledgerTransaction.findUniqueOrThrow({ where: { id: refund.id } });
    expect(row.reversesTransactionId).toBe(locked.id);
    // The original is still there, untouched: the history shows in and back out.
    expect(await db.ledgerEntry.count({ where: { transactionId: locked.id } })).toBe(2);
  });
});

describe("AT-19: no network I/O inside a transaction", () => {
  const quiet = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as PinoLogger;

  it("the guard trips inside a transaction opened through PrismaService", async () => {
    await expect(
      prisma.transaction("test-scope", () => {
        assertNoOpenTransaction("calling a provider");
        return Promise.resolve();
      }),
    ).rejects.toBeInstanceOf(IoInsideTransactionError);
  });

  /* A real adapter, not the guard on its own: the email provider refuses before it dials out. */
  it("an outbound adapter refuses to run inside one", async () => {
    const mailer = new ResendMailer("re_test_never_sent", "BIRQ <no-reply@example.com>", quiet);
    await expect(
      prisma.transaction("test-scope", () =>
        mailer.send({ to: "x@example.com", subject: "s", text: "t", html: "<p>t</p>" }),
      ),
    ).rejects.toBeInstanceOf(IoInsideTransactionError);
  });

  it("and is silent outside one, so ordinary work is untouched", () => {
    expect(() => {
      assertNoOpenTransaction("calling a provider");
    }).not.toThrow();
  });
});

/*
  The row lock doing its job. Twenty postings race to spend from an account
  that holds enough for exactly ten of them. If the lock did not serialise
  them, two could read the same balance and both proceed - the database floor
  would still catch that, but by then it is a constraint failure rather than
  a clean refusal. Exactly ten succeed, exactly ten are refused as
  insufficient, the balance lands on exactly zero, and every transaction
  that was written balances.
*/
describe("concurrency", () => {
  it("serialises concurrent spends: exactly the funds available are spent, never more", async () => {
    const user = uniq("user");
    await ledger.post(seed(user, 10n * USDT));

    const attempts = Array.from({ length: 20 }, () =>
      ledger.post(lock(user, uniq("trade"), 1n * USDT)),
    );
    const outcomes = await Promise.allSettled(attempts);

    const won = outcomes.filter((o) => o.status === "fulfilled");
    const lost = outcomes.filter((o) => o.status === "rejected");
    expect(won).toHaveLength(10);
    expect(lost).toHaveLength(10);
    for (const o of lost) {
      const reason: unknown = o.reason;
      expect(reason).toBeInstanceOf(InsufficientFundsError);
    }

    expect(await ledger.balance(accounts.userAvailable(user))).toBe(0n);

    const rows = await prisma.client.$queryRaw<{ unbalanced: number }[]>`
      SELECT count(*)::int AS unbalanced FROM (
        SELECT transaction_id FROM ledger_entries GROUP BY transaction_id, asset HAVING sum(signed_amount) <> 0
      ) x`;
    expect(rows[0]?.unbalanced).toBe(0);
  }, 60_000);
});
