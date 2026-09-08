import { createPrismaClient, type PrismaClient, type VerificationPurpose } from "@abay/database";
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";

import { createApp } from "@/app";
import { loadEnv } from "@/config/env";

/*
  The real application, over HTTP, against the real database and Redis.

  These cover the properties that make the flows safe rather than merely
  working: that the endpoints cannot be used to discover who has an account,
  that a code cannot be replayed or brute forced, that a password alone does
  not sign anyone in, that the session cookie is not readable by script, and
  that revocation takes effect immediately.
*/

let app: NestFastifyApplication;
let db: PrismaClient;
let env: ReturnType<typeof loadEnv>;
const server = () => app.getHttpServer() as Parameters<typeof request>[0];

/** A fresh address per test run, so runs do not collide in a shared database. */
const uniqueEmail = () =>
  `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
const PASSWORD = "Correct1Horse";

/** Reads the code straight from the database: tests run with the log mailer. */
async function latestCodeFor(email: string, purpose: VerificationPurpose): Promise<string> {
  const token = await db.verificationToken.findFirst({
    where: { email, purpose, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!token) throw new Error(`no ${purpose} token for ${email}`);
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

const cookieOf = (res: request.Response): string => {
  const setCookie = res.headers["set-cookie"];
  if (!setCookie?.[0]) throw new Error("no session cookie was set");
  return setCookie[0];
};

async function registerFully(email: string): Promise<{ cookie: string; userId: string }> {
  await request(server()).post("/v1/auth/register/start").send({ email }).expect(202);
  const code = await latestCodeFor(email, "EMAIL_VERIFICATION");
  const verify = await request(server())
    .post("/v1/auth/register/verify")
    .send({ email, code })
    .expect(200);
  const complete = await request(server())
    .post("/v1/auth/register/complete")
    .send({ ticket: verify.body.ticket, password: PASSWORD })
    .expect(201);
  return { cookie: cookieOf(complete), userId: complete.body.user.id };
}

/** Password step then code step: how every sign-in works. */
async function loginFully(email: string, password = PASSWORD): Promise<string> {
  const challenge = await request(server())
    .post("/v1/auth/login")
    .send({ email, password })
    .expect(200);
  const code = await latestCodeFor(email, "LOGIN");
  const verified = await request(server())
    .post("/v1/auth/login/verify")
    .send({ ticket: challenge.body.ticket, code })
    .expect(200);
  return cookieOf(verified);
}

beforeAll(async () => {
  env = loadEnv();
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

  it("tells a returning customer to log in, and still sends them nothing", async () => {
    const taken = uniqueEmail();
    await registerFully(taken);

    const known = await request(server())
      .post("/v1/auth/register/start")
      .send({ email: taken })
      .expect(409);
    expect(known.body.error.code).toBe("CONFLICT");

    await request(server())
      .post("/v1/auth/register/start")
      .send({ email: uniqueEmail() })
      .expect(202);

    // The answer is in the response, so no unrequested code lands in the inbox
    // of someone who already has an account.
    const issued = await db.verificationToken.count({
      where: { email: taken, purpose: "EMAIL_VERIFICATION", consumedAt: null },
    });
    expect(issued).toBe(0);
  });

  it("rejects a wrong code, and burns the code after repeated attempts", async () => {
    const email = uniqueEmail();
    await request(server()).post("/v1/auth/register/start").send({ email }).expect(202);
    const real = await latestCodeFor(email, "EMAIL_VERIFICATION");
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
    const code = await latestCodeFor(email, "EMAIL_VERIFICATION");

    await request(server()).post("/v1/auth/register/verify").send({ email, code }).expect(200);
    await request(server()).post("/v1/auth/register/verify").send({ email, code }).expect(401);
  });

  it("will not let one ticket create two accounts", async () => {
    const email = uniqueEmail();
    await request(server()).post("/v1/auth/register/start").send({ email }).expect(202);
    const code = await latestCodeFor(email, "EMAIL_VERIFICATION");
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
    const code = await latestCodeFor(email, "EMAIL_VERIFICATION");
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
  it("needs the password and then the emailed code; the password alone gets no session", async () => {
    const email = uniqueEmail();
    await registerFully(email);

    const challenge = await request(server())
      .post("/v1/auth/login")
      .send({ email, password: PASSWORD })
      .expect(200);
    expect(challenge.body.ticket).toEqual(expect.any(String));
    expect(challenge.headers["set-cookie"]).toBeUndefined();

    const code = await latestCodeFor(email, "LOGIN");
    const verified = await request(server())
      .post("/v1/auth/login/verify")
      .send({ ticket: challenge.body.ticket, code })
      .expect(200);
    expect(verified.body.user.email).toBe(email);
    expect(cookieOf(verified)).toMatch(/^abay_session=/);

    // The ticket is spent with the session.
    await request(server())
      .post("/v1/auth/login/verify")
      .send({ ticket: challenge.body.ticket, code })
      .expect(401);
  });

  it("rejects a wrong code without ending the attempt, and a re-sent code replaces the old one", async () => {
    const email = uniqueEmail();
    await registerFully(email);
    const challenge = await request(server())
      .post("/v1/auth/login")
      .send({ email, password: PASSWORD })
      .expect(200);
    const first = await latestCodeFor(email, "LOGIN");

    await request(server())
      .post("/v1/auth/login/verify")
      .send({ ticket: challenge.body.ticket, code: first === "000000" ? "111111" : "000000" })
      .expect(401);

    await request(server())
      .post("/v1/auth/login/resend")
      .send({ ticket: challenge.body.ticket })
      .expect(202);
    const second = await latestCodeFor(email, "LOGIN");
    expect(second).not.toBe(first);

    await request(server())
      .post("/v1/auth/login/verify")
      .send({ ticket: challenge.body.ticket, code: first })
      .expect(401);
    await request(server())
      .post("/v1/auth/login/verify")
      .send({ ticket: challenge.body.ticket, code: second })
      .expect(200);
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
    // No session, and no code, was issued either way.
    expect(wrongPassword.headers["set-cookie"]).toBeUndefined();
    const codes = await db.verificationToken.count({ where: { email, purpose: "LOGIN" } });
    expect(codes).toBe(0);
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

    // And the code step cannot tell either: an unknown address gets the same
    // rejection as a wrong code for a known one.
    const unknownCode = await request(server())
      .post("/v1/auth/password-reset/verify")
      .send({ email: uniqueEmail(), code: "123456" })
      .expect(401);
    const wrongCode = await request(server())
      .post("/v1/auth/password-reset/verify")
      .send({ email, code: "000000" })
      .expect(401);
    expect(unknownCode.body.error.message).toBe(wrongCode.body.error.message);
  });

  it("changes the password, signs the account out everywhere, and the old password stops working", async () => {
    const email = uniqueEmail();
    const { cookie: oldSession } = await registerFully(email);
    const NEW_PASSWORD = "Different2Horse";

    await request(server()).post("/v1/auth/password-reset").send({ email }).expect(202);
    const code = await latestCodeFor(email, "PASSWORD_RESET");
    const verify = await request(server())
      .post("/v1/auth/password-reset/verify")
      .send({ email, code })
      .expect(200);
    await request(server())
      .post("/v1/auth/password-reset/complete")
      .send({ ticket: verify.body.ticket, password: NEW_PASSWORD })
      .expect(200);

    // The ticket is spent.
    await request(server())
      .post("/v1/auth/password-reset/complete")
      .send({ ticket: verify.body.ticket, password: NEW_PASSWORD })
      .expect(401);

    // The session from before the reset is dead.
    await request(server()).get("/v1/auth/me").set("Cookie", oldSession).expect(401);

    // Old password out, new password in.
    await request(server()).post("/v1/auth/login").send({ email, password: PASSWORD }).expect(401);
    const cookie = await loginFully(email, NEW_PASSWORD);
    await request(server()).get("/v1/auth/me").set("Cookie", cookie).expect(200);
  });
});

describe("google", () => {
  it("sends the browser to Google with state and a PKCE challenge, never a secret", async () => {
    const res = await request(server()).get("/v1/auth/google/start").expect(302);
    const location = new URL(res.headers.location!);

    expect(location.origin + location.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(location.searchParams.get("client_id")).toBe(env.GOOGLE_CLIENT_ID);
    expect(location.searchParams.get("redirect_uri")).toBe(
      `${env.API_URL}/v1/auth/google/callback`,
    );
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(location.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(location.searchParams.get("scope")).toBe("openid email");
    expect(res.headers.location).not.toContain(env.GOOGLE_CLIENT_SECRET);
  });

  it("bounces a callback it did not start back to the log-in page, with no session", async () => {
    const res = await request(server())
      .get("/v1/auth/google/callback")
      .query({ code: "whatever", state: "not-a-state-this-server-issued" })
      .expect(302);
    expect(res.headers.location).toBe(`${env.WEB_URL}/login?error=google_expired`);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("reports a cancelled sign-in as cancelled", async () => {
    const res = await request(server())
      .get("/v1/auth/google/callback")
      .query({ error: "access_denied", state: "irrelevant" })
      .expect(302);
    expect(res.headers.location).toBe(`${env.WEB_URL}/login?error=google_denied`);
  });
});
