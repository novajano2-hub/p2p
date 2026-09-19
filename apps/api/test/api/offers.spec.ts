import {
  type MarketplaceOffer,
  type OfferView,
  type PaymentMethodDetailView,
} from "@abay/contracts";
import { createPrismaClient, type PrismaClient } from "@abay/database";
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import { PinoLogger } from "nestjs-pino";
import request from "supertest";

import { createApp } from "@/app";
import { loadEnv, type Env } from "@/config/env";
import { RedisService } from "@/infra/redis/redis.service";
import { accounts } from "@/modules/ledger/account-code";
import { LedgerService } from "@/modules/ledger/ledger.service";
import { FUNDING_LOCK_KEY, OfferFundingWatcher } from "@/modules/offers/offer-funding.watcher";
import { OfferService } from "@/modules/offers/offer.service";
import {
  PAYMENT_METHOD_PURPOSE,
  PaymentDetailsCipher,
} from "@/modules/payment-methods/payment-details.cipher";

import { csrfFor, listed, registerFully, uniqueEmail } from "./helpers";

/*
  Phase 4, stage 1: where a seller is paid, and what the marketplace lists.

  Two things matter most here. Payment instructions are RESTRICTED data:
  they must be unreadable in the database, invisible in a list, and reachable
  by nobody but their owner. And an offer must never promise what its owner
  cannot deliver: a SELL offer is listed only as far as the seller can fund
  it this minute, because the escrow is taken when a trade opens, not when
  the offer is posted.

  Every correlation id and email here starts with "test-", which is how
  global-teardown.js knows which rows are its to clear.
*/

let app: NestFastifyApplication;
let db: PrismaClient;
let env: Env;
let ledger: LedgerService;
let cipher: PaymentDetailsCipher;
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
  cipher = app.get(PaymentDetailsCipher);
});

afterAll(async () => {
  await db.$disconnect();
  await app.close();
});

/* ------------------------------------------------------------- helpers */

/** A signed-in customer, verified unless told otherwise, funded if asked. */
async function customer(options: { verified?: boolean; usdt?: bigint } = {}) {
  const { cookie, userId } = await registerFully(server(), db, uniqueEmail());
  if (options.verified !== false) {
    await db.user.update({ where: { id: userId }, data: { kycStatus: "APPROVED" } });
  }
  if (options.usdt && options.usdt > 0n) {
    await ledger.post({
      reason: "OPENING_BALANCE",
      asset: "USDT",
      reference: { type: "fixture", id: uniq("fund") },
      actor: { type: "SYSTEM" },
      correlationId: uniq("corr"),
      idempotencyKey: uniq("fund"),
      lines: [
        {
          account: accounts.platform("OPENING_BALANCE"),
          direction: "DEBIT",
          amount: options.usdt * USDT,
        },
        {
          account: accounts.userAvailable(userId),
          direction: "CREDIT",
          amount: options.usdt * USDT,
        },
      ],
    });
  }
  return { cookie, userId, api: api(cookie) };
}

/** Requests as one customer, with the cookie, the CSRF token and a test request id. */
function api(cookie: string) {
  const headers = (test: request.Test) =>
    test
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfFor(cookie))
      .set("x-request-id", uniq("req"));
  return {
    get: (path: string) => headers(request(server()).get(path)),
    post: (path: string, body?: object) => headers(request(server()).post(path)).send(body ?? {}),
    patch: (path: string, body: object) => headers(request(server()).patch(path)).send(body),
    del: (path: string) => headers(request(server()).delete(path)),
  };
}
type Api = ReturnType<typeof api>;

const TELEBIRR = { kind: "TELEBIRR", accountHolder: "Abebe Bikila", phone: "+251912345678" };
const AWASH = {
  kind: "AWASH",
  accountHolder: "Abebe Bikila",
  accountNumber: "01320123456789",
};

async function addMethod(who: Api, body: object = TELEBIRR): Promise<PaymentMethodDetailView> {
  const response = await who.post("/v1/payment-methods", body).expect(201);
  return response.body as PaymentMethodDetailView;
}

/** A SELL offer: 100 USDT at 158.50 birr, 10 to 20,000 birr a trade, unless overridden. */
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
      terms: "Telebirr only, no third-party payments.",
      ...overrides,
    })
    .expect(201);
  return response.body as OfferView;
}

/* ------------------------------------------------------ payment methods */

