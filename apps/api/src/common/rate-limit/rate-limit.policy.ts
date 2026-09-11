import { SetMetadata } from "@nestjs/common";

/*
  What a route's rate limit is written as.

  A policy names what to count BY, not what to count: the bucket is derived
  from the route itself (controller class and handler name), so two routes can
  never accidentally share a counter and no route needs to invent a unique
  string that a copy-paste could duplicate.

  Several policies on one route are all checked, and all of them have to pass.
  That is how the two halves of the brief's "rate limits by account, IP,
  device and action" coexist on a single endpoint: a per-address limit stops
  one account being ground down, and a per-IP limit stops one machine working
  through a list of addresses instead (threat model B1.5).
*/

/** What a counter is kept per. Each is derivable from the raw request. */
export type RateLimitSubject =
  /*
    The calling address, as Fastify resolved it - which honours TRUST_PROXY, so
    behind a proxy this is the real client and not the proxy. IPv6 is bucketed
    to a /64 before it is used; see rate-limit.service.
  */
  | "ip"
  /*
    The email address in the request body, normalised and hashed. For the
    endpoints where the address IS the account being attacked and there is no
    session yet: log-in, registration, password reset. A body without one
    simply skips the policy rather than falling back to something weaker.
  */
  | "email"
  /*
    The session the request arrives with, of whichever realm - hashed, so what
    is in Redis cannot be replayed as a cookie. Used for authenticated routes
    that cost something to serve: uploads, document reads, decisions.
  */
  | "session";

export interface RateLimitPolicy {
  by: RateLimitSubject;
  /** Requests allowed inside one window. */
  limit: number;
  /** The window, in seconds. Fixed, not sliding: see rate-limit.service. */
  windowSeconds: number;
}

export const RATE_LIMIT_POLICIES = "rate-limit:policies";

/**
 * Declares the limits for one route. Without this decorator a route is not
 * rate limited at all, which is the right default for reads that cost nothing
 * and would otherwise make Redis a dependency of simply looking at a page.
 */
export const RateLimit = (...policies: RateLimitPolicy[]) =>
  SetMetadata(RATE_LIMIT_POLICIES, policies);

/* Written at the call site as `perIp(30, minutes(15))`, which reads as the rule it is. */

export const minutes = (count: number): number => count * 60;
export const hours = (count: number): number => count * 3_600;

export const perIp = (limit: number, windowSeconds: number): RateLimitPolicy => ({
  by: "ip",
  limit,
  windowSeconds,
});

export const perEmail = (limit: number, windowSeconds: number): RateLimitPolicy => ({
  by: "email",
  limit,
  windowSeconds,
});

export const perSession = (limit: number, windowSeconds: number): RateLimitPolicy => ({
  by: "session",
  limit,
  windowSeconds,
});
