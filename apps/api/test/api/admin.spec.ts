import { createPrismaClient, type PrismaClient } from "@abay/database";
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";

import { createApp } from "@/app";
import { loadEnv } from "@/config/env";
import { hashPassword } from "@/modules/auth/tokens";

import { registerFully, uniqueEmail, uploadPhotos } from "./helpers";

/*
  The admin realm, over HTTP, against the real database.

  What is being tested is not that a queue renders. It is the separation the
  realm exists for: that a customer session buys nothing here, that an admin
  session buys nothing on the customer side, that being an administrator is
  not the same as being allowed, that a decision cannot be made twice, and
  that no decision can happen without a record of who made it - one that the
  person who made it cannot then edit.
*/

let app: NestFastifyApplication;
let db: PrismaClient;
const server = () => app.getHttpServer() as Parameters<typeof request>[0];

const ADMIN_PASSWORD = "correct horse battery staple";

/** Only the fields these tests read back. Supertest hands over `any`. */
interface QueueItem {
  id: string;
  account: { userId: string };
  documents: { id: string; kind: string }[];
}

const DETAILS = {
  legalName: "Abebe Bikila",
  dateOfBirth: "1990-04-12",
  documentType: "NATIONAL_ID",
  documentNumber: "ET-4410-9921",
} as const;

