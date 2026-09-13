import { type AdminCustomerSearchResponse } from "@abay/contracts";
import { createPrismaClient, type PrismaClient } from "@abay/database";
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";

import { createApp } from "@/app";
import { loadEnv, type Env } from "@/config/env";
import { hashPassword } from "@/modules/auth/tokens";

import { enrolledTotp, registerFully, totpCodeFor, uniqueEmail } from "./helpers";

/*
  Finding a customer by what a human has to hand.

  This exists for one screen - attributing a stray deposit - and the whole
  point of it is that an administrator arrives knowing an account number, a
  username or an email, never an internal id. So that is what is tested: each
  of those three finds the right person, an id does not, the roles that may
  not ask are refused, and every search leaves a record.
*/

let app: NestFastifyApplication;
let db: PrismaClient;
let env: Env;
const server = () => app.getHttpServer() as Parameters<typeof request>[0];

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const ADMIN_PASSWORD = "correct horse battery staple";

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

async function makeAdmin(roles: string[]) {
  // Matches the pattern global-teardown.js clears admins by.
  const email = `admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const totp = enrolledTotp();
  await db.adminUser.create({
    data: {
      email,
      name: "Test Administrator",
      passwordHash: await hashPassword(ADMIN_PASSWORD),
      passwordChangedAt: new Date(),
      roles: roles as never,
      ...totp.fields,
    },
  });
  const login = await request(server())
    .post("/v1/admin/auth/login")
    .send({ email, password: ADMIN_PASSWORD, code: totpCodeFor(totp.secret) })
    .expect(200);
  const cookie = login.headers["set-cookie"]?.[0];
  if (!cookie) throw new Error("admin sign-in set no cookie");
  return { email, cookie };
}

const search = (cookie: string, q: string) =>
  request(server())
    .get(`/v1/admin/customers?q=${encodeURIComponent(q)}`)
    .set("Cookie", cookie)
    .set("x-request-id", `test-${run}-search`);

const found = (body: unknown) => (body as AdminCustomerSearchResponse).customers;

describe("finding a customer", () => {
  it("finds them by account number, username and email, but never by internal id", async () => {
    const reviewer = await makeAdmin(["DEPOSIT_REVIEWER"]);
    const { userId } = await registerFully(server(), db, uniqueEmail());
    const who = await db.user.findUniqueOrThrow({ where: { id: userId } });

    // The account number, exactly as it is printed.
    expect(found((await search(reviewer.cookie, who.platformId).expect(200)).body)).toContainEqual(
      expect.objectContaining({ userId, platformId: who.platformId }),
    );

    // The digits alone, which is how people read it off a screen.
    const digits = who.platformId.replace(/^BQ-?/i, "");
    expect(
      found((await search(reviewer.cookie, digits).expect(200)).body).map((c) => c.userId),
    ).toContain(userId);

    // Username, in the wrong case.
    expect(
      found((await search(reviewer.cookie, who.username.toUpperCase()).expect(200)).body).map(
        (c) => c.userId,
      ),
    ).toContain(userId);

    // Email.
    expect(
      found((await search(reviewer.cookie, who.email).expect(200)).body).map((c) => c.userId),
    ).toContain(userId);

    // The internal id finds nothing: if you have it you are not searching,
    // and a directory that answers to uuids is one that can be walked.
    expect(found((await search(reviewer.cookie, userId).expect(200)).body)).toHaveLength(0);
  });

  it("returns nothing a customer would mind, and nothing they would not", async () => {
    const reviewer = await makeAdmin(["WITHDRAWAL_APPROVER"]);
    const { userId } = await registerFully(server(), db, uniqueEmail());
    const who = await db.user.findUniqueOrThrow({ where: { id: userId } });

    const one = found((await search(reviewer.cookie, who.platformId).expect(200)).body)[0];
    expect(one).toBeDefined();
    expect(Object.keys(one as object).sort()).toEqual([
      "email",
      "kycStatus",
      "platformId",
      "status",
      "userId",
      "username",
    ]);
  });

  it("refuses an administrator whose roles do not decide about customers", async () => {
    const reader = await makeAdmin(["LEDGER_VIEWER"]);
    await search(reader.cookie, "BQ-00000000").expect(403);

    const approver = await makeAdmin(["WITHDRAWAL_APPROVER"]);
    await search(approver.cookie, "BQ-00000000").expect(200);
  });

  it("refuses a term too short to be a search", async () => {
    const reviewer = await makeAdmin(["DEPOSIT_REVIEWER"]);
    await search(reviewer.cookie, "a").expect(400);
  });

  it("records every search, because looking up any customer by name is a power", async () => {
    const reviewer = await makeAdmin(["DEPOSIT_REVIEWER"]);
    const { userId } = await registerFully(server(), db, uniqueEmail());
    const who = await db.user.findUniqueOrThrow({ where: { id: userId } });

    await search(reviewer.cookie, who.username).expect(200);

    const recorded = await db.auditEvent.findFirst({
      where: { action: "customer.searched", actorEmail: reviewer.email },
      orderBy: { createdAt: "desc" },
    });
    expect(recorded).not.toBeNull();
    expect(recorded?.after).toMatchObject({ term: who.username });
  });
});
