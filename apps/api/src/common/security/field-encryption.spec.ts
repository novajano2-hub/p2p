import { randomBytes } from "node:crypto";

import { decryptField, encryptField, fieldEncryptionKey } from "./field-encryption";

const KEY = randomBytes(32);

describe("field encryption", () => {
  it("round-trips, and never produces the same ciphertext twice", () => {
    const first = encryptField("JBSWY3DPEHPK3PXP", KEY, "admin-totp");
    const second = encryptField("JBSWY3DPEHPK3PXP", KEY, "admin-totp");
    expect(first).not.toBe(second);
    expect(decryptField(first, KEY, "admin-totp")).toBe("JBSWY3DPEHPK3PXP");
    expect(decryptField(second, KEY, "admin-totp")).toBe("JBSWY3DPEHPK3PXP");
  });

  it("does not contain the plaintext", () => {
    const stored = encryptField("JBSWY3DPEHPK3PXP", KEY, "admin-totp");
    expect(stored).not.toContain("JBSWY3DPEHPK3PXP");
  });

  it("refuses a tampered value rather than decrypting it into garbage", () => {
    const stored = encryptField("secret", KEY, "admin-totp");
    const parts = stored.split(".");
    const body = parts[2] ?? "";
    // Flip the first character to something it is not, so the ciphertext no
    // longer authenticates under the tag.
    const flipped = (body.startsWith("A") ? "B" : "A") + body.slice(1);
    const tampered = [parts[0], parts[1], flipped, parts[3]].join(".");
    expect(() => decryptField(tampered, KEY, "admin-totp")).toThrow();
  });

  it("refuses another key", () => {
    const stored = encryptField("secret", KEY, "admin-totp");
    expect(() => decryptField(stored, randomBytes(32), "admin-totp")).toThrow();
  });

  /*
    The purpose is authenticated, so a ciphertext lifted out of one column
    cannot be replayed into a differently-purposed one and quietly decrypt.
  */
  it("refuses a ciphertext presented under a different purpose", () => {
    const stored = encryptField("secret", KEY, "admin-totp");
    expect(() => decryptField(stored, KEY, "payment-instructions")).toThrow();
  });

  it("refuses shapes that are not an encrypted field at all", () => {
    for (const bad of ["", "v1", "v2.a.b.c", "plaintext", "v1.a.b.c.d"]) {
      expect(() => decryptField(bad, KEY, "admin-totp")).toThrow();
    }
  });
});

describe("fieldEncryptionKey", () => {
  it("accepts 64 hex characters and refuses everything else", () => {
    expect(fieldEncryptionKey("ab".repeat(32))).toHaveLength(32);
    expect(() => fieldEncryptionKey("ab".repeat(31))).toThrow();
    expect(() => fieldEncryptionKey("not hex at all")).toThrow();
  });
});
