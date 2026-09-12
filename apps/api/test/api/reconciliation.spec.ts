import {
  type ReconciliationBreaksResponse,
  type ReconciliationBreakView,
  type ReconciliationPosition,
  type ReconciliationReport,
  type SweepsResponse,
} from "@abay/contracts";
import { createPrismaClient, type PrismaClient } from "@abay/database";
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";

import { createApp } from "@/app";
import { loadEnv, type Env } from "@/config/env";
import { hashPassword } from "@/modules/auth/tokens";
import { MockChain } from "@/modules/blockchain/mock/mock-blockchain.gateway";
import { signWebhook } from "@/modules/custody/webhooks/webhook-signature";
import { MockCustodyProvider } from "@/modules/custody/mock/mock-custody.provider";
import { DepositService } from "@/modules/deposits/deposit.service";
import { accounts } from "@/modules/ledger/account-code";
import { LedgerService } from "@/modules/ledger/ledger.service";
import { ReconcilerService } from "@/modules/reconciliation/reconciler.service";
import { SweepService } from "@/modules/sweeps/sweep.service";

import { enrolledTotp, registerFully, totpCodeFor, uniqueEmail } from "./helpers";

/*
  Treasury housekeeping: sweeping deposits into the pool, and holding the
  chain up against the ledger.

  AT-12 is the test that matters here. The reconciler must notice a
  difference in either direction, say which way it runs and by how much,
  raise it for a person - and post nothing itself, ever. Only the adjustment
  workflow, run by a person with a reason, turns a break into an entry.

  These tests run against a database other spec files have also used, so
  every assertion about a position is relative to what the same pass
  reported a moment earlier, not to an absolute total.
*/

let app: NestFastifyApplication;
let db: PrismaClient;
let env: Env;
let chain: MockChain;
let custody: MockCustodyProvider;
let ledger: LedgerService;
let sweeps: SweepService;
let reconciler: ReconcilerService;
let deposits: DepositService;
const server = () => app.getHttpServer() as Parameters<typeof request>[0];

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let counter = 0;
const uniq = (label: string) => `test-${run}-${label}-${++counter}`;
const USDT = 1_000_000n;
const USDT18 = 10n ** 18n;
const ADMIN_PASSWORD = "correct horse battery staple";
const HOT = accounts.platform("TREASURY_HOT");
const DEPOSIT_ADDRESSES = accounts.platform("DEPOSIT_ADDRESSES");

