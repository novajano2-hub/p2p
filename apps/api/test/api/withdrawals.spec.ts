import {
  type AdminWithdrawalItem,
  type AdminWithdrawalQueueResponse,
  type WithdrawalLimitsResponse,
  type WithdrawalView,
} from "@abay/contracts";
import { createPrismaClient, type PrismaClient } from "@abay/database";
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";

import { createApp } from "@/app";
import { loadEnv, type Env } from "@/config/env";
import { hashPassword } from "@/modules/auth/tokens";
import { MockChain } from "@/modules/blockchain/mock/mock-blockchain.gateway";
import { MockCustodyProvider } from "@/modules/custody/mock/mock-custody.provider";
import { accounts } from "@/modules/ledger/account-code";
import { LedgerService } from "@/modules/ledger/ledger.service";
import { WithdrawalService } from "@/modules/withdrawals/withdrawal.service";

import {
  csrfFor,
  enrolledTotp,
  PASSWORD,
  registerFully,
  totpCodeFor,
  uniqueEmail,
} from "./helpers";

/*
  Money going out, end to end: a customer asks and their funds move to a hold
  (JE-7); the policy either lets it through or asks a person; the worker
  builds, signs and broadcasts it (JE-8a); the chain confirms it and the debt
  is extinguished (JE-8b); and everything that can go wrong before broadcast
  gives the money back exactly once (JE-9).

  The test that matters most is AT-9: when the provider cannot say whether
  the coins left, nothing is retried, nothing is refunded, the customer's
  funds stay visibly held, and a person resolves it against the chain.

  Every correlation id and email here starts with "test-", which is how
  global-teardown.js knows which rows are its to clear.
*/

let app: NestFastifyApplication;
let db: PrismaClient;
let env: Env;
let chain: MockChain;
let custody: MockCustodyProvider;
let ledger: LedgerService;
let withdrawals: WithdrawalService;
const server = () => app.getHttpServer() as Parameters<typeof request>[0];

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let counter = 0;
const uniq = (label: string) => `test-${run}-${label}-${++counter}`;
const USDT = 1_000_000n;
const ADMIN_PASSWORD = "correct horse battery staple";
const OUTSIDE = (seed: string) => `0x${seed.repeat(40).slice(0, 40)}`;

beforeAll(async () => {
  env = loadEnv();
  app = await createApp(env);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  db = createPrismaClient(env.DATABASE_URL);
  chain = app.get(MockChain);
  custody = app.get(MockCustodyProvider);
  ledger = app.get(LedgerService);
  withdrawals = app.get(WithdrawalService);
});

afterAll(async () => {
  await db.$disconnect();
  await app.close();
});

/* AT-10: every transaction in the database balances, after every test here. */
afterEach(async () => {
  const rows = await db.$queryRaw<{ transaction_id: string }[]>`
    SELECT transaction_id FROM ledger_entries
     GROUP BY transaction_id, asset HAVING sum(signed_amount) <> 0 OR count(*) < 2`;
  expect(rows).toEqual([]);
});

/* ------------------------------------------------------------- helpers */

const available = (userId: string) => ledger.balance(accounts.userAvailable(userId));
const pending = (userId: string) => ledger.balance(accounts.userPendingWithdrawal(userId));
const treasury = () => ledger.balance(accounts.platform("TREASURY_HOT"));

/*
  The platform's own balances are shared with every other test in this file -
  the worker broadcasts whatever is approved, not only the row under test - so
  what is asserted about them is per-withdrawal: the legs it posted, which
  nothing else can disturb.
*/
async function legs(withdrawalId: string, reason: string): Promise<string[]> {
  const transaction = await db.ledgerTransaction.findFirst({
    where: { referenceType: "withdrawal", referenceId: withdrawalId, reason: reason as never },
    include: { entries: { include: { account: true } } },
  });
  if (!transaction) return [];
  return transaction.entries
    .map((entry) => `${entry.account.purpose} ${entry.direction} ${entry.amount.toString()}`)
    .sort();
}

