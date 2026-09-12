import { signWebhook, verifyWebhook } from "./webhook-signature";

describe("webhook signatures", () => {
  const secret = "a-secret-long-enough-for-the-mock";
  const body = Buffer.from('{"event":"transfer","amount":"1000000"}');
  const now = 1_800_000_000;

  it("accepts what it signed, over the raw body", () => {
    const header = signWebhook(secret, body, now);
    expect(verifyWebhook({ secret, header, rawBody: body, nowSeconds: now })).toEqual({
      ok: true,
      timestamp: now,
    });
  });

  it("refuses a body that changed by one byte, and a different secret", () => {
    const header = signWebhook(secret, body, now);
    const tampered = Buffer.from(body.toString().replace("1000000", "1000001"));
    expect(verifyWebhook({ secret, header, rawBody: tampered, nowSeconds: now })).toEqual({
      ok: false,
      reason: "mismatch",
    });
    expect(verifyWebhook({ secret: "other", header, rawBody: body, nowSeconds: now })).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("refuses a replay from outside the window, in either direction", () => {
    const header = signWebhook(secret, body, now);
    expect(verifyWebhook({ secret, header, rawBody: body, nowSeconds: now + 301 }).ok).toBe(false);
    expect(verifyWebhook({ secret, header, rawBody: body, nowSeconds: now - 301 }).ok).toBe(false);
    expect(verifyWebhook({ secret, header, rawBody: body, nowSeconds: now + 299 }).ok).toBe(true);
  });

  it("refuses a malformed or missing header without touching the secret", () => {
    for (const header of [undefined, "", "v1=abc", "t=1,v1=xyz", `t=${now},v1=00`]) {
      expect(verifyWebhook({ secret, header, rawBody: body, nowSeconds: now })).toEqual({
        ok: false,
        reason: "malformed",
      });
    }
  });
});
