import { createPrismaClient, type PrismaClient } from "@abay/database";

import { OPEN, SETTLED } from "@/modules/trades/trade.machine";

/*
  The two invariants that hold after every API test, wherever it lives.

  AT-10 asks for a shared hook, not a copied one: "any test in the suite that
  manages to write an unbalanced transaction fails, whatever it was doing".
  Seven specs each kept their own copy of the query and three that post to the
  ledger kept none at all - exactly the decay the plan is written against.
  This file is on the api project's setupFilesAfterEnv, so a spec written
  tomorrow is covered on the day it is written and cannot forget.

  AT-14 is the same argument about escrow. It was one test inside
  trades.spec.ts, scoped to that run's own correlation ids, so a trade left in
  a wrong state by any other spec went unseen. Here it runs over every trade
  in the database, with the two sets of states imported from the machine
  rather than typed out again, so a new state cannot quietly pass.

  Both are read-only: two aggregates and one join per test, against tables a
  test database keeps small.
*/

let client: PrismaClient | null = null;

/** One connection per spec file, opened on first use and closed with the file. */
function db(): PrismaClient {
  client ??= createPrismaClient(process.env.DATABASE_URL ?? "");
  return client;
}

/**
 * AT-10. Every transaction balances to zero per asset, has at least two
 * entries, and touches exactly one asset. The database enforces the first
 * with a deferred trigger, so a failure here is a test that swallowed it.
 */
async function everyTransactionBalances(): Promise<void> {
  const unbalanced = await db().$queryRaw<{ transaction_id: string }[]>`
    SELECT transaction_id FROM ledger_entries
     GROUP BY transaction_id, asset
    HAVING sum(signed_amount) <> 0 OR count(*) < 2`;
  expect(unbalanced).toEqual([]);

  const mixed = await db().$queryRaw<{ transaction_id: string }[]>`
    SELECT transaction_id FROM ledger_entries
     GROUP BY transaction_id HAVING count(DISTINCT asset) <> 1`;
  expect(mixed).toEqual([]);
}

/**
 * AT-14. A trade's escrow account holds exactly the trade's amount while the
 * trade is open and exactly nothing once it is settled. Trades are joined
 * left: a trade whose escrow account does not exist yet has never locked
 * anything, and zero is the right answer for it either way.
 */
async function everyEscrowMatchesItsTrade(): Promise<void> {
  const rows = await db().$queryRaw<
    { id: string; status: string; amount: bigint; balance: bigint }[]
  >`
    SELECT t.id, t.status::text AS status, t.amount, COALESCE(b.balance, 0) AS balance
      FROM trades t
      LEFT JOIN ledger_accounts a ON a.code = 'LIAB:TRADE:' || t.id || ':USDT:ESCROW'
      LEFT JOIN ledger_account_balances b ON b.account_id = a.id`;

  const wrong = rows.filter((row) => {
    if (SETTLED.includes(row.status as (typeof SETTLED)[number])) return row.balance !== 0n;
    if (OPEN.includes(row.status as (typeof OPEN)[number])) return row.balance !== row.amount;
    return true; // a status in neither set is a new state nobody has classified
  });
  expect(wrong).toEqual([]);
}

afterEach(async () => {
  await everyTransactionBalances();
  await everyEscrowMatchesItsTrade();
});

afterAll(async () => {
  await client?.$disconnect();
  client = null;
});
