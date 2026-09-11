import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { type FastifyReply, type FastifyRequest } from "fastify";
import { PinoLogger } from "nestjs-pino";

import { AppError } from "@/common/errors/app-error";
import {
  RATE_LIMIT_POLICIES,
  type RateLimitPolicy,
  type RateLimitSubject,
} from "@/common/rate-limit/rate-limit.policy";
import { rateLimitAddress, subjectHash } from "@/common/rate-limit/rate-limit.keys";
import { RateLimitService } from "@/common/rate-limit/rate-limit.service";
import { ENV } from "@/config/config.module";
import { type Env } from "@/config/env";
import { ADMIN_SESSION_COOKIE } from "@/modules/admin/admin-session.service";
import { SESSION_COOKIE } from "@/modules/auth/session.service";

/*
  Applies whatever limits a route declared with @RateLimit.

  Registered globally but inert without that decorator, so it costs an
  undecorated route one metadata lookup and no Redis call. That is deliberate:
  making every read of every page depend on Redis would turn a cache outage
  into an outage, and the limits that matter are on the handful of endpoints
  that send email, verify a password, or move bytes.

  It runs before the auth guards, being global, which is the order we want: a
  flood is turned away before it can spend a database round trip resolving a
  session. The consequence is that an authenticated route's counter is keyed on
  the session cookie as presented, not on a session proven to be live - which
  is the correct subject anyway, since the cost being limited is incurred
  whether or not the session turns out to be valid.
*/
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimitService,
    @Inject(ENV) private readonly env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RateLimitGuard.name);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") return true;
    if (!this.env.RATE_LIMIT_ENABLED) return true;

    const policies = this.reflector.getAllAndOverride<RateLimitPolicy[] | undefined>(
      RATE_LIMIT_POLICIES,
      [context.getHandler(), context.getClass()],
    );
    if (!policies || policies.length === 0) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    /*
      The route is the counter's name. Two routes cannot collide, a route cannot
      collide with itself across restarts, and nothing has to be kept unique by
      hand. It is also readable in a log line, which a hash of the path is not.
    */
    const route = `${context.getClass().name}.${context.getHandler().name}`;

    for (const policy of policies) {
      const subject = subjectOf(policy.by, request);
      // Nothing to count against: a body with no email, a route with no
      // session. Skipping is right - inventing a subject would either merge
      // unrelated callers into one counter or give each request its own.
      if (!subject) continue;

      const { allowed, retryAfterSeconds } = await this.limiter.hit(
        `${route}:${policy.by}:${subject}`,
        policy.limit,
        policy.windowSeconds,
      );
      if (allowed) continue;

      const reply = context.switchToHttp().getResponse<FastifyReply>();
      void reply.header("retry-after", String(retryAfterSeconds));
      /*
        Logged with the route and what it was keyed by, never with the subject
        itself: the subject is a hashed address or a hashed credential, and the
        useful signal is "this endpoint is being hammered", which the route and
        the count already carry.
      */
      this.logger.warn(
        { event: "rate_limit.exceeded", route, by: policy.by, limit: policy.limit },
        "rate limit exceeded",
      );
      throw AppError.rateLimited();
    }

    return true;
  }
}

/** The value this request is counted against, or null if it has none. */
function subjectOf(by: RateLimitSubject, request: FastifyRequest): string | null {
  switch (by) {
    case "ip":
      return rateLimitAddress(request.ip);

    case "email": {
      /*
        Read before validation runs, so it is whatever the caller sent. That is
        safe because it is only ever hashed into a key: a hostile value cannot
        escape a sha256. Normalised the same way the account lookup normalises
        it, so "A@b.com " and "a@b.com" are one subject and not two.
      */
      const body: unknown = request.body;
      if (typeof body !== "object" || body === null) return null;
      const email = (body as { email?: unknown }).email;
      if (typeof email !== "string") return null;
      const normalised = email.trim().toLowerCase();
      return normalised ? subjectHash(normalised) : null;
    }

    case "session": {
      /*
        Whichever realm's cookie is present. A route belongs to exactly one
        realm, so there is no ambiguity in practice; the customer cookie is
        checked first only because there are more of those routes.
      */
      const cookies = request.cookies as Record<string, string | undefined> | undefined;
      const token = cookies?.[SESSION_COOKIE] ?? cookies?.[ADMIN_SESSION_COOKIE];
      return token ? subjectHash(token) : null;
    }
  }
}
