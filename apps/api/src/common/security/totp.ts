import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/*
  Time-based one-time passwords, RFC 6238 over RFC 4226, hand-rolled the way
  the rest of this kit is: the whole algorithm is an HMAC, a truncation and a
  modulo, and a dependency would be larger than the code it replaced.

  The parameters are the ones every authenticator app assumes when a QR code
  does not say otherwise - SHA-1, six digits, thirty seconds - and they are
  not configurable here on purpose. SHA-1's known weaknesses are collision
  attacks, which have no bearing on HMAC used this way (RFC 6194); choosing a
  "stronger" hash would buy nothing and break apps that ignore the algorithm
  parameter, which several of the big ones do.
*/

export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;

/** 160 bits, the RFC 4226 recommended secret size, as the raw bytes. */
export function generateTotpSecret(): Buffer {
  return randomBytes(20);
}

/** The 30-second step a moment falls in. What "one code" means in time. */
export function totpStep(atMs: number = Date.now()): number {
  return Math.floor(atMs / 1_000 / TOTP_PERIOD_SECONDS);
}

/** RFC 4226 HOTP: HMAC-SHA1, dynamic truncation, six decimal digits. */
export function hotp(secret: Buffer, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(message).digest();
  const offset = (digest[19] ?? 0) & 0x0f;
  const code =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    ((digest[offset + 1] ?? 0) << 16) |
    ((digest[offset + 2] ?? 0) << 8) |
    (digest[offset + 3] ?? 0);
  return (code % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, "0");
}

/** The code for one step, for tests and for nothing user-facing. */
export function totpAt(secret: Buffer, atMs: number = Date.now()): string {
  return hotp(secret, totpStep(atMs));
}

/*
  Verifies a presented code and answers WHICH step it matched, or null.

  The window is one step either side of now: a phone's clock a little ahead
  or behind, or a code typed in its final second, must not fail. Wider than
  that helps nobody but an attacker.

  Returning the step rather than a boolean is what makes replay prevention
  possible: the caller must record the accepted step and refuse anything at
  or below it (RFC 6238 5.2 - the verifier MUST NOT accept a second attempt
  of the same OTP). Comparison is constant-time; six digits are guessable
  only by volume, and volume is the rate limiter's problem, but there is no
  reason to hand out a timing oracle either.
*/
export function verifyTotp(
  secret: Buffer,
  presented: string,
  atMs: number = Date.now(),
): number | null {
  if (!/^\d{6}$/.test(presented)) return null;
  const now = totpStep(atMs);
  const candidate = Buffer.from(presented, "utf8");
  for (const step of [now, now - 1, now + 1]) {
    if (step < 0) continue;
    const expected = Buffer.from(hotp(secret, step), "utf8");
    if (expected.length === candidate.length && timingSafeEqual(expected, candidate)) {
      return step;
    }
  }
  return null;
}

/*
  ------------------------------------------------------------------- base32
  RFC 4648. Only needed because otpauth:// carries the secret this way; it is
  not used anywhere else in the application.
*/

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Unpadded, upper case: the form every authenticator app expects in a URI. */
export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  const symbol = (index: number): string => BASE32_ALPHABET.charAt(index & 31);
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += symbol(value >>> (bits - 5));
      bits -= 5;
    }
  }
  if (bits > 0) out += symbol(value << (5 - bits));
  return out;
}

/** Tolerant of case, spaces and padding, since people paste these by hand. */
export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error("not base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/*
  What the QR code says. The label is "issuer:account" and the issuer is
  repeated as a parameter - both, because different apps read different
  halves. Everything user-controlled is URI-encoded; the account is an email
  address we issued, but encoding it is free and assuming is not.
*/
export function otpauthUri(issuer: string, account: string, secret: Buffer): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret: base32Encode(secret),
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
