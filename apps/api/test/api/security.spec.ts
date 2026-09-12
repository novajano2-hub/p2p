import { createPrismaClient, type PrismaClient } from "@abay/database";
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";

import { createApp } from "@/app";
import { csrfTokenFor } from "@/common/security/csrf";
import { loadEnv } from "@/config/env";
import { RedisService } from "@/infra/redis/redis.service";
import { hashPassword } from "@/modules/auth/tokens";

import { csrfFor, registerFully, uniqueEmail } from "./helpers";

/*
  The two protections that exist only to stop an attack, over HTTP, against the
  real application.

  Nothing here tests a feature. Every assertion has the form "this request
  should not have worked", which is the only way either of these can be tested:
  a CSRF hole and a missing rate limit both leave an API that answers every
  legitimate request perfectly. The rest of the suite proves the flows work;
  this file proves they cannot be driven from somewhere else, or driven forever.

  Rate limiting is switched on for this file alone. Every other spec runs with
  it off, because they all come from 127.0.0.1 and would otherwise spend the
  per-address allowance on themselves (see test/setup-env.ts).
*/

let app: NestFastifyApplication;
let db: PrismaClient;
let env: ReturnType<typeof loadEnv>;
let redis: RedisService;
const server = () => app.getHttpServer() as Parameters<typeof request>[0];

const ADMIN_PASSWORD = "correct horse battery staple";

beforeAll(async () => {
  process.env.RATE_LIMIT_ENABLED = "true";
  env = loadEnv();
  app = await createApp(env);
  await app.init();
  // Fastify does not route a request until it is ready; without this every
  // request simply hangs.
  await app.getHttpAdapter().getInstance().ready();
  db = createPrismaClient(env.DATABASE_URL);
  redis = app.get(RedisService);
});

afterAll(async () => {
  await clearLimits();
  await app.close();
  await db.$disconnect();
});

/*
  Counters outlive the process, and every request in this file comes from one
  address, so each test starts from zero rather than from wherever the last one
  left off. Otherwise the order the tests happen to run in decides which pass.
*/
async function clearLimits(): Promise<void> {
  const keys = await redis.client.keys("rl:*");
  if (keys.length > 0) await redis.client.del(...keys);
}

beforeEach(clearLimits);

