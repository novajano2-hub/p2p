import { type OfferView, type TradeMessageView, type TradeView } from "@abay/contracts";
import { createPrismaClient, type PrismaClient } from "@abay/database";
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";

import { createApp } from "@/app";
import { loadEnv, type Env } from "@/config/env";
import { accounts } from "@/modules/ledger/account-code";
import { LedgerService } from "@/modules/ledger/ledger.service";

import { csrfFor, fakeJpeg, fakePng, registerFully, uniqueEmail } from "./helpers";

/*
  Phase 4, stage 3: the chat inside a trade, over HTTP.

  A message is a row with a place in one order per trade; the same client
  message id sent twice is one message; reading is tracked per party; an
  image is bytes in the store behind a row; and none of it is reachable by
  anyone who is not one of the two parties (AT-6). The socket that delivers
  these live is covered by realtime.spec.ts.
*/

let app: NestFastifyApplication;
let db: PrismaClient;
let env: Env;
let ledger: LedgerService;
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
    raw: (path: string, contentType: string, body: Buffer) =>
      headers(request(server()).post(path)).set("content-type", contentType).send(body),
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

const AUTO_REPLY = "Thanks! Pay within 30 minutes and put nothing about crypto in the reference.";

/** A seller with an auto-replying offer, a buyer, and a trade between them. */
async function opened() {
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
      paymentMethodIds: [method.body.id],
      autoReply: AUTO_REPLY,
    })
    .expect(201);
  const trade = await buyer.api
    .post(
      "/v1/trades",
      { offerId: (offer.body as OfferView).id, offerRevision: 1, amount: (20n * USDT).toString() },
      uniq("key"),
    )
    .expect(201);
  return { seller, buyer, trade: trade.body as TradeView };
}

const messages = (who: Api, tradeId: string, query = "") =>
  who.get(`/v1/trades/${tradeId}/messages${query}`);

/* ---------------------------------------------------------------- tests */

