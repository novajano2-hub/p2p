import {
  type MarketplaceOffer,
  type OfferView,
  type PaymentMethodDetailView,
} from "@abay/contracts";
import { createPrismaClient, type PrismaClient } from "@abay/database";
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";

import { createApp } from "@/app";
import { loadEnv, type Env } from "@/config/env";
import { accounts } from "@/modules/ledger/account-code";
import { LedgerService } from "@/modules/ledger/ledger.service";
import {
  PAYMENT_METHOD_PURPOSE,
  PaymentDetailsCipher,
} from "@/modules/payment-methods/payment-details.cipher";

import { csrfFor, registerFully, uniqueEmail } from "./helpers";

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

/**
 * Every page of the marketplace, not only the first: other test files leave
 * their offers listed until the teardown, and at the same price those sort
 * ahead of ours.
 */
async function listed(who: Api, want: "BUY" | "SELL", extra = ""): Promise<MarketplaceOffer[]> {
  const offers: MarketplaceOffer[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 40; page++) {
    const after = cursor ? `&cursor=${cursor}` : "";
    const response = await who.get(`/v1/offers?want=${want}&limit=50${extra}${after}`).expect(200);
    const body = response.body as { offers: MarketplaceOffer[]; nextCursor: string | null };
    offers.push(...body.offers);
    cursor = body.nextCursor;
    if (!cursor) break;
  }
  return offers;
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