/** An administrator straight into the table, the way the CLI makes one. */
async function makeAdmin(): Promise<string> {
  const email = `admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  await db.adminUser.create({
    data: {
      email,
      name: "Security Test Administrator",
      passwordHash: await hashPassword(ADMIN_PASSWORD),
      passwordChangedAt: new Date(),
      roles: ["KYC_REVIEWER"] as never,
    },
  });
  return email;
}

describe("the CSRF token", () => {
  /*
    The bridge between this file and the rest of the suite. Every other spec
    derives the token from the cookie with csrfFor(); this asserts that what the
    API actually puts on the wire is that same value, so the convenience cannot
    drift away from the thing it stands in for.
  */
  it("is handed over in a header with the session it belongs to", async () => {
    const email = uniqueEmail();
    await request(server()).post("/v1/auth/register/start").send({ email }).expect(202);
    const code = await codeFor(email);
    const verify = await request(server())
      .post("/v1/auth/register/verify")
      .send({ email, code })
      .expect(200);
    const complete = await request(server())
      .post("/v1/auth/register/complete")
      .send({ ticket: verify.body.ticket, password: "Correct1Horse" })
      .expect(201);

    const cookie = complete.headers["set-cookie"]?.[0] ?? "";
    expect(complete.headers["x-csrf-token"]).toBeTruthy();
    expect(complete.headers["x-csrf-token"]).toBe(csrfFor(cookie));
  });

  it("comes back on an authenticated read, so a client always holds a current one", async () => {
    const { cookie } = await registerFully(server(), db, uniqueEmail());
    const me = await request(server()).get("/v1/auth/me").set("Cookie", cookie).expect(200);
    expect(me.headers["x-csrf-token"]).toBe(csrfFor(cookie));
  });

  it("is not the session token, and does not carry it", async () => {
    const { cookie } = await registerFully(server(), db, uniqueEmail());
    const sessionToken = (cookie.split(";")[0] ?? "").split("=")[1] ?? "";
    expect(sessionToken).not.toHaveLength(0);
    expect(csrfFor(cookie)).not.toBe(sessionToken);
    expect(csrfFor(cookie)).not.toContain(sessionToken);
  });
});

describe("a cookie-authenticated mutation", () => {
  it("is refused outright with no token", async () => {
    const { cookie } = await registerFully(server(), db, uniqueEmail());
    const response = await request(server())
      .patch("/v1/auth/me")
      .set("Cookie", cookie)
      .send({ username: "renamed_one" })
      .expect(403);
    expect(response.body.error.code).toBe("CSRF_FAILED");
  });

  it("is refused with a token that is merely a plausible string", async () => {
    const { cookie } = await registerFully(server(), db, uniqueEmail());
    await request(server())
      .patch("/v1/auth/me")
      .set("Cookie", cookie)
      .set("x-csrf-token", "Zm9yZ2VkLXRva2VuLXRoYXQtbG9va3MtYWJvdXQtcmlnaHQ")
      .send({ username: "renamed_two" })
      .expect(403);
  });

  /*
    The property that makes the token worth having: it is bound to one session.
    Somebody who reads a token out of their own session must not be able to
    spend it against another.
  */
  it("is refused with a token that belongs to a different session", async () => {
    const victim = await registerFully(server(), db, uniqueEmail());
    const attacker = await registerFully(server(), db, uniqueEmail());
    await request(server())
      .patch("/v1/auth/me")
      .set("Cookie", victim.cookie)
      .set("x-csrf-token", csrfFor(attacker.cookie))
      .send({ username: "renamed_three" })
      .expect(403);
  });

  it("goes through with the token the API issued", async () => {
    const { cookie } = await registerFully(server(), db, uniqueEmail());
    // Unique per run: a username is unique across the platform, so a fixed one
    // here collides with whatever an interrupted earlier run left behind.
    const username = `renamed_${Math.random().toString(36).slice(2, 8)}`;
    const response = await request(server())
      .patch("/v1/auth/me")
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfFor(cookie))
      .send({ username })
      .expect(200);
    expect(response.body.user.username).toBe(username);
  });
});

describe("a read", () => {
  /*
    Asking a GET for a token would cost every one of them a CORS preflight, and
    a GET cannot change anything, so there would be nothing to show for it.
  */
  it("is not asked for a token", async () => {
    const { cookie } = await registerFully(server(), db, uniqueEmail());
    await request(server()).get("/v1/kyc").set("Cookie", cookie).expect(200);
    await request(server()).get("/v1/notifications").set("Cookie", cookie).expect(200);
  });
});

describe("signing out", () => {
  /*
    The one deliberate exemption, and the reason for it: a client that cannot
    tell whether it is signed in has never been handed a token, and it still has
    to be able to reach a signed-out state. A forged sign-out is a nuisance, not
    a breach, and the origin check still covers the browser case.
  */
  it("works without a token, on purpose", async () => {
    const { cookie } = await registerFully(server(), db, uniqueEmail());
    await request(server()).post("/v1/auth/logout").set("Cookie", cookie).expect(204);
  });
});

describe("the origin check", () => {
  it("refuses an unsafe request from an origin the API does not serve", async () => {
    const response = await request(server())
      .post("/v1/auth/login")
      .set("Origin", "https://evil.example")
      .send({ email: uniqueEmail(), password: "Correct1Horse" })
      .expect(403);
    expect(response.body.error.code).toBe("CSRF_FAILED");
  });

  /*
    Log-in, registration and recovery carry no session, so there is no token to
    ask them for. This is the check that covers them, which is why it applies to
    every unsafe request and not only to authenticated ones.
  */
  it("refuses a forged registration and a forged password reset too", async () => {
    for (const path of ["/v1/auth/register/start", "/v1/auth/password-reset"]) {
      await request(server())
        .post(path)
        .set("Origin", "https://evil.example")
        .send({ email: uniqueEmail() })
        .expect(403);
    }
  });

  it("allows the origin it does serve", async () => {
    await request(server())
      .post("/v1/auth/password-reset")
      .set("Origin", env.CORS_ORIGINS[0] ?? "")
      .send({ email: uniqueEmail() })
      .expect(202);
  });

  /*
    Sec-Fetch-Site is set by the browser and cannot be reached by script, so it
    is believed even when there is no Origin to compare against, which is how an
    opaque origin arrives.
  */
  it("refuses a cross-site request that sends no origin at all", async () => {
    await request(server())
      .post("/v1/auth/password-reset")
      .set("Sec-Fetch-Site", "cross-site")
      .send({ email: uniqueEmail() })
      .expect(403);
  });

  /*
    A caller with no Origin is not a browser, so it has no cookie jar for an
    attacker to borrow. Refusing those would break every non-browser client for
    nothing; they are still held to the token check when they use a cookie.
  */
  it("allows a caller that is not a browser", async () => {
    await request(server())
      .post("/v1/auth/password-reset")
      .send({ email: uniqueEmail() })
      .expect(202);
  });
});

describe("the two realms", () => {
  it("do not accept tokens derived for one another", async () => {
    const email = await makeAdmin();
    const login = await request(server())
      .post("/v1/admin/auth/login")
      .send({ email, password: ADMIN_PASSWORD })
      .expect(200);
    const cookie = login.headers["set-cookie"]?.[0] ?? "";
    const sessionToken = (cookie.split(";")[0] ?? "").split("=")[1] ?? "";

    // A token derived for the customer realm from this very session token must
    // be worthless against the admin realm that issued it.
    await request(server())
      .post("/v1/admin/auth/logout")
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfTokenFor("customer", sessionToken))
      .expect(403);

    // The one the admin realm actually issued is the one that works.
    expect(login.headers["x-csrf-token"]).toBe(csrfTokenFor("admin", sessionToken));
    await request(server())
      .post("/v1/admin/auth/logout")
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfTokenFor("admin", sessionToken))
      .expect(204);
  });

  it("hold an administrator to the token, with no exemption for signing out", async () => {
    const email = await makeAdmin();
    const login = await request(server())
      .post("/v1/admin/auth/login")
      .send({ email, password: ADMIN_PASSWORD })
      .expect(200);
    await request(server())
      .post("/v1/admin/auth/logout")
      .set("Cookie", login.headers["set-cookie"]?.[0] ?? "")
      .expect(403);
  });
});

describe("rate limits", () => {
  /*
    Four reset emails to one address in a quarter of an hour, then no more. The
    address is the subject because somebody else's inbox is the target.
  */
  it("stop an address being used to post someone mail forever", async () => {
    const email = uniqueEmail();
    for (let attempt = 0; attempt < 4; attempt++) {
      await request(server()).post("/v1/auth/password-reset").send({ email }).expect(202);
    }
    const refused = await request(server())
      .post("/v1/auth/password-reset")
      .send({ email })
      .expect(429);
    expect(refused.body.error.code).toBe("RATE_LIMITED");
    expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("count each address separately", async () => {
    const spent = uniqueEmail();
    for (let attempt = 0; attempt < 4; attempt++) {
      await request(server()).post("/v1/auth/password-reset").send({ email: spent }).expect(202);
    }
    // A different address has its own allowance, untouched by the one above.
    await request(server())
      .post("/v1/auth/password-reset")
      .send({ email: uniqueEmail() })
      .expect(202);
  });

  /*
    One route running out must not take another with it. The counter is named
    after the route, which is what makes that true with nothing to maintain.
  */
  it("count each route separately", async () => {
    const email = uniqueEmail();
    for (let attempt = 0; attempt < 4; attempt++) {
      await request(server()).post("/v1/auth/password-reset").send({ email }).expect(202);
    }
    await request(server()).post("/v1/auth/password-reset").send({ email }).expect(429);
    // Same address, different route: unaffected, and answers on its merits.
    await request(server())
      .post("/v1/auth/login")
      .send({ email, password: "Correct1Horse" })
      .expect(401);
  });

  /*
    The tightest limit in the application. This is the single door into the admin
    realm and it answers to a password alone until MFA lands, so five attempts
    against one account is the whole allowance (docs/open-questions.md Q2a).
  */
  it("hold the admin door to five attempts an account", async () => {
    const email = await makeAdmin();
    for (let attempt = 0; attempt < 5; attempt++) {
      await request(server())
        .post("/v1/admin/auth/login")
        .send({ email, password: "not the password" })
        .expect(401);
    }
    // Even the correct password, which is the point: the account is closed for
    // the rest of the window, not merely the wrong guesses.
    const refused = await request(server())
      .post("/v1/admin/auth/login")
      .send({ email, password: ADMIN_PASSWORD })
      .expect(429);
    expect(refused.body.error.code).toBe("RATE_LIMITED");
  });

  /*
    Threat model B3.4, asserted rather than merely written down: with Redis
    unreachable the limiter cannot tell a first attempt from a ten thousandth,
    and letting everything through is the outcome an attacker would choose. So a
    limited endpoint is refused instead.
  */
  describe("when Redis will not answer", () => {
    /*
      The command is made to fail rather than the socket being pulled, and that
      is the more honest test as well as the stabler one. Pulling the socket does
      not hold: the client is configured to reconnect on a timer, so it comes
      back mid-test and the outage being tested stops existing. What every real
      failure has in common - server gone, connection reset, command timed out -
      is that the command rejects, so that is what is reproduced. The message is
      the one ioredis raises when the stream has gone.
    */
    let failing: jest.SpyInstance;

    beforeAll(() => {
      failing = jest
        .spyOn(redis.client, "eval")
        .mockRejectedValue(new Error("Connection is closed"));
    });

    afterAll(() => {
      failing.mockRestore();
    });

    it("a limited endpoint fails closed rather than open", async () => {
      const response = await request(server())
        .post("/v1/auth/password-reset")
        .send({ email: uniqueEmail() })
        .expect(503);
      expect(response.body.error.code).toBe("NOT_READY");
    });

    /*
      And the blast radius stops there. A route with no limit declared never
      asks the limiter anything, so a cache outage does not become an outage of
      everything - which is why the cheap reads deliberately have no limit on
      them. That the stub was never called is the assertion.
    */
    it("an unlimited route is untouched", async () => {
      failing.mockClear();
      await request(server()).get("/v1/auth/me").expect(401);
      await request(server()).get("/health").expect(200);
      expect(failing).not.toHaveBeenCalled();
    });
  });
});

/** The emailed code, read from the database: tests run with the log mailer. */
async function codeFor(email: string): Promise<string> {
  const token = await db.verificationToken.findFirst({
    where: { email, purpose: "EMAIL_VERIFICATION", consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!token) throw new Error(`no code for ${email}`);
  const { createHash } = await import("node:crypto");
  for (let i = 0; i < 1_000_000; i++) {
    const candidate = i.toString().padStart(6, "0");
    if (createHash("sha256").update(candidate).digest("hex") === token.tokenHash) return candidate;
  }
  throw new Error("code not recoverable");
}
