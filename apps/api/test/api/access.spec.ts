import { randomBytes, randomUUID } from "node:crypto";

import {
  type DepositAddressResponse,
  type DisputeView,
  type OfferView,
  type PaymentMethodDetailView,
  type TradeMessageView,
  type TradeView,
  type WithdrawalView,
} from "@abay/contracts";
import { createPrismaClient, type PrismaClient } from "@abay/database";
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";

import { createApp } from "@/app";
import { loadEnv, type Env } from "@/config/env";
import { MockChain } from "@/modules/blockchain/mock/mock-blockchain.gateway";
import { signWebhook } from "@/modules/custody/webhooks/webhook-signature";
import { accounts } from "@/modules/ledger/account-code";
import { LedgerService } from "@/modules/ledger/ledger.service";

import { csrfFor, fakePng, PASSWORD, registerFully, uniqueEmail, uploadPhoto } from "./helpers";

/*
  AT-6, as one table (docs/testing/acceptance-test-plan.md).

  Every route that names an object somebody owns is a row: who may read or
  act on it, and what everybody else is told. Four callers try each one - the
  owner, the counterparty of a trade, a stranger with a valid session of their
  own, and nobody at all - and every id is also tried missing, replaced by a
  random one, because the rule that matters most is that last column: a
  stranger is told exactly what a missing id is told, status and body alike.
  Not "a 404 too" - the same 404. Anything else is a way to learn that an
  object exists, and an id you can confirm is an id you can go on to try
  things against.

  The table is checked against the routes Fastify actually registered. A
  route with an object and no row fails the run, and so does a row naming a
  route that is gone, which is how the table is kept from decaying the moment
  somebody adds an endpoint - the way the plan says such tables die. Routes
  with no object to own are listed too, each with why, and the ones that are
  lists are read as a stranger: a stranger's list must not carry the owner's
  rows. Every admin route is tried with a customer's cookie, and every route
  there is with none.

  "Allowed" here means not turned away for who the caller is: any answer but
  401, 403 or 404, since a row that reaches the object and then refuses on
  its state (409) has found it. That each act then does what it says is the
  job of every resource's own spec; this file is only about who.
*/

let app: NestFastifyApplication;
let db: PrismaClient;
let env: Env;
let ledger: LedgerService;
let chain: MockChain;
const server = () => app.getHttpServer() as Parameters<typeof request>[0];

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let counter = 0;
const uniq = (label: string) => `test-${run}-${label}-${++counter}`;
const USDT = 1_000_000n;

type Method = "GET" | "POST" | "PATCH" | "DELETE";
const METHODS = new Set<string>(["GET", "POST", "PATCH", "PUT", "DELETE"]);

/** Every route the application registered, as Fastify saw it. */
const registered: { method: string; url: string }[] = [];

beforeAll(async () => {
  env = loadEnv();
  app = await createApp(env);
  // Before init, which is when Nest registers its routes: the hook sees every one.
  app
    .getHttpAdapter()
    .getInstance()
    .addHook("onRoute", (route) => {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      for (const method of methods) registered.push({ method, url: route.url });
    });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  db = createPrismaClient(env.DATABASE_URL);
  ledger = app.get(LedgerService);
  chain = app.get(MockChain);
});

afterAll(async () => {
  await db.$disconnect();
  await app.close();
});

/* ------------------------------------------------------------- the world */

interface Party {
  cookie: string;
  userId: string;
}

/**
 * Everything the rows point at, built once: A sells, B buys, C is nobody to
 * either of them. Five trades because five acts want five different states,
 * and a row that finds the object in the wrong state proves less than one
 * that finds it in the right one.
 */
interface World {
  a: Party;
  b: Party;
  stranger: Party;
  /** A's ad, at revision 1, paid into A's Telebirr account. */
  offer: OfferView;
  telebirr: PaymentMethodDetailView;
  /** A's second account, on no ad, so it can be removed. */
  awash: PaymentMethodDetailView;
  /** Awaiting payment: for "I have paid". */
  tradeP: TradeView;
  /** Awaiting payment: for the buyer's cancellation. */
  tradeC: TradeView;
  /** Paid: for the seller's release. */
  tradeR: TradeView;
  /** Paid, past the cooldown: for opening a dispute. */
  tradeO: TradeView;
  /** Disputed by B, with one piece of B's evidence; the chat rows live here. */
  tradeD: TradeView;
  dispute: DisputeView;
  evidenceId: string;
  /** An image A sent in tradeD's chat. */
  imageMessage: TradeMessageView;
  depositId: string;
  withdrawal: WithdrawalView;
  /** A photograph A uploaded before verification, still staged. */
  documentId: string;
  notificationId: string;
}

