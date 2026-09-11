import { KYC_REJECTION_REASONS } from "@abay/contracts";
import { createPrismaClient, type PrismaClient } from "@abay/database";
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";

import { createApp } from "@/app";
import { loadEnv } from "@/config/env";
import { hashPassword } from "@/modules/auth/tokens";

import { csrfFor, registerFully, uniqueEmail, uploadPhotos } from "./helpers";

/*
  What a customer is told without doing anything on this device.

  The only writer is a KYC decision, so what matters here is that the two
  happen together (a customer is never told about a decision that did not
  happen, and never left uninformed about one that did), that the wording a
  rejection carries is the reason an administrator actually gave, and that
  the notifications are exactly as private as everything else in this app -
  an id alone is never enough to read or mark somebody else's.
*/

let app: NestFastifyApplication;
let db: PrismaClient;
const server = () => app.getHttpServer() as Parameters<typeof request>[0];

const ADMIN_PASSWORD = "correct horse battery staple";

const DETAILS = {
  legalName: "Abebe Bikila",
  dateOfBirth: "1990-04-12",
  documentType: "NATIONAL_ID",
  documentNumber: "ET-4410-9921",
} as const;

async function makeAdmin(): Promise<string> {
  const email = `admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  await db.adminUser.create({
    data: {
      email,
      name: "Test Administrator",
      passwordHash: await hashPassword(ADMIN_PASSWORD),
      passwordChangedAt: new Date(),
      roles: ["KYC_REVIEWER"],
    },
  });
  const response = await request(server())
    .post("/v1/admin/auth/login")
    .send({ email, password: ADMIN_PASSWORD })
    .expect(200);
  const cookie = response.headers["set-cookie"]?.[0];
  if (!cookie) throw new Error("admin sign-in set no cookie");
  return cookie;
}

async function pendingSubmission(): Promise<{ userId: string; cookie: string; id: string }> {
  const customer = await registerFully(server(), db, uniqueEmail());
  const documents = await uploadPhotos(server(), customer.cookie);
  await request(server())
    .post("/v1/kyc")
    .set("Cookie", customer.cookie)
    .set("x-csrf-token", csrfFor(customer.cookie))
    .send({ ...DETAILS, documents })
    .expect(202);
  const submission = await db.kycSubmission.findFirstOrThrow({
    where: { userId: customer.userId },
    orderBy: { createdAt: "desc" },
  });
  return { userId: customer.userId, cookie: customer.cookie, id: submission.id };
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

describe("notifications", () => {
  it("starts empty, and is reachable only with a session", async () => {
    await request(server()).get("/v1/notifications").expect(401);

    const { cookie } = await registerFully(server(), db, uniqueEmail());
    const list = await request(server()).get("/v1/notifications").set("Cookie", cookie).expect(200);
    expect(list.body).toEqual({ notifications: [], unreadCount: 0 });
  });

  it("tells the customer the moment an administrator approves, and not before", async () => {
    const submission = await pendingSubmission();

    const before = await request(server())
      .get("/v1/notifications")
      .set("Cookie", submission.cookie)
      .expect(200);
    expect(before.body).toEqual({ notifications: [], unreadCount: 0 });

    const adminCookie = await makeAdmin();
    await request(server())
      .post(`/v1/admin/kyc/submissions/${submission.id}/approve`)
      .set("Cookie", adminCookie)
      .set("x-csrf-token", csrfFor(adminCookie))
      .send({})
      .expect(200);

    const after = await request(server())
      .get("/v1/notifications")
      .set("Cookie", submission.cookie)
      .expect(200);
    expect(after.body.unreadCount).toBe(1);
    expect(after.body.notifications).toHaveLength(1);
    expect(after.body.notifications[0]).toMatchObject({
      type: "KYC_APPROVED",
      link: "/verify",
      readAt: null,
    });
  });

  it("carries the canonical sentence for the reason the administrator chose", async () => {
    const submission = await pendingSubmission();
    const adminCookie = await makeAdmin();

    await request(server())
      .post(`/v1/admin/kyc/submissions/${submission.id}/reject`)
      .set("Cookie", adminCookie)
      .set("x-csrf-token", csrfFor(adminCookie))
      .send({ reason: "PHOTO_UNREADABLE" })
      .expect(200);

    const list = await request(server())
      .get("/v1/notifications")
      .set("Cookie", submission.cookie)
      .expect(200);
    expect(list.body.notifications[0]).toMatchObject({
      type: "KYC_REJECTED",
      body: KYC_REJECTION_REASONS.PHOTO_UNREADABLE,
    });
  });

  it("marks one as read, and only its owner may", async () => {
    const submission = await pendingSubmission();
    const adminCookie = await makeAdmin();
    await request(server())
      .post(`/v1/admin/kyc/submissions/${submission.id}/approve`)
      .set("Cookie", adminCookie)
      .set("x-csrf-token", csrfFor(adminCookie))
      .send({})
      .expect(200);

    const list = await request(server())
      .get("/v1/notifications")
      .set("Cookie", submission.cookie)
      .expect(200);
    const id = list.body.notifications[0].id as string;

    const stranger = await registerFully(server(), db, uniqueEmail());
    // Not 200-with-no-effect: the stranger cannot tell this exists at all.
    await request(server())
      .post(`/v1/notifications/${id}/read`)
      .set("Cookie", stranger.cookie)
      .set("x-csrf-token", csrfFor(stranger.cookie))
      .expect(404);
    const untouched = await request(server())
      .get("/v1/notifications")
      .set("Cookie", submission.cookie)
      .expect(200);
    expect(untouched.body.unreadCount).toBe(1);

    await request(server())
      .post(`/v1/notifications/${id}/read`)
      .set("Cookie", submission.cookie)
      .set("x-csrf-token", csrfFor(submission.cookie))
      .expect(204);
    const read = await request(server())
      .get("/v1/notifications")
      .set("Cookie", submission.cookie)
      .expect(200);
    expect(read.body.unreadCount).toBe(0);
    expect(read.body.notifications[0].readAt).toEqual(expect.any(String));

    // Marking an already-read one again is not an error.
    await request(server())
      .post(`/v1/notifications/${id}/read`)
      .set("Cookie", submission.cookie)
      .set("x-csrf-token", csrfFor(submission.cookie))
      .expect(204);
  });

  it("marks every unread one at once", async () => {
    const a = await pendingSubmission();
    const b = await pendingSubmission();
    const adminCookie = await makeAdmin();
    // Two decisions for the SAME account, so there are two to clear together.
    await request(server())
      .post(`/v1/admin/kyc/submissions/${a.id}/reject`)
      .set("Cookie", adminCookie)
      .set("x-csrf-token", csrfFor(adminCookie))
      .send({ reason: "PHOTO_UNREADABLE" })
      .expect(200);

    // Submit and decide a second time for the same customer.
    const documents = await uploadPhotos(server(), a.cookie);
    await request(server())
      .post("/v1/kyc")
      .set("Cookie", a.cookie)
      .set("x-csrf-token", csrfFor(a.cookie))
      .send({ ...DETAILS, documents })
      .expect(202);
    const second = await db.kycSubmission.findFirstOrThrow({
      where: { userId: a.userId },
      orderBy: { createdAt: "desc" },
    });
    await request(server())
      .post(`/v1/admin/kyc/submissions/${second.id}/approve`)
      .set("Cookie", adminCookie)
      .set("x-csrf-token", csrfFor(adminCookie))
      .send({})
      .expect(200);

    const before = await request(server())
      .get("/v1/notifications")
      .set("Cookie", a.cookie)
      .expect(200);
    expect(before.body.unreadCount).toBe(2);

    await request(server())
      .post("/v1/notifications/read-all")
      .set("Cookie", a.cookie)
      .set("x-csrf-token", csrfFor(a.cookie))
      .expect(204);

    const after = await request(server())
      .get("/v1/notifications")
      .set("Cookie", a.cookie)
      .expect(200);
    expect(after.body.unreadCount).toBe(0);

    // b's own notification is untouched by a clearing their own.
    await request(server())
      .post(`/v1/admin/kyc/submissions/${b.id}/approve`)
      .set("Cookie", adminCookie)
      .set("x-csrf-token", csrfFor(adminCookie))
      .send({})
      .expect(200);
    const bList = await request(server())
      .get("/v1/notifications")
      .set("Cookie", b.cookie)
      .expect(200);
    expect(bList.body.unreadCount).toBe(1);
  });
});
