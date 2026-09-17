import {
  type AdminDisputeDetail,
  type AdminDisputeQueueResponse,
  type DisputeView,
  type OfferView,
  type PaymentMethodDetailView,
  type TradeView,
} from "@abay/contracts";
import { createPrismaClient, type PrismaClient } from "@abay/database";
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";

import { createApp } from "@/app";
import { loadEnv, type Env } from "@/config/env";
import { hashPassword } from "@/modules/auth/tokens";
import { accounts } from "@/modules/ledger/account-code";
import { LedgerService } from "@/modules/ledger/ledger.service";

import {
  csrfFor,
  enrolledTotp,
  fakeJpeg,
  fakePng,
  PASSWORD,
  registerFully,
  totpCodeFor,
  uniqueEmail,
} from "./helpers";

/*
  Phase 4, stage 4: disputes, end to end.

  AT-8 is what this file exists for: a disputed trade is decided only by the
  DISPUTE_RESOLVER role, both outcomes produce the right ledger entries (the
  release shape, or the refund shape reversing the lock), and the audit
  event carries the actor, the note, both states and the evidence it cites,
  with a timeline that reads from creation to decision. Around it: the
  cooldown, evidence from both sides within its caps, withdrawing and
  reopening, the seller ending a dispute by releasing, and a stranger
  finding nothing (AT-6).

  Every correlation id and email here starts with "test-", which is how
  global-teardown.js knows which rows are its to clear.
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
const ADMIN_PASSWORD = "correct horse battery staple";
const AUTO_REPLY = "Thanks! Pay within 30 minutes.";
const TERMS = "Pay from an account in your own name. No third parties.";
const NOTE = "The buyer's receipt shows the transfer to the seller's Telebirr number.";

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

async function customer(usdt = 0n) {
  const email = uniqueEmail();
  const { cookie, userId } = await registerFully(server(), db, email);
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
  return { cookie, userId, email, api: api(cookie) };
}

/** A seller with an offer, a buyer, a 40 USDT trade between them, and the buyer's "I have paid". */
async function paidTrade() {
  const seller = await customer(100n);
  const buyer = await customer();
  const method = (
    await seller.api
      .post("/v1/payment-methods", {
        kind: "TELEBIRR",
        accountHolder: "Abebe Bikila",
        phone: "0912345678",
      })
      .expect(201)
  ).body as PaymentMethodDetailView;
  const offer = (
    await seller.api
      .post("/v1/offers", {
        side: "SELL",
        priceSantim: "15850",
        totalAmount: (100n * USDT).toString(),
        minSantim: "1000",
        maxSantim: "2000000",
        paymentWindowMinutes: 30,
        paymentMethodIds: [method.id],
        autoReply: AUTO_REPLY,
        terms: TERMS,
      })
      .expect(201)
  ).body as OfferView;
  const trade = (
    await buyer.api
      .post(
        "/v1/trades",
        { offerId: offer.id, offerRevision: 1, amount: (40n * USDT).toString() },
        uniq("key"),
      )
      .expect(201)
  ).body as TradeView;
  await buyer.api.post(`/v1/trades/${trade.id}/paid`, { reference: "FT-2409-1123" }).expect(200);
  return { seller, buyer, offer, trade };
}

/** Moves "I have paid" back past the cooldown, so a dispute may be opened now. */
async function cooled(tradeId: string): Promise<void> {
  await db.trade.update({
    where: { id: tradeId },
    data: { paidAt: new Date(Date.now() - (env.TRADE_DISPUTE_COOLDOWN_MINUTES + 1) * 60_000) },
  });
}

const OPEN = {
  reason: "PAYMENT_NOT_RELEASED",
  description: "I paid an hour ago and sent the receipt.",
};

async function disputed() {
  const fixture = await paidTrade();
  await cooled(fixture.trade.id);
  const dispute = (
    await fixture.buyer.api.post(`/v1/trades/${fixture.trade.id}/dispute`, OPEN).expect(201)
  ).body as DisputeView;
  return { ...fixture, dispute };
}

const available = (userId: string) => ledger.balance(accounts.userAvailable(userId));
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