/** A customer with funds, verified so the daily ceiling is the useful one. */
async function funded(usdt: bigint, options: { verified?: boolean } = {}) {
  const { cookie, userId } = await registerFully(server(), db, uniqueEmail());
  if (options.verified !== false) {
    await db.user.update({ where: { id: userId }, data: { kycStatus: "APPROVED" } });
  }
  await ledger.post({
    reason: "OPENING_BALANCE",
    asset: "USDT",
    reference: { type: "fixture", id: uniq("fund") },
    actor: { type: "SYSTEM" },
    correlationId: uniq("corr"),
    idempotencyKey: uniq("fund"),
    lines: [
      { account: accounts.platform("OPENING_BALANCE"), direction: "DEBIT", amount: usdt * USDT },
      { account: accounts.userAvailable(userId), direction: "CREDIT", amount: usdt * USDT },
    ],
  });
  return { cookie, userId };
}

/** The hot treasury, funded the way a sweep will fund it in stage 4. */
async function fundTreasury(usdt: bigint) {
  await ledger.post({
    reason: "OPENING_BALANCE",
    asset: "USDT",
    reference: { type: "fixture", id: uniq("treasury") },
    actor: { type: "SYSTEM" },
    correlationId: uniq("corr"),
    idempotencyKey: uniq("treasury"),
    lines: [
      { account: accounts.platform("TREASURY_HOT"), direction: "DEBIT", amount: usdt * USDT },
      { account: accounts.platform("OPENING_BALANCE"), direction: "CREDIT", amount: usdt * USDT },
    ],
  });
}

function ask(
  cookie: string,
  body: { amount: bigint; destination: string; password?: string; network?: string },
  key = uniq("key"),
) {
  return request(server())
    .post("/v1/wallet/withdrawals")
    .set("Cookie", cookie)
    .set("x-csrf-token", csrfFor(cookie))
    .set("Idempotency-Key", key)
    .set("x-request-id", uniq("req"))
    .send({
      network: body.network ?? "BSC",
      amount: (body.amount * USDT).toString(),
      destination: body.destination,
      password: body.password ?? PASSWORD,
    });
}

/** A destination this customer has used before, aged past the cooldown. */
async function knownDestination(userId: string, destination: string) {
  await db.withdrawal.create({
    data: {
      userId,
      network: "BSC",
      asset: "USDT",
      amount: 1n * USDT,
      destination,
      status: "CONFIRMED",
      clientKey: uniq("historic"),
      correlationId: uniq("corr"),
      requestedAt: new Date(Date.now() - 72 * 60 * 60 * 1000),
      settledAt: new Date(Date.now() - 72 * 60 * 60 * 1000),
    },
  });
}

