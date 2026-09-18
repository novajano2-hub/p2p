import { type ClientRequest, type IncomingMessage } from "node:http";

import {
  REALTIME_CLOSE,
  REALTIME_PATH,
  type OfferView,
  type RealtimeServerFrame,
  type TradeView,
} from "@abay/contracts";
import { createPrismaClient, type PrismaClient } from "@abay/database";
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";
import { WebSocket, type RawData } from "ws";

import { createApp } from "@/app";
import { loadEnv, type Env } from "@/config/env";
import { RedisService } from "@/infra/redis/redis.service";
import { accounts } from "@/modules/ledger/account-code";
import { LedgerService } from "@/modules/ledger/ledger.service";
import { RealtimeGateway } from "@/modules/realtime/realtime.gateway";
import { TradeService } from "@/modules/trades/trade.service";

import { csrfFor, PASSWORD, registerFully, uniqueEmail } from "./helpers";

/*
  Phase 4, stage 3: the socket.

  The upgrade is refused with a plain HTTP status unless the session cookie
  is live and the Origin is ours (the WebSocket equivalent of CSRF); a party
  may watch a trade and a stranger is told nothing (AT-6); a message written
  by a POST reaches the other party's socket, as do typing, read markers, a
  trade changing state and a notification; a client that misbehaves is cut
  off; a session ended elsewhere closes the socket; a ninth tab closes the
  first; and shutdown says 1001 to everyone. Nothing here moves money: the
  socket only ever says "go and look".
*/

let app: NestFastifyApplication;
let db: PrismaClient;
let env: Env;
let ledger: LedgerService;
let trades: TradeService;
let gateway: RealtimeGateway;
let origin: string;
let wsBase: string;
let appClosed = false;
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
  // A socket needs a real port: supertest listens per request, a WebSocket cannot.
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  const port = address && typeof address === "object" ? address.port : 0;
  wsBase = `ws://127.0.0.1:${port}`;
  origin = env.CORS_ORIGINS[0] ?? "http://localhost:3000";
  db = createPrismaClient(env.DATABASE_URL);
  ledger = app.get(LedgerService);
  trades = app.get(TradeService);
  gateway = app.get(RealtimeGateway);
});

