import { Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { AppError } from "@/common/errors/app-error";
import { RedisService } from "@/infra/redis/redis.service";

/*
  The counter behind every rate limit.

  Fixed windows, not a sliding log. A fixed window lets through at most twice
  the limit across a window boundary, which is the honest cost of it; a sliding
  window costs a sorted set per subject and a member per request, and for
  limits whose job is to make brute force and mail-bombing impractical rather
  than to meter a paid API, that precision buys nothing. The window is short
  enough that twice the limit is still far below what an attack needs.

  Redis is the right home for this and only this kind of state: the brief and
  ADR-0009 both draw the line in the same place - queues, rate limits, bounded
  locks and disposable cache, never anything a balance depends on. A counter
  lost to a restart is a few extra attempts allowed, not a lost invariant.
*/

/*
  One round trip, and atomic against every other process doing the same thing.
  INCR creates the key at 1 when it is absent, so the first caller in a window
  is the one that sets the expiry.

  PTTL is read back rather than assumed because the answer has to say how long
  to wait, and because of the second branch: a key with no expiry would count
  up forever and lock a subject out permanently. That should be impossible -
  nothing else writes these keys - so it is handled rather than trusted.
*/
const HIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { count, ttl }
`;

/** Every key this service writes, so they are recognisable in a Redis that holds other things. */
const PREFIX = "rl";

export interface RateLimitOutcome {
  allowed: boolean;
  /** Whole seconds until the window resets. Always at least 1, for the Retry-After header. */
  retryAfterSeconds: number;
}

@Injectable()
export class RateLimitService {
  constructor(
    private readonly redis: RedisService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RateLimitService.name);
  }

  /**
   * Counts one request against `bucket` and says whether it may proceed.
   *
   * Counted on the way in, before the handler runs, deliberately: half the
   * point of limiting a log-in is to avoid paying for an Argon2 verification
   * on behalf of an attacker, and a limiter that only counted failures would
   * pay for every one of them first.
   */
  async hit(bucket: string, limit: number, windowSeconds: number): Promise<RateLimitOutcome> {
    const key = `${PREFIX}:${bucket}`;
    let count: number;
    let ttlMs: number;

    try {
      const result = (await this.redis.client.eval(
        HIT_SCRIPT,
        1,
        key,
        String(windowSeconds * 1_000),
      )) as [number, number];
      [count, ttlMs] = result;
    } catch (error) {
      /*
        Fails closed, which threat model B3.4 names explicitly: if Redis is
        unreachable we cannot tell an ordinary request from the ten thousandth
        attempt of a credential-stuffing run, and letting everything through is
        the outcome an attacker would choose. So the request is refused.

        503, not 429: the caller has not exceeded anything, we simply cannot
        say. It is the same answer /ready is giving at the same moment, and the
        same status the error mapper already returns for a dependency that is
        down, so a client that retries on 503 needs no new behaviour.
      */
      this.logger.error(
        { err: error, event: "rate_limit.unavailable", bucket },
        "rate limiter cannot reach redis; refusing the request",
      );
      throw AppError.notReady("We cannot process that right now. Please try again in a moment.");
    }

    // Ceiling, and never zero: Retry-After: 0 invites an immediate retry.
    const retryAfterSeconds = Math.max(1, Math.ceil(ttlMs / 1_000));
    return { allowed: count <= limit, retryAfterSeconds };
  }
}