describe("payment methods", () => {
  it("reads a document from before the banks were kinds by the row's kind", async () => {
    const { api: me, userId } = await customer();
    // What such a row holds: the old shape inside, the corrected kind beside it.
    const legacy = {
      kind: "BANK_TRANSFER",
      bankCode: "CBE",
      bankName: "Commercial Bank of Ethiopia",
      accountHolder: "Abebe Bikila",
      accountNumber: "1000123456789",
      branch: null,
    };
    const row = await db.paymentMethod.create({
      data: {
        userId,
        kind: "CBE",
        label: "CBE ····6789",
        hint: "6789",
        detailsEncrypted: cipher.encrypt(legacy as never, PAYMENT_METHOD_PURPOSE),
      },
    });

    const read = await me.get(`/v1/payment-methods/${row.id}`).expect(200);
    expect(read.body.instructions).toEqual({
      kind: "CBE",
      accountHolder: "Abebe Bikila",
      accountNumber: "1000123456789",
    });
  });

  it("keeps the instructions encrypted and lists a method by its label alone", async () => {
    const { api: me, userId } = await customer();

    const created = await addMethod(me);
    expect(created.kind).toBe("TELEBIRR");
    expect(created.label).toBe("Telebirr ····5678");
    expect(created.hint).toBe("5678");
    expect(created.instructions).toEqual({
      kind: "TELEBIRR",
      accountHolder: "Abebe Bikila",
      accountNumber: "0912345678",
    });

    // What the database holds: a versioned ciphertext, and not a digit of the number.
    const row = await db.paymentMethod.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.userId).toBe(userId);
    expect(row.detailsEncrypted.startsWith("v1.")).toBe(true);
    expect(row.detailsEncrypted).not.toContain("0912345678");
    expect(row.detailsEncrypted).not.toContain("Abebe");

    const list = await me.get("/v1/payment-methods").expect(200);
    expect(list.body.paymentMethods).toHaveLength(1);
    expect(list.body.paymentMethods[0]).not.toHaveProperty("instructions");
    expect(list.body.paymentMethods[0].label).toBe("Telebirr ····5678");

    const whole = await me.get(`/v1/payment-methods/${created.id}`).expect(200);
    expect(whole.body.instructions.accountNumber).toBe("0912345678");
  });

  it("writes an Ethiopian mobile number the same way however it was typed", async () => {
    const { api: me } = await customer();
    for (const phone of ["0912345678", "251912345678", "912345678", "+251 912345678"]) {
      const created = await me
        .post("/v1/payment-methods", { ...TELEBIRR, phone: phone.replace(/\s/g, "") })
        .expect(201);
      expect(created.body.instructions.accountNumber).toBe("0912345678");
    }
    // Safaricom numbers start with 7 and are just as Ethiopian.
    const mpesa = await addMethod(me, {
      kind: "MPESA",
      accountHolder: "Sara",
      phone: "0712345678",
    });
    expect(mpesa.instructions.accountNumber).toBe("0712345678");
  });

  it("treats a bank as a method of its own, named by the bank", async () => {
    const { api: me } = await customer();
    // A branch and a bank code were once asked for here. A client that still
    // sends them is not refused; they are simply not kept - the bank is the
    // kind, and a transfer needs the account, not the desk it was opened at.
    const bank = await addMethod(me, { ...AWASH, bankCode: "AWASH", branch: "Bole" });
    expect(bank.kind).toBe("AWASH");
    expect(bank.label).toBe("Awash Bank ····6789");
    expect(bank.instructions).toEqual({
      kind: "AWASH",
      accountHolder: "Abebe Bikila",
      accountNumber: "01320123456789",
    });
    expect(bank).not.toHaveProperty("bankCode");

    const cbe = await addMethod(me, { ...AWASH, kind: "CBE", accountNumber: "1000123456789" });
    expect(cbe.label).toBe("CBE ····6789");

    // The old catch-all is gone: a bank has to be named.
    const generic = await me
      .post("/v1/payment-methods", { ...AWASH, kind: "BANK_TRANSFER" })
      .expect(400);
    expect(generic.body.error.code).toBe("VALIDATION_FAILED");
    // ...and a bank without an account number is not a place to pay.
    const missing = await me
      .post("/v1/payment-methods", { kind: "DASHEN", accountHolder: "Abebe Bikila" })
      .expect(400);
    expect(missing.body.error.code).toBe("VALIDATION_FAILED");

    const badPhone = await me
      .post("/v1/payment-methods", { ...TELEBIRR, phone: "12345" })
      .expect(400);
    const details = badPhone.body.error.details as { path: string }[];
    expect(details.map((d) => d.path)).toContain("phone");
  });

  it("is invisible to every other customer", async () => {
    const { api: owner } = await customer();
    const { api: other } = await customer();
    const created = await addMethod(owner);

    await other.get(`/v1/payment-methods/${created.id}`).expect(404);
    await other.del(`/v1/payment-methods/${created.id}`).expect(404);
    const theirs = await other.get("/v1/payment-methods").expect(200);
    expect(theirs.body.paymentMethods).toEqual([]);

    // Still the owner's, untouched.
    await owner.get(`/v1/payment-methods/${created.id}`).expect(200);
  });

  it("archives rather than deletes, and not while an offer names it", async () => {
    const { api: me } = await customer({ usdt: 200n });
    const method = await addMethod(me);
    const offer = await sellOffer(me, method.id);

    const refused = await me.del(`/v1/payment-methods/${method.id}`).expect(409);
    expect(refused.body.error.message).toMatch(/offers/i);

    await me.post(`/v1/offers/${offer.id}/close`).expect(200);
    await me.del(`/v1/payment-methods/${method.id}`).expect(204);
    // Twice is fine: the second archive has nothing to do.
    await me.del(`/v1/payment-methods/${method.id}`).expect(204);

    const list = await me.get("/v1/payment-methods").expect(200);
    expect(list.body.paymentMethods).toEqual([]);
    // History can still be read: a trade that snapshotted it points here.
    const archived = await me.get(`/v1/payment-methods/${method.id}`).expect(200);
    expect(archived.body.status).toBe("ARCHIVED");
  });

  it("keeps at most ten", async () => {
    const { api: me } = await customer();
    for (let i = 0; i < 10; i++) {
      await addMethod(me, { ...TELEBIRR, phone: `09123456${String(i).padStart(2, "0")}` });
    }
    const eleventh = await me.post("/v1/payment-methods", TELEBIRR).expect(409);
    expect(eleventh.body.error.code).toBe("CONFLICT");
  });
});

