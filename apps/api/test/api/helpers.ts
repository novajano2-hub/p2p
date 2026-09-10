import { type PrismaClient, type VerificationPurpose } from "@abay/database";
import request from "supertest";

/*
  The walk-through steps more than one API spec needs. Registration is three
  requests and a code that only exists as a hash, so every suite that needs a
  signed-in customer would otherwise repeat all of it.
*/

type Server = Parameters<typeof request>[0];

/** A fresh address per run, so runs do not collide in a shared database. */
export const uniqueEmail = (): string =>
  `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

export const PASSWORD = "Correct1Horse";

/** Reads the code from the database: tests run with the log mailer. */
export async function latestCodeFor(
  db: PrismaClient,
  email: string,
  purpose: VerificationPurpose,
): Promise<string> {
  const token = await db.verificationToken.findFirst({
    where: { email, purpose, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!token) throw new Error(`no ${purpose} token for ${email}`);
  // The row stores only a hash, so the code is recovered by scanning the
  // six-digit space - the production path never holds a code in plaintext
  // just to make it testable.
  const { createHash } = await import("node:crypto");
  for (let i = 0; i < 1_000_000; i++) {
    const candidate = i.toString().padStart(6, "0");
    if (createHash("sha256").update(candidate).digest("hex") === token.tokenHash) return candidate;
  }
  throw new Error("code not recoverable");
}

/** Email, code, password: a signed-in customer and the cookie that proves it. */
export async function registerFully(
  server: Server,
  db: PrismaClient,
  email: string,
): Promise<{ cookie: string; userId: string }> {
  await request(server).post("/v1/auth/register/start").send({ email }).expect(202);
  const code = await latestCodeFor(db, email, "EMAIL_VERIFICATION");
  const verify = await request(server)
    .post("/v1/auth/register/verify")
    .send({ email, code })
    .expect(200);
  const complete = await request(server)
    .post("/v1/auth/register/complete")
    .send({ ticket: verify.body.ticket, password: PASSWORD })
    .expect(201);
  const setCookie = complete.headers["set-cookie"];
  if (!setCookie?.[0]) throw new Error("registration did not set a session cookie");
  return { cookie: setCookie[0], userId: complete.body.user.id };
}

/* ------------------------------------------------------------- photographs */

/** A JPEG as far as anything reading the header is concerned: the magic bytes, then filler. */
export function fakeJpeg(bytes = 4_096): Buffer {
  const buffer = Buffer.alloc(bytes, 0x41);
  buffer.set([0xff, 0xd8, 0xff, 0xe0], 0);
  return buffer;
}

/** The same trick for a PNG. */
export function fakePng(bytes = 4_096): Buffer {
  const buffer = Buffer.alloc(bytes, 0x41);
  buffer.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return buffer;
}

export type PhotoKind = "front" | "back" | "selfie";

/** Uploads one photograph as the raw image body; the caller asserts on the response. */
export function uploadPhoto(
  server: Server,
  cookie: string,
  kind: PhotoKind,
  body: Buffer = fakeJpeg(),
  contentType = "image/jpeg",
): request.Test {
  return request(server)
    .post(`/v1/kyc/documents/${kind}`)
    .set("Cookie", cookie)
    .set("content-type", contentType)
    .send(body);
}

/** Every photograph a submission needs, uploaded and accepted, as the ids it refers to. */
export async function uploadPhotos(
  server: Server,
  cookie: string,
  withBack = true,
): Promise<{ front: string; back?: string; selfie: string }> {
  const front = await uploadPhoto(server, cookie, "front").expect(201);
  const selfie = await uploadPhoto(server, cookie, "selfie").expect(201);
  const documents: { front: string; back?: string; selfie: string } = {
    front: front.body.id,
    selfie: selfie.body.id,
  };
  if (withBack) {
    const back = await uploadPhoto(server, cookie, "back").expect(201);
    documents.back = back.body.id;
  }
  return documents;
}