let world: World;

async function fund(userId: string, usdt: bigint): Promise<void> {
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

/** A verified customer; `before` runs while they are still unverified. */
async function party(options: {
  usdt?: bigint;
  before?: (party: Party) => Promise<void>;
}): Promise<Party> {
  const { cookie, userId } = await registerFully(server(), db, uniqueEmail());
  const who = { cookie, userId };
  if (options.before) await options.before(who);
  await db.user.update({ where: { id: userId }, data: { kycStatus: "APPROVED" } });
  if (options.usdt) await fund(userId, options.usdt);
  return who;
}

function as(who: Party) {
  const headers = (test: request.Test) =>
    test
      .set("Cookie", who.cookie)
      .set("x-csrf-token", csrfFor(who.cookie))
      .set("x-request-id", uniq("req"));
  return {
    get: (path: string) => headers(request(server()).get(path)),
    post: (path: string, body: object = {}, key = false) => {
      const test = headers(request(server()).post(path));
      return (key ? test.set("Idempotency-Key", uniq("key")) : test).send(body);
    },
    raw: (path: string, type: string, bytes: Buffer) =>
      headers(request(server()).post(path)).set("content-type", type).send(bytes),
  };
}

async function take(buyer: Party, offer: OfferView): Promise<TradeView> {
  const response = await as(buyer)
    .post(
      "/v1/trades",
      { offerId: offer.id, offerRevision: offer.revision, amount: (10n * USDT).toString() },
      true,
    )
    .expect(201);
  return response.body as TradeView;
}

async function paid(buyer: Party, trade: TradeView, cool = false): Promise<TradeView> {
  const response = await as(buyer)
    .post(`/v1/trades/${trade.id}/paid`, { reference: "FT-2409-1123" })
    .expect(200);
  if (cool) {
    // Past the dispute cooldown, so a dispute may be opened now.
    await db.trade.update({
      where: { id: trade.id },
      data: { paidAt: new Date(Date.now() - (env.TRADE_DISPUTE_COOLDOWN_MINUTES + 1) * 60_000) },
    });
  }
  return response.body as TradeView;
}

async function buildWorld(): Promise<World> {
  let documentId = "";
  const a = await party({
    usdt: 100n,
    before: async (who) => {
      const photo = await uploadPhoto(server(), who.cookie, "front").expect(201);
      documentId = photo.body.id as string;
    },
  });
  const b = await party({});
  const stranger = await party({});

  const telebirr = (
    await as(a)
      .post("/v1/payment-methods", {
        kind: "TELEBIRR",
        accountHolder: "Abebe Bikila",
        phone: "0912345678",
      })
      .expect(201)
  ).body as PaymentMethodDetailView;
  const awash = (
    await as(a)
      .post("/v1/payment-methods", {
        kind: "AWASH",
        accountHolder: "Abebe Bikila",
        accountNumber: "01320123456789",
      })
      .expect(201)
  ).body as PaymentMethodDetailView;
  const offer = (
    await as(a)
      .post("/v1/offers", {
        side: "SELL",
        priceSantim: "15850",
        totalAmount: (100n * USDT).toString(),
        minSantim: "1000",
        maxSantim: "2000000",
        paymentWindowMinutes: 30,
        paymentMethodIds: [telebirr.id],
        autoReply: "Thanks! Pay within 30 minutes.",
        terms: "Pay from an account in your own name.",
      })
      .expect(201)
  ).body as OfferView;

  const tradeP = await take(b, offer);
  const tradeC = await take(b, offer);
  const tradeR = await paid(b, await take(b, offer));
  const tradeO = await paid(b, await take(b, offer), true);
  const tradeD = await paid(b, await take(b, offer), true);
  const dispute = (
    await as(b)
      .post(`/v1/trades/${tradeD.id}/dispute`, {
        reason: "PAYMENT_NOT_RELEASED",
        description: "I paid an hour ago and sent the receipt.",
      })
      .expect(201)
  ).body as DisputeView;
  const evidence = await as(b)
    .raw(`/v1/trades/${tradeD.id}/dispute/evidence?note=Receipt`, "image/png", fakePng(2_048))
    .expect(201);
  const imageMessage = (
    await as(a)
      .raw(`/v1/trades/${tradeD.id}/messages/images/${uniq("img")}`, "image/png", fakePng(2_048))
      .expect(201)
  ).body as TradeMessageView;

  // A deposit, the way one really arrives: on the chain, then announced.
  const address = (await as(a).get("/v1/wallet/deposit-address").expect(200))
    .body as DepositAddressResponse;
  const minted = await chain.mint({
    to: address.address,
    rawAmount: 5n * 10n ** 18n,
    tag: uniq("mint"),
  });
  const announcement = JSON.stringify({
    event: "transfer.incoming",
    network: "BSC",
    txHash: minted.txHash,
    logIndex: 0,
  });
  await request(server())
    .post("/v1/webhooks/custody")
    .set("content-type", "application/json")
    .set("x-custody-signature", signWebhook(env.CUSTODY_WEBHOOK_SECRET, announcement))
    .set("x-request-id", uniq("wh"))
    .send(announcement)
    .expect(200);
  const deposit = await db.deposit.findFirst({ where: { txHash: minted.txHash } });
  if (!deposit) throw new Error("the announced deposit was not recorded");

  // A withdrawal to an address never used before is held for a person, and
  // held is still the customer's to call off.
  const withdrawal = (
    await as(a)
      .post(
        "/v1/wallet/withdrawals",
        {
          network: "BSC",
          amount: (10n * USDT).toString(),
          destination: `0x${randomBytes(20).toString("hex")}`,
          password: PASSWORD,
        },
        true,
      )
      .expect(201)
  ).body as WithdrawalView;

  const notification = await db.notification.create({
    data: {
      userId: a.userId,
      type: "TRADE_OPENED",
      title: "An order was opened",
      body: "Somebody took your ad.",
      link: `/orders/${tradeD.id}`,
    },
  });

  return {
    a,
    b,
    stranger,
    offer,
    telebirr,
    awash,
    tradeP,
    tradeC,
    tradeR,
    tradeO,
    tradeD,
    dispute,
    evidenceId: evidence.body.id as string,
    imageMessage,
    depositId: deposit.id,
    withdrawal,
    documentId,
    notificationId: notification.id,
  };
}

/* --------------------------------------------------------------- the table */

/**
 * What a caller is told. "allowed": found, and not refused for who they are.
 * "nothing": exactly what a missing id gets. A number: found, and refused
 * with exactly this status - 403 for the other party to a trade, 409 for
 * an owner asked to take their own ad.
 */
type Verdict = "allowed" | "nothing" | number;

interface Row {
  method: Method;
  /** As Fastify registered it. */
  path: string;
  what: string;
  /** Every :name in the path, and any id the body names. Called afresh for every request. */
  params: (w: World) => Record<string, string>;
  /** The names that are the object; each is tried missing in turn. */
  missing: string[];
  /** A body the route accepts, so the check reaches the object and not the validator. */
  body?: (ids: Record<string, string>) => object;
  raw?: () => { type: string; bytes: Buffer };
  query?: string;
  /** Sends an Idempotency-Key. */
  key?: boolean;
  a: Verdict;
  b: Verdict;
  /** A stranger sees nothing, unless the object is public by design. */
  stranger?: "public";
}

const offerId = (w: World) => ({ id: w.offer.id });
const tradeD = (w: World) => ({ tradeId: w.tradeD.id });
const png = () => ({ type: "image/png", bytes: fakePng(2_048) });

/*
  In this order, because some rows change the world: the ad is read while it
  is still on the market, taken before its revision could move, paused and
  resumed before it is closed; the dispute collects evidence before it is
  withdrawn; the account that is removed is the one no ad uses.
*/
const MATRIX: Row[] = [
  /* --------------------------------------------- the market: public to read, its owner's to run */
  {
    method: "GET",
    path: "/v1/offers/:id",
    what: "an ad, as somebody about to take it sees it",
    params: offerId,
    missing: ["id"],
    a: "allowed",
    b: "allowed",
    stranger: "public",
  },
  {
    method: "GET",
    path: "/v1/offers/:id/mine",
    what: "an ad, as its owner sees it",
    params: offerId,
    missing: ["id"],
    a: "allowed",
    b: "nothing",
  },
  {
    method: "POST",
    path: "/v1/trades",
    what: "taking an ad: the object is named in the body",
    params: (w) => ({ offerId: w.offer.id }),
    missing: ["offerId"],
    body: (ids) => ({
      offerId: ids.offerId,
      offerRevision: 1,
      amount: (10n * USDT).toString(),
    }),
    key: true,
    a: 409,
    b: "allowed",
    stranger: "public",
  },
  {
    method: "PATCH",
    path: "/v1/offers/:id",
    what: "editing an ad",
    params: offerId,
    missing: ["id"],
    body: () => ({ autoReply: "Thanks, pay within the window." }),
    a: "allowed",
    b: "nothing",
  },
  {
    method: "POST",
    path: "/v1/offers/:id/pause",
    what: "taking an ad off the market",
    params: offerId,
    missing: ["id"],
    a: "allowed",
    b: "nothing",
  },
  {
    method: "POST",
    path: "/v1/offers/:id/resume",
    what: "putting an ad back",
    params: offerId,
    missing: ["id"],
    a: "allowed",
    b: "nothing",
  },

  /* ---------------------------------- payment methods: the buyer pays into one and still cannot read it */
  {
    method: "GET",
    path: "/v1/payment-methods/:id",
    what: "a payment method, with its instructions",
    params: (w) => ({ id: w.telebirr.id }),
    missing: ["id"],
    a: "allowed",
    b: "nothing",
  },
  {
    method: "POST",
    path: "/v1/payment-methods/:id/replace",
    what: "replacing the account behind a payment method",
    params: (w) => ({ id: w.telebirr.id }),
    missing: ["id"],
    body: () => ({ kind: "TELEBIRR", accountHolder: "Abebe Bikila", phone: "0911223344" }),
    a: "allowed",
    b: "nothing",
  },
  {
    method: "DELETE",
    path: "/v1/payment-methods/:id",
    what: "removing a payment method",
    params: (w) => ({ id: w.awash.id }),
    missing: ["id"],
    a: "allowed",
    b: "nothing",
  },

  /* ------------------------------------------- trades: both parties see it; each act has one side */
  {
    method: "GET",
    path: "/v1/trades/:id",
    what: "a trade",
    params: (w) => ({ id: w.tradeD.id }),
    missing: ["id"],
    a: "allowed",
    b: "allowed",
  },
  {
    method: "GET",
    path: "/v1/trades/:id/events",
    what: "a trade's history",
    params: (w) => ({ id: w.tradeD.id }),
    missing: ["id"],
    a: "allowed",
    b: "allowed",
  },
  {
    method: "POST",
    path: "/v1/trades/:id/paid",
    what: '"I have paid": the buyer\'s',
    params: (w) => ({ id: w.tradeP.id }),
    missing: ["id"],
    body: () => ({ reference: "FT-2409-1123" }),
    a: 403,
    b: "allowed",
  },
  {
    method: "POST",
    path: "/v1/trades/:id/cancel",
    what: "calling a trade off before paying: the buyer's",
    params: (w) => ({ id: w.tradeC.id }),
    missing: ["id"],
    body: () => ({}),
    a: 403,
    b: "allowed",
  },
  {
    method: "POST",
    path: "/v1/trades/:id/release",
    what: "releasing the USDT: the seller's",
    params: (w) => ({ id: w.tradeR.id }),
    missing: ["id"],
    body: () => ({ password: PASSWORD }),
    a: "allowed",
    b: 403,
  },

  /* --------------------------------------------------------------- the chat, inside the trade */
  {
    method: "GET",
    path: "/v1/trades/:tradeId/messages",
    what: "the chat",
    params: tradeD,
    missing: ["tradeId"],
    a: "allowed",
    b: "allowed",
  },
  {
    method: "POST",
    path: "/v1/trades/:tradeId/messages",
    what: "sending a message",
    params: tradeD,
    missing: ["tradeId"],
    body: () => ({ clientMessageId: uniq("msg"), body: "Hello from the access table." }),
    a: "allowed",
    b: "allowed",
  },
  {
    method: "POST",
    path: "/v1/trades/:tradeId/messages/images/:clientMessageId",
    what: "sending an image; the client's id is a name for the message, not an object",
    params: (w) => ({ tradeId: w.tradeD.id, clientMessageId: uniq("img") }),
    missing: ["tradeId"],
    raw: png,
    a: "allowed",
    b: "allowed",
  },
  {
    method: "GET",
    path: "/v1/trades/:tradeId/messages/:messageId/image",
    what: "an image somebody sent",
    params: (w) => ({ tradeId: w.tradeD.id, messageId: w.imageMessage.id }),
    missing: ["tradeId", "messageId"],
    a: "allowed",
    b: "allowed",
  },
  {
    method: "POST",
    path: "/v1/trades/:tradeId/messages/read",
    what: "marking the chat read",
    params: tradeD,
    missing: ["tradeId"],
    body: () => ({ seq: 1 }),
    a: "allowed",
    b: "allowed",
  },

  /* --------------------------------------------------------------- disputes, and their evidence */
  {
    method: "GET",
    path: "/v1/trades/:tradeId/dispute",
    what: "the dispute on a trade",
    params: tradeD,
    missing: ["tradeId"],
    a: "allowed",
    b: "allowed",
  },
  {
    method: "POST",
    path: "/v1/trades/:tradeId/dispute",
    what: "opening a dispute: either party's, once",
    params: (w) => ({ tradeId: w.tradeO.id }),
    missing: ["tradeId"],
    body: () => ({
      reason: "PAYMENT_NOT_RELEASED",
      description: "I paid an hour ago and sent the receipt.",
    }),
    a: "allowed",
    b: "allowed",
  },
  {
    method: "POST",
    path: "/v1/trades/:tradeId/dispute/evidence",
    what: "attaching evidence: either party's",
    params: tradeD,
    missing: ["tradeId"],
    raw: png,
    query: "note=Receipt",
    a: "allowed",
    b: "allowed",
  },
  {
    method: "GET",
    path: "/v1/trades/:tradeId/dispute/evidence/:evidenceId",
    what: "a piece of evidence",
    params: (w) => ({ tradeId: w.tradeD.id, evidenceId: w.evidenceId }),
    missing: ["tradeId", "evidenceId"],
    a: "allowed",
    b: "allowed",
  },
  {
    method: "POST",
    path: "/v1/trades/:tradeId/dispute/withdraw",
    what: "withdrawing a dispute: only whoever opened it",
    params: tradeD,
    missing: ["tradeId"],
    a: 403,
    b: "allowed",
  },

  /* --------------------------------------------------------------------------- the wallet */
  {
    method: "GET",
    path: "/v1/wallet/deposits/:id",
    what: "a deposit",
    params: (w) => ({ id: w.depositId }),
    missing: ["id"],
    a: "allowed",
    b: "nothing",
  },
  {
    method: "GET",
    path: "/v1/wallet/withdrawals/:id",
    what: "a withdrawal",
    params: (w) => ({ id: w.withdrawal.id }),
    missing: ["id"],
    a: "allowed",
    b: "nothing",
  },
  {
    method: "POST",
    path: "/v1/wallet/withdrawals/:id/cancel",
    what: "calling a withdrawal off",
    params: (w) => ({ id: w.withdrawal.id }),
    missing: ["id"],
    a: "allowed",
    b: "nothing",
  },

  /* ------------------------------------------------------------ verification, and the bell */
  {
    method: "GET",
    path: "/v1/kyc/documents/:id",
    what: "a photograph of an identity document",
    params: (w) => ({ id: w.documentId }),
    missing: ["id"],
    a: "allowed",
    b: "nothing",
  },
  {
    method: "POST",
    path: "/v1/notifications/:id/read",
    what: "marking a notification read",
    params: (w) => ({ id: w.notificationId }),
    missing: ["id"],
    a: "allowed",
    b: "nothing",
  },

  /* ------------------------------------- last: closing the ad, after which nothing above could read it */
  {
    method: "POST",
    path: "/v1/offers/:id/close",
    what: "closing an ad, for good",
    params: offerId,
    missing: ["id"],
    a: "allowed",
    b: "nothing",
  },
];

/*
  Routes with no object in the path or the body: what they answer belongs to
  the session that asks. The lists among them are read as the owner and as a
  stranger, and the owner's rows must be in the one and not the other.
*/
interface Scoped {
  method: Method;
  path: string;
  why: string;
  list?: {
    /** The owner's object this list should carry. */
    holds: (w: World) => string;
    /** The ids the list carries. */
    ids: (body: unknown) => string[];
  };
}

const rows = (body: unknown, field: string): string[] =>
  ((body as Record<string, { id: string }[]>)[field] ?? []).map((row) => row.id);

const SESSION_SCOPED: Scoped[] = [
  { method: "GET", path: "/v1/auth/me", why: "the caller's own account" },
  { method: "PATCH", path: "/v1/auth/me", why: "the caller's own account" },
  {
    method: "GET",
    path: "/v1/kyc",
    why: "the caller's own verification",
    list: {
      holds: (w) => w.documentId,
      ids: (body) => rows(body, "documents"),
    },
  },
  { method: "POST", path: "/v1/kyc", why: "submits the caller's own details" },
  {
    method: "POST",
    path: "/v1/kyc/documents/:kind",
    why: "uploads to the caller's own staging area; :kind is front, back or selfie, not an id",
  },
  {
    method: "GET",
    path: "/v1/notifications",
    why: "the caller's own",
    list: {
      holds: (w) => w.notificationId,
      ids: (body) => rows(body, "notifications"),
    },
  },
  { method: "POST", path: "/v1/notifications/read-all", why: "the caller's own" },
  { method: "GET", path: "/v1/offers", why: "the market, public to every signed-in customer" },
  {
    method: "GET",
    path: "/v1/offers/mine",
    why: "the caller's own ads",
    list: {
      holds: (w) => w.offer.id,
      ids: (body) => rows(body, "offers"),
    },
  },
  { method: "POST", path: "/v1/offers", why: "posts as the caller" },
  {
    method: "GET",
    path: "/v1/payment-methods",
    why: "the caller's own",
    list: {
      holds: (w) => w.telebirr.id,
      ids: (body) => rows(body, "paymentMethods"),
    },
  },
  { method: "POST", path: "/v1/payment-methods", why: "adds to the caller's own" },
  {
    method: "GET",
    path: "/v1/trades",
    why: "the caller's own, on either side",
    list: {
      holds: (w) => w.tradeD.id,
      ids: (body) => rows(body, "trades"),
    },
  },
  {
    method: "GET",
    path: "/v1/wallet/deposit-address",
    why: "issued to the caller; a stranger gets their own, checked below",
  },
  { method: "GET", path: "/v1/wallet/balance", why: "the caller's own" },
  {
    method: "GET",
    path: "/v1/wallet/deposits",
    why: "the caller's own",
    list: {
      holds: (w) => w.depositId,
      ids: (body) => rows(body, "deposits"),
    },
  },
  { method: "GET", path: "/v1/wallet/withdrawals/limits", why: "the caller's own" },
  {
    method: "GET",
    path: "/v1/wallet/withdrawals",
    why: "the caller's own",
    list: {
      holds: (w) => w.withdrawal.id,
      ids: (body) => rows(body, "withdrawals"),
    },
  },
  { method: "POST", path: "/v1/wallet/withdrawals", why: "moves the caller's own money" },
];

/** Reachable with no session at all, each for a reason, and what nobody is told there. */
const PUBLIC: { method: Method; path: string; anonymous: number[]; why: string }[] = [
  { method: "GET", path: "/health", anonymous: [200], why: "liveness" },
  { method: "GET", path: "/ready", anonymous: [200, 503], why: "readiness" },
  {
    method: "POST",
    path: "/v1/auth/register/start",
    anonymous: [400],
    why: "sign-up begins with no session",
  },
  { method: "POST", path: "/v1/auth/register/verify", anonymous: [400], why: "sign-up" },
  { method: "POST", path: "/v1/auth/register/complete", anonymous: [400], why: "sign-up" },
  { method: "POST", path: "/v1/auth/login", anonymous: [400], why: "sign-in" },
  { method: "POST", path: "/v1/auth/login/verify", anonymous: [400], why: "sign-in" },
  { method: "POST", path: "/v1/auth/login/resend", anonymous: [400], why: "sign-in" },
  {
    method: "POST",
    path: "/v1/auth/logout",
    anonymous: [204],
    why: "must work for a client that cannot tell whether it is signed in",
  },
  { method: "POST", path: "/v1/auth/password-reset", anonymous: [400], why: "recovery" },
  { method: "POST", path: "/v1/auth/password-reset/verify", anonymous: [400], why: "recovery" },
  { method: "POST", path: "/v1/auth/password-reset/complete", anonymous: [400], why: "recovery" },
  { method: "GET", path: "/v1/auth/google/start", anonymous: [302], why: "sign-in with Google" },
  {
    method: "GET",
    path: "/v1/auth/google/callback",
    anonymous: [302],
    why: "Google's return; a bad state is sent back to the web app, not answered here",
  },
  {
    method: "POST",
    path: "/v1/admin/auth/login",
    anonymous: [400],
    why: "the admin realm's own door",
  },
  {
    method: "POST",
    path: "/v1/webhooks/custody",
    anonymous: [401],
    why: "a machine, authenticated by its signature over the body rather than by a session",
  },
];

/* --------------------------------------------------------------- running it */

interface Answer {
  status: number;
  body: unknown;
}

/** The answer, with the one thing that legitimately differs between two identical refusals removed. */
function comparable(response: request.Response): Answer {
  const body: unknown = Buffer.isBuffer(response.body)
    ? `<${response.body.length} bytes>`
    : response.body;
  const clone: unknown = JSON.parse(JSON.stringify(body ?? null));
  if (clone && typeof clone === "object" && "error" in clone) {
    const error = (clone as { error: Record<string, unknown> }).error;
    delete error.correlationId;
  }
  return { status: response.status, body: clone };
}

const fill = (path: string, ids: Record<string, string>) =>
  path.replace(/:(\w+)/g, (_match, name: string) => ids[name] ?? "");

type Caller = Party | "anonymous";

async function call(row: Row, who: Caller, ids: Record<string, string>): Promise<Answer> {
  const url = fill(row.path, ids) + (row.query ? `?${row.query}` : "");
  const agent = request(server());
  let test =
    row.method === "GET"
      ? agent.get(url)
      : row.method === "POST"
        ? agent.post(url)
        : row.method === "PATCH"
          ? agent.patch(url)
          : agent.delete(url);
  test = test.set("x-request-id", uniq("req"));
  if (who !== "anonymous") {
    test = test.set("Cookie", who.cookie).set("x-csrf-token", csrfFor(who.cookie));
  }
  if (row.key) test = test.set("Idempotency-Key", uniq("key"));
  if (row.raw) {
    const { type, bytes } = row.raw();
    test = test.set("content-type", type).send(bytes);
  } else if (row.body) {
    test = test.send(row.body(ids));
  }
  return comparable(await test);
}

const shown = (answer: Answer) => `${answer.status} ${JSON.stringify(answer.body)}`;

/** Fails with the row, the caller and the answer in the message, which the bare matcher would not say. */
function judge(label: string, answer: Answer, verdict: Verdict, missing: Answer): void {
  if (verdict === "allowed") {
    const turnedAway = [401, 403, 404].includes(answer.status);
    expect(turnedAway ? `${label}: turned away with ${shown(answer)}` : "allowed").toBe("allowed");
    return;
  }
  if (verdict === "nothing") {
    expect(`${label}: ${shown(answer)}`).toBe(`${label}: ${shown(missing)}`);
    return;
  }
  expect(`${label}: ${answer.status}`).toBe(`${label}: ${verdict}`);
}

beforeAll(async () => {
  world = await buildWorld();
});

describe("what belongs to a session", () => {
  it("is not in a stranger's lists", async () => {
    for (const scoped of SESSION_SCOPED) {
      if (!scoped.list) continue;
      const mine = await as(world.a).get(scoped.path).expect(200);
      const theirs = await as(world.stranger).get(scoped.path).expect(200);
      const held = scoped.list.holds(world);
      expect(
        `${scoped.path} as A holds ${held}: ${String(scoped.list.ids(mine.body).includes(held))}`,
      ).toBe(`${scoped.path} as A holds ${held}: true`);
      expect(
        `${scoped.path} as a stranger holds ${held}: ${String(scoped.list.ids(theirs.body).includes(held))}`,
      ).toBe(`${scoped.path} as a stranger holds ${held}: false`);
    }
  });

  it("is a deposit address of one's own", async () => {
    const mine = (await as(world.a).get("/v1/wallet/deposit-address").expect(200))
      .body as DepositAddressResponse;
    const theirs = (await as(world.stranger).get("/v1/wallet/deposit-address").expect(200))
      .body as DepositAddressResponse;
    expect(theirs.address).not.toBe(mine.address);
  });
});

describe("AT-6: every object, every caller", () => {
  it.each(MATRIX.map((row) => [`${row.method} ${row.path}`, row] as const))(
    "%s",
    async (label, row) => {
      const ids = () => row.params(world);

      // Nobody: turned away before the object is even looked for.
      const nobody = await call(row, "anonymous", ids());
      expect(`${label} as nobody: ${nobody.status}`).toBe(`${label} as nobody: 401`);
      expect((nobody.body as { error: { code: string } }).error.code).toBe("UNAUTHENTICATED");

      /*
        Each id missing in turn, as the owner. The first named is the object
        that decides whether anything is seen at all - the trade, for a
        message or a file inside one - and its 404 is the genuine article
        everybody else is held to. An inner id missing may say so to a party,
        who is entitled to know the trade exists; a stranger asking the same
        must still be told only about the trade.
      */
      const missing: Answer[] = [];
      for (const name of row.missing) {
        const gone = { ...ids(), [name]: randomUUID() };
        const answer = await call(row, world.a, gone);
        expect(`${label} with no such ${name}: ${answer.status}`).toBe(
          `${label} with no such ${name}: 404`,
        );
        missing.push(answer);
        if (missing.length > 1 && !row.stranger) {
          const outsider = await call(row, world.stranger, gone);
          expect(`${label} with no such ${name}, as a stranger: ${shown(outsider)}`).toBe(
            `${label} with no such ${name}, as a stranger: ${shown(missing[0]!)}`,
          );
        }
      }
      const genuine = missing[0];
      if (!genuine) throw new Error(`${label} names no object to try missing`);

      // A stranger with a session of their own: told what a missing id is told, unless the object is public.
      const stranger = await call(row, world.stranger, ids());
      judge(`${label} as a stranger`, stranger, row.stranger ? "allowed" : "nothing", genuine);

      // The two parties, refusals first: a refusal changes nothing, and an allowed act may.
      const parties: [string, Party, Verdict][] = [
        ["B", world.b, row.b],
        ["A", world.a, row.a],
      ];
      parties.sort((x, y) => Number(x[2] === "allowed") - Number(y[2] === "allowed"));
      for (const [name, who, verdict] of parties) {
        judge(`${label} as ${name}`, await call(row, who, ids()), verdict, genuine);
      }
    },
  );
});

describe("the route map", () => {
  /** The application's routes, without the HEAD twins Fastify adds and the CORS preflight. */
  const routes = () =>
    registered
      .filter((route) => METHODS.has(route.method))
      .filter(
        (route) =>
          route.url.startsWith("/v1/") || route.url === "/health" || route.url === "/ready",
      )
      .map((route) => `${route.method} ${route.url}`);

  const isAdmin = (route: string) =>
    route.includes(" /v1/admin/") && route !== "POST /v1/admin/auth/login";

  it("is fully classified: every route is in the table, session-scoped, public, or the admin realm", () => {
    const listed = new Set<string>([
      ...MATRIX.map((row) => `${row.method} ${row.path}`),
      ...SESSION_SCOPED.map((row) => `${row.method} ${row.path}`),
      ...PUBLIC.map((row) => `${row.method} ${row.path}`),
    ]);
    const actual = new Set(routes());
    expect(actual.size).toBeGreaterThan(50);

    const unclassified = [...actual].filter((route) => !listed.has(route) && !isAdmin(route));
    const stale = [...listed].filter((route) => !actual.has(route));
    expect({ unclassified, stale }).toEqual({ unclassified: [], stale: [] });
  });

  it("turns nobody away from a public route, and everybody else from every other", async () => {
    const expectedOf = new Map(PUBLIC.map((row) => [`${row.method} ${row.path}`, row.anonymous]));
    const wrong: string[] = [];
    for (const route of routes()) {
      const [method = "GET", path = ""] = route.split(" ");
      const url = fill(path, {}).replace(/:(\w+)/g, () => randomUUID());
      const agent = request(server());
      const test =
        method === "GET"
          ? agent.get(url)
          : method === "POST"
            ? agent.post(url)
            : method === "PATCH"
              ? agent.patch(url)
              : method === "PUT"
                ? agent.put(url)
                : agent.delete(url);
      const response = await test.set("x-request-id", uniq("anon")).send({});
      const expected = expectedOf.get(route) ?? [401];
      if (!expected.includes(response.status)) {
        wrong.push(`${route} -> ${response.status} (expected ${expected.join(" or ")})`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("keeps the admin realm invisible to a customer's session", async () => {
    const wrong: string[] = [];
    for (const route of routes().filter(isAdmin)) {
      const [method = "GET", path = ""] = route.split(" ");
      const url = path.replace(/:(\w+)/g, () => randomUUID());
      const agent = request(server());
      const test = method === "GET" ? agent.get(url) : agent.post(url);
      const response = await test
        .set("Cookie", world.a.cookie)
        .set("x-csrf-token", csrfFor(world.a.cookie))
        .set("x-request-id", uniq("adm"))
        .send({});
      if (response.status !== 401) wrong.push(`${route} -> ${response.status}`);
    }
    expect(wrong).toEqual([]);
  });
});