/* ---------------------------------------------------------------- offers */

describe("offers", () => {
  it("can be posted only by a verified account, naming its own live methods", async () => {
    const { api: unverified } = await customer({ verified: false, usdt: 100n });
    const method = await addMethod(unverified);
    const refused = await unverified
      .post("/v1/offers", {
        side: "SELL",
        priceSantim: "15850",
        totalAmount: (50n * USDT).toString(),
        minSantim: "1000",
        maxSantim: "500000",
        paymentWindowMinutes: 15,
        paymentMethodIds: [method.id],
      })
      .expect(403);
    expect(refused.body.error.message).toMatch(/verify/i);

    const { api: verified } = await customer({ usdt: 100n });
    // Somebody else's method: not theirs to be paid through.
    const notMine = await verified
      .post("/v1/offers", {
        side: "SELL",
        priceSantim: "15850",
        totalAmount: (50n * USDT).toString(),
        minSantim: "1000",
        maxSantim: "500000",
        paymentWindowMinutes: 15,
        paymentMethodIds: [method.id],
      })
      .expect(400);
    expect(notMine.body.error.details[0].path).toBe("paymentMethodIds");

    const own = await addMethod(verified);
    const offer = await sellOffer(verified, own.id);
    expect(offer.status).toBe("ACTIVE");
    expect(offer.remainingAmount).toBe(offer.totalAmount);
    // A new ad is the first version of itself, with nothing running against it.
    expect(offer.revision).toBe(1);
    expect(offer.openOrders).toBe(0);
    expect(offer.paymentMethods).toEqual([
      { kind: "TELEBIRR", paymentMethodId: own.id, label: "Telebirr ····5678" },
    ]);

    const mine = await verified.get("/v1/offers/mine").expect(200);
    expect((mine.body.offers as OfferView[]).map((o) => o.id)).toEqual([offer.id]);
  });

  it("refuses limits that no trade could ever meet", async () => {
    const { api: me } = await customer({ usdt: 10n });
    const method = await addMethod(me);

    const inverted = await me
      .post("/v1/offers", {
        side: "SELL",
        priceSantim: "15850",
        totalAmount: (10n * USDT).toString(),
        minSantim: "50000",
        maxSantim: "1000",
        paymentWindowMinutes: 15,
        paymentMethodIds: [method.id],
      })
      .expect(400);
    expect(inverted.body.error.details[0].path).toBe("maxSantim");

    // 1 USDT at 150.00 birr is worth 150 birr; a 200 birr minimum can never be met.
    const unreachable = await me
      .post("/v1/offers", {
        side: "SELL",
        priceSantim: "15000",
        totalAmount: (1n * USDT).toString(),
        minSantim: "20000",
        maxSantim: "20000",
        paymentWindowMinutes: 15,
        paymentMethodIds: [method.id],
      })
      .expect(400);
    expect(unreachable.body.error.details[0].path).toBe("minSantim");
  });

  it("lists a SELL offer only as far as the seller can fund it", async () => {
    const { api: seller, userId: sellerId } = await customer({ usdt: 50n });
    const { api: broke } = await customer({ usdt: 0n });
    const { api: buyer } = await customer();

    const sellerMethod = await addMethod(seller);
    const brokeMethod = await addMethod(broke);
    const offer = await sellOffer(seller, sellerMethod.id);
    const unfunded = await sellOffer(broke, brokeMethod.id);

    const market = await listed(buyer, "BUY");
    const shown = market.find((o) => o.id === offer.id);
    expect(shown).toBeDefined();
    // 100 USDT posted, 50 in the account: 50 is what a buyer could take.
    expect(shown?.available).toBe((50n * USDT).toString());
    // ...and the maximum is capped by it: 50 USDT at 158.50 = 7,925.00 birr.
    expect(shown?.maxSantim).toBe("792500");
    expect(shown?.minSantim).toBe("1000");
    expect(shown?.paymentKinds).toEqual(["TELEBIRR"]);
    expect(shown?.isMine).toBe(false);
    expect(shown?.advertiser.userId).toBe(sellerId);
    expect(shown?.advertiser.verified).toBe(true);
    expect(shown?.advertiser.completionRate).toBeNull();
    expect(shown).not.toHaveProperty("autoReply");

    expect(market.find((o) => o.id === unfunded.id)).toBeUndefined();
    await buyer.get(`/v1/offers/${unfunded.id}`).expect(404);

    const own = await listed(seller, "BUY");
    expect(own.find((o) => o.id === offer.id)?.isMine).toBe(true);

    const one = await buyer.get(`/v1/offers/${offer.id}`).expect(200);
    expect(one.body.available).toBe((50n * USDT).toString());
  });

  it("lists a BUY offer by what remains, whatever the buyer holds", async () => {
    const { api: buyer } = await customer({ usdt: 0n });
    const { api: seller } = await customer();
    const offer = await buyer
      .post("/v1/offers", {
        side: "BUY",
        priceSantim: "15800",
        totalAmount: (30n * USDT).toString(),
        minSantim: "10000",
        maxSantim: "100000000",
        paymentWindowMinutes: 45,
        paymentKinds: ["TELEBIRR", "CBE_BIRR", "TELEBIRR"],
      })
      .expect(201);
    expect(offer.body.paymentMethods).toEqual([
      { kind: "TELEBIRR", paymentMethodId: null, label: null },
      { kind: "CBE_BIRR", paymentMethodId: null, label: null },
    ]);

    const market = await listed(seller, "SELL");
    const shown = market.find((o) => o.id === offer.body.id);
    expect(shown?.available).toBe((30n * USDT).toString());
    // 30 USDT at 158.00 = 4,740.00 birr caps a 1,000,000 birr maximum.
    expect(shown?.maxSantim).toBe("474000");
    expect(shown?.paymentKinds).toEqual(["CBE_BIRR", "TELEBIRR"]);
    // A BUY offer is not in the list of things to buy.
    expect((await listed(seller, "BUY")).find((o) => o.id === offer.body.id)).toBeUndefined();
  });

  it("filters by the amount a taker means to trade and by the rail they can use", async () => {
    const { api: seller } = await customer({ usdt: 50n });
    const { api: buyer } = await customer();
    const telebirr = await addMethod(seller);
    const cbe = await addMethod(seller, {
      kind: "CBE_BIRR",
      accountHolder: "Abebe",
      phone: "0911111111",
    });
    const offer = await sellOffer(seller, telebirr.id, { paymentMethodIds: [telebirr.id, cbe.id] });

    // 3,000 birr is inside 10 .. 7,925; 8,000 birr is not.
    const inside = await listed(buyer, "BUY", "&amountSantim=300000");
    expect(inside.map((o) => o.id)).toContain(offer.id);
    const outside = await listed(buyer, "BUY", "&amountSantim=800000");
    expect(outside.map((o) => o.id)).not.toContain(offer.id);

    const byCbe = await listed(buyer, "BUY", "&paymentKind=CBE_BIRR");
    expect(byCbe.map((o) => o.id)).toContain(offer.id);
    const byMpesa = await listed(buyer, "BUY", "&paymentKind=MPESA");
    expect(byMpesa.map((o) => o.id)).not.toContain(offer.id);

    await seller.post(`/v1/offers/${offer.id}/close`).expect(200);
  });

  it("orders by price, best first, and pages with a cursor", async () => {
    const { api: seller } = await customer({ usdt: 500n });
    const { api: buyer } = await customer();
    const mpesa = await addMethod(seller, {
      kind: "MPESA",
      accountHolder: "Abebe",
      phone: "0712121212",
    });
    // Prices nobody else in the database would post, so the page is ours alone.
    const prices = ["9000300", "9000100", "9000200"];
    const ids: Record<string, string> = {};
    for (const price of prices) {
      const offer = await sellOffer(seller, mpesa.id, {
        priceSantim: price,
        maxSantim: "900030000",
      });
      ids[price] = offer.id;
    }

    const first = await buyer.get("/v1/offers?want=BUY&paymentKind=MPESA&limit=2").expect(200);
    expect((first.body.offers as MarketplaceOffer[]).map((o) => o.priceSantim)).toEqual([
      "9000100",
      "9000200",
    ]);
    expect(first.body.nextCursor).toEqual(expect.any(String));

    const second = await buyer
      .get(`/v1/offers?want=BUY&paymentKind=MPESA&limit=2&cursor=${first.body.nextCursor}`)
      .expect(200);
    expect((second.body.offers as MarketplaceOffer[]).map((o) => o.priceSantim)).toEqual([
      "9000300",
    ]);
    expect(second.body.nextCursor).toBeNull();

    await buyer.get("/v1/offers?want=BUY&cursor=nonsense").expect(400);

    for (const id of Object.values(ids)) await seller.post(`/v1/offers/${id}/close`).expect(200);
  });

  it("is edited, paused, resumed and closed by its owner and nobody else", async () => {
    const { api: seller } = await customer({ usdt: 200n });
    const { api: other } = await customer();
    const method = await addMethod(seller);
    const offer = await sellOffer(seller, method.id);

    await other.patch(`/v1/offers/${offer.id}`, { priceSantim: "16000" }).expect(404);
    await other.post(`/v1/offers/${offer.id}/pause`).expect(404);

    // Pretend a trade took 20 USDT, then raise the total: what was taken is kept.
    await db.offer.update({
      where: { id: offer.id },
      data: { remainingAmount: 80n * USDT },
    });
    const edited = await seller
      .patch(`/v1/offers/${offer.id}`, {
        totalAmount: (150n * USDT).toString(),
        priceSantim: "16000",
        terms: "",
      })
      .expect(200);
    expect(edited.body.totalAmount).toBe((150n * USDT).toString());
    expect(edited.body.remainingAmount).toBe((130n * USDT).toString());
    expect(edited.body.priceSantim).toBe("16000");
    expect(edited.body.terms).toBeNull();
    // Below what open trades hold is refused.
    const tooLow = await seller
      .patch(`/v1/offers/${offer.id}`, { totalAmount: (10n * USDT).toString() })
      .expect(400);
    expect(tooLow.body.error.details[0].path).toBe("totalAmount");

    const paused = await seller.post(`/v1/offers/${offer.id}/pause`).expect(200);
    expect(paused.body.status).toBe("PAUSED");
    expect((await listed(other, "BUY")).find((o) => o.id === offer.id)).toBeUndefined();
    await other.get(`/v1/offers/${offer.id}`).expect(404);
    // Its owner can still read it whole.
    await seller.get(`/v1/offers/${offer.id}/mine`).expect(200);

    const resumed = await seller.post(`/v1/offers/${offer.id}/resume`).expect(200);
    expect(resumed.body.status).toBe("ACTIVE");
    expect((await listed(other, "BUY")).find((o) => o.id === offer.id)).toBeDefined();

    const closed = await seller.post(`/v1/offers/${offer.id}/close`).expect(200);
    expect(closed.body.status).toBe("CLOSED");
    const reopened = await seller.post(`/v1/offers/${offer.id}/resume`).expect(409);
    expect(reopened.body.error.code).toBe("CONFLICT");
    await seller.patch(`/v1/offers/${offer.id}`, { priceSantim: "16100" }).expect(409);
  });

  it("allows a handful of live offers per account", async () => {
    const { api: me } = await customer({ usdt: 1_000n });
    const method = await addMethod(me);
    for (let i = 0; i < env.OFFER_MAX_PER_USER; i++) await sellOffer(me, method.id);
    const oneMore = await me
      .post("/v1/offers", {
        side: "SELL",
        priceSantim: "15850",
        totalAmount: (10n * USDT).toString(),
        minSantim: "1000",
        maxSantim: "100000",
        paymentWindowMinutes: 15,
        paymentMethodIds: [method.id],
      })
      .expect(409);
    expect(oneMore.body.error.message).toMatch(/close one/i);
  });
});

