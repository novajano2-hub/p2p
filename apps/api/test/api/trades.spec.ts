import { type OfferView, type PaymentMethodDetailView, type TradeView } from "@abay/contracts";
import { createPrismaClient, type PrismaClient } from "@abay/database";
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import { PinoLogger } from "nestjs-pino";
import request from "supertest";

import { createApp } from "@/app";
import { loadEnv, type Env } from "@/config/env";
import { RedisService } from "@/infra/redis/redis.service";
import { accounts } from "@/modules/ledger/account-code";
import { LedgerService } from "@/modules/ledger/ledger.service";
import { OfferService } from "@/modules/offers/offer.service";
import { EXPIRER_LOCK_KEY, TradeExpirer } from "@/modules/trades/trade-expirer";
import { OPEN, SETTLED, TRADE_TRANSITIONS } from "@/modules/trades/trade.machine";
import { TradeService } from "@/modules/trades/trade.service";

import { csrfFor, listed, PASSWORD, registerFully, uniqueEmail } from "./helpers";

/*
  Phase 4, stage 2: the trade engine, end to end.

  The acceptance tests this file exists for are the ones about money that
  must move exactly once, or not at all: two takers cannot lock the same
  USDT (AT-2), a withdrawal and a trade cannot overspend together (AT-3),
  "I have paid" moves nothing (AT-4), a release credits the buyer once
  however many times it is asked (AT-5), a cancelled or expired trade gives
  the escrow back once and reverses the lock by id (AT-7), and a settled
  trade's escrow is exactly zero (AT-14).

  Every correlation id and email here starts with "test-", which is how
  global-teardown.js knows which rows are its to clear.
*/

let app: NestFastifyApplication;
let db: PrismaClient;
let env: Env;
let ledger: LedgerService;
let trades: TradeService;
let offers: OfferService;
const server = () => app.getHttpServer() as Parameters<typeof request>[0];

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let counter = 0;
const uniq = (label: string) => `test-${run}-${label}-${++counter}`;
const USDT = 1_000_000n;
const OUTSIDE = "0x1111111111111111111111111111111111111111";

beforeAll(async () => {
  env = loadEnv();
  app = await createApp(env);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  db = createPrismaClient(env.DATABASE_URL);
  ledger = app.get(LedgerService);
  trades = app.get(TradeService);
  offers = app.get(OfferService);
});

afterAll(async () => {
  await db.$disconnect();
  await app.close();
});

afterEach(() => {
  jest.restoreAllMocks();
});

/* ------------------------------------------------------------- helpers */

function api(cookie: string) {
  const headers = (test: request.Test) =>
    test
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfFor(cookie))
      .set("x-request-id", uniq("req"));
  return {
    get: (path: string) => headers(request(server()).get(path)),
    post: (path: string, body?: object, key?: string) => {
      const test = headers(request(server()).post(path));
      return (key ? test.set("Idempotency-Key", key) : test).send(body ?? {});
    },
    patch: (path: string, body: object) => headers(request(server()).patch(path)).send(body),
  };
}
type Api = ReturnType<typeof api>;

async function customer(options: { verified?: boolean; usdt?: bigint } = {}) {
  const email = uniqueEmail();
  const { cookie, userId } = await registerFully(server(), db, email);
  if (options.verified !== false) {
    await db.user.update({ where: { id: userId }, data: { kycStatus: "APPROVED" } });
  }
  if (options.usdt && options.usdt > 0n) await fund(userId, options.usdt);
  return { cookie, userId, email, api: api(cookie) };
}

async function fund(userId: string, usdt: bigint) {
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
}

const TELEBIRR = { kind: "TELEBIRR", accountHolder: "Abebe Bikila", phone: "0912345678" };

async function addMethod(who: Api, body: object = TELEBIRR): Promise<PaymentMethodDetailView> {
  const response = await who.post("/v1/payment-methods", body).expect(201);
  return response.body as PaymentMethodDetailView;
}

/** 100 USDT at 158.50 ETB, 10 to 20,000 ETB a trade, 30 minutes to pay. */
async function sellOffer(
  who: Api,
  methodId: string,
  overrides: Record<string, unknown> = {},
): Promise<OfferView> {
  const response = await who
    .post("/v1/offers", {
      side: "SELL",
      priceSantim: "15850",
      totalAmount: (100n * USDT).toString(),
      minSantim: "1000",
      maxSantim: "2000000",
      paymentWindowMinutes: 30,
      paymentMethodIds: [methodId],
      ...overrides,
    })
    .expect(201);
  return response.body as OfferView;
}

/*
  Every order names the version of the ad it is placed against. Fresh ads are
  at version 1, so that is the default here; a test that edits an ad first
  passes the new number itself.
*/
function take(who: Api, body: object, key = uniq("key")) {
  return who.post("/v1/trades", { offerRevision: 1, ...body }, key);
}

const available = (userId: string) => ledger.balance(accounts.userAvailable(userId));
const pending = (userId: string) => ledger.balance(accounts.userPendingWithdrawal(userId));
const escrow = (tradeId: string) => ledger.balance(accounts.tradeEscrow(tradeId));

async function legs(tradeId: string, reason: string): Promise<string[]> {
  const transaction = await db.ledgerTransaction.findFirst({
    where: { referenceType: "trade", referenceId: tradeId, reason: reason as never },
    include: { entries: { include: { account: true } } },
  });
  if (!transaction) return [];
  return transaction.entries
    .map((entry) => `${entry.account.purpose} ${entry.direction} ${entry.amount.toString()}`)
    .sort();
}

