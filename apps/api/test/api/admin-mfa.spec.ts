import { createPrismaClient, type PrismaClient } from "@abay/database";
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";

import { createApp } from "@/app";
import { base32Decode, totpAt } from "@/common/security/totp";
import { loadEnv } from "@/config/env";
import { hashPassword } from "@/modules/auth/tokens";

import { csrfFor, enrolledTotp, totpCodeFor } from "./helpers";

/*
  The administrator's second factor, end to end over HTTP: that it can be
  enrolled, that it is demanded once enrolled, that a code cannot be spent
  twice, and - the part that makes "mandatory" true rather than aspirational -
  that a session without it can reach nothing but enrollment.

  Every other admin spec starts from an already-enrolled account; this is the
  one place the enrollment ceremony itself, and the un-enrolled state, are
  what is under test.
*/

let app: NestFastifyApplication;
let db: PrismaClient;
const server = () => app.getHttpServer() as Parameters<typeof request>[0];

const PASSWORD = "correct horse battery staple";

beforeAll(async () => {
  const env = loadEnv();
  app = await createApp(env);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  db = createPrismaClient(env.DATABASE_URL);
});

afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

/** A fresh administrator with NO second factor: the state every account starts in. */
async function makeBareAdmin(): Promise<{ id: string; email: string }> {
  const email = `admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const admin = await db.adminUser.create({
    data: {
      email,
      name: "Unenrolled Administrator",
      passwordHash: await hashPassword(PASSWORD),
      passwordChangedAt: new Date(),
      roles: ["KYC_REVIEWER"],
    },
  });
  return { id: admin.id, email };
}

async function passwordOnlySignIn(email: string): Promise<string> {
  const response = await request(server())
    .post("/v1/admin/auth/login")
    .send({ email, password: PASSWORD })
    .expect(200);
  const cookie = response.headers["set-cookie"]?.[0];
  if (!cookie) throw new Error("sign-in set no cookie");
  return cookie;
}

describe("a session with no second factor yet", () => {
  it("signs in on the password alone, but is not counted as enrolled", async () => {
    const admin = await makeBareAdmin();
    const cookie = await passwordOnlySignIn(admin.email);
    const me = await request(server()).get("/v1/admin/auth/me").set("Cookie", cookie).expect(200);
    expect(me.body.admin.mfaEnrolled).toBe(false);
  });

  it("is refused everything but the enrollment routes", async () => {
    const admin = await makeBareAdmin();
    const cookie = await passwordOnlySignIn(admin.email);

    // The real work of the realm: closed until enrollment is done.
    const blocked = await request(server())
      .get("/v1/admin/kyc/queue")
      .set("Cookie", cookie)
      .expect(403);
    expect(blocked.body.error.code).toBe("FORBIDDEN");

    // What it CAN reach: find out who it is, set up, and leave.
    await request(server()).get("/v1/admin/auth/me").set("Cookie", cookie).expect(200);
    await request(server())
      .post("/v1/admin/auth/mfa/setup")
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfFor(cookie))
      .expect(200);
  });
});

describe("enrollment", () => {
  it("stages a secret, then activates it once a code proves the app has it", async () => {
    const admin = await makeBareAdmin();
    const cookie = await passwordOnlySignIn(admin.email);

    const setup = await request(server())
      .post("/v1/admin/auth/mfa/setup")
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfFor(cookie))
      .expect(200);
    const secret = String(setup.body.secret);
    expect(secret).toBeTruthy();
    expect(setup.body.otpauthUri).toContain("otpauth://totp/");

    // Staged, not yet active: still not enrolled, and the secret is not stored raw.
    const midway = await db.adminUser.findUniqueOrThrow({ where: { id: admin.id } });
    expect(midway.totpEnrolledAt).toBeNull();
    expect(midway.totpSecret).toBeNull();
    expect(midway.totpPendingSecret).not.toContain(secret);

    const confirm = await request(server())
      .post("/v1/admin/auth/mfa/confirm")
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfFor(cookie))
      .send({ code: totpCodeFor(secret) })
      .expect(200);
    expect(confirm.body.admin.mfaEnrolled).toBe(true);

    // Now the real routes open, on the same session.
    await request(server()).get("/v1/admin/kyc/queue").set("Cookie", cookie).expect(200);

    // And it was written down.
    const event = await db.auditEvent.findFirst({
      where: { action: "admin.mfa_enrolled", subjectId: admin.id },
    });
    expect(event).not.toBeNull();
  });

  it("refuses to confirm with a wrong code, and stays unenrolled", async () => {
    const admin = await makeBareAdmin();
    const cookie = await passwordOnlySignIn(admin.email);
    await request(server())
      .post("/v1/admin/auth/mfa/setup")
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfFor(cookie))
      .expect(200);

    await request(server())
      .post("/v1/admin/auth/mfa/confirm")
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfFor(cookie))
      .send({ code: "000000" })
      .expect(401);

    const still = await db.adminUser.findUniqueOrThrow({ where: { id: admin.id } });
    expect(still.totpEnrolledAt).toBeNull();
    await request(server()).get("/v1/admin/kyc/queue").set("Cookie", cookie).expect(403);
  });
});

describe("sign-in, once enrolled", () => {
  /** Insert an already-enrolled admin and return the clear secret. */
  async function makeEnrolled(): Promise<{ email: string; secret: string }> {
    const email = `admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const totp = enrolledTotp();
    await db.adminUser.create({
      data: {
        email,
        name: "Enrolled Administrator",
        passwordHash: await hashPassword(PASSWORD),
        passwordChangedAt: new Date(),
        roles: ["KYC_REVIEWER"],
        ...totp.fields,
      },
    });
    return { email, secret: totp.secret };
  }

  it("demands the code: a right password with none is MFA_REQUIRED, not a session", async () => {
    const admin = await makeEnrolled();
    const response = await request(server())
      .post("/v1/admin/auth/login")
      .send({ email: admin.email, password: PASSWORD })
      .expect(401);
    expect(response.body.error.code).toBe("MFA_REQUIRED");
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("refuses a wrong code", async () => {
    const admin = await makeEnrolled();
    await request(server())
      .post("/v1/admin/auth/login")
      .send({ email: admin.email, password: PASSWORD, code: "000000" })
      .expect(401);
  });

  it("lets a right password and a right code in", async () => {
    const admin = await makeEnrolled();
    await request(server())
      .post("/v1/admin/auth/login")
      .send({ email: admin.email, password: PASSWORD, code: totpCodeFor(admin.secret) })
      .expect(200);
  });

  /*
    RFC 6238 5.2: a code is single-use. The step it belongs to is recorded on
    acceptance, and a second sign-in inside the same 30 seconds - same code -
    must be refused, or a shoulder-surfed or logged code is replayable for
    half a minute.
  */
  it("will not accept the same code twice", async () => {
    const admin = await makeEnrolled();
    const code = totpCodeFor(admin.secret);
    await request(server())
      .post("/v1/admin/auth/login")
      .send({ email: admin.email, password: PASSWORD, code })
      .expect(200);
    await request(server())
      .post("/v1/admin/auth/login")
      .send({ email: admin.email, password: PASSWORD, code })
      .expect(401);
  });

  /*
    A code from the step just gone is still valid at that instant (clock skew),
    but once a LATER step has been spent, going back to the earlier one must
    fail: the recorded step only ever moves forward.
  */
  it("will not accept a code older than the last one used", async () => {
    const admin = await makeEnrolled();
    const now = Date.now();
    const current = totpAt(base32Decode(admin.secret), now);
    const previous = totpAt(base32Decode(admin.secret), now - 30_000);
    expect(current).not.toBe(previous);

    await request(server())
      .post("/v1/admin/auth/login")
      .send({ email: admin.email, password: PASSWORD, code: current })
      .expect(200);
    await request(server())
      .post("/v1/admin/auth/login")
      .send({ email: admin.email, password: PASSWORD, code: previous })
      .expect(401);
  });
});