/* ------------------------------------------- the market's filters */

/*
  Phase 5, stage 5. Two filters from Binance's popover - the time a buyer has
  to pay, and "only ads I can take" - and, on every ad, why this viewer could
  not take it, which is what its Limited button says. The rules are the trade
  engine's own, so nothing the filter lets through is refused at order time.
*/
describe("the market's filters, and what its viewer can take", () => {
  const find = (list: MarketplaceOffer[], id: string) => list.find((o) => o.id === id);

  it("filters by time to pay, and says why an ad cannot be taken - or leaves it out", async () => {
    const { api: seller } = await customer({ usdt: 500n });
    const method = await addMethod(seller);
    const quick = await sellOffer(seller, method.id, { paymentWindowMinutes: 15 });
    const verifiedOnly = await sellOffer(seller, method.id, {
      paymentWindowMinutes: 45,
      requireVerified: true,
    });
    const experienced = await sellOffer(seller, method.id, {
      paymentWindowMinutes: 60,
      minCompletedTrades: 5,
    });

    // A newcomer: not verified, no trades yet.
    const { api: newcomer } = await customer({ verified: false });
    const all = await listed(newcomer, "BUY");
    expect(find(all, quick.id)?.blockedBecause).toBeNull();
    expect(find(all, verifiedOnly.id)?.blockedBecause).toBe("VERIFICATION");
    expect(find(all, experienced.id)?.blockedBecause).toBe("COMPLETED_TRADES");
    // One ad on its own says the same.
    const one = await newcomer.get(`/v1/offers/${verifiedOnly.id}`).expect(200);
    expect(one.body.blockedBecause).toBe("VERIFICATION");

    // Only the ads that give the buyer exactly 45 minutes: not 15, not 60.
    const slow = await listed(newcomer, "BUY", "&paymentWindowMinutes=45");
    expect(find(slow, quick.id)).toBeUndefined();
    expect(find(slow, verifiedOnly.id)).toBeDefined();
    expect(find(slow, experienced.id)).toBeUndefined();
    expect(slow.every((o) => o.paymentWindowMinutes === 45)).toBe(true);

    // Only the ads the newcomer could take.
    const takeable = await listed(newcomer, "BUY", "&takeable=true");
    expect(find(takeable, quick.id)).toBeDefined();
    expect(find(takeable, verifiedOnly.id)).toBeUndefined();
    expect(find(takeable, experienced.id)).toBeUndefined();
    expect(takeable.every((o) => o.blockedBecause === null && !o.isMine)).toBe(true);

    // Verified, the second opens up; the third still wants five trades.
    const { api: verified } = await customer();
    const forVerified = await listed(verified, "BUY", "&takeable=true");
    expect(find(forVerified, verifiedOnly.id)).toBeDefined();
    expect(find(forVerified, experienced.id)).toBeUndefined();
    // Nobody can take their own ad, so it is left out for its owner.
    expect(find(await listed(seller, "BUY", "&takeable=true"), quick.id)).toBeUndefined();
    expect(find(await listed(seller, "BUY"), quick.id)?.isMine).toBe(true);

    // A value the market does not offer is refused, not ignored.
    await newcomer.get("/v1/offers?want=BUY&paymentWindowMinutes=20").expect(400);
    await newcomer.get("/v1/offers?want=BUY&takeable=perhaps").expect(400);
  });
});