/** A seller with an offer and a buyer, the fixture most tests start from. */
async function pair(sellerUsdt = 100n) {
  const seller = await customer({ usdt: sellerUsdt });
  const buyer = await customer();
  const method = await addMethod(seller.api);
  const offer = await sellOffer(seller.api, method.id);
  return { seller, buyer, method, offer };
}

async function opened(amountUsdt = 40n) {
  const fixture = await pair();
  const response = await take(fixture.buyer.api, {
    offerId: fixture.offer.id,
    amount: (amountUsdt * USDT).toString(),
  }).expect(201);
  return { ...fixture, trade: response.body as TradeView };
}

/* --------------------------------------------------------------- opening */

describe("opening a trade", () => {
  it("locks the seller's USDT in escrow and snapshots where to pay (JE-3)", async () => {
    const { seller, buyer, offer } = await pair();

    const response = await take(buyer.api, {
      offerId: offer.id,
      amount: (40n * USDT).toString(),
    }).expect(201);
    const trade = response.body as TradeView;

    expect(trade.role).toBe("BUYER");
    expect(trade.status).toBe("AWAITING_FIAT_PAYMENT");
    expect(trade.amount).toBe((40n * USDT).toString());
    // 40 USDT at 158.50 = 6,340.00 ETB
    expect(trade.fiatSantim).toBe("634000");
    expect(trade.priceSantim).toBe("15850");
    expect(trade.fee).toBe("0");
    expect(trade.buyerReceives).toBe((40n * USDT).toString());
    expect(trade.payment.kind).toBe("TELEBIRR");
    expect(trade.payment.instructions?.accountNumber).toBe("0912345678");
    expect(trade.payment.instructions?.accountHolder).toBe("Abebe Bikila");
    expect(trade.counterparty.userId).toBe(seller.userId);
    expect(trade.actions).toMatchObject({
      canMarkPaid: true,
      canCancel: true,
      canRelease: false,
      canDispute: false,
      canChat: true,
    });
    expect(new Date(trade.paymentDeadline).getTime()).toBeGreaterThan(Date.now() + 25 * 60_000);

    expect(await available(seller.userId)).toBe(60n * USDT);
    expect(await escrow(trade.id)).toBe(40n * USDT);
    expect(await legs(trade.id, "ESCROW_LOCKED")).toEqual([
      "AVAILABLE DEBIT 40000000",
      "ESCROW CREDIT 40000000",
    ]);

    const mine = await seller.api.get(`/v1/offers/${offer.id}/mine`).expect(200);
    expect(mine.body.remainingAmount).toBe((60n * USDT).toString());

    // The seller's side of the same trade.
    const theirs = await seller.api.get(`/v1/trades/${trade.id}`).expect(200);
    expect(theirs.body.role).toBe("SELLER");
    expect(theirs.body.counterparty.userId).toBe(buyer.userId);
    expect(theirs.body.actions).toMatchObject({
      canMarkPaid: false,
      canCancel: false,
      canRelease: false,
    });

    // Told, in the app and by email, in the same transaction as the trade.
    const notice = await db.notification.findFirst({
      where: { userId: seller.userId, type: "TRADE_OPENED" },
    });
    expect(notice?.link).toBe(`/orders/${trade.id}`);
    const mail = await db.outboxEvent.count({
      where: { type: "email.send", payload: { path: ["to"], equals: seller.email } },
    });
    expect(mail).toBe(1);

    // The wallet's third figure: the seller's escrowed money is still theirs.
    const balance = await seller.api.get("/v1/wallet/balance").expect(200);
    expect(balance.body).toMatchObject({
      available: (60n * USDT).toString(),
      escrowed: (40n * USDT).toString(),
      total: (100n * USDT).toString(),
    });
  });

  it("takes a BUY offer from the selling side, funding the escrow from the taker", async () => {
    const advertiser = await customer();
    const taker = await customer({ usdt: 50n });
    const method = await addMethod(taker.api);
    const offer = await advertiser.api
      .post("/v1/offers", {
        side: "BUY",
        priceSantim: "16000",
        totalAmount: (30n * USDT).toString(),
        minSantim: "1000",
        maxSantim: "1000000",
        paymentWindowMinutes: 15,
        paymentKinds: ["TELEBIRR"],
      })
      .expect(201);

    const noMethod = await take(taker.api, {
      offerId: offer.body.id,
      amount: (10n * USDT).toString(),
    }).expect(400);
    expect(noMethod.body.error.details[0].path).toBe("paymentMethodId");

    const response = await take(taker.api, {
      offerId: offer.body.id,
      amount: (10n * USDT).toString(),
      paymentMethodId: method.id,
    }).expect(201);
    const trade = response.body as TradeView;
    expect(trade.role).toBe("SELLER");
    expect(trade.offerSide).toBe("BUY");
    expect(await available(taker.userId)).toBe(40n * USDT);
    expect(await escrow(trade.id)).toBe(10n * USDT);

    const buyerSide = await advertiser.api.get(`/v1/trades/${trade.id}`).expect(200);
    expect(buyerSide.body.role).toBe("BUYER");
    expect(buyerSide.body.payment.instructions.accountNumber).toBe("0912345678");
    expect(buyerSide.body.actions.canMarkPaid).toBe(true);
  });

  it("works the pair out from either side and refuses what the offer does not take", async () => {
    const { buyer, offer } = await pair();

    const byBirr = await take(buyer.api, { offerId: offer.id, fiatSantim: "100000" }).expect(201);
    // 1,000 ETB at 158.50 buys 6.309148 USDT, worth 999.99958 ETB - never more than typed.
    expect(byBirr.body.amount).toBe("6309148");
    expect(byBirr.body.fiatSantim).toBe("100000");

    const both = await take(buyer.api, {
      offerId: offer.id,
      amount: "1000000",
      fiatSantim: "100000",
    }).expect(400);
    expect(both.body.error.details[0].path).toBe("amount");

    // Under the offer's minimum of 10 ETB: 0.05 USDT is 7.93 ETB.
    const tiny = await take(buyer.api, { offerId: offer.id, amount: "50000" }).expect(400);
    expect(tiny.body.error.details[0].path).toBe("amount");

    // More than remains (110 USDT is 17,435 ETB: inside the limits, over what is left).
    const tooMuch = await take(buyer.api, {
      offerId: offer.id,
      amount: (110n * USDT).toString(),
    }).expect(400);
    expect(tooMuch.body.error.details[0].message).toMatch(/left on this offer/i);

    await request(server())
      .post("/v1/trades")
      .set("Cookie", buyer.cookie)
      .set("x-csrf-token", csrfFor(buyer.cookie))
      .send({ offerId: offer.id, offerRevision: 1, amount: "1000000" })
      .expect(400);
  });

  it("cannot take one's own offer", async () => {
    const { seller, offer } = await pair();
    const own = await take(seller.api, { offerId: offer.id, amount: "1000000" }).expect(409);
    expect(own.body.error.message).toMatch(/your own/i);
  });

  it("keeps a taker inside their daily ceiling and the open-trade cap", async () => {
    const seller = await customer({ usdt: 500n });
    const method = await addMethod(seller.api);
    const offer = await sellOffer(seller.api, method.id, {
      totalAmount: (500n * USDT).toString(),
      maxSantim: "100000000",
    });

    const unverified = await customer({ verified: false });
    const over = await take(unverified.api, {
      offerId: offer.id,
      amount: (150n * USDT).toString(),
    }).expect(400);
    expect(over.body.error.details[0].message).toMatch(/daily trading limit/i);

    const buyer = await customer();
    for (let i = 0; i < env.TRADE_MAX_OPEN_PER_USER; i++) {
      await take(buyer.api, { offerId: offer.id, amount: (1n * USDT).toString() }).expect(201);
    }
    const capped = await take(buyer.api, {
      offerId: offer.id,
      amount: (1n * USDT).toString(),
    }).expect(409);
    expect(capped.body.error.message).toMatch(/trades open/i);
  });

  it("answers a repeated Idempotency-Key with the same trade", async () => {
    const { buyer, seller, offer } = await pair();
    const key = uniq("key");
    const first = await take(buyer.api, { offerId: offer.id, amount: "5000000" }, key).expect(201);
    const again = await take(buyer.api, { offerId: offer.id, amount: "5000000" }, key).expect(201);
    expect(again.body.id).toBe(first.body.id);
    expect(await available(seller.userId)).toBe(95n * USDT);
    const changed = await take(buyer.api, { offerId: offer.id, amount: "6000000" }, key).expect(
      409,
    );
    expect(changed.body.error.code).toBe("CONFLICT");
  });

  it("refuses to open at a price the taker never saw, and keeps the offer whole", async () => {
    const { seller, buyer, offer } = await pair();
    // The advertiser's edit lands between the taker's look and their take,
    // committed outside the trade's transaction, as a real one would be - and
    // written straight to the row here, so the ad's version does not move. The
    // price is compared under the lock as well as the version, so even an edit
    // that never went through the service cannot sell at a number nobody saw.
    const reserve = offers.reserve.bind(offers);
    jest.spyOn(offers, "reserve").mockImplementationOnce(async (tx, id, amount) => {
      await db.offer.update({ where: { id }, data: { priceSantim: 16000n } });
      return reserve(tx, id, amount);
    });

    const stale = await take(buyer.api, {
      offerId: offer.id,
      amount: (10n * USDT).toString(),
    }).expect(409);
    expect(stale.body.error.code).toBe("OFFER_CHANGED");
    expect(await available(seller.userId)).toBe(100n * USDT);
    const mine = await seller.api.get(`/v1/offers/${offer.id}/mine`).expect(200);
    expect(mine.body).toMatchObject({
      priceSantim: "16000",
      remainingAmount: (100n * USDT).toString(),
    });

    // Looked at again, at the new price, it opens: 10 USDT at 160.00 is 1,600.00 ETB.
    const fresh = await take(buyer.api, {
      offerId: offer.id,
      amount: (10n * USDT).toString(),
    }).expect(201);
    expect(fresh.body).toMatchObject({ priceSantim: "16000", fiatSantim: "160000" });
  });

  it("is invisible to anyone who is not a party (AT-6)", async () => {
    const { trade } = await opened();
    const stranger = await customer();
    await stranger.api.get(`/v1/trades/${trade.id}`).expect(404);
    await stranger.api.get(`/v1/trades/${trade.id}/events`).expect(404);
    await stranger.api.post(`/v1/trades/${trade.id}/paid`).expect(404);
    await stranger.api.post(`/v1/trades/${trade.id}/cancel`).expect(404);
    await stranger.api.post(`/v1/trades/${trade.id}/release`, { password: PASSWORD }).expect(404);
    const list = await stranger.api.get("/v1/trades?scope=open").expect(200);
    expect(list.body.trades).toEqual([]);
  });
});

