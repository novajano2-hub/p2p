import { randomInt } from "node:crypto";

/*
  The customer-facing account number, and the username an account is born
  with.

  The number is what a person quotes to support and shows a counterparty, the
  way a Binance UID is. "BQ-" and eight digits, drawn at random: it is not the
  primary key, not sequential, and not a count of how many accounts exist.
  Ninety million values means a collision is rare enough to handle by simply
  drawing again, which is what the callers do.
*/

export const PLATFORM_ID_PREFIX = "BQ-";
export const PLATFORM_ID_PATTERN = /^BQ-\d{8}$/;

export function generatePlatformId(): string {
  // 10,000,000 to 99,999,999: always eight digits, never a leading zero.
  // randomInt is rejection-sampled, so every value is equally likely.
  return `${PLATFORM_ID_PREFIX}${randomInt(10_000_000, 100_000_000)}`;
}

/**
 * The placeholder username: derived from the account number, so it is unique
 * without a lookup and obviously something to change.
 */
export function placeholderUsername(platformId: string): string {
  return `user_${platformId.slice(PLATFORM_ID_PREFIX.length)}`;
}

/** Usernames are unique case-insensitively; this is the form the index is on. */
export function usernameKey(username: string): string {
  return username.toLowerCase();
}

/**
 * True when a Prisma unique violation (P2002) involves one of the named
 * columns. Prisma reports the constraint's columns in `meta.target`, by
 * field or by database name depending on the version, so both are matched
 * by substring: "email", "platform", "username".
 */
export function uniqueViolationTargets(error: unknown, ...columns: string[]): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, meta } = error as { code?: unknown; meta?: { target?: unknown } };
  if (code !== "P2002") return false;
  const target = meta?.target;
  const names = Array.isArray(target)
    ? target.map(String)
    : typeof target === "string"
      ? [target]
      : [];
  return columns.some((column) => names.some((name) => name.includes(column)));
}
