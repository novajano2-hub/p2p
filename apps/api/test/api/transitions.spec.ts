import { type OfferView, type TradeView } from "@abay/contracts";
import { createPrismaClient, type PrismaClient } from "@abay/database";
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";

import { createApp } from "@/app";
import { loadEnv, type Env } from "@/config/env";
import { accounts } from "@/modules/ledger/account-code";
import { LedgerService } from "@/modules/ledger/ledger.service";
import { TradeService } from "@/modules/trades/trade.service";

import { csrfFor, PASSWORD, registerFully, uniqueEmail } from "./helpers";

/*
  AT-17's second half: a refused transition writes nothing.

  The machines' own sweeps (trade.machine.spec.ts, offer.transitions.spec.ts
  and the two from Phase 3) prove the table refuses the pairs it should. They
  are pure functions, so they cannot say what the service does around the
  refusal - whether the row moved anyway, whether something was posted before
  the check, whether an event was recorded for a thing that did not happen.

  So each test here takes a trade to a real state, photographs everything
  about it that could change, makes the illegal move over HTTP, and asserts
  the photograph still matches: the same status and the same updatedAt, the
  same number of ledger transactions, the same escrow, the same timeline.
  The wrong-party moves are here too, because to a person losing money there
  is no difference between "the machine refused it" and "the wrong person was
  allowed to do it".
*/

let app: NestFastifyApplication;
let db: PrismaClient;
let env: Env;
let ledger: LedgerService;
let trades: TradeService;
const server = () => app.getHttpServer() as Parameters<typeof request>[0];

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let counter = 0;
const uniq = (label: string) => `test-${run}-${label}-${++counter}`;
const USDT = 1_000_000n;

beforeAll(async () => {
  env = loadEnv();
  app = await createApp(env);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  db = createPrismaClient(env.DATABASE_URL);
  ledger = app.get(LedgerService);
  trades = app.get(TradeService);
});

afterAll(async () => {
  await db.$disconnect();
  await app.close();
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
  };
}
type Api = ReturnType<typeof api>;