describe("the trade chat", () => {
  it("opens with the advertiser's auto-reply and numbers every message in one order", async () => {
    const { seller, buyer, trade } = await opened();

    const first = await messages(buyer.api, trade.id).expect(200);
    expect(first.body.lastSeq).toBe(1);
    expect(first.body.open).toBe(true);
    expect(first.body.messages).toHaveLength(1);
    expect(first.body.messages[0]).toMatchObject({
      seq: 1,
      senderId: seller.userId,
      kind: "TEXT",
      body: AUTO_REPLY,
      image: null,
    });

    const sent = await buyer.api
      .post(`/v1/trades/${trade.id}/messages`, {
        clientMessageId: "m-0001-aaaa",
        body: "  Paid via Telebirr, ref 7781  ",
      })
      .expect(201);
    expect(sent.body).toMatchObject({
      seq: 2,
      senderId: buyer.userId,
      body: "Paid via Telebirr, ref 7781",
    });

    // The same client id again is the same message, not a second one.
    const again = await buyer.api
      .post(`/v1/trades/${trade.id}/messages`, { clientMessageId: "m-0001-aaaa", body: "anything" })
      .expect(201);
    expect(again.body.id).toBe(sent.body.id);
    expect(again.body.seq).toBe(2);

    const after = await messages(seller.api, trade.id, "?after=1").expect(200);
    expect((after.body.messages as TradeMessageView[]).map((m) => m.seq)).toEqual([2]);
    expect(after.body.lastSeq).toBe(2);

    // Writing counts as reading your own: the buyer is caught up, the seller is one behind.
    const buyerView = await buyer.api.get(`/v1/trades/${trade.id}`).expect(200);
    expect(buyerView.body.chat).toEqual({ lastSeq: 2, unread: 0 });
    const sellerView = await seller.api.get(`/v1/trades/${trade.id}`).expect(200);
    expect(sellerView.body.chat).toEqual({ lastSeq: 2, unread: 1 });
    expect(first.body.myLastReadSeq).toBe(0);
  });

  it("tracks how far each party has read, never backwards, never past the end", async () => {
    const { seller, buyer, trade } = await opened();
    await buyer.api
      .post(`/v1/trades/${trade.id}/messages`, { clientMessageId: "m-0002-aaaa", body: "hello" })
      .expect(201);

    await seller.api.post(`/v1/trades/${trade.id}/messages/read`, { seq: 2 }).expect(204);
    const asBuyer = await messages(buyer.api, trade.id).expect(200);
    expect(asBuyer.body.theirLastReadSeq).toBe(2);
    expect(asBuyer.body.myLastReadSeq).toBe(2);

    await seller.api.post(`/v1/trades/${trade.id}/messages/read`, { seq: 1 }).expect(204);
    await seller.api.post(`/v1/trades/${trade.id}/messages/read`, { seq: 99 }).expect(204);
    const asSeller = await messages(seller.api, trade.id).expect(200);
    expect(asSeller.body.myLastReadSeq).toBe(2);
    const view = await seller.api.get(`/v1/trades/${trade.id}`).expect(200);
    expect(view.body.chat.unread).toBe(0);
  });

  it("keeps an image as bytes behind a numbered message, for the parties only", async () => {
    const { seller, buyer, trade } = await opened();
    const stranger = await customer();

    const notImage = await buyer.api
      .raw(
        `/v1/trades/${trade.id}/messages/images/img-0001-aaaa`,
        "image/png",
        Buffer.from("not really"),
      )
      .expect(400);
    expect(notImage.body.error.code).toBe("VALIDATION_FAILED");

    const sent = await buyer.api
      .raw(`/v1/trades/${trade.id}/messages/images/img-0002-aaaa`, "image/png", fakePng(2_048))
      .expect(201);
    expect(sent.body).toMatchObject({
      seq: 2,
      kind: "IMAGE",
      body: null,
      image: { contentType: "image/png", sizeBytes: 2_048 },
    });

    // Again with the same client id: the same message, whatever the bytes.
    const again = await buyer.api
      .raw(`/v1/trades/${trade.id}/messages/images/img-0002-aaaa`, "image/jpeg", fakeJpeg())
      .expect(201);
    expect(again.body.id).toBe(sent.body.id);

    const bytes = await seller.api
      .get(`/v1/trades/${trade.id}/messages/${sent.body.id}/image`)
      .expect(200);
    expect(bytes.headers["content-type"]).toMatch(/^image\/png/);
    expect(bytes.body.length).toBe(2_048);

    await stranger.api.get(`/v1/trades/${trade.id}/messages/${sent.body.id}/image`).expect(404);
    // A text message has no image, and says so the same way as a missing one.
    const text = await messages(buyer.api, trade.id).expect(200);
    const auto = (text.body.messages as TradeMessageView[])[0];
    await buyer.api.get(`/v1/trades/${trade.id}/messages/${auto?.id ?? ""}/image`).expect(404);
  });

  it("is invisible to strangers and closes a day after the trade does", async () => {
    const { seller, buyer, trade } = await opened();
    const stranger = await customer();

    await messages(stranger.api, trade.id).expect(404);
    await stranger.api
      .post(`/v1/trades/${trade.id}/messages`, { clientMessageId: "m-0003-aaaa", body: "hi" })
      .expect(404);
    await stranger.api.post(`/v1/trades/${trade.id}/messages/read`, { seq: 1 }).expect(404);

    // Cancelled, and still talking: the money may have crossed anyway.
    await buyer.api.post(`/v1/trades/${trade.id}/cancel`).expect(200);
    await seller.api
      .post(`/v1/trades/${trade.id}/messages`, {
        clientMessageId: "m-0004-aaaa",
        body: "no worries",
      })
      .expect(201);
    expect((await messages(buyer.api, trade.id).expect(200)).body.open).toBe(true);

    // Two days later, read-only.
    await db.trade.update({
      where: { id: trade.id },
      data: { closedAt: new Date(Date.now() - 48 * 3_600_000) },
    });
    const closed = await seller.api
      .post(`/v1/trades/${trade.id}/messages`, { clientMessageId: "m-0005-aaaa", body: "late" })
      .expect(409);
    expect(closed.body.error.message).toMatch(/closed/i);
    const listing = await messages(buyer.api, trade.id).expect(200);
    expect(listing.body.open).toBe(false);
    expect(listing.body.lastSeq).toBe(2);
    const view = await buyer.api.get(`/v1/trades/${trade.id}`).expect(200);
    expect(view.body.actions.canChat).toBe(false);
  });

  it("refuses an empty, an oversized, or an unnumbered message", async () => {
    const { buyer, trade } = await opened();
    await buyer.api
      .post(`/v1/trades/${trade.id}/messages`, { clientMessageId: "m-0006-aaaa", body: "   " })
      .expect(400);
    await buyer.api
      .post(`/v1/trades/${trade.id}/messages`, {
        clientMessageId: "m-0007-aaaa",
        body: "x".repeat(2_001),
      })
      .expect(400);
    await buyer.api
      .post(`/v1/trades/${trade.id}/messages`, { clientMessageId: "no", body: "hello" })
      .expect(400);
    await buyer.api.post(`/v1/trades/${trade.id}/messages`, { body: "hello" }).expect(400);
  });
});
