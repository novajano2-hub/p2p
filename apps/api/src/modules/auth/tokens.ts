import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

import * as argon2 from "argon2";

/*
  The primitives the auth module is built from. Kept together because the rules
  they encode - what is stored, what is compared, and how - are the difference
  between a session table that is useless to an attacker who reads it and one
  that is a list of valid credentials.
*/

/**
 * Argon2id with parameters chosen deliberately rather than left at defaults:
 * 19 MiB and 2 passes is the OWASP baseline, and is what a server can afford
 * per login while still being expensive to attack in bulk.
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // A malformed stored hash is a failed login, never a 500 that tells an
    // attacker they found something unusual.
    return false;
  }
}

/*
  A hash to compare against when no account exists, so a login attempt for an
  unknown address costs the same as one for a known address. Without it, the
  response time answers "does this person have an account".
*/
const DUMMY_PASSWORD = randomBytes(32).toString("hex");
let dummyHash: Promise<string> | undefined;

export async function burnTimeLikeAVerify(): Promise<void> {
  dummyHash ??= hashPassword(DUMMY_PASSWORD);
  await verifyPassword(await dummyHash, "not the password");
}

/** An opaque session or ticket token. 256 bits from the CSPRNG, URL-safe. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * What actually goes in the database. SHA-256 rather than Argon2 because these
 * are high-entropy random tokens, not passwords: there is nothing to brute
 * force, and session lookup happens on every request. Hashing at all is the
 * point - a leaked table yields no usable token.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Six digits, uniformly distributed. `randomInt` is rejection-sampled, unlike `% 1e6`. */
export function generateVerificationCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** Constant-time compare for two hex digests of equal length. */
export function tokenMatches(expectedHash: string, candidateHash: string): boolean {
  const a = Buffer.from(expectedHash, "hex");
  const b = Buffer.from(candidateHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
