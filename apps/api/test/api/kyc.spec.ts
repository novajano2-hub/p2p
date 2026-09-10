import { createPrismaClient, type PrismaClient } from "@abay/database";
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";

import { createApp } from "@/app";
import { loadEnv } from "@/config/env";

import { registerFully, uniqueEmail } from "./helpers";

/*
  Identity verification over HTTP, against the real database.

  What matters here is not that a form submits: it is that a customer cannot
  verify themselves, cannot be verified twice, and cannot see or touch anyone
  else's submission. Approval is an administrator's act and has no route on
  this side at all, which is the property the last test pins down.
*/

let app: NestFastifyApplication;
let db: PrismaClient;
const server = () => app.getHttpServer() as Parameters<typeof request>[0];

const DETAILS = {
  legalName: "Abebe Bikila",
  dateOfBirth: "1990-04-12",
  country: "ET",
  documentType: "NATIONAL_ID",
  documentNumber: "ET-4410-9921",
} as const;

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

describe("identity verification", () => {
  it("starts unverified and says so", async () => {
    const { cookie } = await registerFully(server(), db, uniqueEmail());

    const state = await request(server()).get("/v1/kyc").set("Cookie", cookie).expect(200);
    expect(state.body).toMatchObject({
      status: "NOT_STARTED",
      submittedAt: null,
      rejectionReason: null,
    });

    // And the session carries it, so every screen agrees without asking twice.
    const me = await request(server()).get("/v1/auth/me").set("Cookie", cookie).expect(200);
    expect(me.body.user.kycStatus).toBe("NOT_STARTED");
  });

  it("records a submission, moves the account to pending, and refuses a second one", async () => {
    const { cookie, userId } = await registerFully(server(), db, uniqueEmail());

    const submitted = await request(server())
      .post("/v1/kyc")
      .set("Cookie", cookie)
      .send(DETAILS)
      .expect(202);
    expect(submitted.body.status).toBe("PENDING");
    expect(submitted.body.submittedAt).toEqual(expect.any(String));

    const stored = await db.kycSubmission.findFirst({ where: { userId } });
    expect(stored).toMatchObject({
      legalName: DETAILS.legalName,
      country: "ET",
      documentType: "NATIONAL_ID",
      status: "PENDING",
      reviewedAt: null,
    });

    // A second attempt would leave an administrator with two versions of the
    // truth, so it is refused while the first is still waiting.
    await request(server()).post("/v1/kyc").set("Cookie", cookie).send(DETAILS).expect(409);
  });

  it("enforces its rules on the server, not only in the browser", async () => {
    const { cookie } = await registerFully(server(), db, uniqueEmail());

    const tooYoung = new Date();
    tooYoung.setUTCFullYear(tooYoung.getUTCFullYear() - 15);
    const under18 = await request(server())
      .post("/v1/kyc")
      .set("Cookie", cookie)
      .send({ ...DETAILS, dateOfBirth: tooYoung.toISOString().slice(0, 10) })
      .expect(400);
    expect(under18.body.error.code).toBe("VALIDATION_FAILED");

    await request(server())
      .post("/v1/kyc")
      .set("Cookie", cookie)
      .send({ ...DETAILS, documentType: "LIBRARY_CARD" })
      .expect(400);

    await request(server())
      .post("/v1/kyc")
      .set("Cookie", cookie)
      .send({ ...DETAILS, legalName: "A" })
      .expect(400);

    // None of that got as far as the database.
    const count = await db.kycSubmission.count({
      where: { user: { sessions: { some: {} } }, legalName: "A" },
    });
    expect(count).toBe(0);
  });

  it("is the customer's own, and reachable only with a session", async () => {
    await request(server()).get("/v1/kyc").expect(401);
    await request(server()).post("/v1/kyc").send(DETAILS).expect(401);

    const alice = await registerFully(server(), db, uniqueEmail());
    const bob = await registerFully(server(), db, uniqueEmail());
    await request(server()).post("/v1/kyc").set("Cookie", alice.cookie).send(DETAILS).expect(202);

    // Alice submitting says nothing about Bob.
    const bobState = await request(server()).get("/v1/kyc").set("Cookie", bob.cookie).expect(200);
    expect(bobState.body.status).toBe("NOT_STARTED");
  });

  it("has no route a customer could use to approve anyone, including themselves", async () => {
    const { cookie } = await registerFully(server(), db, uniqueEmail());
    await request(server()).post("/v1/kyc").set("Cookie", cookie).send(DETAILS).expect(202);

    // Approval is an administrator's act. Nothing under /v1/kyc performs one.
    for (const path of ["/v1/kyc/approve", "/v1/kyc/review", "/v1/kyc/status"]) {
      const res = await request(server()).post(path).set("Cookie", cookie).send({});
      expect(res.status).toBe(404);
    }
    // And the account is still only pending.
    const state = await request(server()).get("/v1/kyc").set("Cookie", cookie).expect(200);
    expect(state.body.status).toBe("PENDING");
  });
});