/* --------------------------------------------------- the ad balance */

/*
  Phase 5, stage 4. An ad locks nothing, so a seller may post more than they
  hold, as on Binance; the market shows a sell ad only while their balance
  covers its smallest order. The owner is shown why when it does not, told
  once, and the ad goes offline after a day of it. The worker's pass
  (OfferService.checkFunding) is run here by hand, over this file's own ads
  only, and with the clock moved rather than waited for.
*/
describe("an ad its seller's balance cannot cover", () => {
  const HOUR = 3_600_000;
  /** 1,000.00 birr: at 158.50 that takes 6.309117 USDT. */
  const THOUSAND_BIRR = "100000";

  const mine = async (who: Api, id: string) =>
    (await who.get(`/v1/offers/${id}/mine`).expect(200)).body as OfferView;

  const told = async (who: Api) =>
    (
      (await who.get("/v1/notifications").expect(200)).body as {
        notifications: { type: string; title: string; body: string; link: string | null }[];
      }
    ).notifications.filter((item) => item.type.startsWith("OFFER_"));

  const pass = (offerIds: string[], now?: Date) =>
    app.get(OfferService).checkFunding({ offerIds, ...(now ? { now } : {}) });

  /*
    Held through each test: a worker running against this database - a
    developer's own, say - takes its turn only when the lock is free, so none
    runs a pass between the steps below and answers for them.
  */
  const HOLDER = "offers.spec";
  beforeEach(async () => {
    await app.get(RedisService).client.set(FUNDING_LOCK_KEY, HOLDER, "PX", 60_000);
  });
  afterEach(async () => {
    const redis = app.get(RedisService).client;
    if ((await redis.get(FUNDING_LOCK_KEY)) === HOLDER) await redis.del(FUNDING_LOCK_KEY);
  });

  it("can be posted above the balance, and shows its owner what it can offer and why it is hidden", async () => {
    const { api: seller } = await customer({ usdt: 10n });
    const { api: buyer } = await customer();
    const method = await addMethod(seller);

    // 100 USDT advertised on 10 held: allowed, and it offers the 10.
    const ad = await sellOffer(seller, method.id, { minSantim: THOUSAND_BIRR });
    expect(ad.adBalance).toBe((10n * USDT).toString());
    expect(ad.hiddenBecause).toBeNull();
    expect(ad.unfundedSince).toBeNull();
    expect(ad.pausesAt).toBeNull();
    expect((await listed(buyer, "BUY")).find((o) => o.id === ad.id)?.available).toBe(
      (10n * USDT).toString(),
    );

    // A smallest order of 2,000.00 birr is more than 10 USDT is worth (1,585.00).
    const raised = await seller.patch(`/v1/offers/${ad.id}`, { minSantim: "200000" }).expect(200);
    expect(raised.body.hiddenBecause).toBe("BALANCE");
    expect(raised.body.adBalance).toBe((10n * USDT).toString());
    expect((await listed(buyer, "BUY")).find((o) => o.id === ad.id)).toBeUndefined();
    await buyer.get(`/v1/offers/${ad.id}`).expect(404);

    // Sold down, as trades would have: 3.5 USDT left is worth 554.75 birr,
    // less than the 1,000.00 minimum however much the seller holds.
    await seller.patch(`/v1/offers/${ad.id}`, { minSantim: THOUSAND_BIRR }).expect(200);
    await db.offer.update({ where: { id: ad.id }, data: { remainingAmount: 3_500_000n } });
    const soldDown = await mine(seller, ad.id);
    expect(soldDown.hiddenBecause).toBe("REMAINDER");
    expect(soldDown.adBalance).toBe("3500000");
    expect(
      ((await seller.get("/v1/offers/mine").expect(200)).body.offers as OfferView[]).find(
        (o) => o.id === ad.id,
      )?.hiddenBecause,
    ).toBe("REMAINDER");

    // A buy ad never depends on its owner's balance.
    const { api: broke } = await customer({ usdt: 0n });
    const bid = await broke
      .post("/v1/offers", {
        side: "BUY",
        priceSantim: "15800",
        totalAmount: (30n * USDT).toString(),
        minSantim: THOUSAND_BIRR,
        maxSantim: "400000",
        paymentWindowMinutes: 30,
        paymentKinds: ["TELEBIRR"],
      })
      .expect(201);
    expect(bid.body.adBalance).toBe((30n * USDT).toString());
    expect(bid.body.hiddenBecause).toBeNull();

    // A closed ad offers nothing and is hidden for no reason but being closed.
    const closed = await seller.post(`/v1/offers/${ad.id}/close`).expect(200);
    expect(closed.body.adBalance).toBe("0");
    expect(closed.body.hiddenBecause).toBeNull();
  });

  it("tells its seller once, and goes offline after a day of it", async () => {
    const { api: seller } = await customer({ usdt: 0n });
    const method = await addMethod(seller);
    const ad = await sellOffer(seller, method.id, { minSantim: THOUSAND_BIRR });
    expect(ad.hiddenBecause).toBe("BALANCE");
    // Hidden from the start, but nobody has looked at the clock yet.
    expect(ad.unfundedSince).toBeNull();

    expect(await pass([ad.id])).toEqual({ hidden: 1, paused: 0, cleared: 0 });
    const hidden = await told(seller);
    expect(hidden).toHaveLength(1);
    expect(hidden[0]).toMatchObject({
      type: "OFFER_HIDDEN",
      title: "Your ad is hidden from the market",
      link: "/trade/ads",
    });
    expect(hidden[0]?.body).toBe(
      "Your sell ad at 158.50 birr is hidden: your available balance of 0.000000 USDT is worth less than its smallest order of 1,000.00 birr. Add USDT within 24 hours or the ad goes offline.",
    );

    const waiting = await mine(seller, ad.id);
    expect(waiting.status).toBe("ACTIVE");
    const since = Date.parse(waiting.unfundedSince ?? "");
    expect(Date.now() - since).toBeLessThan(60_000);
    expect(waiting.pausesAt).toBe(new Date(since + 24 * HOUR).toISOString());

    // Looking again says nothing again.
    expect(await pass([ad.id])).toEqual({ hidden: 0, paused: 0, cleared: 0 });
    expect(await told(seller)).toHaveLength(1);

    // A minute short of the day: still on. The day: offline.
    expect(await pass([ad.id], new Date(since + 24 * HOUR - 60_000))).toEqual({
      hidden: 0,
      paused: 0,
      cleared: 0,
    });
    expect(await pass([ad.id], new Date(since + 24 * HOUR))).toEqual({
      hidden: 0,
      paused: 1,
      cleared: 0,
    });
    const off = await mine(seller, ad.id);
    expect(off.status).toBe("PAUSED");
    expect(off.unfundedSince).toBeNull();
    expect(off.pausesAt).toBeNull();
    // Switched back on as it is, the balance would still keep it out.
    expect(off.hiddenBecause).toBe("BALANCE");

    const offline = await told(seller);
    expect(offline.map((item) => item.type)).toEqual(["OFFER_PAUSED", "OFFER_HIDDEN"]);
    expect(offline[0]).toMatchObject({
      title: "Your ad went offline",
      link: "/trade/ads?tab=offline",
    });
    expect(offline[0]?.body).toBe(
      "Your sell ad at 158.50 birr was taken offline: for 24 hours your available balance could not cover its smallest order of 1,000.00 birr. Add USDT, then switch it back on in My ads.",
    );

    // An ad that is off is nobody's concern: nothing more happens to it.
    expect(await pass([ad.id], new Date(since + 48 * HOUR))).toEqual({
      hidden: 0,
      paused: 0,
      cleared: 0,
    });
  });

  it("stops the clock when the balance covers the ad again or its owner switches it off, and does not repeat itself within a day", async () => {
    const { api: seller, userId } = await customer({ usdt: 0n });
    const method = await addMethod(seller);
    const ad = await sellOffer(seller, method.id, { minSantim: THOUSAND_BIRR });
    expect(await pass([ad.id])).toEqual({ hidden: 1, paused: 0, cleared: 0 });

    // Fifty USDT arrive: the ad is back, and its clock stops.
    await ledger.post({
      reason: "OPENING_BALANCE",
      asset: "USDT",
      reference: { type: "fixture", id: uniq("fund") },
      actor: { type: "SYSTEM" },
      correlationId: uniq("corr"),
      idempotencyKey: uniq("fund"),
      lines: [
        { account: accounts.platform("OPENING_BALANCE"), direction: "DEBIT", amount: 50n * USDT },
        { account: accounts.userAvailable(userId), direction: "CREDIT", amount: 50n * USDT },
      ],
    });
    expect(await pass([ad.id])).toEqual({ hidden: 0, paused: 0, cleared: 1 });
    const covered = await mine(seller, ad.id);
    expect(covered.hiddenBecause).toBeNull();
    expect(covered.unfundedSince).toBeNull();

    // 50 USDT is worth 7,925.00 birr; a smallest order of 8,000.00 is out of
    // reach again. The clock restarts, but its owner heard an hour ago.
    await seller.patch(`/v1/offers/${ad.id}`, { minSantim: "800000" }).expect(200);
    expect(await pass([ad.id])).toEqual({ hidden: 0, paused: 0, cleared: 0 });
    expect((await mine(seller, ad.id)).unfundedSince).not.toBeNull();
    expect(await told(seller)).toHaveLength(1);

    // Switched off by hand: no clock. Switched back on: a whole day again.
    const paused = await seller.post(`/v1/offers/${ad.id}/pause`).expect(200);
    expect(paused.body.unfundedSince).toBeNull();
    expect((await db.offer.findUniqueOrThrow({ where: { id: ad.id } })).unfundedSince).toBeNull();
    await seller.post(`/v1/offers/${ad.id}/resume`).expect(200);
    expect(await pass([ad.id])).toEqual({ hidden: 0, paused: 0, cleared: 0 });
    const since = Date.parse((await mine(seller, ad.id)).unfundedSince ?? "");
    expect(Date.now() - since).toBeLessThan(60_000);

    // A day after the first time, the owner would hear of it again.
    await db.offer.update({
      where: { id: ad.id },
      data: { unfundedSince: null, unfundedNotifiedAt: new Date(Date.now() - 25 * HOUR) },
    });
    expect(await pass([ad.id])).toEqual({ hidden: 1, paused: 0, cleared: 0 });
    expect(await told(seller)).toHaveLength(2);
  });

  it("runs one pass at a time across workers, and gives the lock back as it ends", async () => {
    const redis = app.get(RedisService);
    const watcher = new OfferFundingWatcher(
      redis,
      app.get(OfferService),
      await app.resolve(PinoLogger),
    );

    // Another worker's pass is under way: this one waits its turn and leaves that lock alone.
    expect(await watcher.tick()).toBeNull();
    expect(await redis.client.get(FUNDING_LOCK_KEY)).toBe(HOLDER);

    // Its turn: a pass over every live sell ad, and the lock given back as it ends.
    await redis.client.del(FUNDING_LOCK_KEY);
    expect(await watcher.tick()).toEqual({
      hidden: expect.any(Number) as number,
      paused: expect.any(Number) as number,
      cleared: expect.any(Number) as number,
    });
    expect(await redis.client.exists(FUNDING_LOCK_KEY)).toBe(0);
  });
});