async function customer(usdt = 0n) {
  const { cookie, userId } = await registerFully(server(), db, uniqueEmail());
  await db.user.update({ where: { id: userId }, data: { kycStatus: "APPROVED" } });
  if (usdt > 0n) {
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
  return { cookie, userId, api: api(cookie) };
}

/** One seller with 100 USDT on one offer, and a buyer, shared by every case. */
interface Pair {
  seller: { userId: string; api: Api };
  buyer: { userId: string; api: Api };
  offerId: string;
}
let pair: Pair;

beforeAll(async () => {
  const seller = await customer(100n);
  const buyer = await customer();
  const method = await seller.api
    .post("/v1/payment-methods", { kind: "TELEBIRR", accountHolder: "Abebe", phone: "0912345678" })
    .expect(201);
  const offer = await seller.api
    .post("/v1/offers", {
      side: "SELL",
      priceSantim: "15850",
      totalAmount: (100n * USDT).toString(),
      minSantim: "1000",
      maxSantim: "2000000",
      paymentWindowMinutes: 30,
      paymentMethodIds: [method.body.id as string],
    })
    .expect(201);
  pair = { seller, buyer, offerId: (offer.body as OfferView).id };
});

/** A fresh 10 USDT trade on the shared offer. */
async function opened(): Promise<TradeView> {
  const response = await pair.buyer.api
    .post(
      "/v1/trades",
      { offerId: pair.offerId, offerRevision: 1, amount: (10n * USDT).toString() },
      uniq("key"),
    )
    .expect(201);
  return response.body as TradeView;
}

/*
  Everything about a trade that an illegal move might disturb. updatedAt is
  in here deliberately: a service that refuses correctly but touches the row
  on the way has still written, and would show a customer a trade that
  "changed" for no reason.
*/
async function photograph(tradeId: string) {
  const [row, postings, events, escrow] = await Promise.all([
    db.trade.findUniqueOrThrow({
      where: { id: tradeId },
      select: { status: true, updatedAt: true, paidAt: true, closedAt: true },
    }),
    db.ledgerTransaction.count({ where: { referenceType: "trade", referenceId: tradeId } }),
    db.tradeEvent.count({ where: { tradeId } }),
    ledger.balance(accounts.tradeEscrow(tradeId)),
  ]);
  return { row, postings, events, escrow };
}

type Photograph = Awaited<ReturnType<typeof photograph>>;

/** The refused call, and the proof that it cost nothing. */
async function refuses(
  tradeId: string,
  before: Photograph,
  attempt: Promise<request.Response>,
  status: number,
): Promise<void> {
  const response = await attempt;
  expect(response.status).toBe(status);
  expect(await photograph(tradeId)).toEqual(before);
}

/* ---------------------------------------------------------------- tests */

describe("a refused transition writes nothing (AT-17)", () => {
  it("cannot mark a completed trade paid, or pay it twice", async () => {
    const trade = await opened();
    await pair.buyer.api.post(`/v1/trades/${trade.id}/paid`, {}).expect(200);
    await pair.seller.api
      .post(`/v1/trades/${trade.id}/release`, { password: PASSWORD })
      .expect(200);

    const before = await photograph(trade.id);
    expect(before.row.status).toBe("COMPLETED");
    expect(before.escrow).toBe(0n);

    await refuses(trade.id, before, pair.buyer.api.post(`/v1/trades/${trade.id}/paid`, {}), 409);
    await refuses(
      trade.id,
      before,
      pair.seller.api.post(`/v1/trades/${trade.id}/release`, { password: PASSWORD }),
      409,
    );
    await refuses(trade.id, before, pair.buyer.api.post(`/v1/trades/${trade.id}/cancel`, {}), 409);
  });

  it("cannot mark a cancelled trade paid, or cancel it again", async () => {
    const trade = await opened();
    await pair.buyer.api.post(`/v1/trades/${trade.id}/cancel`, {}).expect(200);

    const before = await photograph(trade.id);
    expect(before.row.status).toBe("CANCELLED");
    expect(before.escrow).toBe(0n);

    await refuses(trade.id, before, pair.buyer.api.post(`/v1/trades/${trade.id}/paid`, {}), 409);
    await refuses(trade.id, before, pair.buyer.api.post(`/v1/trades/${trade.id}/cancel`, {}), 409);
  });

  it("cannot release a trade whose time ran out", async () => {
    const trade = await opened();
    await db.trade.update({
      where: { id: trade.id },
      data: { paymentDeadline: new Date(Date.now() - 60_000) },
    });
    // expireDue() is database-wide, so what matters is this trade, not the count.
    await trades.expireDue();
    const before = await photograph(trade.id);
    expect(before.row.status).toBe("EXPIRED");
    expect(before.escrow).toBe(0n);

    await refuses(
      trade.id,
      before,
      pair.seller.api.post(`/v1/trades/${trade.id}/release`, { password: PASSWORD }),
      409,
    );
    await refuses(trade.id, before, pair.buyer.api.post(`/v1/trades/${trade.id}/paid`, {}), 409);
  });

  it("cannot cancel a trade that is under dispute", async () => {
    const trade = await opened();
    await pair.buyer.api.post(`/v1/trades/${trade.id}/paid`, {}).expect(200);
    // The cooldown is time, not state: move the clock rather than the row.
    await db.trade.update({
      where: { id: trade.id },
      data: { paidAt: new Date(Date.now() - 60 * 60_000) },
    });
    await pair.buyer.api
      .post(`/v1/trades/${trade.id}/dispute`, {
        reason: "PAYMENT_NOT_RELEASED",
        description: "Paid an hour ago and nothing has been released to me.",
      })
      .expect(201);

    const before = await photograph(trade.id);
    expect(before.row.status).toBe("DISPUTED");
    expect(before.escrow).toBe(10n * USDT);

    await refuses(trade.id, before, pair.buyer.api.post(`/v1/trades/${trade.id}/cancel`, {}), 409);
    await refuses(trade.id, before, pair.buyer.api.post(`/v1/trades/${trade.id}/paid`, {}), 409);

    // Left as it is on purpose: an open dispute is a legal resting state, and
    // the escrow invariant that runs after every test says so.
  });

  it("will not let either party make the other's move", async () => {
    const trade = await opened();
    const before = await photograph(trade.id);
    expect(before.row.status).toBe("AWAITING_FIAT_PAYMENT");

    // The seller cannot say the buyer paid, and cannot cancel to get out of
    // an offer they no longer like: both would be the wrong hand on the money.
    await refuses(trade.id, before, pair.seller.api.post(`/v1/trades/${trade.id}/paid`, {}), 403);
    await refuses(trade.id, before, pair.seller.api.post(`/v1/trades/${trade.id}/cancel`, {}), 403);
    // And the buyer cannot release the USDT to themselves.
    await refuses(
      trade.id,
      before,
      pair.buyer.api.post(`/v1/trades/${trade.id}/release`, { password: PASSWORD }),
      403,
    );

    await pair.buyer.api.post(`/v1/trades/${trade.id}/cancel`, {}).expect(200);
  });
});