async function makeAdmin(roles: string[] = ["DISPUTE_RESOLVER"]) {
  const email = `admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const totp = enrolledTotp();
  const admin = await db.adminUser.create({
    data: {
      email,
      name: "Test Resolver",
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
type Admin = Awaited<ReturnType<typeof makeAdmin>>;

const adminGet = (admin: Admin, path: string, requestId = uniq("adm")) =>
  request(server())
    .get(`/v1/admin/disputes${path}`)
    .set("Cookie", admin.cookie)
    .set("x-request-id", requestId);

const adminPost = (admin: Admin, path: string, body: object, requestId = uniq("adm")) =>
  request(server())
    .post(`/v1/admin/disputes${path}`)
    .set("Cookie", admin.cookie)
    .set("x-csrf-token", admin.csrf)
    .set("x-request-id", requestId)
    .send(body);

/* ---------------------------------------------------------------- tests */

describe("opening a dispute", () => {
  it("waits for the cooldown, then either party may open it and the other is told", async () => {
    const { seller, buyer, trade } = await paidTrade();

    const early = await buyer.api.post(`/v1/trades/${trade.id}/dispute`, OPEN).expect(409);
    expect(early.body.error.message).toMatch(/minutes/i);
    expect(
      (await buyer.api.get(`/v1/trades/${trade.id}`).expect(200)).body.actions.canDispute,
    ).toBe(false);
    await buyer.api.get(`/v1/trades/${trade.id}/dispute`).expect(404);

    await cooled(trade.id);
    expect(
      (await buyer.api.get(`/v1/trades/${trade.id}`).expect(200)).body.actions.canDispute,
    ).toBe(true);

    const tooShort = await buyer.api
      .post(`/v1/trades/${trade.id}/dispute`, { reason: "OTHER", description: "help" })
      .expect(400);
    expect(tooShort.body.error.details[0].path).toBe("description");

    const opened = await buyer.api.post(`/v1/trades/${trade.id}/dispute`, OPEN).expect(201);
    expect(opened.body).toMatchObject({
      tradeId: trade.id,
      status: "OPEN",
      reason: "PAYMENT_NOT_RELEASED",
      openedBy: "BUYER",
      openedByMe: true,
      outcome: null,
      evidence: [],
      evidenceLeft: 5,
    });

    // The trade says so from both sides; the seller may still release, nobody may cancel.
    const mine = await buyer.api.get(`/v1/trades/${trade.id}`).expect(200);
    expect(mine.body.status).toBe("DISPUTED");
    expect(mine.body.dispute).toMatchObject({ status: "OPEN", openedByMe: true });
    expect(mine.body.actions).toMatchObject({
      canDispute: false,
      canWithdrawDispute: true,
      canCancel: false,
      canRelease: false,
    });
    const theirs = await seller.api.get(`/v1/trades/${trade.id}`).expect(200);
    expect(theirs.body.actions).toMatchObject({ canWithdrawDispute: false, canRelease: true });
    expect(
      (await seller.api.get(`/v1/trades/${trade.id}/dispute`).expect(200)).body.openedByMe,
    ).toBe(false);

    // Once, and money untouched: a status changed, nothing moved.
    await seller.api.post(`/v1/trades/${trade.id}/dispute`, OPEN).expect(409);
    expect(await escrow(trade.id)).toBe(40n * USDT);
    const told = await db.notification.findFirst({
      where: { userId: seller.userId, type: "DISPUTE_OPENED" },
    });
    expect(told?.link).toBe(`/orders/${trade.id}`);

    // A stranger finds nothing (AT-6).
    const stranger = await customer();
    await stranger.api.get(`/v1/trades/${trade.id}/dispute`).expect(404);
    await stranger.api.post(`/v1/trades/${trade.id}/dispute`, OPEN).expect(404);
    await stranger.api.post(`/v1/trades/${trade.id}/dispute/withdraw`).expect(404);
  });

  it("collects evidence from both sides, images only, five each, for the parties only", async () => {
    const { seller, buyer, trade } = await disputed();
    const stranger = await customer();
    const path = `/v1/trades/${trade.id}/dispute/evidence`;

    const notImage = await buyer.api.raw(path, "image/png", Buffer.from("not really")).expect(400);
    expect(notImage.body.error.code).toBe("VALIDATION_FAILED");

    const receipt = await buyer.api
      .raw(`${path}?note=${encodeURIComponent("Telebirr receipt")}`, "image/png", fakePng(2_048))
      .expect(201);
    expect(receipt.body).toMatchObject({
      uploadedBy: "BUYER",
      contentType: "image/png",
      sizeBytes: 2_048,
      note: "Telebirr receipt",
    });
    const statement = await seller.api.raw(path, "image/jpeg", fakeJpeg()).expect(201);
    expect(statement.body).toMatchObject({ uploadedBy: "SELLER", note: null });

    for (let i = 0; i < 4; i++) await buyer.api.raw(path, "image/png", fakePng()).expect(201);
    const sixth = await buyer.api.raw(path, "image/png", fakePng()).expect(400);
    expect(sixth.body.error.details[0].message).toMatch(/up to 5/);
    await stranger.api.raw(path, "image/png", fakePng()).expect(404);

    // Each side's count is its own.
    const asBuyer = (await buyer.api.get(`/v1/trades/${trade.id}/dispute`).expect(200))
      .body as DisputeView;
    expect(asBuyer.evidence).toHaveLength(6);
    expect(asBuyer.evidenceLeft).toBe(0);
    const asSeller = (await seller.api.get(`/v1/trades/${trade.id}/dispute`).expect(200))
      .body as DisputeView;
    expect(asSeller.evidenceLeft).toBe(4);

    // The bytes, to the other party; to nobody else.
    const bytes = await seller.api
      .get(`/v1/trades/${trade.id}/dispute/evidence/${receipt.body.id}`)
      .expect(200);
    expect(bytes.headers["content-type"]).toMatch(/^image\/png/);
    expect(bytes.body.length).toBe(2_048);
    await stranger.api
      .get(`/v1/trades/${trade.id}/dispute/evidence/${receipt.body.id}`)
      .expect(404);
    await buyer.api.get(`/v1/trades/${trade.id}/dispute/evidence/${trade.id}`).expect(404);
  });

  it("is withdrawn by whoever opened it, and only them, and may be reopened", async () => {
    const { seller, buyer, trade, dispute } = await disputed();
    await buyer.api
      .raw(`/v1/trades/${trade.id}/dispute/evidence`, "image/png", fakePng())
      .expect(201);

    const notTheirs = await seller.api.post(`/v1/trades/${trade.id}/dispute/withdraw`).expect(403);
    expect(notTheirs.body.error.message).toMatch(/opened/i);

    const withdrawn = await buyer.api.post(`/v1/trades/${trade.id}/dispute/withdraw`).expect(200);
    expect(withdrawn.body).toMatchObject({ id: dispute.id, status: "WITHDRAWN", evidenceLeft: 0 });
    expect(withdrawn.body.withdrawnAt).toEqual(expect.any(String));
    const back = await buyer.api.get(`/v1/trades/${trade.id}`).expect(200);
    expect(back.body.status).toBe("BUYER_MARKED_PAID");
    expect(back.body.actions).toMatchObject({ canDispute: true, canWithdrawDispute: false });
    await buyer.api.post(`/v1/trades/${trade.id}/dispute/withdraw`).expect(409);
    await buyer.api
      .raw(`/v1/trades/${trade.id}/dispute/evidence`, "image/png", fakePng())
      .expect(409);
    const told = await db.notification.findFirst({
      where: { userId: seller.userId, type: "DISPUTE_WITHDRAWN" },
    });
    expect(told).not.toBeNull();

    // The seller, this time, and the row is the same one, rewritten; the file is still there.
    const reopened = await seller.api
      .post(`/v1/trades/${trade.id}/dispute`, {
        reason: "WRONG_AMOUNT",
        description: "6,000 birr arrived, not 6,340.",
      })
      .expect(201);
    expect(reopened.body).toMatchObject({
      id: dispute.id,
      status: "OPEN",
      reason: "WRONG_AMOUNT",
      openedBy: "SELLER",
      openedByMe: true,
      withdrawnAt: null,
    });
    expect(reopened.body.evidence).toHaveLength(1);
    expect((await buyer.api.get(`/v1/trades/${trade.id}`).expect(200)).body.status).toBe(
      "DISPUTED",
    );
  });
});

describe("deciding a dispute (AT-8)", () => {
  it("shows the resolver the terms the order was taken under", async () => {
    const { seller, offer, dispute } = await disputed();
    const resolver = await makeAdmin();

    // The advertiser rewrites the ad after the dispute is open. What the buyer
    // agreed to is part of the order, and does not move with it.
    await request(server())
      .patch(`/v1/offers/${offer.id}`)
      .set("Cookie", seller.cookie)
      .set("x-csrf-token", csrfFor(seller.cookie))
      .send({ terms: "Third-party payments are fine, actually." })
      .expect(200);

    const detail = (await adminGet(resolver, `/${dispute.id}`).expect(200))
      .body as AdminDisputeDetail;
    expect(detail.terms).toBe(TERMS);
  });

  it("is for the DISPUTE_RESOLVER role alone", async () => {
    const { buyer, seller, dispute } = await disputed();
    const body = { outcome: "RELEASE_TO_BUYER", note: NOTE };

    // The parties, with their customer sessions, are nobody in the admin realm -
    // neither of them can read the case and neither can decide it.
    await buyer.api.post(`/v1/admin/disputes/${dispute.id}/resolve`, body).expect(401);
    await buyer.api.get(`/v1/admin/disputes/${dispute.id}`).expect(401);
    await seller.api.post(`/v1/admin/disputes/${dispute.id}/resolve`, body).expect(401);
    await seller.api.get(`/v1/admin/disputes/${dispute.id}`).expect(401);
    await request(server()).post(`/v1/admin/disputes/${dispute.id}/resolve`).send(body).expect(401);

    // An administrator without the role is refused, and told why.
    const reviewer = await makeAdmin(["KYC_REVIEWER"]);
    await adminGet(reviewer, "").expect(403);
    await adminPost(reviewer, `/${dispute.id}/resolve`, body).expect(403);
    expect(await escrow(dispute.tradeId)).toBe(40n * USDT);

    /*
      The plan's fifth denial is "an admin who is a party to the trade". There
      is no such person to make: administrators live in their own table with
      their own sessions, and a trade's two sides are rows in another. So the
      test is of the separation itself rather than of a refusal - if these
      four ever stop holding, the fifth denial becomes writable and this test
      is where somebody should come back to.
    */
    const resolver = await makeAdmin();
    expect(await db.user.findUnique({ where: { email: resolver.email } })).toBeNull();
    const row = await db.trade.findUniqueOrThrow({ where: { id: dispute.tradeId } });
    expect(
      await db.adminUser.findMany({ where: { id: { in: [row.buyerId, row.sellerId] } } }),
    ).toEqual([]);
    // And it does not work in the other direction either: an admin session is
    // not a customer session, so a resolver cannot act as a party anywhere.
    await request(server())
      .get(`/v1/trades/${dispute.tradeId}`)
      .set("Cookie", resolver.cookie)
      .expect(401);
  });

  it("releases to the buyer with a full record: ledger, audit, both parties, timeline", async () => {
    const { seller, buyer, trade, dispute } = await disputed();
    await buyer.api
      .raw(`/v1/trades/${trade.id}/dispute/evidence`, "image/png", fakePng())
      .expect(201);
    await seller.api
      .post(`/v1/trades/${trade.id}/messages`, {
        clientMessageId: "d-0001-aaaa",
        body: "Nothing here yet.",
      })
      .expect(201);
    const resolver = await makeAdmin();

    const queue = (await adminGet(resolver, "").expect(200)).body as AdminDisputeQueueResponse;
    const item = queue.open.find((entry) => entry.id === dispute.id);
    expect(item).toMatchObject({
      status: "OPEN",
      reason: "PAYMENT_NOT_RELEASED",
      openedBy: "BUYER",
      evidenceCount: 1,
      trade: {
        id: trade.id,
        status: "DISPUTED",
        amount: (40n * USDT).toString(),
        paymentReference: "FT-2409-1123",
      },
    });
    expect(item?.buyer.customer?.userId).toBe(buyer.userId);
    expect(item?.seller.customer?.email).toBe(seller.email);
    expect(item?.seller.tradesTotal).toBe(1);

    // Everything the decision can rest on, and a record that it was looked at.
    const detail = (await adminGet(resolver, `/${dispute.id}`).expect(200))
      .body as AdminDisputeDetail;
    expect(detail.payment.instructions.accountNumber).toBe("0912345678");
    expect(detail.evidence).toHaveLength(1);
    expect(detail.evidence[0]?.uploadedBy).toBe("BUYER");
    expect(detail.messages.map((message) => message.body)).toEqual([
      AUTO_REPLY,
      "Nothing here yet.",
    ]);
    expect(detail.events.map((event) => `${event.kind}:${event.actor}`)).toEqual([
      "CREATED:BUYER",
      "MARKED_PAID:BUYER",
      "DISPUTE_OPENED:BUYER",
    ]);
    const viewed = await db.auditEvent.findFirst({
      where: { action: "dispute.viewed", subjectId: dispute.id },
    });
    expect(viewed?.actorEmail).toBe(resolver.email);
    const file = await adminGet(
      resolver,
      `/${dispute.id}/evidence/${detail.evidence[0]?.id ?? ""}`,
    ).expect(200);
    expect(file.headers["content-type"]).toMatch(/^image\/png/);

    const noNote = await adminPost(resolver, `/${dispute.id}/resolve`, {
      outcome: "RELEASE_TO_BUYER",
      note: "ok",
    }).expect(400);
    expect(noNote.body.error.details[0].path).toBe("note");

    const requestId = uniq("decide");
    const decided = await adminPost(
      resolver,
      `/${dispute.id}/resolve`,
      { outcome: "RELEASE_TO_BUYER", note: NOTE },
      requestId,
    ).expect(200);
    expect(decided.body).toMatchObject({
      status: "RESOLVED",
      outcome: "RELEASE_TO_BUYER",
      resolutionNote: NOTE,
      resolvedByEmail: resolver.email,
      trade: { status: "COMPLETED" },
    });

    // JE-6: the release shape, under the dispute's own reason.
    expect(await legs(trade.id, "DISPUTE_RESOLVED_RELEASE")).toEqual([
      "AVAILABLE CREDIT 40000000",
      "ESCROW DEBIT 40000000",
      "TRADE_FEES CREDIT 0",
    ]);
    expect(await escrow(trade.id)).toBe(0n);
    expect(await available(buyer.userId)).toBe(40n * USDT);
    expect(await available(seller.userId)).toBe(60n * USDT);

    // The audit event: who, why, what changed, what they looked at.
    const audit = await db.auditEvent.findFirst({
      where: { action: "dispute.resolved_release", subjectId: dispute.id },
    });
    expect(audit?.actorEmail).toBe(resolver.email);
    expect(audit?.actorAdminId).toBe(resolver.id);
    // The request that caused it, so the event, the logs and the ledger row
    // can be put beside each other afterwards.
    expect(audit?.correlationId).toBe(requestId);
    expect(audit?.reason).toBe(NOTE);
    expect(audit?.before).toMatchObject({
      tradeStatus: "DISPUTED",
      disputeStatus: "OPEN",
      openedBy: "BUYER",
      reason: "PAYMENT_NOT_RELEASED",
    });
    expect(audit?.after).toMatchObject({ tradeStatus: "COMPLETED", outcome: "RELEASE_TO_BUYER" });
    expect((audit?.after as { evidenceIds: string[] }).evidenceIds).toEqual([
      detail.evidence[0]?.id,
    ]);

    // Both parties, with the note; and the trade reads the decision from either side.
    for (const userId of [buyer.userId, seller.userId]) {
      const told = await db.notification.findFirst({ where: { userId, type: "DISPUTE_RESOLVED" } });
      expect(told?.body).toContain(NOTE);
    }
    const view = await seller.api.get(`/v1/trades/${trade.id}`).expect(200);
    expect(view.body.dispute).toMatchObject({
      status: "RESOLVED",
      outcome: "RELEASE_TO_BUYER",
      resolutionNote: NOTE,
    });
    const timeline = (await buyer.api.get(`/v1/trades/${trade.id}/events`).expect(200)).body
      .events as {
      kind: string;
      actor: string;
    }[];
    expect(timeline.map((event) => `${event.kind}:${event.actor}`)).toEqual([
      "CREATED:ME",
      "MARKED_PAID:ME",
      "DISPUTE_OPENED:ME",
      "DISPUTE_RESOLVED:ADMIN",
    ]);

    // Decided once. A second decision finds a closed trade, and moves nothing.
    const again = await adminPost(resolver, `/${dispute.id}/resolve`, {
      outcome: "REFUND_TO_SELLER",
      note: NOTE,
    }).expect(409);
    expect(again.body.error.code).toBe("CONFLICT");
    expect(await available(buyer.userId)).toBe(40n * USDT);
    const recent = (await adminGet(resolver, "").expect(200)).body as AdminDisputeQueueResponse;
    expect(recent.recent.map((entry) => entry.id)).toContain(dispute.id);
    expect(recent.open.map((entry) => entry.id)).not.toContain(dispute.id);
  });

  it("refunds the seller when decided the other way, reversing the lock (JE-5 shape)", async () => {
    const { seller, buyer, offer, trade, dispute } = await disputed();
    await seller.api
      .raw(`/v1/trades/${trade.id}/dispute/evidence`, "image/png", fakePng())
      .expect(201);
    const resolver = await makeAdmin();
    const detail = (await adminGet(resolver, `/${dispute.id}`).expect(200))
      .body as AdminDisputeDetail;

    const refundNote = "No transfer reached the seller's account by the time of review.";
    const requestId = uniq("decide");
    const decided = await adminPost(
      resolver,
      `/${dispute.id}/resolve`,
      { outcome: "REFUND_TO_SELLER", note: refundNote },
      requestId,
    ).expect(200);
    expect(decided.body.trade.status).toBe("REFUNDED");

    expect(await legs(trade.id, "DISPUTE_RESOLVED_REFUND")).toEqual([
      "AVAILABLE CREDIT 40000000",
      "ESCROW DEBIT 40000000",
    ]);
    const refund = await db.ledgerTransaction.findFirstOrThrow({
      where: { referenceType: "trade", referenceId: trade.id, reason: "DISPUTE_RESOLVED_REFUND" },
    });
    const lock = await db.ledgerTransaction.findFirstOrThrow({
      where: { referenceType: "trade", referenceId: trade.id, reason: "ESCROW_LOCKED" },
    });
    expect(refund.reversesTransactionId).toBe(lock.id);
    expect(refund.actorType).toBe("ADMIN");
    expect(await escrow(trade.id)).toBe(0n);
    expect(await available(seller.userId)).toBe(100n * USDT);
    expect(await available(buyer.userId)).toBe(0n);

    // What did not sell goes back on the offer; the buyer's record notes the failure.
    const mine = await seller.api.get(`/v1/offers/${offer.id}/mine`).expect(200);
    expect(mine.body.remainingAmount).toBe((100n * USDT).toString());
    const stats = await db.traderStats.findUniqueOrThrow({ where: { userId: buyer.userId } });
    expect(stats).toMatchObject({ tradesTotal: 1, tradesFailed: 1 });
    const audit = await db.auditEvent.findFirst({
      where: { action: "dispute.resolved_refund", subjectId: dispute.id },
    });
    expect(audit?.actorEmail).toBe(resolver.email);
    expect(audit?.actorAdminId).toBe(resolver.id);
    expect(audit?.correlationId).toBe(requestId);
    expect(audit?.reason).toBe(refundNote);
    expect(audit?.before).toMatchObject({
      tradeStatus: "DISPUTED",
      disputeStatus: "OPEN",
      openedBy: "BUYER",
      reason: "PAYMENT_NOT_RELEASED",
    });
    expect(audit?.after).toMatchObject({
      tradeStatus: "REFUNDED",
      sellerRefund: (40n * USDT).toString(),
    });
    expect((audit?.after as { evidenceIds: string[] }).evidenceIds).toEqual([
      detail.evidence[0]?.id,
    ]);
    const view = await buyer.api.get(`/v1/trades/${trade.id}`).expect(200);
    expect(view.body.status).toBe("REFUNDED");
    expect(view.body.message).toMatch(/seller's favour/i);

    // The whole story, from either side, without reading the audit log.
    const timeline = (await seller.api.get(`/v1/trades/${trade.id}/events`).expect(200)).body
      .events as { kind: string; actor: string }[];
    expect(timeline.map((event) => `${event.kind}:${event.actor}`)).toEqual([
      "CREATED:COUNTERPARTY",
      "MARKED_PAID:COUNTERPARTY",
      "DISPUTE_OPENED:COUNTERPARTY",
      "DISPUTE_RESOLVED:ADMIN",
    ]);
  });

  it("ends without a person when the seller releases after all", async () => {
    const { seller, buyer, trade, dispute } = await disputed();
    const resolver = await makeAdmin();

    await seller.api.post(`/v1/trades/${trade.id}/release`, { password: PASSWORD }).expect(200);
    expect(await available(buyer.userId)).toBe(40n * USDT);
    const view = await buyer.api.get(`/v1/trades/${trade.id}`).expect(200);
    expect(view.body.status).toBe("COMPLETED");
    expect(view.body.dispute).toMatchObject({
      status: "RESOLVED",
      outcome: "RELEASE_TO_BUYER",
      resolutionNote: "The seller released the USDT.",
    });
    const decidedBy = await db.dispute.findUniqueOrThrow({ where: { id: dispute.id } });
    expect(decidedBy.resolvedByEmail).toBeNull();

    // Nothing left for a reviewer to decide.
    await adminPost(resolver, `/${dispute.id}/resolve`, {
      outcome: "REFUND_TO_SELLER",
      note: NOTE,
    }).expect(409);
    expect(await escrow(trade.id)).toBe(0n);
  });
});