async function makeAdmin(roles: string[] = ["WITHDRAWAL_APPROVER"]) {
  const email = `admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const totp = enrolledTotp();
  const admin = await db.adminUser.create({
    data: {
      email,
      name: "Test Approver",
      passwordHash: await hashPassword(ADMIN_PASSWORD),
      passwordChangedAt: new Date(),
      roles: roles as never,
      ...totp.fields,
    },
  });
  const login = await request(server())
    .post("/v1/admin/auth/login")
    .send({ email, password: ADMIN_PASSWORD, code: totpCodeFor(totp.secret) })
    .expect(200);
  const cookie = login.headers["set-cookie"]?.[0];
  if (!cookie) throw new Error("admin sign-in set no cookie");
  const me = await request(server()).get("/v1/admin/auth/me").set("Cookie", cookie).expect(200);
  const csrf = me.headers["x-csrf-token"];
  if (typeof csrf !== "string") throw new Error("no csrf token issued");
  return { id: admin.id, email, cookie, csrf };
}

const adminPost = (admin: { cookie: string; csrf: string }, path: string, body: object) =>
  request(server())
    .post(`/v1/admin/withdrawals${path}`)
    .set("Cookie", admin.cookie)
    .set("x-csrf-token", admin.csrf)
    .set("x-request-id", uniq("adm"))
    .send(body);

describe("asking to withdraw", () => {
  it("reports what the customer may send, against their tier and their balance", async () => {
    const { cookie, userId } = await funded(50n);
    const body = (
      await request(server()).get("/v1/wallet/withdrawals/limits").set("Cookie", cookie).expect(200)
    ).body as WithdrawalLimitsResponse;
    expect(body).toMatchObject({
      network: "BSC",
      asset: "USDT",
      available: (50n * USDT).toString(),
      // Verified: the tier's 2,000 a day, which is below the configured maximum.
      dailyMaximum: (2_000n * USDT).toString(),
      dailyRemaining: (2_000n * USDT).toString(),
      fee: "0",
    });
    expect(await pending(userId)).toBe(0n);
  });

  it("takes the amount out of available and holds it, and tells the customer where it is", async () => {
    const { cookie, userId } = await funded(50n);
    const response = await ask(cookie, { amount: 10n, destination: OUTSIDE("a") }).expect(201);
    const view = response.body as WithdrawalView;

    expect(view).toMatchObject({
      amount: (10n * USDT).toString(),
      fee: "0",
      destination: OUTSIDE("a"),
      // A brand-new destination: the policy wants a person, and the customer is told so.
      stage: "HELD",
      status: "RISK_REVIEW",
      txHash: null,
    });
    expect(view.message).toMatch(/checking this withdrawal/);
    expect(await available(userId)).toBe(40n * USDT);
    expect(await pending(userId)).toBe(10n * USDT);

    const row = await db.withdrawal.findUniqueOrThrow({ where: { id: view.id } });
    expect(row.holdTransactionId).not.toBeNull();
    expect(row.riskReasons).toContain("destination never used before");
    const actions = await db.auditEvent.findMany({
      where: { subjectType: "withdrawal", subjectId: view.id },
      select: { action: true },
    });
    expect(actions.map((a) => a.action).sort()).toEqual([
      "withdrawal.requested",
      "withdrawal.risk_evaluated",
    ]);
  });

  it("goes straight through for an ordinary amount to an address they have used before", async () => {
    const { cookie, userId } = await funded(50n);
    const destination = OUTSIDE("b");
    await knownDestination(userId, destination);

    const view = (await ask(cookie, { amount: 10n, destination }).expect(201))
      .body as WithdrawalView;
    expect(view).toMatchObject({ stage: "PENDING", status: "APPROVED", message: null });
    expect(
      await db.auditEvent.count({
        where: { subjectId: view.id, action: "withdrawal.approved.auto" },
      }),
    ).toBe(1);
  });

  it("refuses without the password, and writes nothing", async () => {
    const { cookie, userId } = await funded(50n);
    await ask(cookie, {
      amount: 5n,
      destination: OUTSIDE("c"),
      password: "not my password",
    }).expect(400);
    expect(await available(userId)).toBe(50n * USDT);
    expect(await db.withdrawal.count({ where: { userId } })).toBe(0);
  });

  it("pauses withdrawals for a day after a password change", async () => {
    const { cookie, userId } = await funded(50n);
    // An hour ago: after that the customer signed in again, which is why this
    // session is still good. The cooldown is what must stop them, not the guard.
    await db.authIdentity.updateMany({
      where: { userId, provider: "PASSWORD" },
      data: { passwordChangedAt: new Date(Date.now() - 60 * 60 * 1000) },
    });
    const refused = await ask(cookie, { amount: 5n, destination: OUTSIDE("d") }).expect(403);
    expect(JSON.stringify(refused.body)).toMatch(/password change/);
    expect(await db.withdrawal.count({ where: { userId } })).toBe(0);
  });

  it("refuses more than is available, more than the daily ceiling, and our own addresses", async () => {
    const { cookie, userId } = await funded(50n);
    await request(server()).get("/v1/wallet/deposit-address").set("Cookie", cookie).expect(200);
    const mine = await db.attributionAddress.findFirstOrThrow({ where: { userId } });

    const overdrawn = await ask(cookie, { amount: 60n, destination: OUTSIDE("e") }).expect(409);
    expect(JSON.stringify(overdrawn.body)).toMatch(/INSUFFICIENT_FUNDS/);

    const unverified = await funded(5_000n, { verified: false });
    const overLimit = await ask(unverified.cookie, {
      amount: 500n,
      destination: OUTSIDE("f"),
    }).expect(400);
    expect(JSON.stringify(overLimit.body)).toMatch(/daily limit/);

    const ourOwn = await ask(cookie, { amount: 5n, destination: mine.address }).expect(400);
    expect(JSON.stringify(ourOwn.body)).toMatch(/deposit address/);

    expect(await available(userId)).toBe(50n * USDT);
    expect(await db.withdrawal.count({ where: { userId } })).toBe(0);
  });

  it("does the work once when the same request is retried under one key", async () => {
    const { cookie, userId } = await funded(50n);
    const key = uniq("key");
    const first = (await ask(cookie, { amount: 10n, destination: OUTSIDE("9") }, key).expect(201))
      .body as WithdrawalView;
    const again = (await ask(cookie, { amount: 10n, destination: OUTSIDE("9") }, key).expect(201))
      .body as WithdrawalView;

    expect(again.id).toBe(first.id);
    expect(await db.withdrawal.count({ where: { userId } })).toBe(1);
    expect(await available(userId)).toBe(40n * USDT);
    // A different body under a spent key is a conflict, not a silent overwrite.
    await ask(cookie, { amount: 11n, destination: OUTSIDE("9") }, key).expect(409);
    expect(await db.withdrawal.count({ where: { userId } })).toBe(1);
  });

  it("refuses a request with no Idempotency-Key at all", async () => {
    const { cookie } = await funded(50n);
    await request(server())
      .post("/v1/wallet/withdrawals")
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfFor(cookie))
      .send({
        network: "BSC",
        amount: (5n * USDT).toString(),
        destination: OUTSIDE("7"),
        password: PASSWORD,
      })
      .expect(400);
  });

  it("gives the money back when the customer calls it off", async () => {
    const { cookie, userId } = await funded(50n);
    const view = (await ask(cookie, { amount: 10n, destination: OUTSIDE("1") }).expect(201))
      .body as WithdrawalView;
    expect(await pending(userId)).toBe(10n * USDT);

    const cancelled = await request(server())
      .post(`/v1/wallet/withdrawals/${view.id}/cancel`)
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfFor(cookie))
      .set("x-request-id", uniq("req"))
      .expect(200);
    expect(cancelled.body as WithdrawalView).toMatchObject({
      stage: "RETURNED",
      status: "CANCELLED",
    });
    expect(await available(userId)).toBe(50n * USDT);
    expect(await pending(userId)).toBe(0n);
    // Terminal: a second cancel is refused, and the money does not come back twice.
    await request(server())
      .post(`/v1/wallet/withdrawals/${view.id}/cancel`)
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfFor(cookie))
      .expect(409);
    expect(await available(userId)).toBe(50n * USDT);
  });
});

describe("authorising", () => {
  it("needs one administrator above the auto threshold, and refuses everyone without the role", async () => {
    const approver = await makeAdmin();
    const outsider = await makeAdmin(["KYC_REVIEWER"]);
    const { cookie, userId } = await funded(2_000n);
    const destination = OUTSIDE("2");
    await knownDestination(userId, destination);

    // 600 USDT: over the 500 auto-approval threshold, under the 1,500 dual one.
    const view = (await ask(cookie, { amount: 600n, destination }).expect(201))
      .body as WithdrawalView;
    expect(view.status).toBe("RISK_REVIEW");
    const row = await db.withdrawal.findUniqueOrThrow({ where: { id: view.id } });
    expect(row.approvalsRequired).toBe(1);

    await request(server())
      .get("/v1/admin/withdrawals/queue")
      .set("Cookie", outsider.cookie)
      .expect(403);
    const queue = (
      await request(server())
        .get("/v1/admin/withdrawals/queue")
        .set("Cookie", approver.cookie)
        .expect(200)
    ).body as AdminWithdrawalQueueResponse;
    expect(queue.review.map((w) => w.id)).toContain(view.id);

    const approved = (
      await adminPost(approver, `/${view.id}/approve`, { reason: "known customer" }).expect(200)
    ).body as AdminWithdrawalItem;
    expect(approved).toMatchObject({ status: "APPROVED", stage: "PENDING" });
    expect(approved.approvals).toHaveLength(1);
    expect(
      await db.auditEvent.count({
        where: { subjectId: view.id, action: "withdrawal.approved.manual" },
      }),
    ).toBe(1);
  });

  it("needs two different administrators above the dual threshold", async () => {
    const first = await makeAdmin();
    const second = await makeAdmin();
    const { cookie, userId } = await funded(2_000n);
    const destination = OUTSIDE("3");
    await knownDestination(userId, destination);

    const view = (await ask(cookie, { amount: 1_600n, destination }).expect(201))
      .body as WithdrawalView;
    expect(
      (await db.withdrawal.findUniqueOrThrow({ where: { id: view.id } })).approvalsRequired,
    ).toBe(2);

    const once = (await adminPost(first, `/${view.id}/approve`, { reason: "checked" }).expect(200))
      .body as AdminWithdrawalItem;
    expect(once.status).toBe("RISK_REVIEW");
    expect(once.approvals).toHaveLength(1);

    // The same administrator cannot be both of the two.
    await adminPost(first, `/${view.id}/approve`, { reason: "again" }).expect(409);
    expect((await db.withdrawal.findUniqueOrThrow({ where: { id: view.id } })).status).toBe(
      "RISK_REVIEW",
    );

    const twice = (
      await adminPost(second, `/${view.id}/approve`, { reason: "seconded" }).expect(200)
    ).body as AdminWithdrawalItem;
    expect(twice.status).toBe("APPROVED");
    expect(twice.approvals.map((a) => a.adminId).sort()).toEqual([first.id, second.id].sort());
  });

  it("gives the money back when an administrator refuses it", async () => {
    const approver = await makeAdmin();
    const { cookie, userId } = await funded(50n);
    const view = (await ask(cookie, { amount: 10n, destination: OUTSIDE("4") }).expect(201))
      .body as WithdrawalView;

    await adminPost(approver, `/${view.id}/reject`, {}).expect(400);
    const rejected = (
      await adminPost(approver, `/${view.id}/reject`, { reason: "address on a watchlist" }).expect(
        200,
      )
    ).body as AdminWithdrawalItem;
    expect(rejected).toMatchObject({ status: "REJECTED", stage: "RETURNED" });
    expect(rejected.message).toBe("address on a watchlist");
    expect(await available(userId)).toBe(50n * USDT);
    expect(await pending(userId)).toBe(0n);
    // Terminal, and the release cannot happen twice.
    await adminPost(approver, `/${view.id}/reject`, { reason: "again" }).expect(409);
    expect(await available(userId)).toBe(50n * USDT);
  });
});

describe("sending, and settling", () => {
  it("builds, broadcasts and confirms, moving the money the way the taxonomy says", async () => {
    await fundTreasury(1_000n);
    const { cookie, userId } = await funded(100n);
    const destination = OUTSIDE("5");
    await knownDestination(userId, destination);
    const view = (await ask(cookie, { amount: 40n, destination }).expect(201))
      .body as WithdrawalView;
    expect(view.status).toBe("APPROVED");

    const sent = await withdrawals.processApproved();
    expect(sent.broadcast).toBeGreaterThanOrEqual(1);
    const broadcast = await db.withdrawal.findUniqueOrThrow({ where: { id: view.id } });
    expect(broadcast.status).toBe("BROADCAST");
    expect(broadcast.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    // JE-8a: the coins left the hot treasury and are in transit. The customer's
    // liability is untouched - we still owe them until it confirms.
    expect(await legs(view.id, "WITHDRAWAL_BROADCAST")).toEqual([
      "IN_TRANSIT DEBIT 40000000",
      "TREASURY_HOT CREDIT 40000000",
    ]);
    expect(await pending(userId)).toBe(40n * USDT);

    // Not yet final: nothing settles.
    await withdrawals.confirmBroadcast();
    expect((await db.withdrawal.findUniqueOrThrow({ where: { id: view.id } })).status).toBe(
      "BROADCAST",
    );
    await chain.advance(15);
    await withdrawals.confirmBroadcast();

    // JE-8b: the debt is extinguished; both sides of the balance sheet shrink.
    const confirmed = await db.withdrawal.findUniqueOrThrow({ where: { id: view.id } });
    expect(confirmed.status).toBe("CONFIRMED");
    expect(await pending(userId)).toBe(0n);
    expect(await available(userId)).toBe(60n * USDT);
    expect(await legs(view.id, "WITHDRAWAL_CONFIRMED")).toEqual([
      "IN_TRANSIT CREDIT 40000000",
      "PENDING_WITHDRAWAL DEBIT 40000000",
    ]);

    const told = await db.notification.findFirst({ where: { userId, type: "WITHDRAWAL_SENT" } });
    expect(told?.body).toContain("40.000000 USDT");
    const asked = await request(server())
      .get(`/v1/wallet/withdrawals/${view.id}`)
      .set("Cookie", cookie)
      .expect(200);
    expect(asked.body as WithdrawalView).toMatchObject({ stage: "SENT", status: "CONFIRMED" });
  });

  it("gives the money back when the provider refuses to sign", async () => {
    await fundTreasury(200n);
    const { cookie, userId } = await funded(100n);
    const destination = OUTSIDE("6");
    await knownDestination(userId, destination);

    const refused = (await ask(cookie, { amount: 10n, destination }).expect(201))
      .body as WithdrawalView;
    await custody.direct(refused.id, "REFUSED");
    await withdrawals.processApproved();

    const row = await db.withdrawal.findUniqueOrThrow({ where: { id: refused.id } });
    expect(row.status).toBe("SIGN_REFUSED");
    expect(await available(userId)).toBe(100n * USDT);
    expect(await pending(userId)).toBe(0n);
  });

  it("gives the money back, without asking the provider, when the treasury is short", async () => {
    const drain = await treasury();
    if (drain > 0n) {
      await ledger.post({
        reason: "SWEEP_BROADCAST",
        asset: "USDT",
        reference: { type: "fixture", id: uniq("drain") },
        actor: { type: "SYSTEM" },
        correlationId: uniq("corr"),
        idempotencyKey: uniq("drain"),
        lines: [
          { account: accounts.platform("TREASURY_COLD"), direction: "DEBIT", amount: drain },
          { account: accounts.platform("TREASURY_HOT"), direction: "CREDIT", amount: drain },
        ],
      });
    }
    const { cookie, userId } = await funded(100n);
    const destination = OUTSIDE("8");
    await knownDestination(userId, destination);

    const view = (await ask(cookie, { amount: 90n, destination }).expect(201))
      .body as WithdrawalView;
    await withdrawals.processApproved();

    const row = await db.withdrawal.findUniqueOrThrow({ where: { id: view.id } });
    expect(row.status).toBe("BUILD_FAILED");
    expect(row.failureReason).toMatch(/hot treasury/);
    expect(await available(userId)).toBe(100n * USDT);
    expect(await pending(userId)).toBe(0n);
    // Nothing was ever asked of the provider, so nothing is on the chain.
    expect(await db.mockChainTransfer.count({ where: { tag: `custody:${view.id}` } })).toBe(0);
  });
});

/*
  AT-9. The provider is told to answer "unknown", which is the one answer
  that means we do not know whether the customer's money left. Everything
  below is what must happen next, and just as importantly what must not.
*/
describe("AT-9: an ambiguous broadcast", () => {
  async function ambiguous(outcome: "UNKNOWN_BROADCAST" | "UNKNOWN_DROPPED", seed: string) {
    await fundTreasury(500n);
    const { cookie, userId } = await funded(100n);
    const destination = OUTSIDE(seed);
    await knownDestination(userId, destination);
    const view = (await ask(cookie, { amount: 30n, destination }).expect(201))
      .body as WithdrawalView;
    await custody.direct(view.id, outcome);

    const result = await withdrawals.processApproved();
    expect(result.unknown).toBeGreaterThanOrEqual(1);
    return { cookie, userId, id: view.id };
  }

  it("stops at a person, holds the funds, and never sends or refunds on its own", async () => {
    const { cookie, userId, id } = await ambiguous("UNKNOWN_BROADCAST", "a1");

    // It went through BROADCAST_UNKNOWN and stopped at a person.
    const actions = await db.auditEvent.findMany({
      where: { subjectType: "withdrawal", subjectId: id },
      select: { action: true },
      orderBy: { createdAt: "asc" },
    });
    expect(actions.map((a) => a.action)).toContain("withdrawal.broadcast_unknown");
    expect(actions.map((a) => a.action)).toContain("withdrawal.investigation_opened");
    expect((await db.withdrawal.findUniqueOrThrow({ where: { id } })).status).toBe(
      "MANUAL_INVESTIGATION",
    );

    /*
      The heart of it. Ten more passes, as a restarted or duplicated worker
      would make: the provider is never asked again, so exactly one transfer
      exists on the chain for this withdrawal - not two.
    */
    for (let pass = 0; pass < 10; pass++) {
      await withdrawals.processApproved();
      await withdrawals.confirmBroadcast();
    }
    expect(await db.mockChainTransfer.count({ where: { tag: `custody:${id}` } })).toBe(1);
    expect((await db.withdrawal.findUniqueOrThrow({ where: { id } })).status).toBe(
      "MANUAL_INVESTIGATION",
    );

    // No refund, and no broadcast entry either: we do not know, so we post nothing.
    expect(await pending(userId)).toBe(30n * USDT);
    expect(await available(userId)).toBe(70n * USDT);
    expect(
      await db.ledgerTransaction.count({
        where: { referenceType: "withdrawal", referenceId: id, reason: "WITHDRAWAL_HOLD_RELEASED" },
      }),
    ).toBe(0);
    expect(
      await db.ledgerTransaction.count({
        where: { referenceType: "withdrawal", referenceId: id, reason: "WITHDRAWAL_BROADCAST" },
      }),
    ).toBe(0);

    // And the customer sees it as still going, with their money visibly held.
    const seen = (
      await request(server()).get(`/v1/wallet/withdrawals/${id}`).set("Cookie", cookie).expect(200)
    ).body as WithdrawalView;
    expect(seen.stage).toBe("SENDING");
    expect(seen.message).toMatch(/held safely/);
  });

  it("resolves forward when a person finds the transaction on the chain", async () => {
    const approver = await makeAdmin();
    const { userId, id } = await ambiguous("UNKNOWN_BROADCAST", "a2");

    // A hash that is not on the chain is refused: this is checked, not believed.
    await adminPost(approver, `/${id}/investigation`, {
      outcome: "BROADCAST",
      txHash: `0x${"f".repeat(64)}`,
      reason: "guessing",
    }).expect(409);
    await adminPost(approver, `/${id}/investigation`, {
      outcome: "BROADCAST",
      reason: "no hash given",
    }).expect(400);

    const onChain = await db.mockChainTransfer.findFirstOrThrow({
      where: { tag: `custody:${id}` },
    });
    const resolved = (
      await adminPost(approver, `/${id}/investigation`, {
        outcome: "BROADCAST",
        txHash: onChain.txHash,
        reason: "found on the chain at the expected address and amount",
      }).expect(200)
    ).body as AdminWithdrawalItem;

    // JE-8a, posted now rather than then. The customer still owes nothing back.
    expect(resolved).toMatchObject({ status: "BROADCAST", stage: "SENDING" });
    expect(await legs(id, "WITHDRAWAL_BROADCAST")).toEqual([
      "IN_TRANSIT DEBIT 30000000",
      "TREASURY_HOT CREDIT 30000000",
    ]);
    expect(await pending(userId)).toBe(30n * USDT);

    // From there it settles like any other.
    await chain.advance(15);
    await withdrawals.confirmBroadcast();
    expect((await db.withdrawal.findUniqueOrThrow({ where: { id } })).status).toBe("CONFIRMED");
    expect(await pending(userId)).toBe(0n);
    expect(await legs(id, "WITHDRAWAL_CONFIRMED")).toEqual([
      "IN_TRANSIT CREDIT 30000000",
      "PENDING_WITHDRAWAL DEBIT 30000000",
    ]);
  });

  it("gives the money back only when two administrators attest nothing was sent", async () => {
    const first = await makeAdmin();
    const second = await makeAdmin();
    const { userId, id } = await ambiguous("UNKNOWN_DROPPED", "a3");
    // Nothing reached the chain in this one.
    expect(await db.mockChainTransfer.count({ where: { tag: `custody:${id}` } })).toBe(0);

    const once = (
      await adminPost(first, `/${id}/investigation`, {
        outcome: "FAILED",
        reason: "no transaction from our address at that nonce, checked twice",
      }).expect(200)
    ).body as AdminWithdrawalItem;
    // One is not enough: the money stays held.
    expect(once.status).toBe("MANUAL_INVESTIGATION");
    expect(await pending(userId)).toBe(30n * USDT);
    await adminPost(first, `/${id}/investigation`, { outcome: "FAILED", reason: "again" }).expect(
      409,
    );

    const done = (
      await adminPost(second, `/${id}/investigation`, {
        outcome: "FAILED",
        reason: "confirmed absent after the reorg window",
      }).expect(200)
    ).body as AdminWithdrawalItem;
    expect(done).toMatchObject({ status: "FAILED_CONFIRMED", stage: "RETURNED" });
    expect(await pending(userId)).toBe(0n);
    expect(await available(userId)).toBe(100n * USDT);
    expect(
      await db.ledgerTransaction.count({
        where: { referenceType: "withdrawal", referenceId: id, reason: "WITHDRAWAL_HOLD_RELEASED" },
      }),
    ).toBe(1);
  });
});