/* ------------------------------------------------------- paid, released */

describe("paying and releasing", () => {
  it("marking paid moves no money, however often, and no timer can finish it (AT-4)", async () => {
    const { seller, buyer, trade } = await opened();

    const other = await seller.api.post(`/v1/trades/${trade.id}/paid`).expect(403);
    expect(other.body.error.message).toMatch(/buyer/i);

    const paid = await buyer.api
      .post(`/v1/trades/${trade.id}/paid`, { reference: "FT2409/1123" })
      .expect(200);
    expect(paid.body.status).toBe("BUYER_MARKED_PAID");
    expect(paid.body.paidAt).toEqual(expect.any(String));
    expect(paid.body.payment.reference).toBe("FT2409/1123");
    expect(paid.body.actions).toMatchObject({ canMarkPaid: false, canCancel: false });

    for (let i = 0; i < 3; i++) {
      await buyer.api.post(`/v1/trades/${trade.id}/paid`).expect(409);
    }

    const postings = await db.ledgerTransaction.count({
      where: { referenceType: "trade", referenceId: trade.id },
    });
    expect(postings).toBe(1);
    expect(await escrow(trade.id)).toBe(40n * USDT);
    expect(await available(buyer.userId)).toBe(0n);

    // The expirer runs past the deadline and finds nothing it may touch.
    await db.trade.update({
      where: { id: trade.id },
      data: { paymentDeadline: new Date(Date.now() - 60_000) },
    });
    expect(await trades.expireDue()).toBe(0);
    const still = await buyer.api.get(`/v1/trades/${trade.id}`).expect(200);
    expect(still.body.status).toBe("BUYER_MARKED_PAID");

    // And by inspection of the table itself: nothing leads out of the paid
    // state but a release or a dispute, both of which need a person.
    expect(TRADE_TRANSITIONS.BUYER_MARKED_PAID).toEqual(["COMPLETED", "DISPUTED"]);
    expect(TRADE_TRANSITIONS.AWAITING_FIAT_PAYMENT).not.toContain("COMPLETED");

    const seen = await db.notification.findFirst({
      where: { userId: seller.userId, type: "TRADE_PAID" },
    });
    expect(seen).not.toBeNull();
  });

  it("releases to the buyer exactly once, with the seller's password (AT-5, JE-4)", async () => {
    const { seller, buyer, trade } = await opened();
    await buyer.api.post(`/v1/trades/${trade.id}/paid`).expect(200);

    await buyer.api.post(`/v1/trades/${trade.id}/release`, { password: PASSWORD }).expect(403);
    const wrong = await seller.api
      .post(`/v1/trades/${trade.id}/release`, { password: "not it" })
      .expect(400);
    expect(wrong.body.error.details[0].path).toBe("password");
    expect(await escrow(trade.id)).toBe(40n * USDT);

    const released = await seller.api
      .post(`/v1/trades/${trade.id}/release`, { password: PASSWORD })
      .expect(200);
    expect(released.body.status).toBe("COMPLETED");
    expect(released.body.closedAt).toEqual(expect.any(String));

    expect(await legs(trade.id, "ESCROW_RELEASED")).toEqual([
      "AVAILABLE CREDIT 40000000",
      "ESCROW DEBIT 40000000",
      "TRADE_FEES CREDIT 0",
    ]);
    expect(await escrow(trade.id)).toBe(0n);
    expect(await available(buyer.userId)).toBe(40n * USDT);
    expect(await available(seller.userId)).toBe(60n * USDT);

    // Again, sequentially: a typed refusal, never a second credit.
    const again = await seller.api
      .post(`/v1/trades/${trade.id}/release`, { password: PASSWORD })
      .expect(409);
    expect(again.body.error.code).toBe("CONFLICT");
    expect(await available(buyer.userId)).toBe(40n * USDT);

    // The buyer's view no longer shows where they paid; the seller's still does.
    const buyerView = await buyer.api.get(`/v1/trades/${trade.id}`).expect(200);
    expect(buyerView.body.payment.instructions).toBeNull();
    expect(buyerView.body.message).toMatch(/available balance/i);
    const sellerView = await seller.api.get(`/v1/trades/${trade.id}`).expect(200);
    expect(sellerView.body.payment.instructions.accountNumber).toBe("0912345678");

    const stats = await db.traderStats.findUniqueOrThrow({ where: { userId: seller.userId } });
    expect(stats).toMatchObject({ tradesTotal: 1, tradesCompleted: 1, releaseCount: 1 });
    // Both parties get a record of it: the credit for the buyer, the receipt
    // for the seller. Each links to the trade.
    const credited = await db.notification.findFirst({
      where: { userId: buyer.userId, type: "TRADE_RELEASED" },
    });
    expect(credited).toMatchObject({ title: "USDT received", link: `/orders/${trade.id}` });
    const receipt = await db.notification.findFirst({
      where: { userId: seller.userId, type: "TRADE_RELEASED" },
    });
    expect(receipt).toMatchObject({ title: "USDT sent", link: `/orders/${trade.id}` });

    const events = await buyer.api.get(`/v1/trades/${trade.id}/events`).expect(200);
    const timeline = events.body.events as { kind: string; actor: string }[];
    expect(timeline.map((e) => `${e.kind}:${e.actor}`)).toEqual([
      "CREATED:ME",
      "MARKED_PAID:ME",
      "RELEASED:COUNTERPARTY",
    ]);
  });

  it("releases exactly once under concurrent requests (AT-5)", async () => {
    const { seller, buyer, trade } = await opened();
    await buyer.api.post(`/v1/trades/${trade.id}/paid`).expect(200);

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        seller.api.post(`/v1/trades/${trade.id}/release`, { password: PASSWORD }),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409, 409, 409, 409]);

    const releases = await db.ledgerTransaction.count({
      where: { referenceType: "trade", referenceId: trade.id, reason: "ESCROW_RELEASED" },
    });
    expect(releases).toBe(1);
    expect(await available(buyer.userId)).toBe(40n * USDT);
    expect(await escrow(trade.id)).toBe(0n);
  });
});

