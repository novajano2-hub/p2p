import { createHash } from "node:crypto";

/*
  What a counter is kept against, turned into something safe to use as a Redis
  key. Pure, and separate from the service that talks to Redis so that the
  rules below - which are the fiddly part - can be tested on their own.
*/

/**
 * Stands in for a value we would rather not keep, even for a few minutes and
 * even in a store that forgets. An email address is personal data
 * (docs/architecture/data-classification.md); a session token is a live
 * credential. Neither belongs in a key that a stray `KEYS *` would print.
 *
 * Truncated to 32 hex characters. 128 bits is far past any chance of two
 * subjects colliding into one counter, and a shorter key is a smaller key.
 */
export const subjectHash = (value: string): string =>
  createHash("sha256").update(value).digest("hex").slice(0, 32);

/**
 * The address a counter is kept against.
 *
 * IPv4-mapped form is unwrapped first, because Node reports a v4 client on a
 * dual-stack socket as `::ffff:127.0.0.1` and the same client over a v4-only
 * socket as `127.0.0.1`. Those must not be two subjects.
 *
 * A single IPv6 address is then widened to its /64. Home and hosting networks
 * are routinely handed a whole /64 or more, so counting per address would let
 * one machine present eighteen quintillion of them and never meet a limit. The
 * /64 is the smallest block that is reliably one subscriber.
 */
export function rateLimitAddress(ip: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped?.[1]) return mapped[1];
  if (!ip.includes(":")) return ip;

  const groups = ipv6Groups(ip);
  // Unparseable: keep the address itself rather than lump every odd one together.
  if (!groups) return ip;
  return `${groups
    .slice(0, 4)
    .map((group) => (Number.parseInt(group, 16) || 0).toString(16))
    .join(":")}::/64`;
}

/** The eight groups of an IPv6 address, with `::` expanded. Null if it is not one. */
function ipv6Groups(ip: string): string[] | null {
  // A link-local address may carry a zone ("fe80::1%eth0"), which is not part of it.
  const bare = ip.split("%")[0] ?? ip;
  const halves = bare.split("::");
  if (halves.length > 2) return null;

  const head = halves[0] ? halves[0].split(":") : [];
  if (halves.length === 1) return head.length === 8 ? head : null;

  const tail = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...Array.from({ length: missing }, () => "0"), ...tail];
}