beforeAll(async () => {
  env = loadEnv();
  app = await createApp(env);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  db = createPrismaClient(env.DATABASE_URL);
  chain = app.get(MockChain);
  custody = app.get(MockCustodyProvider);
  ledger = app.get(LedgerService);
  sweeps = app.get(SweepService);
  reconciler = app.get(ReconcilerService);
  deposits = app.get(DepositService);
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

/** A customer whose deposit has been credited, so there is something to sweep. */
async function deposited(usdt: bigint) {
  const { cookie, userId } = await registerFully(server(), db, uniqueEmail());
  const addressResponse = await request(server())
    .get("/v1/wallet/deposit-address")
    .set("Cookie", cookie)
    .expect(200);
  const address = (addressResponse.body as { address: string }).address;

  const minted = await chain.mint({ to: address, rawAmount: usdt * USDT18, tag: uniq("mint") });
  const raw = JSON.stringify({
    event: "transfer.incoming",
    network: "BSC",
    txHash: minted.txHash,
    logIndex: 0,
  });
  await request(server())
    .post("/v1/webhooks/custody")
    .set("content-type", "application/json")
    .set("x-custody-signature", signWebhook(env.CUSTODY_WEBHOOK_SECRET, raw))
    .set("x-request-id", uniq("wh"))
    .send(raw)
    .expect(200);
  await chain.advance(15);
  await deposits.confirmDue();
  return { userId, address, txHash: minted.txHash };
}

/** The position for one account, as a fresh pass sees it right now. */
async function positionFor(accountCode: string): Promise<ReconciliationPosition> {
  const report = await reconciler.reconcile(uniq("rec"));
  const position = report.positions.find((row) => row.accountCode === accountCode);
  if (!position) throw new Error(`no position for ${accountCode}`);
  return position;
}

/*
  The legs one sweep posted. Platform balances are shared with every other
  spec in the run - the sweeper moves whatever is eligible, not only this
  test's address - so what is asserted about a sweep is the entries it made.
*/
async function legs(sweepId: string, reason: string): Promise<string[]> {
  const transaction = await db.ledgerTransaction.findFirst({
    where: { referenceType: "sweep", referenceId: sweepId, reason: reason as never },
    include: { entries: { include: { account: true } } },
  });
  if (!transaction) return [];
  return transaction.entries
    .map((entry) => `${entry.account.purpose} ${entry.direction} ${entry.amount.toString()}`)
    .sort();
}

const openBreakFor = (accountCode: string) =>
  db.reconciliationBreak.findFirst({ where: { accountCode, status: "OPEN" } });

async function makeAdmin(roles: string[]) {
  const email = `admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const totp = enrolledTotp();
  const admin = await db.adminUser.create({
    data: {
      email,
      name: "Test Adjuster",
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
  return { id: admin.id, cookie, csrf };
}

/*
  Brings one account's books level before a test injects its own difference.
  Other specs share this database and this treasury, so without it a test
  would be asserting about their leftovers as much as its own injection.
  It uses the real workflow, which is also a small proof that the workflow
  closes whatever it is pointed at.
*/
async function settle(admin: { cookie: string; csrf: string }, accountCode: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const position = await positionFor(accountCode);
    if (position.agrees) return;
    const open = await openBreakFor(accountCode);
    if (!open) return;
    await resolveBreak(admin, open.id, {
      action: open.kind === "SURPLUS" ? "RECORD_SURPLUS" : "WRITE_OFF_SHORTFALL",
      reason: "levelling the books before this test injects a difference of its own",
    }).expect(200);
  }
  expect((await positionFor(accountCode)).agrees).toBe(true);
}

const resolveBreak = (admin: { cookie: string; csrf: string }, id: string, body: object) =>
  request(server())
    .post(`/v1/admin/reconciliation/breaks/${id}/resolve`)
    .set("Cookie", admin.cookie)
    .set("x-csrf-token", admin.csrf)
    .set("x-request-id", uniq("adm"))
    .send(body);

describe("sweeping", () => {
  it("moves a credited deposit into the treasury without touching who owns it", async () => {
    const { userId, address } = await deposited(40n);
    const owned = await ledger.balance(accounts.userAvailable(userId));

    const pending = await sweeps.sweepable();
    expect(pending.find((row) => row.address === address)?.amount).toBe(40n * USDT);

    const swept = await sweeps.sweepDue(200);
    expect(swept.swept).toBeGreaterThanOrEqual(1);
    const sweep = await db.sweep.findFirstOrThrow({
      where: { address: { address } },
      orderBy: { createdAt: "desc" },
    });
    expect(sweep).toMatchObject({ status: "BROADCAST", amount: 40n * USDT });

    // JE-2a: out of the deposit addresses, into transit. No liability moved.
    expect(await legs(sweep.id, "SWEEP_BROADCAST")).toEqual([
      "DEPOSIT_ADDRESSES CREDIT 40000000",
      "IN_TRANSIT DEBIT 40000000",
    ]);
    expect(await ledger.balance(accounts.userAvailable(userId))).toBe(owned);

    await chain.advance(15);
    expect((await sweeps.confirmSweeps()).confirmed).toBeGreaterThanOrEqual(1);

    // JE-2b: into the hot treasury, which is what withdrawals are paid from.
    const confirmed = await db.sweep.findUniqueOrThrow({ where: { id: sweep.id } });
    expect(confirmed.status).toBe("CONFIRMED");
    expect(await legs(sweep.id, "SWEEP_CONFIRMED")).toEqual([
      "IN_TRANSIT CREDIT 40000000",
      "TREASURY_HOT DEBIT 40000000",
    ]);
    // The whole point of a sweep: the customer's balance is untouched by it.
    expect(await ledger.balance(accounts.userAvailable(userId))).toBe(owned);

    // Nothing left to sweep from that address, and a second pass does nothing.
    const after = await sweeps.sweepable();
    expect(after.find((row) => row.address === address)).toBeUndefined();
  });

  it("leaves a small balance where it is rather than paying gas to move it", async () => {
    const { address } = await deposited(2n);
    const pending = await sweeps.sweepable();
    expect(pending.find((row) => row.address === address)?.amount).toBe(2n * USDT);
    // Below SWEEP_MIN_MICRO (5 USDT): recognised, but not worth moving yet.
    await sweeps.sweepDue(200);
    expect(await db.sweep.count({ where: { address: { address } } })).toBe(0);
  });

  /*
    The rule that decides whether a sweep is ever tried again, stated
    directly. A sweep the provider could not confirm stays PENDING, and a
    PENDING sweep keeps its amount claimed, so no later pass can send those
    coins a second time. A refusal is certain - nothing moved - so it is
    FAILED, and the amount becomes sweepable again.
  */
  it("never retries a sweep the provider could not confirm, and does retry a refused one", async () => {
    const { address } = await deposited(30n);
    const addressRow = await db.attributionAddress.findFirstOrThrow({ where: { address } });
    const claimed = await db.sweep.create({
      data: {
        addressId: addressRow.id,
        network: "BSC",
        asset: "USDT",
        amount: 30n * USDT,
        status: "PENDING",
        lastError: "the provider could not confirm the transfer",
        correlationId: uniq("sweep"),
      },
    });
    expect((await sweeps.sweepable()).find((row) => row.address === address)).toBeUndefined();

    await db.sweep.update({ where: { id: claimed.id }, data: { status: "FAILED" } });
    expect((await sweeps.sweepable()).find((row) => row.address === address)?.amount).toBe(
      30n * USDT,
    );

    // Put it back, so a later pass does not sweep this one by surprise.
    await db.sweep.update({ where: { id: claimed.id }, data: { status: "PENDING" } });
  });
});

describe("AT-12: the chain and the ledger disagree", () => {
  it("agrees with itself when nothing is wrong, and posts nothing either way", async () => {
    const before = await db.ledgerTransaction.count();
    const report = await reconciler.reconcile(uniq("rec"));
    expect(report.network).toBe("BSC");
    expect(report.positions.map((row) => row.accountCode)).toEqual([
      DEPOSIT_ADDRESSES,
      HOT,
      accounts.platform("TREASURY_COLD"),
    ]);
    // The whole point: reading the world writes nothing to the ledger.
    expect(await db.ledgerTransaction.count()).toBe(before);
  });

  it("notices a surplus, says by how much, and lets a person book it as owed", async () => {
    const viewer = await makeAdmin(["LEDGER_VIEWER"]);
    const adjuster = await makeAdmin(["FINANCIAL_ADJUSTER", "LEDGER_VIEWER"]);
    const treasuryAddress = await custody.treasuryAddress("BSC", "HOT");
    await settle(adjuster, HOT);
    const before = await positionFor(HOT);
    expect(before.difference).toBe("0");
    const entriesBefore = await db.ledgerTransaction.count();

    // Somebody sent coins to the treasury that the ledger knows nothing about.
    await chain.mint({ to: treasuryAddress, rawAmount: 7n * USDT18, tag: uniq("surplus") });

    const after = await positionFor(HOT);
    expect(BigInt(after.difference) - BigInt(before.difference)).toBe(7n * USDT);
    expect(after.agrees).toBe(false);
    // The reconciler posted nothing of its own, twice over.
    expect(await db.ledgerTransaction.count()).toBe(entriesBefore);

    const raised = await openBreakFor(HOT);
    expect(raised).toMatchObject({ kind: "SURPLUS", status: "OPEN", difference: 7n * USDT });

    // A second pass refreshes the same break rather than raising another.
    await reconciler.reconcile(uniq("rec"));
    expect(
      await db.reconciliationBreak.count({ where: { accountCode: HOT, status: "OPEN" } }),
    ).toBe(1);

    // Reading is one capability; posting the entry is another.
    const breaks = (
      await request(server())
        .get("/v1/admin/reconciliation/breaks?status=OPEN")
        .set("Cookie", viewer.cookie)
        .expect(200)
    ).body as ReconciliationBreaksResponse;
    expect(breaks.breaks.map((row) => row.id)).toContain(raised?.id);
    await resolveBreak(viewer, raised!.id, {
      action: "RECORD_SURPLUS",
      reason: "not this administrator's to post",
    }).expect(403);

    // Writing off a surplus would create money out of a typo.
    await resolveBreak(adjuster, raised!.id, {
      action: "WRITE_OFF_SHORTFALL",
      reason: "wrong direction on purpose",
    }).expect(409);

    const suspenseBefore = await ledger.balance(accounts.platform("RECONCILIATION_SUSPENSE"));
    const resolved = (
      await resolveBreak(adjuster, raised!.id, {
        action: "RECORD_SURPLUS",
        reason: "unexpected inbound transfer, sender not yet identified, ticket 8891",
      }).expect(200)
    ).body as ReconciliationBreakView;

    // JE-11: recorded as something we may owe, never as revenue.
    expect(resolved).toMatchObject({ status: "RESOLVED", kind: "SURPLUS" });
    expect(resolved.adjustmentTransactionId).not.toBeNull();
    expect(await ledger.balance(accounts.platform("RECONCILIATION_SUSPENSE"))).toBe(
      suspenseBefore + BigInt(after.difference),
    );

    // And the books now agree with the chain.
    const settled = await positionFor(HOT);
    expect(settled.difference).toBe("0");
    expect(settled.agrees).toBe(true);
    expect(await openBreakFor(HOT)).toBeNull();
  });
});

describe("AT-12: a shortfall, and a transfer nobody told us about", () => {
  it("notices coins that have left, and the write-off lands on the platform, not on customers", async () => {
    const adjuster = await makeAdmin(["FINANCIAL_ADJUSTER", "LEDGER_VIEWER"]);
    const treasuryAddress = await custody.treasuryAddress("BSC", "HOT");
    // Something to lose.
    await deposited(60n);
    await sweeps.sweepDue(200);
    await chain.advance(15);
    await sweeps.confirmSweeps();
    await settle(adjuster, HOT);

    const before = await positionFor(HOT);
    expect(before.difference).toBe("0");
    const entriesBefore = await db.ledgerTransaction.count();
    const customerLiabilities = await db.$queryRaw<{ total: bigint }[]>`
      SELECT coalesce(sum(b.balance), 0)::bigint AS total
        FROM ledger_account_balances b
        JOIN ledger_accounts a ON a.id = b.account_id
       WHERE a.scope = 'USER'`;

    // Coins leave the treasury by a route the ledger never recorded.
    await chain.mint({
      from: treasuryAddress,
      to: `0x${"d".repeat(40)}`,
      rawAmount: 9n * USDT18,
      tag: uniq("shortfall"),
    });

    const after = await positionFor(HOT);
    expect(BigInt(before.difference) - BigInt(after.difference)).toBe(9n * USDT);
    expect(await db.ledgerTransaction.count()).toBe(entriesBefore);

    const raised = await openBreakFor(HOT);
    expect(raised).toMatchObject({ kind: "SHORTFALL", status: "OPEN", difference: 9n * USDT });

    const lossesBefore = await ledger.balance(accounts.platform("LOSSES"));
    const resolved = (
      await resolveBreak(adjuster, raised!.id, {
        action: "WRITE_OFF_SHORTFALL",
        reason: "confirmed absent after investigation; incident 2026-09-12-01",
      }).expect(200)
    ).body as ReconciliationBreakView;

    // JE-12: the platform's own expense absorbs it.
    expect(resolved.status).toBe("RESOLVED");
    expect(await ledger.balance(accounts.platform("LOSSES"))).toBe(
      lossesBefore + raised!.difference,
    );

    // The thing that must never happen: customers quietly paying for it.
    const afterLiabilities = await db.$queryRaw<{ total: bigint }[]>`
      SELECT coalesce(sum(b.balance), 0)::bigint AS total
        FROM ledger_account_balances b
        JOIN ledger_accounts a ON a.id = b.account_id
       WHERE a.scope = 'USER'`;
    expect(afterLiabilities[0]?.total).toBe(customerLiabilities[0]?.total);

    const settled = await positionFor(HOT);
    expect(settled.agrees).toBe(true);
  });

  it("notices a transfer to one of our addresses that the pipeline never recorded", async () => {
    const adjuster = await makeAdmin(["FINANCIAL_ADJUSTER", "LEDGER_VIEWER"]);
    const { cookie } = await registerFully(server(), db, uniqueEmail());
    const addressResponse = await request(server())
      .get("/v1/wallet/deposit-address")
      .set("Cookie", cookie)
      .expect(200);
    const address = (addressResponse.body as { address: string }).address;

    const before = await positionFor(DEPOSIT_ADDRESSES);
    // Coins arrive and nothing tells the deposit pipeline: no webhook, and the
    // observer is not running in this process.
    await chain.mint({ to: address, rawAmount: 12n * USDT18, tag: uniq("silent") });

    const after = await positionFor(DEPOSIT_ADDRESSES);
    expect(BigInt(after.difference) - BigInt(before.difference)).toBe(12n * USDT);
    const raised = await openBreakFor(DEPOSIT_ADDRESSES);
    expect(raised).toMatchObject({ kind: "SURPLUS", status: "OPEN" });

    /*
      The honest resolution for this one is usually not an entry at all: the
      deposit pipeline will find the transfer on its next scan and credit it
      properly, at which point the difference is gone. So it is dismissed,
      which posts nothing.
    */
    const dismissed = (
      await resolveBreak(adjuster, raised!.id, {
        action: "DISMISS",
        reason: "an unrecorded deposit; the observer will credit it on its next pass",
      }).expect(200)
    ).body as ReconciliationBreakView;
    expect(dismissed).toMatchObject({ status: "DISMISSED", adjustmentTransactionId: null });

    const report = (
      await request(server())
        .get("/v1/admin/reconciliation/report")
        .set("Cookie", adjuster.cookie)
        .set("x-request-id", uniq("rec"))
        .expect(200)
    ).body as ReconciliationReport;
    expect(report.positions.find((row) => row.accountCode === DEPOSIT_ADDRESSES)?.agrees).toBe(
      false,
    );

    const sweepList = (
      await request(server())
        .get("/v1/admin/reconciliation/sweeps")
        .set("Cookie", adjuster.cookie)
        .expect(200)
    ).body as SweepsResponse;
    expect(Number(sweepList.unswept)).toBeGreaterThanOrEqual(0);
  });
});
