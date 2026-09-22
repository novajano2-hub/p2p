import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import * as contracts from "@abay/contracts";
import { createPrismaClient, type PrismaClient } from "@abay/database";
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import { PinoLogger } from "nestjs-pino";
import request from "supertest";

import { createApp } from "@/app";
import { REDACT_PATHS } from "@/common/logging/logging.module";
import {
  REDACTED_KEYS,
  SENSITIVE_FIELDS,
  type SensitiveKey,
} from "@/common/logging/sensitive-fields";
import { loadEnv, type Env } from "@/config/env";
import { hashPassword } from "@/modules/auth/tokens";
import { MockChain } from "@/modules/blockchain/mock/mock-blockchain.gateway";
import { signWebhook } from "@/modules/custody/webhooks/webhook-signature";
import { accounts } from "@/modules/ledger/account-code";
import { LedgerService } from "@/modules/ledger/ledger.service";
import { WithdrawalService } from "@/modules/withdrawals/withdrawal.service";

import { csrfFor, fakePng, registerFully, totpCodeFor, uploadPhotos } from "./helpers";

/*
  AT-13: logs and error reports contain no secrets or sensitive payment details
  (docs/testing/acceptance-test-plan.md).

  The registry in src/common/logging/sensitive-fields.ts says which fields
  those are. This file plants a value it will recognise in every one of them
  - or, for the ones the server mints, captures the value as it goes by -
  then drives the flows that carry them with the log level at trace and every
  line the application writes going into a buffer instead of stdout: a
  customer signing up, in, out and back in with a new password; their payment
  methods; an ad; a buyer taking it, paying, writing in the chat, disputing
  with evidence and a caption; a withdrawal; identity verification; an
  administrator signing in, enrolling a second factor and searching for a
  customer; the custody webhook, refused and accepted; Google's callback; and
  the failures on the way - a wrong password, a forged origin, a body that
  fails validation, and a service that throws mid-request. Then every line is
  read back and none may carry a sentinel.

  Two things are held to account beside the log. The registry is typed, so
  the table of sentinels below does not compile with an entry missing, and at
  the end every entry must have had a value - an entry with nothing planted
  proves nothing. And every field in every request schema whose name looks
  like it might be sensitive has to be in the registry or on a short, named
  list of look-alikes: a new `bankPin` fails this file until somebody decides
  what it is.

  The one place a sentinel may appear is the development mailer's own lines.
  Outside production it writes each email to the log instead of sending it,
  the address and the code included, because the log is the mailbox; the
  environment schema refuses to start production without a real provider, so
  those lines cannot exist where it matters. Every other line is held to zero.

  There is no error reporter and no tracer to capture: the exception filter's
  log line is the error report, and it is in the buffer with everything else.
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

/* --------------------------------------------------------------- sentinels */

const hex = (bytes: number) => randomBytes(bytes).toString("hex");
const digits = (count: number) =>
  Array.from({ length: count }, () => Math.floor(Math.random() * 10)).join("");
const stamp = Date.now();

/** Values this file plants, each shaped to pass the field's own rule. */
const S = {
  password: `At13Pw${hex(6)}1`,
  wrongPassword: `At13Wrong${hex(6)}1`,
  newPassword: `At13New${hex(6)}1`,
  adminPassword: `At13Admin${hex(6)}1`,
  // The shapes global-teardown.js recognises as this suite's, so they are cleared with the rest.
  email: `test-${stamp}-at13a${hex(4)}@example.com`,
  buyerEmail: `test-${stamp}-at13b${hex(4)}@example.com`,
  adminEmail: `admin-${stamp}-at13${hex(4)}@example.com`,
  legalName: `At13 Sentinel ${hex(5)}`,
  dateOfBirth: "1971-03-17",
  documentNumber: `AT13-${hex(6).toUpperCase()}`,
  accountHolder: `At13 Holder ${hex(5)}`,
  phone: `09${digits(8)}`,
  accountNumber: digits(20),
  reference: `AT13-REF-${hex(6)}`,
  chat: `At13 chat ${hex(6)}`,
  description: `At13 dispute statement ${hex(6)}`,
  note: `At13 note ${hex(6)}`,
  reason: `At13 reason ${hex(6)}`,
  webhookSecret: `at13-webhook-${hex(8)}`,
  fieldKey: hex(32),
  googleSecret: `at13-google-${hex(8)}`,
  googleCode: `at13code${hex(8)}`,
  forgedSignature: `t=1,v1=${hex(32)}`,
};

