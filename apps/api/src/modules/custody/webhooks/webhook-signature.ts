import { createHmac, timingSafeEqual } from "node:crypto";

/*
  A webhook is a claim from outside, and the signature is how the claim is
  checked before a byte of it is believed (threat model B6, state-machines.md
  1). Three rules, each closing a specific hole:

    the raw body     signed exactly as received, before any parsing, so that a
                     JSON re-serialisation can neither break nor forge it
    a timestamp      inside the signed text and checked against a window, so
                     a captured webhook cannot be replayed next week
    constant time    the comparison takes as long for a near-miss as for a
                     miss, so the signature cannot be guessed byte by byte

  Header shape: "t=<unix seconds>,v1=<hex hmac-sha256 of "<t>.<raw body>">".
*/

export const WEBHOOK_SIGNATURE_HEADER = "x-custody-signature";

/** How far a webhook's timestamp may sit from now, either way. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

function digest(secret: string, timestamp: number, rawBody: Buffer | string): Buffer {
  return createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest();
}

/** Produces the header a provider (or the mock, or a test) would send. */
export function signWebhook(
  secret: string,
  rawBody: Buffer | string,
  timestamp = Math.floor(Date.now() / 1000),
): string {
  return `t=${timestamp},v1=${digest(secret, timestamp, rawBody).toString("hex")}`;
}

export type WebhookVerdict =
  { ok: true; timestamp: number } | { ok: false; reason: "malformed" | "stale" | "mismatch" };

export function verifyWebhook(input: {
  secret: string;
  header: string | undefined;
  rawBody: Buffer | string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): WebhookVerdict {
  const match = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(input.header ?? "");
  if (!match) return { ok: false, reason: "malformed" };
  const timestamp = Number(match[1]);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS;
  if (Math.abs(now - timestamp) > tolerance) return { ok: false, reason: "stale" };

  const expected = digest(input.secret, timestamp, input.rawBody);
  const presented = Buffer.from(match[2] ?? "", "hex");
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true, timestamp };
}
