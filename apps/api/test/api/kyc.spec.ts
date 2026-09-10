import { existsSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { type AddressInfo } from "node:net";
import { resolve } from "node:path";

import { KYC_IMAGE_MAX_BYTES } from "@abay/contracts";
import { createPrismaClient, type PrismaClient } from "@abay/database";
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";

import { createApp } from "@/app";
import { loggingModule } from "@/common/logging/logging.module";
import { ConfigModule } from "@/config/config.module";
import { loadEnv } from "@/config/env";
import { KycRetentionModule } from "@/modules/kyc/kyc-retention.module";
import { KycRetentionService } from "@/modules/kyc/kyc-retention.service";

import {
  fakeJpeg,
  fakePng,
  registerFully,
  uniqueEmail,
  uploadPhoto,
  uploadPhotos,
} from "./helpers";

/*
  Identity verification over HTTP, against the real database and the on-disk
  object store the tests run with.

  What matters here is not that a form submits: it is that a customer cannot
  verify themselves, cannot be verified twice, cannot see or touch anyone
  else's photographs, and cannot get anything that is not an image into the
  store. Approval is an administrator's act and has no route on this side at
  all, which is the property the last test pins down.
*/

let app: NestFastifyApplication;
let db: PrismaClient;
/* The sweep runs in the worker, which has no HTTP layer, so it is reached
   through its own module rather than through the booted API. */
let retentionContext: TestingModule;
let retention: KycRetentionService;
const server = () => app.getHttpServer() as Parameters<typeof request>[0];

const DETAILS = {
  legalName: "Abebe Bikila",
  dateOfBirth: "1990-04-12",
  documentType: "NATIONAL_ID",
  documentNumber: "ET-4410-9921",
} as const;

/** Where the local store keeps a key: tests run with no STORAGE_* configured. */
const onDisk = (key: string) => resolve(process.cwd(), ".storage", key);

/*
  Announces a body over the limit and never sends it. The refusal has to come
  from the headers alone - the server must not read ten megabytes to decide
  it did not want them - and a client that did send the bytes would only see
  the connection dropped mid-write, which is not something to assert on.
*/
function announceOversizedUpload(cookie: string): Promise<{ status: number; body: string }> {
  const httpServer = app.getHttpServer();
  return new Promise((resolvePromise, reject) => {
    const go = () => {
      const { port } = httpServer.address() as AddressInfo;
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port,
          method: "POST",
          path: "/v1/kyc/documents/front",
          headers: {
            cookie,
            "content-type": "image/jpeg",
            "content-length": String(KYC_IMAGE_MAX_BYTES + 1),
          },
        },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => (body += chunk));
          res.on("end", () => {
            resolvePromise({ status: res.statusCode ?? 0, body });
            req.destroy();
          });
        },
      );
      req.on("error", reject);
      req.flushHeaders();
    };
    // Supertest listens on demand; this request needs the server up first.
    if (httpServer.address()) go();
    else httpServer.listen(0, "127.0.0.1", go);
  });
}

beforeAll(async () => {
  const env = loadEnv();
  app = await createApp(env);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  db = createPrismaClient(env.DATABASE_URL);

  retentionContext = await Test.createTestingModule({
    imports: [ConfigModule.forRoot(env), loggingModule(env), KycRetentionModule],
  }).compile();
  retention = retentionContext.get(KycRetentionService);
});