/**
 * Every key in the registry, and where its sentinel comes from. Typed from
 * the registry: a key added there and not here is a compile error, which is
 * the completeness check the plan asks for.
 */
const HOW: Record<SensitiveKey, "planted" | "captured"> = {
  password: "planted",
  passwordHash: "captured",
  code: "captured",
  ticket: "captured",
  cookie: "captured",
  "set-cookie": "captured",
  "x-csrf-token": "captured",
  secret: "captured",
  otpauthUri: "captured",
  totpSecret: "captured",
  totpPendingSecret: "captured",
  email: "planted",
  q: "planted",
  legalName: "planted",
  dateOfBirth: "planted",
  documentNumber: "planted",
  accountHolder: "planted",
  accountNumber: "planted",
  phone: "planted",
  instructions: "planted",
  reference: "planted",
  body: "planted",
  description: "planted",
  note: "planted",
  reason: "planted",
  "x-custody-signature": "planted",
  CUSTODY_WEBHOOK_SECRET: "planted",
  FIELD_ENCRYPTION_KEY: "planted",
  GOOGLE_CLIENT_SECRET: "planted",
  DATABASE_URL: "captured",
  REDIS_URL: "captured",
};

/** What was planted or captured, by the registry key it stands for. */
const sentinels = new Map<SensitiveKey, Set<string>>();
function seen(key: SensitiveKey, value: string | undefined | null): void {
  if (!value) throw new Error(`no value to plant for ${key}`);
  if (value.length < 6) throw new Error(`a sentinel for ${key} is too short to look for: ${value}`);
  const values = sentinels.get(key) ?? new Set<string>();
  values.add(value);
  sentinels.set(key, values);
}

/*
  What the development mailer writes into the log, by design: the address it
  would have sent to, and the code in the text. Those values may appear on
  its lines whatever field they stand for elsewhere - the search term an
  administrator typed is the same address - and nowhere else.
*/
const MAILED = new Set<SensitiveKey>(["email", "code"]);
const MAILER = "LogMailer";
const mailedValues = () =>
  new Set([...MAILED].flatMap((key) => [...(sentinels.get(key) ?? new Set<string>())]));

/* ------------------------------------------------------------------- setup */

const lines: string[] = [];

