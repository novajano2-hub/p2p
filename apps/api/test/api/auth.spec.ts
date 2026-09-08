import { createPrismaClient, type PrismaClient } from "@abay/database";
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";

import { createApp } from "@/app";
import { loadEnv } from "@/config/env";

/*
  The real application, over HTTP, against the real database and Redis.

  These cover the properties that make the flow safe rather than merely
  working: that the endpoints cannot be used to discover who has an account,
  that a code cannot be replayed or brute forced, that the session cookie is
  not readable by script, and that revocation takes effect immediately.
*/

let app: NestFastifyApplication;
let db: PrismaClient;
const server = () => app.getHttpServer() as Parameters<typeof request>[0];

/** A fresh address per test run, so runs do not collide in a shared database. */
const uniqueEmail = () =>
  `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
const PASSWORD = "Correct1Horse";

/** Reads the code straight from the database: there is no mail provider yet. */
async function latestCodeFor(email: string): Promise<string> {
  const token = await db.verificationToken.findFirst({
    where: { email, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!token) throw new Error(`no verification token for ${email}`);
  // The row stores only a hash, so the code is recovered by scanning the
  // six-digit space. Half a million hashes on average: slow enough to need the
  // raised timeout, and worth it because the production path never has to hold
  // a code in plaintext just to make it testable.
  const { createHash } = await import("node:crypto");
  for (let i = 0; i < 1_000_000; i++) {
    const candidate = i.toString().padStart(6, "0");
    if (createHash("sha256").update(candidate).digest("hex") === token.tokenHash) return candidate;
  }
  throw new Error("code not recoverable");
}

async function registerFully(email: string): Promise<{ cookie: string; userId: string }> {
  await request(server()).post("/v1/auth/register/start").send({ email }).expect(202);
  const code = await latestCodeFor(email);
  const verify = await request(server())
    .post("/v1/auth/register/verify")
    .send({ email, code })
    .expect(200);
  const complete = await request(server())
    .post("/v1/auth/register/complete")
    .send({ ticket: verify.body.ticket, password: PASSWORD })
    .expect(201);
  const setCookie = complete.headers["set-cookie"];
  if (!setCookie?.[0]) throw new Error("registration did not set a session cookie");
  const cookie = setCookie[0];
  return { cookie, userId: complete.body.user.id };
}

beforeAll(async () => {
  const env = loadEnv();
  app = await createApp(env);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  db = createPrismaClient(env.DATABASE_URL);
});

afterAll(async () => {
  await db.$disconnect();
  await app.close();
});

describe("registration", () => {
  it("walks email, code and password, and signs the new account in", async () => {
    const email = uniqueEmail();
    const { cookie, userId } = await registerFully(email);

    expect(userId).toMatch(/^[0-9a-f-]{36}$/);
    // httpOnly is what stops a cross-site script reading the session.
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/^abay_session=/);

    const me = await request(server()).get("/v1/auth/me").set("Cookie", cookie).expect(200);
    expect(me.body.user).toMatchObject({ email, status: "ACTIVE", emailVerified: true });

    // The stored token must not be the cookie value.
    const raw = /abay_session=([^;]+)/.exec(cookie)?.[1] ?? "";
    const stored = await db.session.findFirst({ where: { userId } });
    expect(stored?.tokenHash).not.toBe(raw);
    expect(stored?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("answers identically for a known and an unknown address", async () => {
    const taken = uniqueEmail();
    await registerFully(taken);

    const known = await request(server()).post("/v1/auth/register/start").send({ email: taken });
    const unknown = await request(server())
      .post("/v1/auth/register/start")
      .send({ email: uniqueEmail() });

    expect(known.status).toBe(unknown.status);
    expect(known.body).toEqual(unknown.body);
    // And nothing was sent to the address that already has an account.
    const issued = await db.verificationToken.count({ where: { email: taken, consumedAt: null } });
    expect(issued).toBe(0);
  });

  it("rejects a wrong code, and burns the code after repeated attempts", async () => {
    const email = uniqueEmail();
    await request(server()).post("/v1/auth/register/start").send({ email }).expect(202);
    const real = await latestCodeFor(email);
    const wrong = real === "000000" ? "111111" : "000000";

    for (let attempt = 0; attempt < 4; attempt++) {
      await request(server())
        .post("/v1/auth/register/verify")
        .send({ email, code: wrong })
        .expect(401);
    }

    // The code is now spent: even the correct one no longer works.
    await request(server())
      .post("/v1/auth/register/verify")
      .send({ email, code: real })
      .expect(401);
  });

  it("will not let one code be used twice", async () => {
    const email = uniqueEmail();
    await request(server()).post("/v1/auth/register/start").send({ email }).expect(202);
    const code = await latestCodeFor(email);

    await request(server()).post("/v1/auth/register/verify").send({ email, code }).expect(200);
    await request(server()).post("/v1/auth/register/verify").send({ email, code }).expect(401);
  });

  it("will not let one ticket create two accounts", async () => {
    const email = uniqueEmail();
    await request(server()).post("/v1/auth/register/start").send({ email }).expect(202);
    const code = await latestCodeFor(email);
    const { body } = await request(server())
      .post("/v1/auth/register/verify")
      .send({ email, code })
      .expect(200);

    await request(server())
      .post("/v1/auth/register/complete")
      .send({ ticket: body.ticket, password: PASSWORD })
      .expect(201);
    await request(server())
      .post("/v1/auth/register/complete")
      .send({ ticket: body.ticket, password: PASSWORD })
      .expect(401);
  });

  it("enforces the password policy on the server, not only in the browser", async () => {
    const email = uniqueEmail();
    await request(server()).post("/v1/auth/register/start").send({ email }).expect(202);
    const code = await latestCodeFor(email);
    const { body } = await request(server())
      .post("/v1/auth/register/verify")
      .send({ email, code })
      .expect(200);

    const res = await request(server())
      .post("/v1/auth/register/complete")
      .send({ ticket: body.ticket, password: "short" })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });
});

describe("login", () => {
  it("signs in with the right password", async () => {
    const email = uniqueEmail();
    await registerFully(email);

    const res = await request(server())
      .post("/v1/auth/login")
      .send({ email, password: PASSWORD })
      .expect(200);
    expect(res.body.user.email).toBe(email);
    expect(res.headers["set-cookie"]?.[0]).toMatch(/^abay_session=/);
  });

  it("gives the same answer for a wrong password and an unknown address", async () => {
    const email = uniqueEmail();
    await registerFully(email);

    const wrongPassword = await request(server())
      .post("/v1/auth/login")
      .send({ email, password: "Wrong1Password" })
      .expect(401);
    const unknownAddress = await request(server())
      .post("/v1/auth/login")
      .send({ email: uniqueEmail(), password: PASSWORD })
      .expect(401);

    expect(wrongPassword.body.error.message).toBe(unknownAddress.body.error.message);
    expect(wrongPassword.body.error.code).toBe(unknownAddress.body.error.code);
    // No session was issued either way.
    expect(wrongPassword.headers["set-cookie"]).toBeUndefined();
  });

  it("never returns the password hash", async () => {
    const email = uniqueEmail();
    const { cookie } = await registerFully(email);
    const me = await request(server()).get("/v1/auth/me").set("Cookie", cookie).expect(200);
    expect(JSON.stringify(me.body)).not.toMatch(/argon2|passwordHash|\$argon/i);
  });
});

describe("session", () => {
  it("refuses /me without a session, and after logout", async () => {
    await request(server()).get("/v1/auth/me").expect(401);

    const { cookie } = await registerFully(uniqueEmail());
    await request(server()).get("/v1/auth/me").set("Cookie", cookie).expect(200);

    await request(server()).post("/v1/auth/logout").set("Cookie", cookie).expect(204);
    await request(server()).get("/v1/auth/me").set("Cookie", cookie).expect(401);
  });

  it("records revocation instead of deleting the row", async () => {
    const { cookie, userId } = await registerFully(uniqueEmail());
    await request(server()).post("/v1/auth/logout").set("Cookie", cookie).expect(204);

    const session = await db.session.findFirst({ where: { userId } });
    expect(session).not.toBeNull();
    expect(session?.revokedAt).not.toBeNull();
    expect(session?.revokedReason).toBe("LOGOUT");
  });

  it("is idempotent: logging out twice, or with no session, still succeeds", async () => {
    const { cookie } = await registerFully(uniqueEmail());
    await request(server()).post("/v1/auth/logout").set("Cookie", cookie).expect(204);
    await request(server()).post("/v1/auth/logout").set("Cookie", cookie).expect(204);
    await request(server()).post("/v1/auth/logout").expect(204);
  });

  it("does not accept another user's cookie for this user's data", async () => {
    const alice = await registerFully(uniqueEmail());
    const bobEmail = uniqueEmail();
    await registerFully(bobEmail);

    const me = await request(server()).get("/v1/auth/me").set("Cookie", alice.cookie).expect(200);
    expect(me.body.user.id).toBe(alice.userId);
    expect(me.body.user.email).not.toBe(bobEmail);
  });

  it("rejects a forged or tampered cookie", async () => {
    await request(server())
      .get("/v1/auth/me")
      .set("Cookie", "abay_session=not-a-real-token")
      .expect(401);
  });
});

describe("password reset", () => {
  it("answers identically whether or not the address exists", async () => {
    const email = uniqueEmail();
    await registerFully(email);

    const known = await request(server()).post("/v1/auth/password-reset").send({ email });
    const unknown = await request(server())
      .post("/v1/auth/password-reset")
      .send({ email: uniqueEmail() });

    expect(known.status).toBe(unknown.status);
    expect(known.body).toEqual(unknown.body);
  });
});
