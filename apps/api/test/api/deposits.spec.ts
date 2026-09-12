import {
  type AdminDepositItem,
  type DepositAddressResponse,
  type DepositsResponse,
} from "@abay/contracts";
import { createPrismaClient, type PrismaClient } from "@abay/database";
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import { type PinoLogger } from "nestjs-pino";
import request from "supertest";

import { createApp } from "@/app";
import { loadEnv, type Env } from "@/config/env";
import { PrismaService } from "@/infra/prisma/prisma.service";
import { RedisService } from "@/infra/redis/redis.service";
import { hashPassword } from "@/modules/auth/tokens";
import {
  BLOCKCHAIN_GATEWAY,
  type BlockchainGateway,
} from "@/modules/blockchain/blockchain.gateway";
import { MockChain, type MintInput } from "@/modules/blockchain/mock/mock-blockchain.gateway";
import { signWebhook } from "@/modules/custody/webhooks/webhook-signature";
import { DepositObserver } from "@/modules/deposits/deposit-observer";
import { DepositService } from "@/modules/deposits/deposit.service";
import { accounts } from "@/modules/ledger/account-code";
import { LedgerService } from "@/modules/ledger/ledger.service";
import { AddressService } from "@/modules/wallets/address.service";

import { enrolledTotp, registerFully, totpCodeFor, uniqueEmail } from "./helpers";

/*
  Money coming in, end to end, against the real database and the mock chain:
  an address is issued once; a webhook is believed only after the chain
  agrees; a deposit is credited exactly once however many times it is
  reported (AT-1); a reorg before finality credits nothing and a reorg after
  it does not take the money back (AT-20); a person decides the rare ones.

  Every tag, correlation id and email here starts with "test-", which is how
  global-teardown.js knows which rows are its to clear.
*/

let app: NestFastifyApplication;
let db: PrismaClient;
let env: Env;
let prisma: PrismaService;
let chain: MockChain;
let gateway: BlockchainGateway;
let deposits: DepositService;
let addresses: AddressService;
let ledger: LedgerService;
const server = () => app.getHttpServer() as Parameters<typeof request>[0];

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let counter = 0;
const uniq = (label: string) => `test-${run}-${label}-${++counter}`;
const USDT = 1_000_000n;
const USDT18 = 10n ** 18n;
const ADMIN_PASSWORD = "correct horse battery staple";

