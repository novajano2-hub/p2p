import { createHash, timingSafeEqual } from "node:crypto";

/*
  Cross-site request forgery, for an API whose sessions are cookies.

  The shape of the problem: the session cookie is SameSite=Lax, because a
  session has to survive following a link back into the app. Lax stops a
  cross-site POST from carrying it, but it is one browser behaviour standing
  alone, and it says nothing about a request from another origin on the same
  site. So a mutation has to prove it was made by a page of ours, not merely
  that the browser had a cookie to send.

  Two independent checks do that, and both have to pass (threat model B1.2):

  1. The origin allowlist, below. A browser sends `Origin` on every unsafe
     request, cross-site or not, so a forged one arrives declaring where it
     came from. Anything not on the same list CORS already uses is refused.

  2. A token the attacker cannot obtain. It is DERIVED from the session token
     rather than stored beside it:

         token = base64url(sha256("birq.csrf.v1." + realm + "." + sessionToken))

     The session token is 256 random bits in an httpOnly cookie, so a page on
     another origin cannot read it and therefore cannot compute this. Deriving
     rather than storing buys three things. There is no secret to configure,
     rotate or leak, because the key material is the session's own token. There
     is no row to keep in step with the session, so the token cannot outlive
     it or drift from it. And the server never has to TRUST a copy the client
     sent back: it recomputes the expected value from the cookie and compares.

     That last point is what makes this stronger than the classic double-submit
     cookie. Double-submit compares a cookie against a header, so an attacker
     who can set a cookie on the registrable domain - from a sibling subdomain,
     say - can satisfy both halves with a value they chose. Here a cookie the
     attacker plants proves nothing, because no cookie is an input to the
     comparison. Only the session cookie is, and they cannot read it.

  Delivery is a response header, not a cookie, for a reason worth writing down:
  the admin session cookie is deliberately host-only (see admin-session.service)
  so that an administrator's session never reaches the customer's hostname. A
  cookie set by the API host cannot be read by script on the web host, so a
  cookie-delivered token would work for the customer realm and quietly fail for
  the admin one. A header is scoped to nothing, exposed through CORS, and works
  the same for both. It also dies with the tab: there is nothing at rest to
  steal, and nothing to inject.

  The token is not a credential on its own. Anybody holding it still needs the
  session cookie for the request to mean anything, which is why it is safe to
  hand back on every response and to keep in a variable in the browser.
*/

/**
 * The two realms derive different tokens from the same input, for the same
 * reason they use different cookies: a value that works in one must be
 * meaningless in the other.
 */
export type CsrfRealm = "customer" | "admin";

/** Carries the token in both directions: the API issues it, the client echoes it. */
export const CSRF_HEADER = "x-csrf-token";

/*
  A label that is part of the hashed input, so this digest can never collide
  with another use of sha256 over the same token. `hashToken` in the auth module
  hashes the session token bare to get what goes in the database; without the
  label here, the CSRF token and that stored hash would be computed from the
  same bytes, and the contents of the session table would become a set of valid
  CSRF tokens. The version is there so a future change of scheme can be rolled
  out without the two being confusable.
*/
const DOMAIN = "birq.csrf.v1";

/** The token a given session must present. Pure, and cheap enough for every request. */
export function csrfTokenFor(realm: CsrfRealm, sessionToken: string): string {
  return createHash("sha256").update(`${DOMAIN}.${realm}.${sessionToken}`).digest("base64url");
}

/*
  The methods that can change something. GET and HEAD are excluded because they
  must not change anything in the first place; if one ever did, the bug is the
  handler, not the absence of a token. OPTIONS is the CORS preflight, which
  carries no credentials and is answered by the cors plugin before this runs.
*/
const UNSAFE_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const isUnsafeMethod = (method: string): boolean => UNSAFE_METHODS.has(method.toUpperCase());

/** Constant-time, and length-safe: two tokens of different lengths simply differ. */
export function csrfTokenMatches(expected: string, presented: unknown): boolean {
  if (typeof presented !== "string") return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(presented, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Whether an unsafe request declares an origin we do not serve.
 *
 * `undefined` is not a failure. A browser always sends `Origin` on an unsafe
 * request, so its absence means the caller is not a browser - curl, a test, a
 * future mobile client - and nothing can be forged through one of those: there
 * is no ambient cookie jar for an attacker to borrow. Those callers are still
 * held to the token check when they authenticate with a cookie.
 *
 * `Sec-Fetch-Site` is checked as well as `Origin`. It is set by the browser and
 * cannot be spoofed by script, and it answers the question directly rather than
 * by comparison, so it catches a cross-site request whose `Origin` is missing
 * or opaque ("null", from a sandboxed frame or a redirect chain).
 */
export function isCrossSiteRequest(
  origin: string | undefined,
  secFetchSite: string | undefined,
  allowedOrigins: readonly string[],
): boolean {
  if (secFetchSite === "cross-site") return true;
  if (origin === undefined) return false;
  return !allowedOrigins.includes(origin);
}

/** The first value of a header Fastify may hand back as a list. */
export function singleHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
