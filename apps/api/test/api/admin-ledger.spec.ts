import {
  type LedgerAccountDetail,
  type LedgerAccountsResponse,
  type LedgerOverview,
  type LedgerTransactionDetail,
  type LedgerTransactionsResponse,
} from "@abay/contracts";
import { createPrismaClient, type PrismaClient } from "@abay/database";
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";

import { createApp } from "@/app";
import { loadEnv } from "@/config/env";
import { hashPassword } from "@/modules/auth/tokens";
import { accounts } from "@/modules/ledger/account-code";
import { LedgerService } from "@/modules/ledger/ledger.service";
import { type PostingLine, type PostingRequest } from "@/modules/ledger/posting";

import { enrolledTotp, totpCodeFor } from "./helpers";

/*
  The ledger viewer, over HTTP, against the real database.

  What is being tested: that reading the ledger is a capability of its own
  and nothing else buys it; that the figures an operator sees are the
  ledger's own (natural-sense balances, a statement whose running balance is
  the balance that was actually there); that opening somebody's account or a
  transaction that touched it leaves a record of who looked; and that money
  never crosses the wire as a number (AT-21).

  Every owner id and correlation id starts with "test-", which is how
  global-teardown.js knows which immutable rows are its to clear.
*/

let app: NestFastifyApplication;
let db: PrismaClient;
let ledger: LedgerService;
const server = () => app.getHttpServer() as Parameters<typeof request>[0];

const ADMIN_PASSWORD = "correct horse battery staple";
const USDT = 1_000_000n;
const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let counter = 0;
const uniq = (label: string) => `test-${run}-${label}-${++counter}`;