beforeAll(async () => {
  env = loadEnv();
  app = await createApp(env);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  db = createPrismaClient(env.DATABASE_URL);
  prisma = app.get(PrismaService);
  chain = app.get(MockChain);
  gateway = app.get(BLOCKCHAIN_GATEWAY);
  deposits = app.get(DepositService);
  addresses = app.get(AddressService);
  ledger = app.get(LedgerService);
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

async function customer() {
  const { cookie, userId } = await registerFully(server(), db, uniqueEmail());
  const response = await request(server())
    .get("/v1/wallet/deposit-address")
    .set("Cookie", cookie)
    .expect(200);
  const address = (response.body as DepositAddressResponse).address;
  return { cookie, userId, address };
}

/** A signed delivery of the provider's webhook, exactly as it would send it. */
function deliver(txHash: string, logIndex = 0, correlation = uniq("wh")) {
  const raw = JSON.stringify({ event: "transfer.incoming", network: "BSC", txHash, logIndex });
  return request(server())
    .post("/v1/webhooks/custody")
    .set("content-type", "application/json")
    .set("x-custody-signature", signWebhook(env.CUSTODY_WEBHOOK_SECRET, raw))
    .set("x-request-id", correlation)
    .send(raw);
}

const mint = (to: string, usdt: bigint, extra: Partial<MintInput> = {}) =>
  chain.mint({ to, rawAmount: usdt * USDT18, tag: uniq("mint"), ...extra });

const balanceOf = (userId: string) => ledger.balance(accounts.userAvailable(userId));
const unidentified = () => ledger.balance(accounts.platform("UNIDENTIFIED_DEPOSITS"));
const depositRow = (txHash: string) =>
  db.deposit.findUniqueOrThrow({
    where: {
      network_txHash_logIndex: { network: "BSC", txHash: txHash.toLowerCase(), logIndex: 0 },
    },
  });
const creditsFor = (id: string) =>
  db.ledgerTransaction.count({ where: { referenceType: "deposit", referenceId: id } });

async function makeAdmin(roles: string[]) {
  const email = `admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const totp = enrolledTotp();
  const admin = await db.adminUser.create({
    data: {
      email,
      name: "Test Reviewer",
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

describe("the deposit address", () => {
  it("is issued once per customer, the same one every time, and only to a signed-in customer", async () => {
    await request(server()).get("/v1/wallet/deposit-address").expect(401);
    const { cookie, userId, address } = await customer();
    const again = await request(server())
      .get("/v1/wallet/deposit-address")
      .set("Cookie", cookie)
      .expect(200);
    const body = again.body as DepositAddressResponse;
    expect(body).toMatchObject({
      network: "BSC",
      standard: "BEP20",
      asset: "USDT",
      address,
      confirmationsRequired: 15,
      minimumDeposit: "1000000",
    });
    expect(address).toMatch(/^0x[0-9a-f]{40}$/);
    expect(await db.attributionAddress.count({ where: { userId } })).toBe(1);
  });

  it("asks the provider once when several first requests race", async () => {
    const { userId } = await registerFully(server(), db, uniqueEmail());
    const rows = await Promise.all(Array.from({ length: 5 }, () => addresses.getOrCreate(userId)));
    expect(new Set(rows.map((r) => r.address)).size).toBe(1);
    expect(await db.attributionAddress.count({ where: { userId } })).toBe(1);
  });
});

describe("detection", () => {
  it("refuses a bad signature or a malformed body before touching anything", async () => {
    const raw = JSON.stringify({
      event: "transfer.incoming",
      network: "BSC",
      txHash: "0x" + "a".repeat(64),
      logIndex: 0,
    });
    await request(server())
      .post("/v1/webhooks/custody")
      .set("content-type", "application/json")
      .set("x-custody-signature", signWebhook("not-the-secret-at-all", raw))
      .send(raw)
      .expect(401);
    await request(server())
      .post("/v1/webhooks/custody")
      .set("content-type", "application/json")
      .send(raw)
      .expect(401);
    const broken = JSON.stringify({ event: "transfer.incoming", network: "BSC", logIndex: 0 });
    await request(server())
      .post("/v1/webhooks/custody")
      .set("content-type", "application/json")
      .set("x-custody-signature", signWebhook(env.CUSTODY_WEBHOOK_SECRET, broken))
      .send(broken)
      .expect(400);
  });

  it("records a transfer to a customer's address once, and acknowledges every redelivery", async () => {
    const { userId, address } = await customer();
    const minted = await mint(address, 5n);

    const first = await deliver(minted.txHash).expect(200);
    expect(first.body).toEqual({ received: true, outcome: "recorded" });
    const second = await deliver(minted.txHash).expect(200);
    expect(second.body).toEqual({ received: true, outcome: "duplicate" });

    const row = await depositRow(minted.txHash);
    expect(row).toMatchObject({
      status: "CONFIRMING",
      amount: 5n * USDT,
      userId,
      detectedVia: "webhook",
      toAddress: address,
    });
    expect(row.rawAmount).toBe((5n * USDT18).toString());
    const actions = await db.auditEvent.findMany({
      where: { subjectType: "deposit", subjectId: row.id },
      select: { action: true },
    });
    expect(actions.map((a) => a.action).sort()).toEqual(["deposit.confirming", "deposit.detected"]);
  });

  it("acknowledges a claim the chain does not have, and records nothing", async () => {
    const ghost = `0x${"e".repeat(64)}`;
    const response = await deliver(ghost).expect(200);
    expect(response.body).toEqual({ received: true, outcome: "not_on_chain" });
    expect(await db.deposit.count({ where: { txHash: ghost } })).toBe(0);
  });

  it("books money that is ours but nobody's, and refuses to book what is not ours", async () => {
    const { userId, address } = await customer();
    const before = await unidentified();

    // Below dust, to our address: ours, but not creditable. JE-10a.
    const dust = await chain.mint({ to: address, rawAmount: USDT18 / 2n, tag: uniq("dust") });
    await deliver(dust.txHash).expect(200);
    const dustRow = await depositRow(dust.txHash);
    expect(dustRow.status).toBe("UNATTRIBUTED");
    expect(dustRow.reviewReason).toMatch(/dust/);
    expect(dustRow.ledgerTransactionId).not.toBeNull();
    expect(await unidentified()).toBe(before + USDT / 2n);

    // The wrong token, to our address: not USDT, nothing to book.
    const other = await mint(address, 9n, { tokenContract: `0x${"1".repeat(40)}` });
    await deliver(other.txHash).expect(200);
    const otherRow = await depositRow(other.txHash);
    expect(otherRow.status).toBe("UNATTRIBUTED");
    expect(otherRow.reviewReason).toMatch(/token/);
    expect(otherRow.ledgerTransactionId).toBeNull();

    // An address we never issued: not ours at all.
    const stranger = await mint(`0x${"9".repeat(40)}`, 3n);
    await deliver(stranger.txHash).expect(200);
    const strangerRow = await depositRow(stranger.txHash);
    expect(strangerRow).toMatchObject({
      status: "UNATTRIBUTED",
      ledgerTransactionId: null,
      addressId: null,
    });

    // A retired address of ours: ours, booked, waiting for a person.
    await db.attributionAddress.updateMany({ where: { userId }, data: { status: "RETIRED" } });
    const late = await mint(address, 3n);
    await deliver(late.txHash).expect(200);
    const lateRow = await depositRow(late.txHash);
    expect(lateRow.status).toBe("UNATTRIBUTED");
    expect(lateRow.reviewReason).toMatch(/retired/);
    expect(lateRow.ledgerTransactionId).not.toBeNull();
    expect(await unidentified()).toBe(before + USDT / 2n + 3n * USDT);
    expect(await balanceOf(userId)).toBe(0n);
  });
});

describe("confirmation and credit", () => {
  it("credits at finality, once, and tells the customer", async () => {
    const { cookie, userId, address } = await customer();
    const minted = await mint(address, 10n);
    await deliver(minted.txHash).expect(200);
    const id = (await depositRow(minted.txHash)).id;

    expect((await deposits.confirmDue()).credited).toBe(0);
    expect((await depositRow(minted.txHash)).confirmations).toBe(1);
    await chain.advance(13);
    await deposits.confirmDue();
    expect(await depositRow(minted.txHash)).toMatchObject({
      status: "CONFIRMING",
      confirmations: 14,
    });
    expect(await balanceOf(userId)).toBe(0n);

    await chain.advance(1);
    const tally = await deposits.confirmDue();
    expect(tally.credited).toBeGreaterThanOrEqual(1);
    const row = await depositRow(minted.txHash);
    expect(row.status).toBe("CREDITED");
    expect(row.creditedAt).not.toBeNull();
    expect(row.ledgerTransactionId).not.toBeNull();
    expect(await balanceOf(userId)).toBe(10n * USDT);
    expect(await creditsFor(id)).toBe(1);

    const told = await db.notification.findFirst({ where: { userId, type: "DEPOSIT_CREDITED" } });
    expect(told?.body).toContain("10.000000 USDT");
    const email = await db.outboxEvent.findFirst({
      where: { type: "email.send", correlationId: row.correlationId },
    });
    expect(email).not.toBeNull();

    const listed = (
      await request(server()).get("/v1/wallet/deposits").set("Cookie", cookie).expect(200)
    ).body as DepositsResponse;
    expect(listed.deposits.map((d) => [d.status, d.amount, d.confirmationsRequired])).toEqual([
      ["CREDITED", (10n * USDT).toString(), 15],
    ]);

    // A later pass finds nothing to do; the credit does not repeat.
    await chain.advance(5);
    await deposits.confirmDue();
    expect(await balanceOf(userId)).toBe(10n * USDT);
    expect(await creditsFor(id)).toBe(1);
  });

  /*
    AT-1. The same signed webhook, six times, some at once, some while the
    credit is happening, some after it: one deposit, one JE-1, the balance
    up by the amount once, and every single delivery answered 200.
  */
  it("AT-1: the same webhook delivered many times, around the credit, credits exactly once", async () => {
    const { userId, address } = await customer();
    const minted = await mint(address, 7n);

    const early = await Promise.all([
      deliver(minted.txHash),
      deliver(minted.txHash),
      deliver(minted.txHash),
    ]);
    await chain.advance(15);
    const during = await Promise.all([
      deposits.confirmDue(),
      deliver(minted.txHash),
      deliver(minted.txHash),
      deposits.confirmDue(),
      deliver(minted.txHash),
    ]);
    const late = await Promise.all([deliver(minted.txHash), deliver(minted.txHash)]);

    for (const response of [...early, ...during.filter((d) => "status" in d), ...late]) {
      expect((response as { status: number }).status).toBe(200);
    }
    expect(await db.deposit.count({ where: { txHash: minted.txHash } })).toBe(1);
    const row = await depositRow(minted.txHash);
    expect(row.status).toBe("CREDITED");
    expect(await creditsFor(row.id)).toBe(1);
    expect(
      await db.ledgerTransaction.count({ where: { idempotencyKey: `deposit:${row.id}:credit` } }),
    ).toBe(1);
    expect(await balanceOf(userId)).toBe(7n * USDT);
    expect(
      await db.auditEvent.count({ where: { action: "deposit.credited", subjectId: row.id } }),
    ).toBe(1);
  });

  /*
    AT-20. Before finality, a reorg that takes the transfer away orphans the
    deposit and nothing is ever posted. After finality the credit stands:
    the customer's balance is not clawed back by a chain event; the
    reconciler (stage 4) is what raises that as a break for a person.
  */
  it("AT-20: a reorg before finality credits nothing; a reorg after it does not take the money back", async () => {
    const a = await customer();
    const gone = await mint(a.address, 4n);
    await deliver(gone.txHash).expect(200);
    await chain.advance(5);
    await chain.reorg(gone.txHash);
    await deposits.confirmDue();
    expect((await depositRow(gone.txHash)).status).toBe("CONFIRMING");
    await chain.advance(30);
    const tally = await deposits.confirmDue();
    expect(tally.orphaned).toBeGreaterThanOrEqual(1);
    const orphan = await depositRow(gone.txHash);
    expect(orphan.status).toBe("ORPHANED");
    expect(await creditsFor(orphan.id)).toBe(0);
    expect(await balanceOf(a.userId)).toBe(0n);

    const b = await customer();
    const kept = await mint(b.address, 6n);
    await deliver(kept.txHash).expect(200);
    await chain.advance(15);
    await deposits.confirmDue();
    expect((await depositRow(kept.txHash)).status).toBe("CREDITED");
    await chain.reorg(kept.txHash);
    await chain.advance(40);
    await deposits.confirmDue();
    expect((await depositRow(kept.txHash)).status).toBe("CREDITED");
    expect(await balanceOf(b.userId)).toBe(6n * USDT);
    expect(await gateway.findTransfer("BSC", kept.txHash, 0)).toBeNull();
  });
});

describe("the rare ones: a person decides", () => {
  const post = (admin: { cookie: string; csrf: string }, path: string, body: object) =>
    request(server())
      .post(`/v1/admin/deposits${path}`)
      .set("Cookie", admin.cookie)
      .set("x-csrf-token", admin.csrf)
      // A test correlation id, so the ledger rows a decision posts are the teardown's to clear.
      .set("x-request-id", uniq("adm"))
      .send(body);

  async function heldDeposit(usdt: bigint) {
    const who = await customer();
    const minted = await mint(who.address, usdt);
    await deliver(minted.txHash).expect(200);
    await chain.advance(15);
    const tally = await deposits.confirmDue();
    expect(tally.held).toBeGreaterThanOrEqual(1);
    const row = await depositRow(minted.txHash);
    expect(row.status).toBe("MANUAL_REVIEW");
    return { ...who, row };
  }

  it("holds a very large deposit, which a reviewer can approve or reject", async () => {
    const reviewer = await makeAdmin(["DEPOSIT_REVIEWER"]);
    const held = await heldDeposit(10_000n);
    expect(held.row.reviewReason).toMatch(/review threshold/);
    expect(await balanceOf(held.userId)).toBe(0n);

    const queue = await request(server())
      .get("/v1/admin/deposits/queue")
      .set("Cookie", reviewer.cookie)
      .expect(200);
    expect((queue.body as { deposits: AdminDepositItem[] }).deposits.map((d) => d.id)).toContain(
      held.row.id,
    );

    const approved = await post(reviewer, `/${held.row.id}/approve`, {
      reason: "source verified",
    }).expect(200);
    expect(approved.body as AdminDepositItem).toMatchObject({
      status: "CREDITED",
      decidedBy: reviewer.id,
    });
    expect(await balanceOf(held.userId)).toBe(10_000n * USDT);
    expect(
      await db.auditEvent.count({
        where: { action: "deposit.credited.manual", subjectId: held.row.id },
      }),
    ).toBe(1);
    // Terminal: a second decision is refused by the state machine, not silently repeated.
    await post(reviewer, `/${held.row.id}/approve`, {}).expect(409);
    expect(await creditsFor(held.row.id)).toBe(1);

    const other = await heldDeposit(12_000n);
    await post(reviewer, `/${other.row.id}/reject`, {}).expect(400);
    const rejected = await post(reviewer, `/${other.row.id}/reject`, {
      reason: "sanctioned counterparty",
    }).expect(200);
    expect(rejected.body as AdminDepositItem).toMatchObject({
      status: "REJECTED",
      decisionReason: "sanctioned counterparty",
    });
    expect(await balanceOf(other.userId)).toBe(0n);
    expect(await creditsFor(other.row.id)).toBe(0);
  });

  it("attributes an unmatched deposit to a customer, out of the unidentified liability", async () => {
    const reviewer = await makeAdmin(["DEPOSIT_REVIEWER"]);
    const sender = await customer();
    await db.attributionAddress.updateMany({
      where: { userId: sender.userId },
      data: { status: "RETIRED" },
    });
    const minted = await mint(sender.address, 3n);
    await deliver(minted.txHash).expect(200);
    const row = await depositRow(minted.txHash);
    expect(row.status).toBe("UNATTRIBUTED");
    const before = await unidentified();

    const owner = await customer();
    const attributed = await post(reviewer, `/${row.id}/attribute`, {
      userId: owner.userId,
      reason: "sender confirmed by support ticket 4411",
    }).expect(200);
    expect(attributed.body as AdminDepositItem).toMatchObject({
      status: "CREDITED",
      userId: owner.userId,
    });
    expect(await balanceOf(owner.userId)).toBe(3n * USDT);
    expect(await unidentified()).toBe(before - 3n * USDT);
    expect(
      await db.auditEvent.count({ where: { action: "deposit.attributed", subjectId: row.id } }),
    ).toBe(1);

    // Not ours to give: a transfer to an address we never issued has nothing behind it.
    const stranger = await mint(`0x${"8".repeat(40)}`, 2n);
    await deliver(stranger.txHash).expect(200);
    const strangerRow = await depositRow(stranger.txHash);
    await post(reviewer, `/${strangerRow.id}/attribute`, {
      userId: owner.userId,
      reason: "guessing",
    }).expect(409);
    expect(await balanceOf(owner.userId)).toBe(3n * USDT);
  });

  it("refuses the queue to an administrator without the role", async () => {
    const kyc = await makeAdmin(["KYC_REVIEWER", "LEDGER_VIEWER"]);
    await request(server()).get("/v1/admin/deposits/queue").set("Cookie", kyc.cookie).expect(403);
  });
});

describe("the observer", () => {
  it("finds a transfer no webhook ever mentioned, and does not find it twice", async () => {
    const quiet = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as PinoLogger;
    const observer = new DepositObserver(
      prisma,
      app.get(RedisService),
      deposits,
      addresses,
      gateway,
      env,
      quiet,
    );
    const { userId, address } = await customer();
    const minted = await mint(address, 2n);

    const first = await observer.pass();
    expect(first.recorded).toBeGreaterThanOrEqual(1);
    const row = await depositRow(minted.txHash);
    expect(row).toMatchObject({ status: "CONFIRMING", detectedVia: "observer", userId });
    const cursor = await db.chainObserverCursor.findUniqueOrThrow({ where: { network: "BSC" } });
    expect(cursor.lastBlock).toBe(first.head);

    const second = await observer.pass();
    expect(second.recorded).toBe(0);
    expect(await db.deposit.count({ where: { txHash: minted.txHash } })).toBe(1);
  });
});