beforeAll(async () => {
  /*
    A copy of the environment, not the environment: the planted secrets must
    not leak into the other spec files' apps, and the field key in particular
    must stay the one the shared helpers encrypt with.
  */
  env = loadEnv({
    ...process.env,
    LOG_LEVEL: "trace",
    FIELD_ENCRYPTION_KEY: S.fieldKey,
    CUSTODY_WEBHOOK_SECRET: S.webhookSecret,
    GOOGLE_CLIENT_ID: "test-google-client-id",
    GOOGLE_CLIENT_SECRET: S.googleSecret,
  });
  app = await createApp(env, {
    logDestination: {
      write: (line: string) => {
        lines.push(line);
      },
    },
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  db = createPrismaClient(env.DATABASE_URL);
  ledger = app.get(LedgerService);
  chain = app.get(MockChain);

  seen("FIELD_ENCRYPTION_KEY", S.fieldKey);
  seen("CUSTODY_WEBHOOK_SECRET", S.webhookSecret);
  seen("GOOGLE_CLIENT_SECRET", S.googleSecret);
  seen("DATABASE_URL", env.DATABASE_URL);
  seen("REDIS_URL", env.REDIS_URL);
});

afterAll(async () => {
  await db.$disconnect();
  await app.close();
});

/* ----------------------------------------------------------------- helpers */

/** The token inside a Set-Cookie header, whichever realm's cookie it is. */
function tokenOf(setCookie: string): string {
  const pair = setCookie.split(";")[0] ?? "";
  return pair.slice(pair.indexOf("=") + 1);
}

/** A session, as the response that started it. Records the token and the CSRF token as sentinels. */
function sessionFrom(response: request.Response): string {
  const cookie = response.headers["set-cookie"]?.[0];
  if (!cookie) throw new Error("no session cookie was set");
  seen("cookie", tokenOf(cookie));
  seen("set-cookie", tokenOf(cookie));
  seen("x-csrf-token", response.headers["x-csrf-token"]);
  return cookie;
}

/**
 * The newest code mailed to an address, whatever it was for, recovered from
 * its hash the way helpers.ts does. Recorded as a sentinel: a code belongs
 * in the mailer's line and nowhere else.
 */
async function codeFor(email: string): Promise<string> {
  const token = await db.verificationToken.findFirst({
    where: { email, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!token) throw new Error(`no code for ${email}`);
  for (let i = 0; i < 1_000_000; i++) {
    const candidate = i.toString().padStart(6, "0");
    if (createHash("sha256").update(candidate).digest("hex") === token.tokenHash) {
      seen("code", candidate);
      return candidate;
    }
  }
  throw new Error("code not recoverable");
}

const anonymous = () => request(server());

function as(cookie: string) {
  const headers = (test: request.Test) =>
    test
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfFor(cookie))
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

/** Signs in with a password and answers the emailed code: a fresh session. */
async function signIn(email: string, password: string): Promise<string> {
  const started = await anonymous().post("/v1/auth/login").send({ email, password }).expect(200);
  seen("ticket", started.body.ticket as string);
  const verified = await anonymous()
    .post("/v1/auth/login/verify")
    .send({ ticket: started.body.ticket as string, code: await codeFor(email) })
    .expect(200);
  return sessionFrom(verified);
}

/* ------------------------------------------------------------------ flows */

let a = { cookie: "", userId: "" };
let b = { cookie: "", userId: "" };
let offerId = "";

describe("the flows that carry sentinels", () => {
  it("a customer signs up, fails to sign in, then signs in", async () => {
    seen("email", S.email);
    seen("password", S.password);
    await anonymous().post("/v1/auth/register/start").send({ email: S.email }).expect(202);
    const verify = await anonymous()
      .post("/v1/auth/register/verify")
      .send({ email: S.email, code: await codeFor(S.email) })
      .expect(200);
    seen("ticket", verify.body.ticket as string);

    // A body that fails validation, with the password in it.
    await anonymous()
      .post("/v1/auth/register/complete")
      .send({ ticket: "too-short", password: S.password })
      .expect(400);

    const complete = await anonymous()
      .post("/v1/auth/register/complete")
      .send({ ticket: verify.body.ticket as string, password: S.password })
      .expect(201);
    a = { cookie: sessionFrom(complete), userId: complete.body.user.id as string };
    const identity = await db.authIdentity.findFirst({
      where: { userId: a.userId, passwordHash: { not: null } },
    });
    seen("passwordHash", identity?.passwordHash);

    seen("password", S.wrongPassword);
    await anonymous()
      .post("/v1/auth/login")
      .send({ email: S.email, password: S.wrongPassword })
      .expect(401);
    // A forged origin, with real credentials in the body.
    await anonymous()
      .post("/v1/auth/login")
      .set("Origin", "https://evil.example")
      .send({ email: S.email, password: S.password })
      .expect(403);
    a.cookie = await signIn(S.email, S.password);
  });

  it("adds payment methods, posts an ad, and a buyer takes it, pays, writes, disputes and cancels", async () => {
    seen("accountHolder", S.accountHolder);
    seen("phone", S.phone);
    seen("accountNumber", S.accountNumber);
    // The instructions are the holder and the number; either would betray them.
    seen("instructions", S.phone);
    const telebirr = await as(a.cookie)
      .post("/v1/payment-methods", {
        kind: "TELEBIRR",
        accountHolder: S.accountHolder,
        phone: S.phone,
      })
      .expect(201);
    await as(a.cookie)
      .post("/v1/payment-methods", {
        kind: "AWASH",
        accountHolder: S.accountHolder,
        accountNumber: S.accountNumber,
      })
      .expect(201);
    await as(a.cookie)
      .get(`/v1/payment-methods/${telebirr.body.id as string}`)
      .expect(200);

    await db.user.update({ where: { id: a.userId }, data: { kycStatus: "APPROVED" } });
    await fund(a.userId, 100n);
    const offer = await as(a.cookie)
      .post("/v1/offers", {
        side: "SELL",
        priceSantim: "15850",
        totalAmount: (100n * USDT).toString(),
        minSantim: "1000",
        maxSantim: "2000000",
        paymentWindowMinutes: 30,
        paymentMethodIds: [telebirr.body.id as string],
        autoReply: "Thanks! Pay within 30 minutes.",
        terms: "Pay from an account in your own name.",
      })
      .expect(201);
    offerId = offer.body.id as string;

    seen("email", S.buyerEmail);
    const buyer = await registerFully(server(), db, S.buyerEmail);
    b = { cookie: buyer.cookie, userId: buyer.userId };
    const take = () =>
      as(b.cookie)
        .post("/v1/trades", { offerId, offerRevision: 1, amount: (10n * USDT).toString() }, true)
        .expect(201);
    const trade = await take();
    const tradeId = trade.body.id as string;
    // The buyer reads the instructions they are to pay into.
    await as(b.cookie).get(`/v1/trades/${tradeId}`).expect(200);

    seen("reference", S.reference);
    await as(b.cookie).post(`/v1/trades/${tradeId}/paid`, { reference: S.reference }).expect(200);
    seen("body", S.chat);
    await as(b.cookie)
      .post(`/v1/trades/${tradeId}/messages`, { clientMessageId: uniq("msg"), body: S.chat })
      .expect(201);
    await as(a.cookie).get(`/v1/trades/${tradeId}/messages`).expect(200);

    await db.trade.update({
      where: { id: tradeId },
      data: { paidAt: new Date(Date.now() - (env.TRADE_DISPUTE_COOLDOWN_MINUTES + 1) * 60_000) },
    });
    seen("description", S.description);
    await as(b.cookie)
      .post(`/v1/trades/${tradeId}/dispute`, {
        reason: "PAYMENT_NOT_RELEASED",
        description: S.description,
      })
      .expect(201);
    seen("note", S.note);
    await as(b.cookie)
      .raw(
        `/v1/trades/${tradeId}/dispute/evidence?note=${encodeURIComponent(S.note)}`,
        "image/png",
        fakePng(2_048),
      )
      .expect(201);
    await as(b.cookie).post(`/v1/trades/${tradeId}/dispute/withdraw`).expect(200);

    seen("reason", S.reason);
    const second = await take();
    await as(b.cookie)
      .post(`/v1/trades/${second.body.id as string}/cancel`, { reason: S.reason })
      .expect(200);
  });

  it("withdraws, survives a service that throws, changes the password, signs in again and releases", async () => {
    const withdraw = (password: string) =>
      as(a.cookie).post(
        "/v1/wallet/withdrawals",
        {
          network: "BSC",
          amount: (5n * USDT).toString(),
          destination: `0x${hex(20)}`,
          password,
        },
        true,
      );
    await withdraw(S.password).expect(201);

    // A bug mid-request: the exception filter logs the error with its stack,
    // and the request that triggered it - password included - must not follow.
    const withdrawals = app.get(WithdrawalService);
    const broken = jest
      .spyOn(withdrawals, "request")
      .mockRejectedValueOnce(new Error("at13: a deliberate failure inside the service"));
    const failed = await withdraw(S.password).expect(500);
    expect(failed.body.error.code).toBe("INTERNAL");
    broken.mockRestore();

    seen("password", S.newPassword);
    await anonymous().post("/v1/auth/password-reset").send({ email: S.email }).expect(202);
    const verified = await anonymous()
      .post("/v1/auth/password-reset/verify")
      .send({ email: S.email, code: await codeFor(S.email) })
      .expect(200);
    seen("ticket", verified.body.ticket as string);
    await anonymous()
      .post("/v1/auth/password-reset/complete")
      .send({ ticket: verified.body.ticket as string, password: S.newPassword })
      .expect(200);

    // The old session died with the old password; the release wants the new one.
    a.cookie = await signIn(S.email, S.newPassword);
    const trades = await as(a.cookie).get("/v1/trades?scope=open").expect(200);
    const paid = (trades.body.trades as { id: string; status: string }[]).find(
      (trade) => trade.status === "BUYER_MARKED_PAID",
    );
    if (!paid) throw new Error("the paid trade was not found to release");
    await as(a.cookie)
      .post(`/v1/trades/${paid.id}/release`, { password: S.newPassword })
      .expect(200);
  });

  it("the buyer submits their identity", async () => {
    seen("legalName", S.legalName);
    seen("dateOfBirth", S.dateOfBirth);
    seen("documentNumber", S.documentNumber);
    const documents = await uploadPhotos(server(), b.cookie);
    await as(b.cookie)
      .post("/v1/kyc", {
        legalName: S.legalName,
        dateOfBirth: S.dateOfBirth,
        documentType: "NATIONAL_ID",
        documentNumber: S.documentNumber,
        documents,
      })
      .expect(202);
  });

  it("an administrator signs in, enrolls a second factor and searches for a customer", async () => {
    seen("email", S.adminEmail);
    seen("password", S.adminPassword);
    await db.adminUser.create({
      data: {
        email: S.adminEmail,
        name: "At13 Reviewer",
        passwordHash: await hashPassword(S.adminPassword),
        passwordChangedAt: new Date(),
        roles: ["KYC_REVIEWER"] as never,
      },
    });
    const admin = await db.adminUser.findUnique({ where: { email: S.adminEmail } });
    seen("passwordHash", admin?.passwordHash);

    await anonymous()
      .post("/v1/admin/auth/login")
      .send({ email: S.adminEmail, password: S.wrongPassword })
      .expect(401);
    const login = await anonymous()
      .post("/v1/admin/auth/login")
      .send({ email: S.adminEmail, password: S.adminPassword })
      .expect(200);
    const cookie = sessionFrom(login);

    const setup = await as(cookie).post("/v1/admin/auth/mfa/setup").expect(200);
    const secret = setup.body.secret as string;
    seen("secret", secret);
    seen("otpauthUri", secret);
    seen("totpPendingSecret", secret);
    seen("totpSecret", secret);
    expect(setup.body.otpauthUri as string).toContain(secret);
    const code = totpCodeFor(secret);
    seen("code", code);
    await as(cookie).post("/v1/admin/auth/mfa/confirm", { code }).expect(200);

    seen("q", S.email);
    const found = await as(cookie)
      .get(`/v1/admin/customers?q=${encodeURIComponent(S.email)}`)
      .expect(200);
    expect(found.body.customers).toHaveLength(1);
  });

  it("the custody webhook is refused, then believed", async () => {
    const issued = await as(a.cookie).get("/v1/wallet/deposit-address").expect(200);
    const minted = await chain.mint({
      to: issued.body.address as string,
      rawAmount: 5n * 10n ** 18n,
      tag: uniq("mint"),
    });
    const raw = JSON.stringify({
      event: "transfer.incoming",
      network: "BSC",
      txHash: minted.txHash,
      logIndex: 0,
    });

    seen("x-custody-signature", S.forgedSignature);
    await anonymous()
      .post("/v1/webhooks/custody")
      .set("content-type", "application/json")
      .set("x-custody-signature", S.forgedSignature)
      .set("x-request-id", uniq("wh"))
      .send(raw)
      .expect(401);

    const signature = signWebhook(S.webhookSecret, raw);
    seen("x-custody-signature", signature);
    await anonymous()
      .post("/v1/webhooks/custody")
      .set("content-type", "application/json")
      .set("x-custody-signature", signature)
      .set("x-request-id", uniq("wh"))
      .send(raw)
      .expect(200);
  });

  it("Google sends the browser back with a code in the query string", async () => {
    seen("code", S.googleCode);
    const response = await anonymous()
      .get(`/v1/auth/google/callback?code=${S.googleCode}&state=not-the-state-we-issued`)
      .set("x-request-id", uniq("google"));
    expect([302, 400]).toContain(response.status);
  });

  it("an object with a registered key handed straight to the logger comes out censored", async () => {
    // Transient in nestjs-pino, so resolved rather than got; it writes through the same root.
    const logger = await app.resolve(PinoLogger);
    for (const key of REDACTED_KEYS) {
      const probe = `probe-${key}-${hex(6)}`;
      logger.info({ [key]: probe, deep: { deeper: { [key]: probe } } }, "redaction probe");
      const wrote = lines.filter((line) => line.includes("redaction probe") && line.includes(key));
      expect(wrote.length).toBeGreaterThan(0);
      for (const line of wrote) {
        expect(line).not.toContain(probe);
        expect(line).toContain("[REDACTED]");
      }
    }
  });
});

/* ---------------------------------------------------------------- reading it back */

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The value as a word: not part of a longer id or hash that happens to contain the same digits. */
const asWord = (value: string) => new RegExp(`(?<![A-Za-z0-9])${escape(value)}(?![A-Za-z0-9])`);

function contextOf(line: string): string {
  try {
    const parsed: unknown = JSON.parse(line);
    if (parsed && typeof parsed === "object" && "context" in parsed) {
      const context: unknown = parsed.context;
      return typeof context === "string" ? context : "";
    }
  } catch {
    // Not JSON: still a line, and still searched.
  }
  return "";
}

describe("the log stream", () => {
  it("was captured: the requests, the mail, the error report and the probes are all in it", () => {
    const count = (test: (line: string) => boolean) => lines.filter(test).length;
    // One line per request, with the request on it.
    expect(count((line) => line.includes('"req":{'))).toBeGreaterThan(40);
    // Sign-up, two sign-ins, a reset: four mails, at least.
    expect(count((line) => contextOf(line) === MAILER)).toBeGreaterThanOrEqual(4);
    // The service that threw: the exception filter's report, with its stack.
    expect(count((line) => line.includes("unhandled error") && line.includes("stack"))).toBe(1);
    // One probe per redacted key.
    expect(count((line) => line.includes("redaction probe"))).toBe(REDACTED_KEYS.length);
  });

  it("carries no sentinel, outside the development mailer's own lines", () => {
    const hits: { key: string; where: string; line: string }[] = [];
    const mailed = mailedValues();
    for (const [key, values] of sentinels) {
      for (const value of values) {
        const pattern = asWord(value);
        for (const line of lines) {
          if (!pattern.test(line)) continue;
          if (mailed.has(value) && contextOf(line) === MAILER) continue;
          hits.push({ key, where: contextOf(line) || "(no context)", line: line.slice(0, 300) });
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it("had a value planted or captured for every field in the registry", () => {
    const missing = SENSITIVE_FIELDS.map((field) => field.key).filter(
      (key) => !(sentinels.get(key)?.size ?? 0),
    );
    expect(missing).toEqual([]);
    expect(Object.keys(HOW).sort()).toEqual(SENSITIVE_FIELDS.map((field) => field.key).sort());
  });
});

/* ------------------------------------------------------ the registry, held to account */

/** A Zod 4 schema, as far as walking its shape needs to know. */
interface ZodLike {
  _zod: { def: ZodDef };
}
interface ZodDef {
  type: string;
  shape?: Record<string, ZodLike>;
  innerType?: ZodLike;
  element?: ZodLike;
  options?: ZodLike[];
  in?: ZodLike;
  out?: ZodLike;
  valueType?: ZodLike;
  left?: ZodLike;
  right?: ZodLike;
  getter?: () => ZodLike;
}

/** Every leaf path a schema accepts, in dotted form, arrays as `[]`. */
function keysOf(schema: ZodLike, prefix: string, out: Set<string>): void {
  const def = schema._zod.def;
  const inner = (next: ZodLike | undefined, suffix = "") => {
    if (next) keysOf(next, prefix + suffix, out);
  };
  switch (def.type) {
    case "object":
      for (const [key, value] of Object.entries(def.shape ?? {})) {
        keysOf(value, prefix ? `${prefix}.${key}` : key, out);
      }
      return;
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "nonoptional":
    case "readonly":
    case "catch":
      inner(def.innerType);
      return;
    case "array":
      inner(def.element, "[]");
      return;
    case "union":
      for (const option of def.options ?? []) keysOf(option, prefix, out);
      return;
    case "pipe":
      inner(def.in);
      inner(def.out);
      return;
    case "record":
      inner(def.valueType, ".*");
      return;
    case "intersection":
      inner(def.left);
      inner(def.right);
      return;
    case "lazy":
      inner(def.getter?.());
      return;
    default:
      if (prefix) out.add(prefix);
  }
}

/** A name that could be carrying something a person would not want logged. */
const LOOKS_SENSITIVE =
  /pass|secret|token|ticket|otp|\bcode\b|pin\b|phone|mobile|email|account|holder|name\b|birth|document|iban|card|note|description|reference|body|text|message|reason|address|signature|key\b/i;

/** Names the pattern catches that carry nothing of the kind, each with why. */
const LOOK_ALIKES: Record<string, string> = {
  accountId: "a ledger account's id, not a bank account's number",
  documentType: "which kind of document: an enum",
  username: "public: it is what the other side of every trade is shown",
  referenceType: "the ledger's reference: a type and an id",
  referenceId: "the ledger's reference: a type and an id",
  clientMessageId: "the client's name for a message, not the message",
};

describe("the registry", () => {
  const requestKeys = new Set<string>();
  beforeAll(() => {
    for (const [name, value] of Object.entries(contracts as Record<string, unknown>)) {
      if (!/(Request|Query|Webhook)$/.test(name)) continue;
      if (!value || typeof value !== "object" || !("_zod" in value)) continue;
      keysOf(value as ZodLike, "", requestKeys);
    }
  });

  it("is what the logger redacts by", () => {
    for (const key of REDACTED_KEYS) {
      expect(REDACT_PATHS).toEqual(expect.arrayContaining([key, `*.${key}`, `*.*.*.${key}`]));
    }
    expect(REDACT_PATHS).toEqual(expect.arrayContaining(["req.headers", "res.headers"]));
  });

  it("names every request field that looks sensitive, or the look-alike list explains it", () => {
    expect(requestKeys.size).toBeGreaterThan(60);
    const registered = new Set<string>(SENSITIVE_FIELDS.map((field) => field.key));
    const unexplained = [...requestKeys]
      .map((path) => (path.split(".").at(-1) ?? "").replace(/\[\]$/, ""))
      .filter((leaf) => LOOKS_SENSITIVE.test(leaf))
      .filter((leaf) => !registered.has(leaf) && !(leaf in LOOK_ALIKES));
    expect([...new Set(unexplained)]).toEqual([]);
    // And the other way: a request field the registry names has to exist.
    const leaves = new Set(
      [...requestKeys].map((path) => (path.split(".").at(-1) ?? "").replace(/\[\]$/, "")),
    );
    const gone = SENSITIVE_FIELDS.filter(
      (field) => field.where === "request" && !leaves.has(field.key),
    ).map((field) => field.key);
    expect(gone).toEqual([]);
  });

  it("is what the classification document points at", () => {
    const document = readFileSync(
      resolve(__dirname, "../../../../docs/architecture/data-classification.md"),
      "utf8",
    );
    expect(document).toContain("apps/api/src/common/logging/sensitive-fields.ts");
    expect(document).toContain("apps/api/test/api/redaction.spec.ts");
  });
});