/** An administrator straight into the table, the way the CLI makes one. */
async function makeAdmin(
  roles: string[] = ["KYC_REVIEWER"],
): Promise<{ id: string; email: string }> {
  const email = `admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const admin = await db.adminUser.create({
    data: {
      email,
      name: "Test Administrator",
      passwordHash: await hashPassword(ADMIN_PASSWORD),
      passwordChangedAt: new Date(),
      roles: roles as never,
    },
  });
  return { id: admin.id, email: admin.email };
}

async function signIn(email: string, password = ADMIN_PASSWORD): Promise<string> {
  const response = await request(server())
    .post("/v1/admin/auth/login")
    .send({ email, password })
    .expect(200);
  const cookie = response.headers["set-cookie"]?.[0];
  if (!cookie) throw new Error("admin sign-in set no cookie");
  return cookie;
}

/** A customer who has submitted, so there is something in the queue. */
async function pendingSubmission(): Promise<{ userId: string; cookie: string; id: string }> {
  const customer = await registerFully(server(), db, uniqueEmail());
  const documents = await uploadPhotos(server(), customer.cookie);
  await request(server())
    .post("/v1/kyc")
    .set("Cookie", customer.cookie)
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

describe("the admin realm", () => {
  it("signs an administrator in with their own cookie, and records it", async () => {
    const admin = await makeAdmin();
    const cookie = await signIn(admin.email);

    // Its own name. Nothing about it says "session" in the customer sense.
    expect(cookie).toContain("birq_admin_session=");
    expect(cookie).toContain("HttpOnly");
    // Strict, not Lax: nobody should ever arrive at an admin action from a link.
    expect(cookie).toMatch(/SameSite=Strict/i);

    const me = await request(server()).get("/v1/admin/auth/me").set("Cookie", cookie).expect(200);
    expect(me.body.admin).toMatchObject({ email: admin.email, roles: ["KYC_REVIEWER"] });
    // The hash never has a shape that reaches a client.
    expect(JSON.stringify(me.body)).not.toContain("passwordHash");

    const signedIn = await db.auditEvent.findFirst({
      where: { action: "admin.signed_in", actorAdminId: admin.id },
    });
    expect(signedIn).toMatchObject({ actorEmail: admin.email, subjectType: "admin_user" });
  });

  it("refuses a bad password, a suspended account, and records the failure", async () => {
    const admin = await makeAdmin();

    await request(server())
      .post("/v1/admin/auth/login")
      .send({ email: admin.email, password: "not it" })
      .expect(401);
    const failure = await db.auditEvent.findFirst({
      where: { action: "admin.sign_in_failed", subjectId: admin.id },
    });
    // Recorded against the account, with nobody named as the actor: whoever
    // tried is exactly what is not known.
    expect(failure).toMatchObject({ actorAdminId: null });

    await db.adminUser.update({ where: { id: admin.id }, data: { status: "SUSPENDED" } });
    await request(server())
      .post("/v1/admin/auth/login")
      .send({ email: admin.email, password: ADMIN_PASSWORD })
      .expect(401);

    // An address that is not an administrator answers the same way.
    await request(server())
      .post("/v1/admin/auth/login")
      .send({ email: uniqueEmail(), password: ADMIN_PASSWORD })
      .expect(401);
  });

  it("keeps the two realms apart in both directions", async () => {
    const admin = await makeAdmin();
    const adminCookie = await signIn(admin.email);
    const customer = await registerFully(server(), db, uniqueEmail());

    // A customer session is not a weak admin session. It is nothing here.
    await request(server()).get("/v1/admin/kyc/queue").set("Cookie", customer.cookie).expect(401);
    await request(server()).get("/v1/admin/auth/me").set("Cookie", customer.cookie).expect(401);
    await request(server()).get("/v1/admin/kyc/queue").expect(401);

    // And the reverse: an administrator is not a customer with extra powers.
    // They have no account on that side at all.
    await request(server()).get("/v1/auth/me").set("Cookie", adminCookie).expect(401);
    await request(server()).get("/v1/kyc").set("Cookie", adminCookie).expect(401);
  });

  it("treats being an administrator and being allowed as different things", async () => {
    // A real, signed-in administrator, with no roles at all.
    const nobody = await makeAdmin([]);
    const cookie = await signIn(nobody.email);

    // They are signed in.
    await request(server()).get("/v1/admin/auth/me").set("Cookie", cookie).expect(200);
    // And they can do nothing.
    await request(server()).get("/v1/admin/kyc/queue").set("Cookie", cookie).expect(403);

    const { id } = await pendingSubmission();
    await request(server())
      .post(`/v1/admin/kyc/submissions/${id}/approve`)
      .set("Cookie", cookie)
      .send({})
      .expect(403);

    // Holding a different role is not holding this one.
    const other = await makeAdmin(["WITHDRAWAL_APPROVER"]);
    const otherCookie = await signIn(other.email);
    await request(server()).get("/v1/admin/kyc/queue").set("Cookie", otherCookie).expect(403);
  });

  it("approves a submission, lifts the account, and cannot do it twice", async () => {
    const admin = await makeAdmin();
    const cookie = await signIn(admin.email);
    const submission = await pendingSubmission();

    const queue = await request(server())
      .get("/v1/admin/kyc/queue")
      .set("Cookie", cookie)
      .expect(200);
    const listed = queue.body.submissions as QueueItem[];
    const queued = listed.find((item) => item.id === submission.id);
    expect(queued).toBeDefined();
    expect(queued!.account.userId).toBe(submission.userId);
    expect(queued!.documents).toHaveLength(3);

    const approved = await request(server())
      .post(`/v1/admin/kyc/submissions/${submission.id}/approve`)
      .set("Cookie", cookie)
      .send({ note: "Matches the document." })
      .expect(200);
    expect(approved.body.status).toBe("APPROVED");

    // The account is what actually changed, and the customer sees it.
    const state = await request(server())
      .get("/v1/kyc")
      .set("Cookie", submission.cookie)
      .expect(200);
    expect(state.body.status).toBe("APPROVED");

    // Who decided is recorded, alongside what it was before.
    const event = await db.auditEvent.findFirstOrThrow({
      where: { action: "kyc.approved", subjectId: submission.id },
    });
    expect(event).toMatchObject({ actorAdminId: admin.id, actorEmail: admin.email });
    expect(event.before).toMatchObject({ submissionStatus: "PENDING" });

    // A second decision is refused rather than quietly overwriting the first.
    await request(server())
      .post(`/v1/admin/kyc/submissions/${submission.id}/reject`)
      .set("Cookie", cookie)
      .send({ reason: "Changed my mind about this one entirely." })
      .expect(409);
    // It is out of the queue.
    const after = await request(server())
      .get("/v1/admin/kyc/queue")
      .set("Cookie", cookie)
      .expect(200);
    const remaining = after.body.submissions as QueueItem[];
    expect(remaining.some((item) => item.id === submission.id)).toBe(false);
  });

  it("will not reject without a reason the customer can act on", async () => {
    const admin = await makeAdmin();
    const cookie = await signIn(admin.email);
    const submission = await pendingSubmission();

    await request(server())
      .post(`/v1/admin/kyc/submissions/${submission.id}/reject`)
      .set("Cookie", cookie)
      .send({})
      .expect(400);
    await request(server())
      .post(`/v1/admin/kyc/submissions/${submission.id}/reject`)
      .set("Cookie", cookie)
      .send({ reason: "no" })
      .expect(400);
    // Still waiting: neither attempt decided anything.
    expect(
      (await db.kycSubmission.findUniqueOrThrow({ where: { id: submission.id } })).status,
    ).toBe("PENDING");

    const reason = "The name on the card does not match the name you entered.";
    await request(server())
      .post(`/v1/admin/kyc/submissions/${submission.id}/reject`)
      .set("Cookie", cookie)
      .send({ reason })
      .expect(200);

    // And the customer is told exactly that, which is the point of requiring it.
    const state = await request(server())
      .get("/v1/kyc")
      .set("Cookie", submission.cookie)
      .expect(200);
    expect(state.body).toMatchObject({ status: "REJECTED", rejectionReason: reason });
  });

  it("records who looked at somebody's identity documents", async () => {
    const admin = await makeAdmin();
    const cookie = await signIn(admin.email);
    const submission = await pendingSubmission();

    const opened = await request(server())
      .get(`/v1/admin/kyc/submissions/${submission.id}`)
      .set("Cookie", cookie)
      .expect(200);
    expect(opened.body.legalName).toBe(DETAILS.legalName);

    const viewed = await db.auditEvent.findFirst({
      where: { action: "kyc.submission_viewed", subjectId: submission.id },
    });
    expect(viewed).toMatchObject({ actorAdminId: admin.id });

    // The photograph itself comes back to a reviewer.
    const documentId = opened.body.documents[0].id as string;
    const image = await request(server())
      .get(`/v1/admin/kyc/submissions/${submission.id}/documents/${documentId}`)
      .set("Cookie", cookie)
      .expect(200);
    expect(image.headers["content-type"]).toContain("image/");

    // But a document id cannot be walked from one submission to another.
    const other = await pendingSubmission();
    await request(server())
      .get(`/v1/admin/kyc/submissions/${other.id}/documents/${documentId}`)
      .set("Cookie", cookie)
      .expect(404);
  });

  it("never widens the admin cookie to the parent domain, even when one is configured", async () => {
    /*
      In production COOKIE_DOMAIN is set so the web server can see the customer
      cookie and route on it. If the admin cookie inherited that, an
      administrator's session would be sent to birq.com with every request for
      an image or a script - exactly the reach this realm is separated to
      avoid. So a second app is booted the way production is, and both cookies
      are read off it.
    */
    const widened = await createApp({ ...loadEnv(), COOKIE_DOMAIN: ".birq.com" });
    await widened.init();
    await widened.getHttpAdapter().getInstance().ready();
    const wide = () => widened.getHttpServer() as Parameters<typeof request>[0];

    try {
      const admin = await makeAdmin();
      const signIn = await request(wide())
        .post("/v1/admin/auth/login")
        .send({ email: admin.email, password: ADMIN_PASSWORD })
        .expect(200);
      expect(signIn.headers["set-cookie"]?.[0]).not.toMatch(/Domain=/i);

      // And the setting is genuinely on: the customer cookie from the same app
      // does widen, which is what makes the line above mean something.
      const customer = await registerFully(wide(), db, uniqueEmail());
      expect(customer.cookie).toMatch(/Domain=\.birq\.com/i);
    } finally {
      await widened.close();
    }
  });

  it("cannot rewrite its own audit trail", async () => {
    const admin = await makeAdmin();
    await signIn(admin.email);
    const event = await db.auditEvent.findFirstOrThrow({ where: { actorAdminId: admin.id } });

    // The database refuses, not the application: this has to hold for every
    // future line of code, including the ones written in a hurry.
    await expect(
      db.auditEvent.update({ where: { id: event.id }, data: { action: "something.else" } }),
    ).rejects.toThrow();
    await expect(db.auditEvent.delete({ where: { id: event.id } })).rejects.toThrow();

    const still = await db.auditEvent.findUnique({ where: { id: event.id } });
    expect(still?.action).toBe(event.action);
  });
});
