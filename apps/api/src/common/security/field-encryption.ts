import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/*
  Encryption for single database fields whose plaintext the server itself
  needs back - a TOTP secret today, a customer's payment instructions later
  (the brief asks for exactly this: "encrypt sensitive payment information at
  field or storage level"). Hashing is the right tool for a password, because
  the server never needs the password again; it is the wrong tool for a value
  the server must recompute from. This is the other tool.

  What it buys, precisely: a copy of the database - a stolen backup, a
  misdirected dump, a read-only compromise - does not yield working secrets.
  It does NOT protect against a compromise of the running application, which
  holds the key; nothing application-side can.

  AES-256-GCM, so tampering is detected rather than decrypted into garbage. A
  fresh random 96-bit nonce per value; at one encryption per admin enrollment
  the birthday bound is not even on the horizon. The purpose string is bound
  in as additional authenticated data, so a ciphertext lifted from one column
  cannot be replayed into another and quietly decrypt there.

  The wire format is versioned ("v1.") so the key or the algorithm can be
  rotated later by decrypting old rows with old rules and writing new ones,
  without a flag day.
*/

const VERSION = "v1";
const NONCE_BYTES = 12;
const KEY_BYTES = 32;

/** The validated env value, as bytes. env.ts has already enforced the shape. */
export function fieldEncryptionKey(hex: string): Buffer {
  const key = Buffer.from(hex, "hex");
  if (key.length !== KEY_BYTES) throw new Error("FIELD_ENCRYPTION_KEY must be 32 bytes of hex");
  return key;
}

export function encryptField(plaintext: string, key: Buffer, purpose: string): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(purpose, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    nonce.toString("base64url"),
    ciphertext.toString("base64url"),
    tag.toString("base64url"),
  ].join(".");
}

/**
 * The plaintext back, or a throw: a value that does not decrypt cleanly has
 * been tampered with, encrypted under another key, or lifted from a field
 * with a different purpose, and every one of those is a loud problem, not a
 * null to limp past.
 */
export function decryptField(stored: string, key: Buffer, purpose: string): string {
  const [version, nonce, ciphertext, tag, extra] = stored.split(".");
  if (version !== VERSION || !nonce || !ciphertext || !tag || extra !== undefined) {
    throw new Error("not an encrypted field value");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(nonce, "base64url"));
  decipher.setAAD(Buffer.from(purpose, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