async function makeAdmin(roles: string[]): Promise<{ id: string; email: string; secret: string }> {
  const email = `admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const totp = enrolledTotp();
  const admin = await db.adminUser.create({
    data: {
      email,
      name: "Test Administrator",
      passwordHash: await hashPassword(ADMIN_PASSWORD),
      passwordChangedAt: new Date(),
      roles: roles as never,
      ...totp.fields,
    },
  });
  return { id: admin.id, email: admin.email, secret: totp.secret };
}

async function signIn(email: string, secret: string): Promise<string> {
  const response = await request(server())
    .post("/v1/admin/auth/login")
    .send({ email, password: ADMIN_PASSWORD, code: totpCodeFor(secret) })
    .expect(200);
  const cookie = response.headers["set-cookie"]?.[0];
  if (!cookie) throw new Error("admin sign-in set no cookie");
  return cookie;
}

/*
  One customer's short history, posted through the real service: funded with
  10, locks 4 into a trade, the trade expires and refunds it, then holds 2 for
  a withdrawal. Available ends on 8, pending on 2, the escrow on 0.
*/
interface Fixture {
  user: string;
  trade: string;
  opening: string;
  lock: string;
  refund: string;
  hold: string;
  holdCorrelation: string;
}

async function seedHistory(): Promise<Fixture> {
  const user = uniq("user");
  const trade = uniq("trade");
  const available = accounts.userAvailable(user);
  const escrow = accounts.tradeEscrow(trade);
  const post = (
    reason: PostingRequest["reason"],
    reference: PostingRequest["reference"],
    lines: PostingLine[],
    extra: Partial<PostingRequest> = {},
  ) =>
    ledger.post({
      reason,
      asset: "USDT",
      reference,
      actor: { type: "SYSTEM" },
      correlationId: uniq("corr"),
      idempotencyKey: uniq("key"),
      lines,
      ...extra,
    });

  const opening = await post("OPENING_BALANCE", { type: "fixture", id: uniq("fx") }, [
    { account: accounts.platform("OPENING_BALANCE"), direction: "DEBIT", amount: 10n * USDT },
    { account: available, direction: "CREDIT", amount: 10n * USDT },
  ]);
  const lock = await post("ESCROW_LOCKED", { type: "trade", id: trade }, [
    { account: available, direction: "DEBIT", amount: 4n * USDT },
    { account: escrow, direction: "CREDIT", amount: 4n * USDT },
  ]);
  const refund = await post(
    "ESCROW_REFUNDED_EXPIRY",
    { type: "trade", id: trade },
    [
      { account: escrow, direction: "DEBIT", amount: 4n * USDT },
      { account: available, direction: "CREDIT", amount: 4n * USDT },
    ],
    { reversesTransactionId: lock.id },
  );
  const holdCorrelation = uniq("corr");
  const hold = await post(
    "WITHDRAWAL_HELD",
    { type: "withdrawal", id: uniq("wd") },
    [
      { account: available, direction: "DEBIT", amount: 2n * USDT },
      { account: accounts.userPendingWithdrawal(user), direction: "CREDIT", amount: 2n * USDT },
      { account: accounts.platform("WITHDRAWAL_FEES"), direction: "CREDIT", amount: 0n },
    ],
    { correlationId: holdCorrelation },
  );
  return {
    user,
    trade,
    opening: opening.id,
    lock: lock.id,
    refund: refund.id,
    hold: hold.id,
    holdCorrelation,
  };
}

/*
  AT-21, applied to every response in this file: any field that carries
  money is a string. Walks the whole body so a new field cannot slip in as
  a number unnoticed.
*/
const MONEY_KEYS = new Set([
  "amount",
  "signedAmount",
  "balance",
  "balanceAfter",
  "available",
  "pendingWithdrawal",
  "escrowed",
  "debitSide",
  "creditSide",
]);
function expectMoneyAsText(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      expectMoneyAsText(item, `${path}[${index}]`);
    });
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) {
      if (MONEY_KEYS.has(key)) expect([path, key, typeof inner]).toEqual([path, key, "string"]);
      expectMoneyAsText(inner, `${path}.${key}`);
    }
  }
}

let viewer: { id: string; cookie: string };
let fixture: Fixture;

const get = (path: string, cookie = viewer.cookie) =>
  request(server()).get(`/v1/admin/ledger${path}`).set("Cookie", cookie);

beforeAll(async () => {
  const env = loadEnv();
  app = await createApp(env);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  db = createPrismaClient(env.DATABASE_URL);
  ledger = app.get(LedgerService);

  const admin = await makeAdmin(["LEDGER_VIEWER"]);
  viewer = { id: admin.id, cookie: await signIn(admin.email, admin.secret) };
  fixture = await seedHistory();
});

afterAll(async () => {
  await db.$disconnect();
  await app.close();
});

describe("who may read", () => {
  it("refuses everyone without LEDGER_VIEWER, including other administrators", async () => {
    await get("/overview", "").expect(401);

    const reviewer = await makeAdmin(["KYC_REVIEWER", "FINANCIAL_ADJUSTER"]);
    const cookie = await signIn(reviewer.email, reviewer.secret);
    for (const path of ["/overview", "/accounts", "/transactions"]) {
      const response = await get(path, cookie).expect(403);
      // Refused without being told which role would have got them in.
      expect(JSON.stringify(response.body)).not.toContain("LEDGER_VIEWER");
    }
  });
});

describe("overview", () => {
  it("reports a consistent ledger in aggregates, with every amount as text", async () => {
    const body = (await get("/overview").expect(200)).body as LedgerOverview;

    expect(body.health).toEqual({
      balanced: true,
      unbalancedTransactions: 0,
      projectionDrift: 0,
      floorBreaches: 0,
    });
    expect(body.equation.holds).toBe(true);
    expect(body.equation.debitSide).toBe(body.equation.creditSide);
    expect(body.trialBalance.map((row) => row.type)).toEqual([
      "ASSET",
      "LIABILITY",
      "EQUITY",
      "REVENUE",
      "EXPENSE",
    ]);
    expect(body.platform).toHaveLength(11);
    expect(body.platform.every((account) => account.scope === "PLATFORM")).toBe(true);
    expect(body.customers.count).toBeGreaterThanOrEqual(1);
    expect(body.totals.transactions).toBeGreaterThanOrEqual(4);
    expect(body.totals.lastPostedAt).not.toBeNull();

    expectMoneyAsText(body);
    // Aggregates name nobody.
    expect(JSON.stringify(body)).not.toContain(fixture.user);
  });
});

describe("accounts", () => {
  it("lists a customer's accounts with natural-sense balances, and pages by code", async () => {
    const mine = (await get(`/accounts?ownerId=${fixture.user}`).expect(200))
      .body as LedgerAccountsResponse;
    expect(mine.accounts.map((a) => [a.purpose, a.balance])).toEqual([
      ["AVAILABLE", (8n * USDT).toString()],
      ["PENDING_WITHDRAWAL", (2n * USDT).toString()],
    ]);
    expect(mine.nextCursor).toBeNull();
    expectMoneyAsText(mine);

    const escrow = (await get(`/accounts?scope=TRADE&q=${fixture.trade}`).expect(200))
      .body as LedgerAccountsResponse;
    expect(escrow.accounts).toHaveLength(1);
    expect(escrow.accounts[0]).toMatchObject({ purpose: "ESCROW", balance: "0", entryCount: 2 });

    const first = (await get(`/accounts?ownerId=${fixture.user}&limit=1`).expect(200))
      .body as LedgerAccountsResponse;
    expect(first.accounts).toHaveLength(1);
    expect(first.nextCursor).toBe(first.accounts[0]?.code);
    const second = (
      await get(`/accounts?ownerId=${fixture.user}&limit=1&cursor=${first.nextCursor}`).expect(200)
    ).body as LedgerAccountsResponse;
    expect(second.accounts.map((a) => a.purpose)).toEqual(["PENDING_WITHDRAWAL"]);
    expect(second.nextCursor).toBeNull();

    await get("/accounts?scope=SOMETHING").expect(400);
    await get("/accounts?limit=0").expect(400);
  });

  it("shows a statement whose running balance is the balance that was there, and records the view", async () => {
    const list = (await get(`/accounts?ownerId=${fixture.user}&type=LIABILITY`).expect(200))
      .body as LedgerAccountsResponse;
    const available = list.accounts.find((a) => a.purpose === "AVAILABLE");
    if (!available) throw new Error("fixture has no available account");

    const detail = (await get(`/accounts/${available.id}`).expect(200)).body as LedgerAccountDetail;
    expect(detail.account.balance).toBe((8n * USDT).toString());
    // Newest first, and each line carries the balance it left behind.
    expect(detail.statement.map((row) => [row.reason, row.direction, row.balanceAfter])).toEqual([
      ["WITHDRAWAL_HELD", "DEBIT", (8n * USDT).toString()],
      ["ESCROW_REFUNDED_EXPIRY", "CREDIT", (10n * USDT).toString()],
      ["ESCROW_LOCKED", "DEBIT", (6n * USDT).toString()],
      ["OPENING_BALANCE", "CREDIT", (10n * USDT).toString()],
    ]);
    expect(detail.statement.map((row) => row.transactionId)).toEqual([
      fixture.hold,
      fixture.refund,
      fixture.lock,
      fixture.opening,
    ]);
    expectMoneyAsText(detail);

    // The next page continues exactly where the first stopped.
    const page = (await get(`/accounts/${available.id}/statement?limit=2`).expect(200)).body as {
      statement: LedgerAccountDetail["statement"];
      nextCursor: string | null;
    };
    expect(page.statement).toHaveLength(2);
    expect(page.nextCursor).toBe(page.statement[1]?.entryId);
    const rest = (
      await get(`/accounts/${available.id}/statement?limit=2&before=${page.nextCursor}`).expect(200)
    ).body as typeof page;
    expect(rest.statement.map((row) => row.transactionId)).toEqual([fixture.lock, fixture.opening]);
    expect(rest.nextCursor).toBeNull();

    const viewed = await db.auditEvent.findFirst({
      where: { action: "ledger.account_viewed", subjectId: available.id, actorAdminId: viewer.id },
    });
    expect(viewed).toMatchObject({ subjectType: "ledger_account" });
  });

  it("does not record a look at the platform's own accounts", async () => {
    const platform = (await get("/accounts?scope=PLATFORM&q=OPENING_BALANCE").expect(200))
      .body as LedgerAccountsResponse;
    const equity = platform.accounts[0];
    if (!equity) throw new Error("chart of accounts is missing OPENING_BALANCE");
    await get(`/accounts/${equity.id}`).expect(200);
    expect(await db.auditEvent.count({ where: { subjectId: equity.id } })).toBe(0);
  });
});

describe("transactions", () => {
  it("filters by reason, reference, correlation id and account, newest first", async () => {
    const locks = (
      await get(`/transactions?reason=ESCROW_LOCKED&referenceId=${fixture.trade}`).expect(200)
    ).body as LedgerTransactionsResponse;
    expect(locks.transactions.map((t) => t.id)).toEqual([fixture.lock]);

    const byCorrelation = (
      await get(`/transactions?correlationId=${fixture.holdCorrelation}`).expect(200)
    ).body as LedgerTransactionsResponse;
    expect(byCorrelation.transactions.map((t) => t.id)).toEqual([fixture.hold]);
    expectMoneyAsText(byCorrelation);

    const escrowId = locks.transactions[0]?.entries.find((e) =>
      e.accountCode.includes(":TRADE:"),
    )?.accountId;
    const forEscrow = (await get(`/transactions?accountId=${escrowId}`).expect(200))
      .body as LedgerTransactionsResponse;
    expect(forEscrow.transactions.map((t) => t.id)).toEqual([fixture.refund, fixture.lock]);

    const one = (await get(`/transactions?accountId=${escrowId}&limit=1`).expect(200))
      .body as LedgerTransactionsResponse;
    expect(one.transactions.map((t) => t.id)).toEqual([fixture.refund]);
    expect(one.nextCursor).toBe(fixture.refund);
    const next = (
      await get(`/transactions?accountId=${escrowId}&limit=1&cursor=${one.nextCursor}`).expect(200)
    ).body as LedgerTransactionsResponse;
    expect(next.transactions.map((t) => t.id)).toEqual([fixture.lock]);
  });

  it("shows a transaction with its entries and reversal links, and records the view", async () => {
    const refund = (await get(`/transactions/${fixture.refund}`).expect(200))
      .body as LedgerTransactionDetail;
    expect(refund.reverses).toMatchObject({ id: fixture.lock, reason: "ESCROW_LOCKED" });
    expect(refund.reversedBy).toEqual([]);
    expect(refund.entries.map((e) => [e.direction, e.amount, e.signedAmount])).toEqual([
      ["DEBIT", (4n * USDT).toString(), (4n * USDT).toString()],
      ["CREDIT", (4n * USDT).toString(), (-4n * USDT).toString()],
    ]);
    expect(refund.entries.map((e) => e.accountCode)).toEqual(
      expect.arrayContaining([accounts.tradeEscrow(fixture.trade)]),
    );
    expectMoneyAsText(refund);

    const lock = (await get(`/transactions/${fixture.lock}`).expect(200))
      .body as LedgerTransactionDetail;
    expect(lock.reverses).toBeNull();
    expect(lock.reversedBy.map((t) => t.id)).toEqual([fixture.refund]);

    const viewed = await db.auditEvent.findMany({
      where: { action: "ledger.transaction_viewed", actorAdminId: viewer.id },
      select: { subjectId: true },
    });
    expect(viewed.map((v) => v.subjectId)).toEqual(
      expect.arrayContaining([fixture.refund, fixture.lock]),
    );
  });

  it("answers not-found for an unknown id and refuses a malformed one", async () => {
    await get("/transactions/01a00000-0000-7000-8000-000000000000").expect(404);
    await get("/accounts/01a00000-0000-7000-8000-000000000000").expect(404);
    await get("/transactions/not-a-uuid").expect(400);
  });
});
