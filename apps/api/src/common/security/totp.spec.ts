import { base32Decode, base32Encode, hotp, otpauthUri, totpAt, verifyTotp } from "./totp";

/*
  Pinned to the RFCs' own published test vectors, not to this implementation's
  output: a bug that shifted every code by one step would still be perfectly
  self-consistent, and only an external anchor catches that. The secret in the
  vectors is the ASCII string "12345678901234567890".
*/

const RFC_SECRET = Buffer.from("12345678901234567890", "ascii");

describe("hotp", () => {
  it("matches RFC 4226 appendix D for counters 0 through 9", () => {
    const expected = [
      "755224",
      "287082",
      "359152",
      "969429",
      "338314",
      "254676",
      "287922",
      "162583",
      "399871",
      "520489",
    ];
    expected.forEach((code, counter) => {
      expect(hotp(RFC_SECRET, counter)).toBe(code);
    });
  });
});

describe("totpAt", () => {
  it("matches RFC 6238 appendix B (SHA-1 rows, truncated to six digits)", () => {
    const vectors: [number, string][] = [
      [59, "287082"],
      [1_111_111_109, "081804"],
      [1_111_111_111, "050471"],
      [1_234_567_890, "005924"],
      [2_000_000_000, "279037"],
      [20_000_000_000, "353130"],
    ];
    for (const [seconds, code] of vectors) {
      expect(totpAt(RFC_SECRET, seconds * 1_000)).toBe(code);
    }
  });
});

describe("verifyTotp", () => {
  const at = 1_111_111_111_000;

  it("accepts the current step and answers which step it was", () => {
    expect(verifyTotp(RFC_SECRET, "050471", at)).toBe(Math.floor(1_111_111_111 / 30));
  });

  it("accepts one step of clock skew in either direction", () => {
    // 1111111109 is the final second of the PREVIOUS step.
    expect(verifyTotp(RFC_SECRET, "081804", at)).not.toBeNull();
    const next = totpAt(RFC_SECRET, at + 30_000);
    expect(verifyTotp(RFC_SECRET, next, at)).not.toBeNull();
  });

  it("rejects a code from two steps away", () => {
    const stale = totpAt(RFC_SECRET, at - 60_000);
    const far = totpAt(RFC_SECRET, at + 60_000);
    expect(verifyTotp(RFC_SECRET, stale, at)).toBeNull();
    expect(verifyTotp(RFC_SECRET, far, at)).toBeNull();
  });

  it("rejects anything that is not exactly six digits", () => {
    for (const bad of ["", "05047", "0504711", "05047a", "05 471", "-50471"]) {
      expect(verifyTotp(RFC_SECRET, bad, at)).toBeNull();
    }
  });
});

describe("base32", () => {
  it("matches the RFC 4648 vectors, unpadded", () => {
    const vectors: [string, string][] = [
      ["", ""],
      ["f", "MY"],
      ["fo", "MZXQ"],
      ["foo", "MZXW6"],
      ["foob", "MZXW6YQ"],
      ["fooba", "MZXW6YTB"],
      ["foobar", "MZXW6YTBOI"],
    ];
    for (const [plain, encoded] of vectors) {
      expect(base32Encode(Buffer.from(plain, "ascii"))).toBe(encoded);
      expect(base32Decode(encoded).toString("ascii")).toBe(plain);
    }
  });

  it("decodes what people actually paste: lower case, spaces, padding", () => {
    expect(base32Decode("mzxw 6ytb oi==").toString("ascii")).toBe("foobar");
  });

  it("refuses characters outside the alphabet", () => {
    expect(() => base32Decode("MZXW1")).toThrow();
  });
});

describe("otpauthUri", () => {
  it("carries the secret, the issuer and the standard parameters", () => {
    const uri = otpauthUri("BIRQ Admin", "reviewer@example.com", RFC_SECRET);
    expect(uri.startsWith("otpauth://totp/BIRQ%20Admin:reviewer%40example.com?")).toBe(true);
    expect(uri).toContain(`secret=${base32Encode(RFC_SECRET)}`);
    expect(uri).toContain("issuer=BIRQ+Admin");
    expect(uri).toContain("algorithm=SHA1");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });
});
