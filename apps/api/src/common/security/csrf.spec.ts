import { createHash } from "node:crypto";

import {
  csrfTokenFor,
  csrfTokenMatches,
  isCrossSiteRequest,
  isUnsafeMethod,
  singleHeader,
} from "./csrf";

/*
  The properties the CSRF scheme rests on, asserted rather than assumed. If any
  of these stops being true the protection is gone while every endpoint still
  answers normally, which is exactly the kind of failure a test has to catch.
*/

const SESSION = "vP0hR2tYsL8kQ1mN4jX7bC3dF6gH9aZ5wE2rT8yU0iO";

describe("csrfTokenFor", () => {
  it("gives the same token for the same session every time", () => {
    expect(csrfTokenFor("customer", SESSION)).toBe(csrfTokenFor("customer", SESSION));
  });

  it("gives a different token to a different session", () => {
    expect(csrfTokenFor("customer", SESSION)).not.toBe(csrfTokenFor("customer", `${SESSION}x`));
  });

  /*
    The two realms deliberately share no credential. A token minted for an
    administrator session must be worthless in the customer realm even though
    both derive from the same session token, because that is what stops one
    realm token being replayed into the other if a client ever confused them.
  */
  it("gives the two realms different tokens for the same session token", () => {
    expect(csrfTokenFor("admin", SESSION)).not.toBe(csrfTokenFor("customer", SESSION));
  });

  /*
    The session table stores sha256 of the session token. If the CSRF token were
    computed from the same bytes without a label, the contents of that table
    would be a list of valid CSRF tokens.
  */
  it("is not the bare hash of the session token", () => {
    const bare = createHash("sha256").update(SESSION).digest("hex");
    expect(csrfTokenFor("customer", SESSION)).not.toBe(bare);
  });

  it("is url-safe, so it survives a header unaltered", () => {
    expect(csrfTokenFor("customer", SESSION)).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("csrfTokenMatches", () => {
  const expected = csrfTokenFor("customer", SESSION);

  it("accepts the token the session derives", () => {
    expect(csrfTokenMatches(expected, expected)).toBe(true);
  });

  it("refuses a wrong token, a missing one, and anything that is not a string", () => {
    expect(csrfTokenMatches(expected, csrfTokenFor("admin", SESSION))).toBe(false);
    expect(csrfTokenMatches(expected, undefined)).toBe(false);
    expect(csrfTokenMatches(expected, "")).toBe(false);
    expect(csrfTokenMatches(expected, 12_345)).toBe(false);
    expect(csrfTokenMatches(expected, [expected])).toBe(false);
  });

  it("refuses a token that merely starts correctly", () => {
    expect(csrfTokenMatches(expected, expected.slice(0, -1))).toBe(false);
    expect(csrfTokenMatches(expected, `${expected}x`)).toBe(false);
  });

  /* Multi-byte input must not throw on the way to a length comparison. */
  it("refuses a token whose byte length differs from its character length", () => {
    expect(csrfTokenMatches(expected, "\u00e9".repeat(expected.length))).toBe(false);
  });
});

describe("isUnsafeMethod", () => {
  it("covers everything that can change state", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "post", "patch"]) {
      expect(isUnsafeMethod(method)).toBe(true);
    }
  });

  it("leaves reads and the preflight alone", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(isUnsafeMethod(method)).toBe(false);
    }
  });
});

describe("isCrossSiteRequest", () => {
  const allowed = ["https://birq.com", "http://localhost:3000"];

  it("allows an origin on the list", () => {
    expect(isCrossSiteRequest("https://birq.com", "same-site", allowed)).toBe(false);
  });

  it("refuses an origin that is not", () => {
    expect(isCrossSiteRequest("https://evil.example", "cross-site", allowed)).toBe(true);
    expect(isCrossSiteRequest("https://evil.example", undefined, allowed)).toBe(true);
  });

  /* A near miss is a different origin: scheme, host and port all count. */
  it("refuses a near miss", () => {
    expect(isCrossSiteRequest("http://birq.com", undefined, allowed)).toBe(true);
    expect(isCrossSiteRequest("https://www.birq.com", undefined, allowed)).toBe(true);
    expect(isCrossSiteRequest("http://localhost:3001", undefined, allowed)).toBe(true);
  });

  /* An opaque origin, from a sandboxed frame or some redirect chains, is "null". */
  it("refuses the literal null origin", () => {
    expect(isCrossSiteRequest("null", undefined, allowed)).toBe(true);
  });

  /*
    No Origin at all means the caller is not a browser, so there is no cookie
    jar to borrow and nothing to forge. Those callers are still held to the
    token check whenever they authenticate with a cookie.
  */
  it("allows a caller that sends no origin", () => {
    expect(isCrossSiteRequest(undefined, undefined, allowed)).toBe(false);
  });

  /*
    Sec-Fetch-Site is set by the browser and cannot be touched by script, so it
    is believed even when there is no Origin to compare.
  */
  it("refuses a cross-site fetch even with no origin to compare", () => {
    expect(isCrossSiteRequest(undefined, "cross-site", allowed)).toBe(true);
  });
});

describe("singleHeader", () => {
  it("takes the first of a repeated header, and passes the rest through", () => {
    expect(singleHeader(["a", "b"])).toBe("a");
    expect(singleHeader("a")).toBe("a");
    expect(singleHeader(undefined)).toBeUndefined();
    expect(singleHeader([])).toBeUndefined();
  });
});