/* -------------------------------------------------- cancelled, expired */

describe("giving the escrow back", () => {
  it("a buyer's cancellation refunds the seller once and reverses the lock (AT-7, JE-5)", async () => {
    const { seller, buyer, offer, trade } = await opened();

    const notSeller = await seller.api.post(`/v1/trades/${trade.id}/cancel`).expect(403);
    expect(notSeller.body.error.message).toMatch(/buyer/i);

    const cancelled = await buyer.api
      .post(`/v1/trades/${trade.id}/cancel`, { reason: "Changed my mind" })
      .expect(200);
    expect(cancelled.body.status).toBe("CANCELLED");
    expect(cancelled.body.closeReason).toMatch(/Changed my mind/);

    expect(await legs(trade.id, "ESCROW_REFUNDED_CANCELLED")).toEqual([
      "AVAILABLE CREDIT 40000000",
      "ESCROW DEBIT 40000000",
    ]);
    const refund = await db.ledgerTransaction.findFirstOrThrow({
      where: { referenceType: "trade", referenceId: trade.id, reason: "ESCROW_REFUNDED_CANCELLED" },
    });
    const lock = await db.ledgerTransaction.findFirstOrThrow({
      where: { referenceType: "trade", referenceId: trade.id, reason: "ESCROW_LOCKED" },
    });
    expect(refund.reversesTransactionId).toBe(lock.id);
    expect(await escrow(trade.id)).toBe(0n);
    expect(await available(seller.userId)).toBe(100n * USDT);

    const mine = await seller.api.get(`/v1/offers/${offer.id}/mine`).expect(200);
    expect(mine.body.remainingAmount).toBe((100n * USDT).toString());

    await buyer.api.post(`/v1/trades/${trade.id}/cancel`).expect(409);
    await buyer.api.post(`/v1/trades/${trade.id}/paid`).expect(409);
    expect(await trades.expireDue()).toBe(0);
    expect(await available(seller.userId)).toBe(100n * USDT);

    const failed = await db.traderStats.findUniqueOrThrow({ where: { userId: buyer.userId } });
    expect(failed).toMatchObject({ tradesTotal: 1, tradesFailed: 1 });
    const closed = await buyer.api.get("/v1/trades?scope=closed").expect(200);
    expect((closed.body.trades as TradeView[]).map((t) => t.id)).toEqual([trade.id]);
  });

  it("the expirer refunds an unpaid trade once and is a no-op after (AT-7)", async () => {
    const { seller, buyer, offer, trade } = await opened();

    expect(await trades.expireDue()).toBe(0);
    await db.trade.update({
      where: { id: trade.id },
      data: { paymentDeadline: new Date(Date.now() - 1_000) },
    });
    expect(await trades.expireDue()).toBe(1);
    expect(await trades.expireDue()).toBe(0);

    const view = await buyer.api.get(`/v1/trades/${trade.id}`).expect(200);
    expect(view.body.status).toBe("EXPIRED");
    expect(view.body.message).toMatch(/ran out/i);
    expect(await legs(trade.id, "ESCROW_REFUNDED_EXPIRY")).toEqual([
      "AVAILABLE CREDIT 40000000",
      "ESCROW DEBIT 40000000",
    ]);
    expect(await escrow(trade.id)).toBe(0n);
    expect(await available(seller.userId)).toBe(100n * USDT);
    const mine = await seller.api.get(`/v1/offers/${offer.id}/mine`).expect(200);
    expect(mine.body.remainingAmount).toBe((100n * USDT).toString());

    for (const userId of [buyer.userId, seller.userId]) {
      const told = await db.notification.findFirst({ where: { userId, type: "TRADE_EXPIRED" } });
      expect(told).not.toBeNull();
    }
    await buyer.api.post(`/v1/trades/${trade.id}/paid`).expect(409);
  });

  it("the worker's pass gives its lock back, and leaves another worker's alone", async () => {
    const { trade } = await opened();
    await db.trade.update({
      where: { id: trade.id },
      data: { paymentDeadline: new Date(Date.now() - 1_000) },
    });
    const redis = app.get(RedisService);
    const expirer = new TradeExpirer(redis, trades, await app.resolve(PinoLogger));

    await redis.client.del(EXPIRER_LOCK_KEY);
    expect(await expirer.tick()).toBeGreaterThanOrEqual(1);
    const row = await db.trade.findUniqueOrThrow({ where: { id: trade.id } });
    expect(row.status).toBe("EXPIRED");
    // Given back as the pass ends, not when the TTL runs out.
    expect(await redis.client.exists(EXPIRER_LOCK_KEY)).toBe(0);
    expect(await expirer.tick()).toBe(0);

    // Another worker's lock is neither taken nor deleted.
    await redis.client.set(EXPIRER_LOCK_KEY, "another worker", "PX", 5_000);
    expect(await expirer.tick()).toBeNull();
    expect(await redis.client.get(EXPIRER_LOCK_KEY)).toBe("another worker");
    await redis.client.del(EXPIRER_LOCK_KEY);
  });

  /*
    The invariant itself lives in test/ledger-invariants.ts, which checks
    every trade in the database after every test in the project rather than
    this file's own trades at the end of this file. What is left to prove
    here is that the hook had something to look at: a run that made no
    settled trade would pass it without meaning anything.
  */
  it("leaves every settled trade's escrow at exactly zero (AT-14)", async () => {
    const rows = await db.$queryRaw<
      { id: string; status: string; amount: bigint; balance: bigint }[]
    >`
      SELECT t.id, t.status::text AS status, t.amount, COALESCE(b.balance, 0) AS balance
        FROM trades t
        LEFT JOIN ledger_accounts a ON a.code = 'LIAB:TRADE:' || t.id || ':USDT:ESCROW'
        LEFT JOIN ledger_account_balances b ON b.account_id = a.id
       WHERE t.correlation_id LIKE ${`test-${run}-%`}`;

    const seen = new Set(rows.map((row) => row.status));
    expect([...seen].some((status) => SETTLED.includes(status as (typeof SETTLED)[number]))).toBe(
      true,
    );
    expect([...seen].some((status) => OPEN.includes(status as (typeof OPEN)[number]))).toBe(true);
    for (const row of rows) {
      const settled = SETTLED.includes(row.status as (typeof SETTLED)[number]);
      expect(row.balance).toBe(settled ? 0n : row.amount);
    }
  });
});