afterAll(async () => {
  await retentionContext.close();
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
      documents: [],
    });

    // And the session carries it, so every screen agrees without asking twice.
    const me = await request(server()).get("/v1/auth/me").set("Cookie", cookie).expect(200);
    expect(me.body.user.kycStatus).toBe("NOT_STARTED");
  });

  it("keeps each photograph, records the submission, moves the account to pending, and refuses a second one", async () => {
    const { cookie, userId } = await registerFully(server(), db, uniqueEmail());

    const front = await uploadPhoto(server(), cookie, "front").expect(201);
    expect(front.body).toMatchObject({
      kind: "FRONT",
      contentType: "image/jpeg",
      sizeBytes: 4_096,
    });
    expect(front.body.id).toEqual(expect.any(String));

    const documents = await uploadPhotos(server(), cookie);
    const submitted = await request(server())
      .post("/v1/kyc")
      .set("Cookie", cookie)
      .send({ ...DETAILS, documents })
      .expect(202);
    expect(submitted.body.status).toBe("PENDING");
    expect(submitted.body.submittedAt).toEqual(expect.any(String));
    // The staging area is empty: every photograph belongs to the submission now.
    expect(submitted.body.documents).toEqual([]);

    const stored = await db.kycSubmission.findFirst({
      where: { userId },
      include: { documents: true },
    });
    expect(stored).toMatchObject({
      legalName: DETAILS.legalName,
      country: "ET",
      documentType: "NATIONAL_ID",
      status: "PENDING",
      reviewedAt: null,
    });
    // The three photographs belong to this submission now, and the bytes are
    // where the row says they are, under a key that names the owner.
    expect(stored!.documents.map((document) => document.kind).sort()).toEqual([
      "BACK",
      "FRONT",
      "SELFIE",
    ]);
    for (const document of stored!.documents) {
      expect(document.storageKey).toMatch(new RegExp(`^kyc/${userId}/[0-9a-f-]{36}\\.jpg$`));
      expect(existsSync(onDisk(document.storageKey))).toBe(true);
    }
    // Nothing is left staged.
    expect(await db.kycDocument.count({ where: { userId, submissionId: null } })).toBe(0);

    // A second attempt would leave an administrator with two versions of the
    // truth, so it is refused while the first is still waiting - and so is
    // another photograph, which would have nothing to belong to.
    await request(server())
      .post("/v1/kyc")
      .set("Cookie", cookie)
      .send({ ...DETAILS, documents })
      .expect(409);
    await uploadPhoto(server(), cookie, "front").expect(409);
  });

  it("asks a passport for its photo page only, and a card for both sides", async () => {
    const passport = await registerFully(server(), db, uniqueEmail());
    const documents = await uploadPhotos(server(), passport.cookie, false);
    await request(server())
      .post("/v1/kyc")
      .set("Cookie", passport.cookie)
      .send({ ...DETAILS, documentType: "PASSPORT", documents })
      .expect(202);

    const card = await registerFully(server(), db, uniqueEmail());
    const noBack = await uploadPhotos(server(), card.cookie, false);
    const refused = await request(server())
      .post("/v1/kyc")
      .set("Cookie", card.cookie)
      .send({ ...DETAILS, documents: noBack })
      .expect(400);
    expect(refused.body.error.details).toEqual([
      expect.objectContaining({ path: "documents.back" }),
    ]);
  });

  it("takes a photograph again in place of the one before it", async () => {
    const { cookie, userId } = await registerFully(server(), db, uniqueEmail());

    const first = await uploadPhoto(server(), cookie, "front").expect(201);
    const firstRow = await db.kycDocument.findUniqueOrThrow({ where: { id: first.body.id } });
    expect(existsSync(onDisk(firstRow.storageKey))).toBe(true);

    const second = await uploadPhoto(server(), cookie, "front", fakePng(), "image/png").expect(201);
    expect(second.body.id).not.toBe(first.body.id);
    // What the bytes are wins over what the header said.
    expect(second.body.contentType).toBe("image/png");

    const staged = await db.kycDocument.findMany({ where: { userId, submissionId: null } });
    expect(staged.map((document) => document.id)).toEqual([second.body.id]);
    expect(existsSync(onDisk(firstRow.storageKey))).toBe(false);

    // A submission naming the replaced photograph is refused: it is gone.
    const selfie = await uploadPhoto(server(), cookie, "selfie").expect(201);
    const back = await uploadPhoto(server(), cookie, "back").expect(201);
    await request(server())
      .post("/v1/kyc")
      .set("Cookie", cookie)
      .send({
        ...DETAILS,
        documents: { front: first.body.id, back: back.body.id, selfie: selfie.body.id },
      })
      .expect(400);
  });

  it("hands back the photographs already uploaded, and only to their owner", async () => {
    const owner = await registerFully(server(), db, uniqueEmail());
    const stranger = await registerFully(server(), db, uniqueEmail());

    const front = await uploadPhoto(server(), owner.cookie, "front", fakeJpeg(2_048)).expect(201);
    const selfie = await uploadPhoto(server(), owner.cookie, "selfie").expect(201);

    // The state carries the staging area. This is what lets a form that was
    // abandoned halfway be picked up rather than started again.
    const state = await request(server()).get("/v1/kyc").set("Cookie", owner.cookie).expect(200);
    expect(state.body.documents).toHaveLength(2);
    expect(state.body.documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: front.body.id,
          kind: "FRONT",
          contentType: "image/jpeg",
          sizeBytes: 2_048,
        }),
        expect.objectContaining({ id: selfie.body.id, kind: "SELFIE" }),
      ]),
    );

    // And the bytes come back, as the image they went up as.
    const bytes = await request(server())
      .get(`/v1/kyc/documents/${front.body.id}`)
      .set("Cookie", owner.cookie)
      .expect(200);
    expect(bytes.headers["content-type"]).toContain("image/jpeg");
    expect(Buffer.isBuffer(bytes.body)).toBe(true);
    expect((bytes.body as Buffer).length).toBe(2_048);
    // An identity document must never rest in a browser's disk cache.
    expect(bytes.headers["cache-control"]).toBe("no-store");

    // To nobody else, and the refusal says nothing about whether it exists.
    await request(server())
      .get(`/v1/kyc/documents/${front.body.id}`)
      .set("Cookie", stranger.cookie)
      .expect(404);
    await request(server()).get(`/v1/kyc/documents/${front.body.id}`).expect(401);

    const strangerState = await request(server())
      .get("/v1/kyc")
      .set("Cookie", stranger.cookie)
      .expect(200);
    expect(strangerState.body.documents).toEqual([]);
  });

  it("throws away photographs nobody submitted, and leaves the rest alone", async () => {
    const abandoned = await registerFully(server(), db, uniqueEmail());
    const stale = await uploadPhoto(server(), abandoned.cookie, "front").expect(201);
    const fresh = await uploadPhoto(server(), abandoned.cookie, "selfie").expect(201);

    const submitter = await registerFully(server(), db, uniqueEmail());
    const documents = await uploadPhotos(server(), submitter.cookie);
    await request(server())
      .post("/v1/kyc")
      .set("Cookie", submitter.cookie)
      .send({ ...DETAILS, documents })
      .expect(202);

    // Age one staged photograph past the deadline, and age the submitted ones
    // with it, so what survives proves the rule is "unclaimed", not "recent".
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await db.kycDocument.update({
      where: { id: stale.body.id },
      data: { createdAt: twoDaysAgo },
    });
    await db.kycDocument.updateMany({
      where: { userId: submitter.userId },
      data: { createdAt: twoDaysAgo },
    });
    const staleRow = await db.kycDocument.findUniqueOrThrow({ where: { id: stale.body.id } });
    expect(existsSync(onDisk(staleRow.storageKey))).toBe(true);

    expect(await retention.sweepAbandoned()).toBeGreaterThanOrEqual(1);

    // The row is gone and so are the bytes: this exists so that an identity
    // document nobody asked us to check does not sit in the store forever.
    expect(await db.kycDocument.findUnique({ where: { id: stale.body.id } })).toBeNull();
    expect(existsSync(onDisk(staleRow.storageKey))).toBe(false);

    // Uploaded a moment ago, so still waiting for the form that will name it.
    expect(await db.kycDocument.findUnique({ where: { id: fresh.body.id } })).not.toBeNull();
    // Evidence for a submission an administrator has not read yet. Never swept.
    expect(
      await db.kycDocument.count({
        where: { userId: submitter.userId, submissionId: { not: null } },
      }),
    ).toBe(3);
  });

  it("accepts only images, only under the limit, and only as the raw body", async () => {
    const { cookie, userId } = await registerFully(server(), db, uniqueEmail());

    // Text that calls itself a JPEG.
    const notAnImage = await uploadPhoto(
      server(),
      cookie,
      "front",
      Buffer.from("<html>definitely a photo</html>"),
    ).expect(400);
    expect(notAnImage.body.error.code).toBe("VALIDATION_FAILED");

    // A content type nothing here parses.
    await uploadPhoto(server(), cookie, "front", fakeJpeg(), "application/octet-stream").expect(
      415,
    );

    // JSON where the photograph should be.
    await request(server())
      .post("/v1/kyc/documents/front")
      .set("Cookie", cookie)
      .send({ photo: "..." })
      .expect(400);

    // A slot that does not exist.
    await uploadPhoto(server(), cookie, "passport" as never).expect(400);

    // One byte over the limit, refused before a byte of it is read.
    const tooLarge = await announceOversizedUpload(cookie);
    expect(tooLarge.status).toBe(413);
    expect(JSON.parse(tooLarge.body)).toMatchObject({ error: { code: "PAYLOAD_TOO_LARGE" } });

    // None of that left anything behind.
    expect(await db.kycDocument.count({ where: { userId } })).toBe(0);
  });

  it("enforces its rules on the server, not only in the browser", async () => {
    const { cookie } = await registerFully(server(), db, uniqueEmail());
    const documents = await uploadPhotos(server(), cookie);

    const tooYoung = new Date();
    tooYoung.setUTCFullYear(tooYoung.getUTCFullYear() - 15);
    const under18 = await request(server())
      .post("/v1/kyc")
      .set("Cookie", cookie)
      .send({ ...DETAILS, documents, dateOfBirth: tooYoung.toISOString().slice(0, 10) })
      .expect(400);
    expect(under18.body.error.code).toBe("VALIDATION_FAILED");

    await request(server())
      .post("/v1/kyc")
      .set("Cookie", cookie)
      .send({ ...DETAILS, documents, documentType: "LIBRARY_CARD" })
      .expect(400);

    await request(server())
      .post("/v1/kyc")
      .set("Cookie", cookie)
      .send({ ...DETAILS, documents, legalName: "A" })
      .expect(400);

    // No photographs at all.
    await request(server()).post("/v1/kyc").set("Cookie", cookie).send(DETAILS).expect(400);

    // None of that got as far as the database.
    const count = await db.kycSubmission.count({
      where: { user: { sessions: { some: {} } }, legalName: "A" },
    });
    expect(count).toBe(0);
  });

  it("is the customer's own, and reachable only with a session", async () => {
    await request(server()).get("/v1/kyc").expect(401);
    await request(server()).post("/v1/kyc").send(DETAILS).expect(401);
    await request(server())
      .post("/v1/kyc/documents/front")
      .set("content-type", "image/jpeg")
      .send(fakeJpeg())
      .expect(401);

    const alice = await registerFully(server(), db, uniqueEmail());
    const bob = await registerFully(server(), db, uniqueEmail());
    const alicePhotos = await uploadPhotos(server(), alice.cookie);

    // Bob cannot submit with Alice's photographs, however he learned their ids.
    const stolen = await request(server())
      .post("/v1/kyc")
      .set("Cookie", bob.cookie)
      .send({ ...DETAILS, documents: alicePhotos })
      .expect(400);
    expect(stolen.body.error.details).toEqual([
      expect.objectContaining({ path: "documents.front" }),
    ]);
    // And Alice's photographs are untouched, still hers, still waiting.
    expect(
      await db.kycDocument.count({ where: { userId: alice.userId, submissionId: null } }),
    ).toBe(3);

    await request(server())
      .post("/v1/kyc")
      .set("Cookie", alice.cookie)
      .send({ ...DETAILS, documents: alicePhotos })
      .expect(202);

    // Alice submitting says nothing about Bob.
    const bobState = await request(server()).get("/v1/kyc").set("Cookie", bob.cookie).expect(200);
    expect(bobState.body.status).toBe("NOT_STARTED");
  });

  it("has no route a customer could use to approve anyone, including themselves", async () => {
    const { cookie } = await registerFully(server(), db, uniqueEmail());
    const documents = await uploadPhotos(server(), cookie);
    await request(server())
      .post("/v1/kyc")
      .set("Cookie", cookie)
      .send({ ...DETAILS, documents })
      .expect(202);

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