afterAll(async () => {
  await db.$disconnect();
  if (!appClosed) await app.close();
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

/** A seller with an auto-replying offer, a buyer, and a trade between them. */
async function opened() {
  const seller = await customer(200n);
  const buyer = await customer();
  const method = await seller.api
    .post("/v1/payment-methods", { kind: "TELEBIRR", accountHolder: "Abebe", phone: "0912345678" })
    .expect(201);
  const offer = await seller.api
    .post("/v1/offers", {
      side: "SELL",
      priceSantim: "15850",
      totalAmount: (200n * USDT).toString(),
      minSantim: "1000",
      maxSantim: "2000000",
      paymentWindowMinutes: 30,
      paymentMethodIds: [method.body.id],
      autoReply: "Thanks! Pay within 30 minutes.",
    })
    .expect(201);
  const trade = await take(buyer.api, (offer.body as OfferView).id);
  return { seller, buyer, offer: offer.body as OfferView, trade };
}

async function take(who: Api, offerId: string): Promise<TradeView> {
  const response = await who
    .post("/v1/trades", { offerId, offerRevision: 1, amount: (20n * USDT).toString() }, uniq("key"))
    .expect(201);
  return response.body as TradeView;
}

type FrameOf<T extends RealtimeServerFrame["type"]> = Extract<RealtimeServerFrame, { type: T }>;

/** One socket, with what it has been sent kept until a test asks for it. */
class Tab {
  readonly frames: RealtimeServerFrame[] = [];
  readonly closed: Promise<{ code: number; reason: string }>;
  private waiters: { type: string; give: (frame: RealtimeServerFrame) => void }[] = [];

  constructor(readonly ws: WebSocket) {
    this.closed = new Promise((resolve) => {
      ws.on("close", (code: number, reason: Buffer) => {
        resolve({ code, reason: reason.toString() });
      });
    });
    ws.on("message", (data: RawData) => {
      const frame = JSON.parse(rawToString(data)) as RealtimeServerFrame;
      const waiting = this.waiters.findIndex((waiter) => waiter.type === frame.type);
      if (waiting >= 0) {
        const [waiter] = this.waiters.splice(waiting, 1);
        waiter?.give(frame);
        return;
      }
      this.frames.push(frame);
    });
  }

  /** The next frame of this type: one already received, or the first to arrive within the timeout. */
  next<T extends RealtimeServerFrame["type"]>(type: T, timeoutMs = 4_000): Promise<FrameOf<T>> {
    const queued = this.frames.findIndex((frame) => frame.type === type);
    if (queued >= 0) {
      const [frame] = this.frames.splice(queued, 1);
      return Promise.resolve(frame as FrameOf<T>);
    }
    return new Promise((resolve, reject) => {
      const give = (frame: RealtimeServerFrame) => {
        clearTimeout(timer);
        resolve(frame as FrameOf<T>);
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((waiter) => waiter.give !== give);
        reject(new Error(`no "${type}" frame arrived within ${timeoutMs} ms`));
      }, timeoutMs);
      this.waiters.push({ type, give });
    });
  }

  /** Waits a moment and asserts that no frame of this type arrived. */
  async none(type: RealtimeServerFrame["type"], ms = 400): Promise<void> {
    await sleep(ms);
    expect(this.frames.filter((frame) => frame.type === type)).toEqual([]);
  }

  send(frame: unknown): void {
    this.ws.send(typeof frame === "string" ? frame : JSON.stringify(frame));
  }

  sendBinary(bytes: Buffer): void {
    this.ws.send(bytes, { binary: true });
  }

  async close(): Promise<void> {
    if (this.ws.readyState === WebSocket.CLOSED) return;
    this.ws.close();
    await this.closed;
  }
}

class UpgradeRefused extends Error {
  constructor(readonly status: number) {
    super(`the upgrade was refused with ${status}`);
  }
}

function connect(headers: Record<string, string>, path = REALTIME_PATH): Promise<Tab> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBase}${path}`, { headers });
    ws.once("unexpected-response", (req: ClientRequest, res: IncomingMessage) => {
      req.destroy();
      reject(new UpgradeRefused(res.statusCode ?? 0));
    });
    ws.once("error", reject);
    ws.once("open", () => {
      resolve(new Tab(ws));
    });
  });
}

/** The HTTP status the upgrade was refused with, or -1 if it was accepted. */
async function refused(headers: Record<string, string>, path = REALTIME_PATH): Promise<number> {
  try {
    const tab = await connect(headers, path);
    await tab.close();
    return -1;
  } catch (error) {
    if (error instanceof UpgradeRefused) return error.status;
    throw error;
  }
}

async function open(cookie: string): Promise<Tab> {
  const tab = await connect({ cookie, origin });
  await tab.next("hello");
  return tab;
}

async function watch(tab: Tab, tradeId: string): Promise<FrameOf<"subscribed">> {
  tab.send({ type: "subscribe", tradeId });
  return tab.next("subscribed");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function rawToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}

/* ---------------------------------------------------------------- tests */

describe("the door", () => {
  it("refuses the upgrade without a session, from a foreign origin, and off its path", async () => {
    const who = await customer();
    expect(await refused({ origin })).toBe(401);
    expect(await refused({ cookie: "birq_session=not-a-session", origin })).toBe(401);
    expect(await refused({ cookie: who.cookie, origin: "https://evil.example" })).toBe(403);
    expect(await refused({ cookie: who.cookie, origin }, "/v1/somewhere-else")).toBe(404);

    // A browser tab from our own origin is let in and greeted by name.
    const tab = await connect({ cookie: who.cookie, origin });
    const hello = await tab.next("hello");
    expect(hello.userId).toBe(who.userId);
    expect(hello.heartbeatSeconds).toBe(30);
    expect(gateway.connections).toBeGreaterThanOrEqual(1);
    await tab.close();

    // A client that sends no Origin is not a browser; the cookie is then the
    // whole credential, exactly as it is over HTTP.
    const bare = await connect({ cookie: who.cookie });
    expect((await bare.next("hello")).userId).toBe(who.userId);
    await bare.close();
  });

  it("closes a socket whose session has ended (4001), on the next check", async () => {
    const who = await customer();
    const tab = await open(who.cookie);
    await who.api.post("/v1/auth/logout").expect(204);
    await gateway.revalidate();
    expect((await tab.closed).code).toBe(REALTIME_CLOSE.SESSION_ENDED);
    // And the session is over for the upgrade too.
    expect(await refused({ cookie: who.cookie, origin })).toBe(401);
  });

  it("keeps eight tabs open and closes the oldest for a ninth (4002)", async () => {
    const who = await customer();
    const first = await open(who.cookie);
    const others: Tab[] = [];
    for (let i = 0; i < 7; i++) others.push(await open(who.cookie));
    const ninth = await open(who.cookie);
    expect((await first.closed).code).toBe(REALTIME_CLOSE.TOO_MANY_CONNECTIONS);
    for (const tab of [...others, ninth]) await tab.close();
  });
});

describe("watching a trade", () => {
  it("lets a party subscribe, tells a stranger nothing, and drops a client that will not speak the protocol", async () => {
    const { buyer, trade } = await opened();
    const stranger = await customer();

    const mine = await open(buyer.cookie);
    // The auto-reply is message 1, so a client knows at once what it has to fetch.
    expect(await watch(mine, trade.id)).toEqual({
      type: "subscribed",
      tradeId: trade.id,
      lastSeq: 1,
    });
    mine.send({ type: "unsubscribe", tradeId: trade.id });
    expect(await mine.next("unsubscribed")).toEqual({ type: "unsubscribed", tradeId: trade.id });
    mine.send({ type: "ping" });
    expect(await mine.next("pong")).toEqual({ type: "pong" });
    await mine.close();

    const theirs = await open(stranger.cookie);
    theirs.send({ type: "subscribe", tradeId: trade.id });
    expect((await theirs.next("error")).code).toBe("not_found");
    theirs.send({ type: "subscribe", tradeId: "00000000-0000-7000-8000-000000000000" });
    expect((await theirs.next("error")).code).toBe("not_found");

    // Three bad frames and the connection is over (1008).
    theirs.send("this is not json");
    expect((await theirs.next("error")).code).toBe("bad_frame");
    theirs.send({ type: "dance", tradeId: trade.id });
    expect((await theirs.next("error")).code).toBe("bad_frame");
    theirs.sendBinary(Buffer.from([1, 2, 3]));
    expect((await theirs.closed).code).toBe(1008);
  });

  it("delivers a message, typing and a read marker to the other party, not back to the sender", async () => {
    const { seller, buyer, trade } = await opened();
    const sellerTab = await open(seller.cookie);
    const buyerTab = await open(buyer.cookie);
    await watch(sellerTab, trade.id);
    await watch(buyerTab, trade.id);

    const sent = await buyer.api
      .post(`/v1/trades/${trade.id}/messages`, {
        clientMessageId: "rt-0001-aaaa",
        body: "Paid, ref 4411",
      })
      .expect(201);
    const frame = await sellerTab.next("message");
    expect(frame.tradeId).toBe(trade.id);
    expect(frame.message).toMatchObject({
      id: sent.body.id,
      seq: 2,
      senderId: buyer.userId,
      body: "Paid, ref 4411",
    });
    // The sender's own tabs get the same frame: another of their tabs needs it too.
    expect((await buyerTab.next("message")).message.id).toBe(sent.body.id);
    // Sent again with the same client id: the same message, and no second frame.
    await buyer.api
      .post(`/v1/trades/${trade.id}/messages`, {
        clientMessageId: "rt-0001-aaaa",
        body: "Paid, ref 4411",
      })
      .expect(201);
    await sellerTab.none("message");

    buyerTab.send({ type: "typing", tradeId: trade.id });
    expect(await sellerTab.next("typing")).toEqual({
      type: "typing",
      tradeId: trade.id,
      userId: buyer.userId,
    });
    await buyerTab.none("typing");

    await seller.api.post(`/v1/trades/${trade.id}/messages/read`, { seq: 2 }).expect(204);
    expect(await buyerTab.next("read")).toEqual({
      type: "read",
      tradeId: trade.id,
      userId: seller.userId,
      lastReadSeq: 2,
    });
    await sellerTab.none("read");

    // No longer watching: what happens inside the trade stays there.
    sellerTab.send({ type: "unsubscribe", tradeId: trade.id });
    await sellerTab.next("unsubscribed");
    buyerTab.send({ type: "typing", tradeId: trade.id });
    await sellerTab.none("typing");

    await sellerTab.close();
    await buyerTab.close();
  });

  it("tells both parties a trade changed and rings the bell, whether or not they are watching it", async () => {
    const { seller, buyer, offer, trade } = await opened();
    // Not subscribed to anything: the account's own channel carries these.
    const sellerTab = await open(seller.cookie);
    const buyerTab = await open(buyer.cookie);

    await buyer.api.post(`/v1/trades/${trade.id}/paid`, { reference: "FT-1" }).expect(200);
    expect(await sellerTab.next("trade")).toMatchObject({
      tradeId: trade.id,
      status: "BUYER_MARKED_PAID",
    });
    expect((await sellerTab.next("notification")).notification).toMatchObject({
      type: "TRADE_PAID",
      link: `/orders/${trade.id}`,
    });
    expect((await buyerTab.next("trade")).status).toBe("BUYER_MARKED_PAID");

    await seller.api.post(`/v1/trades/${trade.id}/release`, { password: PASSWORD }).expect(200);
    expect((await buyerTab.next("trade")).status).toBe("COMPLETED");
    expect((await buyerTab.next("notification")).notification.type).toBe("TRADE_RELEASED");
    // The seller's own act reaches their other tabs too, and rings their bell
    // once: the receipt for what they sent.
    expect((await sellerTab.next("trade")).status).toBe("COMPLETED");
    expect((await sellerTab.next("notification")).notification).toMatchObject({
      type: "TRADE_RELEASED",
      title: "USDT sent",
    });

    // The expirer's refund arrives the same way, from a pass the worker runs.
    const second = await take(buyer.api, offer.id);
    expect((await sellerTab.next("trade")).status).toBe("AWAITING_FIAT_PAYMENT");
    expect((await sellerTab.next("notification")).notification.type).toBe("TRADE_OPENED");
    await db.trade.update({
      where: { id: second.id },
      data: { paymentDeadline: new Date(Date.now() - 1_000) },
    });
    expect(await trades.expireDue()).toBeGreaterThanOrEqual(1);
    expect(await sellerTab.next("trade")).toMatchObject({ tradeId: second.id, status: "EXPIRED" });
    expect((await sellerTab.next("notification")).notification.type).toBe("TRADE_EXPIRED");

    await sellerTab.close();
    await buyerTab.close();
  });

  it("cuts off a client that floods it (1008)", async () => {
    const who = await customer();
    const tab = await open(who.cookie);
    for (let i = 0; i < 31; i++) tab.send({ type: "ping" });
    expect((await tab.closed).code).toBe(1008);
  });
});

/*
  Phase 5, stage 4: whether the person behind a name is around. The live
  connection and the session are the two witnesses, and the later wins;
  online means seen in the last five minutes, and the time is to the minute.
  Each step below takes the other witness away first, so the one being
  tested is the only one that could have answered.
*/
describe("presence", () => {
  const TWO_HOURS = 2 * 3_600_000;
  const toMinute = (ms: number) => new Date(Math.floor(ms / 60_000) * 60_000).toISOString();

  /** The buyer's view of the seller, from the order and from the ad. */
  async function seenBy(buyer: Api, tradeId: string, offerId: string) {
    const trade = (await buyer.get(`/v1/trades/${tradeId}`).expect(200)).body as TradeView;
    const offer = await buyer.get(`/v1/offers/${offerId}`).expect(200);
    expect(offer.body.advertiser.online).toBe(trade.counterparty.online);
    expect(offer.body.advertiser.lastSeenAt).toBe(trade.counterparty.lastSeenAt);
    return trade.counterparty;
  }

  /** Takes the session's word away: it last saw them two hours ago. */
  async function quietSession(userId: string): Promise<number> {
    const at = Date.now() - TWO_HOURS;
    await db.session.updateMany({ where: { userId }, data: { lastUsedAt: new Date(at) } });
    return at;
  }

  it("puts someone online while a tab is open, and keeps the time they were last seen", async () => {
    const { seller, buyer, trade, offer } = await opened();
    const redis = app.get(RedisService).client;
    const key = `presence:${seller.userId}`;

    // No tab, and the session last saw them two hours ago.
    await redis.del(key);
    const away = await quietSession(seller.userId);
    expect(await seenBy(buyer.api, trade.id, offer.id)).toMatchObject({
      online: false,
      lastSeenAt: toMinute(away),
    });

    // A tab opens.
    const tab = await open(seller.cookie);
    expect((await seenBy(buyer.api, trade.id, offer.id)).online).toBe(true);

    // With nothing else to go on, the heartbeat alone keeps them online.
    await redis.del(key);
    await quietSession(seller.userId);
    await gateway.beat();
    expect((await seenBy(buyer.api, trade.id, offer.id)).online).toBe(true);

    // The tab closes: the moment is kept, and they stay online for the window.
    const beaten = await redis.get(key);
    await tab.close();
    for (let tries = 0; tries < 100 && (await redis.get(key)) === beaten; tries++) {
      await sleep(20);
    }
    const left = Number(await redis.get(key));
    expect(Date.now() - left).toBeLessThan(5_000);
    expect(await seenBy(buyer.api, trade.id, offer.id)).toMatchObject({
      online: true,
      lastSeenAt: toMinute(left),
    });

    // Six minutes on, they are not.
    const sixMinutesAgo = Date.now() - 6 * 60_000;
    await redis.set(key, String(sixMinutesAgo));
    expect(await seenBy(buyer.api, trade.id, offer.id)).toMatchObject({
      online: false,
      lastSeenAt: toMinute(sixMinutesAgo),
    });
  });

  it("answers from the session alone when Redis cannot say", async () => {
    const { seller, buyer, trade, offer } = await opened();
    const redis = app.get(RedisService).client;
    // The live connection saw them just now; the session two hours ago.
    await redis.set(`presence:${seller.userId}`, String(Date.now()));
    const away = await quietSession(seller.userId);
    expect((await seenBy(buyer.api, trade.id, offer.id)).online).toBe(true);

    const outage = jest.spyOn(redis, "mget").mockRejectedValue(new Error("Connection is closed"));
    try {
      expect(await seenBy(buyer.api, trade.id, offer.id)).toMatchObject({
        online: false,
        lastSeenAt: toMinute(away),
      });
    } finally {
      outage.mockRestore();
    }
  });
});

describe("shutdown", () => {
  // Last, on purpose: it takes the application down.
  it("says 1001 to every open socket and leaves none behind", async () => {
    const who = await customer();
    const tab = await open(who.cookie);
    expect(gateway.connections).toBeGreaterThanOrEqual(1);
    appClosed = true;
    await app.close();
    expect((await tab.closed).code).toBe(1001);
    expect(gateway.connections).toBe(0);
  });
});