/* ----------------------------------------------------------- concurrency */

describe("concurrency", () => {
  it("two takers cannot lock the same USDT (AT-2)", async () => {
    const seller = await customer({ usdt: 100n });
    const method = await addMethod(seller.api);
    const offer = await sellOffer(seller.api, method.id, {
      totalAmount: (10_000n * USDT).toString(),
      maxSantim: "100000000",
    });
    const first = await customer();
    const second = await customer();

    // "Repeat >= 50 times to catch interleavings that pass once by luck" - AT-2.
    const ROUNDS = 50;
    for (let round = 0; round < ROUNDS; round++) {
      const [a, b] = await Promise.all([
        take(first.api, { offerId: offer.id, amount: (100n * USDT).toString() }),
        take(second.api, { offerId: offer.id, amount: (100n * USDT).toString() }),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);
      const loser = a.status === 409 ? a : b;
      expect(loser.body.error.code).toBe("INSUFFICIENT_FUNDS");
      expect(await available(seller.userId)).toBe(0n);

      const winner = (a.status === 201 ? a : b).body as TradeView;
      const winnerApi = a.status === 201 ? first.api : second.api;
      expect(await escrow(winner.id)).toBe(100n * USDT);
      await winnerApi.post(`/v1/trades/${winner.id}/cancel`).expect(200);
      expect(await available(seller.userId)).toBe(100n * USDT);
    }

    const escrows = await db.ledgerAccount.count({
      where: {
        scope: "TRADE",
        ownerId: {
          in: (await db.trade.findMany({ where: { offerId: offer.id }, select: { id: true } })).map(
            (t) => t.id,
          ),
        },
      },
    });
    expect(escrows).toBe(ROUNDS);
  }, 180_000);

  /*
    Eight rounds rather than AT-2's fifty, and the reason is the customer's
    own daily withdrawal ceiling: every round the withdrawal wins consumes
    100 USDT of a 2,000 USDT tier limit that no test may raise, and a round
    refused by the ceiling would be a race nobody ran. Eight is what fits
    with room to spare, and it is eight more than this test used to run.
  */
  it("a withdrawal and a trade started together cannot overspend (AT-3)", async () => {
    const seller = await customer({ usdt: 100n });
    const method = await addMethod(seller.api);
    const offer = await sellOffer(seller.api, method.id, {
      totalAmount: (10_000n * USDT).toString(),
    });
    const buyer = await customer();

    // Everything the seller holds in any form. It grows only when a
    // withdrawal wins, because an authorised withdrawal cannot be handed back.
    let stake = 100n * USDT;

    for (let round = 0; round < 8; round++) {
      const [withdrawal, trade] = await Promise.all([
        seller.api.post(
          "/v1/wallet/withdrawals",
          {
            network: "BSC",
            amount: (100n * USDT).toString(),
            destination: OUTSIDE,
            password: PASSWORD,
          },
          uniq("key"),
        ),
        take(buyer.api, { offerId: offer.id, amount: (100n * USDT).toString() }),
      ]);

      // Exactly one of the two got the money, and the loser was refused for
      // the right reason rather than by some other rule.
      expect([withdrawal.status, trade.status].sort()).toEqual([201, 409]);
      const loser = withdrawal.status === 409 ? withdrawal : trade;
      expect(loser.body.error.code).toBe("INSUFFICIENT_FUNDS");

      const [free, held, locked] = await Promise.all([
        available(seller.userId),
        pending(seller.userId),
        trades.escrowedFor(seller.userId),
      ]);
      expect(free).toBe(0n);
      expect(free + held + locked).toBe(stake);

      /*
        Put the seller back to exactly 100 available for the next round. A
        trade can be cancelled, which returns the escrow; an approved
        withdrawal cannot be - it is already authorised, and only the
        processor or an administrator moves it - so that 100 stays held for
        good and the seller is funded again instead.
      */
      if (trade.status === 201) {
        const won = trade.body as TradeView;
        await buyer.api.post(`/v1/trades/${won.id}/cancel`).expect(200);
      } else {
        await fund(seller.userId, 100n);
        stake += 100n * USDT;
      }
      expect(await available(seller.userId)).toBe(100n * USDT);
    }
  }, 180_000);

  // Sixty requests serialised on one offer row run close to the default thirty seconds.
  it("takes and cancels on one offer at the same time, and nothing waits on anything", async () => {
    const seller = await customer({ usdt: 1_000n });
    const method = await addMethod(seller.api);
    const offer = await sellOffer(seller.api, method.id, {
      totalAmount: (1_000n * USDT).toString(),
      maxSantim: "100000000",
    });
    const buyers: Api[] = [];
    for (let i = 0; i < 6; i++) buyers.push((await customer()).api);

    // Opening takes the offer and then the seller's balance. A refund that
    // took them the other way round could deadlock with a take on the same
    // offer, and six people doing both at once is how that shows: as a 500.
    // Every answer is collected first and judged after, so that a failure
    // cannot send this test into afterAll while requests are still running.
    const answers: number[] = [];
    const churn = async (who: Api) => {
      for (let round = 0; round < 5; round++) {
        const taken = await take(who, { offerId: offer.id, amount: (10n * USDT).toString() });
        answers.push(taken.status);
        if (taken.status !== 201) return;
        const back = await who.post(`/v1/trades/${(taken.body as TradeView).id}/cancel`);
        answers.push(back.status);
        if (back.status !== 200) return;
      }
    };
    await Promise.all(buyers.map(churn));
    expect(answers.filter((status) => status >= 500)).toEqual([]);
    expect(answers).toHaveLength(60);

    expect(await available(seller.userId)).toBe(1_000n * USDT);
    const mine = await seller.api.get(`/v1/offers/${offer.id}/mine`).expect(200);
    expect(mine.body.remainingAmount).toBe((1_000n * USDT).toString());
  }, 120_000);
});

/* --------------------------------------------------- the ad underneath it */

/*
  An ad is not a contract until somebody takes it, and its owner may edit it,
  take it offline or close it at any moment - including the moment somebody is
  filling in the form in front of it. Two rules hold that together. An order,
  once open, is entirely its own: price, escrow, payment details, deadline and
  the terms it was taken under. And an order is placed against a version of the
  ad, so an ad that moved in the meantime refuses it rather than opening one on
  terms its taker never read.
*/
describe("the ad underneath a trade", () => {
  it("leaves an order already open exactly as it was", async () => {
    const seller = await customer({ usdt: 100n });
    const buyer = await customer();
    const method = await addMethod(seller.api);
    const offer = await sellOffer(seller.api, method.id, { terms: "Bank transfers only." });

    const opened = (
      await take(buyer.api, { offerId: offer.id, amount: (40n * USDT).toString() }).expect(201)
    ).body as TradeView;
    expect(opened.terms).toBe("Bank transfers only.");

    const before = await seller.api.get(`/v1/offers/${offer.id}/mine`).expect(200);
    expect(before.body.openOrders).toBe(1);

    // Everything its owner can change, and then the ad itself, gone.
    const elsewhere = await addMethod(seller.api, {
      kind: "CBE",
      accountHolder: "Abebe Bikila",
      accountNumber: "1000123456789",
    });
    await seller.api
      .patch(`/v1/offers/${offer.id}`, {
        priceSantim: "16500",
        minSantim: "5000",
        maxSantim: "1000000",
        paymentWindowMinutes: 15,
        paymentMethodIds: [elsewhere.id],
        terms: "Everything is different now.",
      })
      .expect(200);
    await seller.api.post(`/v1/offers/${offer.id}/pause`).expect(200);
    await seller.api.post(`/v1/offers/${offer.id}/close`).expect(200);

    const after = await buyer.api.get(`/v1/trades/${opened.id}`).expect(200);
    expect(after.body).toMatchObject({
      status: "AWAITING_FIAT_PAYMENT",
      amount: opened.amount,
      priceSantim: opened.priceSantim,
      fiatSantim: opened.fiatSantim,
      paymentDeadline: opened.paymentDeadline,
      terms: "Bank transfers only.",
    });
    expect(after.body.payment.instructions.accountNumber).toBe("0912345678");

    // And it still finishes, on a closed ad, from both sides.
    await buyer.api.post(`/v1/trades/${opened.id}/paid`).expect(200);
    const released = await seller.api
      .post(`/v1/trades/${opened.id}/release`, { password: PASSWORD })
      .expect(200);
    expect(released.body.status).toBe("COMPLETED");
    const closed = await seller.api.get(`/v1/offers/${offer.id}/mine`).expect(200);
    expect(closed.body.openOrders).toBe(0);
  });

  it("refuses an order placed against a version of the ad its taker never saw", async () => {
    const seller = await customer({ usdt: 100n });
    const buyer = await customer();
    const method = await addMethod(seller.api);
    const second = await addMethod(seller.api, {
      kind: "CBE",
      accountHolder: "Abebe Bikila",
      accountNumber: "1000123456789",
    });
    const offer = await sellOffer(seller.api, method.id);
    expect(offer.revision).toBe(1);

    // What a taker reads before committing, one change at a time.
    const deal: [string, object][] = [
      ["the price", { priceSantim: "16000" }],
      ["the limits", { minSantim: "2000" }],
      ["the time to pay", { paymentWindowMinutes: 15 }],
      ["the terms", { terms: "Read this first." }],
      ["the rails", { paymentMethodIds: [method.id, second.id] }],
      ["who may take it", { requireVerified: true }],
    ];

    let version = 1;
    for (const [what, patch] of deal) {
      const edited = await seller.api.patch(`/v1/offers/${offer.id}`, patch).expect(200);
      version += 1;
      expect([what, edited.body.revision]).toEqual([what, version]);

      const stale = await take(buyer.api, {
        offerId: offer.id,
        amount: (10n * USDT).toString(),
        offerRevision: version - 1,
      }).expect(409);
      expect(stale.body.error.code).toBe("OFFER_CHANGED");
      // Refused before anything was taken off the ad.
      const mine = await seller.api.get(`/v1/offers/${offer.id}/mine`).expect(200);
      expect(mine.body.remainingAmount).toBe(mine.body.totalAmount);
    }

    // The version the taker is actually looking at is the one that works.
    const market = await listed(buyer.api, "BUY");
    expect(market.find((one) => one.id === offer.id)?.revision).toBe(version);
    await take(buyer.api, {
      offerId: offer.id,
      amount: (10n * USDT).toString(),
      offerRevision: version,
    }).expect(201);
  });

  it("moves the version only when the deal moves", async () => {
    const seller = await customer({ usdt: 100n });
    const buyer = await customer();
    const method = await addMethod(seller.api);
    const offer = await sellOffer(seller.api, method.id, { autoReply: "Hello." });
    const version = async (): Promise<number> => {
      const mine = await seller.api.get(`/v1/offers/${offer.id}/mine`).expect(200);
      return (mine.body as OfferView).revision;
    };

    // Somebody else taking part of it.
    const first = await take(buyer.api, {
      offerId: offer.id,
      amount: (10n * USDT).toString(),
    }).expect(201);
    expect(await version()).toBe(1);

    // A trip offline and back.
    await seller.api.post(`/v1/offers/${offer.id}/pause`).expect(200);
    await seller.api.post(`/v1/offers/${offer.id}/resume`).expect(200);
    expect(await version()).toBe(1);

    // What only the advertiser sees: the total behind the ad, the auto-reply.
    await seller.api
      .patch(`/v1/offers/${offer.id}`, {
        totalAmount: (90n * USDT).toString(),
        autoReply: "Hello again.",
      })
      .expect(200);
    expect(await version()).toBe(1);

    // The same figures sent again.
    await seller.api.patch(`/v1/offers/${offer.id}`, { priceSantim: "15850" }).expect(200);
    expect(await version()).toBe(1);

    // A different account of the seller's behind a rail the ad already offers:
    // a taker reads the kind, never which account is behind it.
    const another = await seller.api
      .post(`/v1/payment-methods/${method.id}/replace`, {
        kind: "TELEBIRR",
        accountHolder: "Abebe Bikila",
        phone: "0911111111",
      })
      .expect(200);
    expect(await version()).toBe(1);
    const mine = await seller.api.get(`/v1/offers/${offer.id}/mine`).expect(200);
    expect((mine.body as OfferView).paymentMethods[0]?.paymentMethodId).toBe(another.body.id);

    // The next order is told the new account; the one already open keeps what it showed.
    const later = await customer();
    const next = await take(later.api, {
      offerId: offer.id,
      amount: (5n * USDT).toString(),
    }).expect(201);
    expect(next.body.payment.instructions.accountNumber).toBe("0911111111");
    const still = await buyer.api.get(`/v1/trades/${first.body.id}`).expect(200);
    expect(still.body.payment.instructions.accountNumber).toBe("0912345678");
  });

  it("says an ad taken offline in the moment of ordering is not available", async () => {
    const { buyer, offer } = await pair();
    const offers = app.get(OfferService);
    const reserve = offers.reserve.bind(offers);
    // The ad goes offline inside the transaction, between the check the order
    // began with and the reservation it ends with: the narrowest window there
    // is, and the sentence has to be the right one even there.
    jest.spyOn(offers, "reserve").mockImplementationOnce(async (tx, id, amount) => {
      await tx.offer.update({ where: { id }, data: { status: "PAUSED" } });
      return reserve(tx, id, amount);
    });

    const refused = await take(buyer.api, {
      offerId: offer.id,
      amount: (10n * USDT).toString(),
    }).expect(404);
    expect(refused.body.error.message).toMatch(/not available/i);
  });

  it("cannot be deleted out from under its orders", async () => {
    const { offer, trade } = await opened();
    await expect(db.offer.delete({ where: { id: offer.id } })).rejects.toMatchObject({
      code: "P2003",
    });
    // Still there, with its money and its history.
    expect(await escrow(trade.id)).toBe(40n * USDT);
    await db.trade.findUniqueOrThrow({ where: { id: trade.id } });
  });
});
