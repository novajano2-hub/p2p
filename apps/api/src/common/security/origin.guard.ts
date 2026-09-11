import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { type FastifyRequest } from "fastify";
import { PinoLogger } from "nestjs-pino";

import { AppError } from "@/common/errors/app-error";
import { isCrossSiteRequest, isUnsafeMethod, singleHeader } from "@/common/security/csrf";
import { ENV } from "@/config/config.module";
import { type Env } from "@/config/env";

/*
  The first of the two CSRF checks, applied to every unsafe request in the
  application whether or not it is authenticated.

  This is the half that protects the requests the token cannot. Signing in,
  registering and starting a password reset carry no session yet, so there is
  no session to derive a token from - and a forged log-in is a real attack
  (it lands a victim in an account the attacker controls, and whatever the
  victim does next happens there). A browser cannot omit `Origin` on a
  cross-site POST, so refusing every origin that is not on the allowlist
  closes that without asking anything of the sign-in pages.

  It is a guard rather than a Fastify hook so that its refusal travels the same
  path as every other error in the application and comes out as the one
  envelope from @abay/contracts, with the request's correlation id attached.

  CORS is not a substitute for this. CORS decides what a browser will let a
  page READ; the request has already been made and acted on by then. A
  same-site preflight is not required at all. This check is server-side and
  runs before any handler.
*/
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OriginGuard.name);
  }

  canActivate(context: ExecutionContext): boolean {
    // Nothing else is an HTTP request: the workers share this codebase.
    if (context.getType() !== "http") return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (!isUnsafeMethod(request.method)) return true;

    const origin = singleHeader(request.headers.origin);
    const secFetchSite = singleHeader(request.headers["sec-fetch-site"]);

    if (isCrossSiteRequest(origin, secFetchSite, this.env.CORS_ORIGINS)) {
      /*
        Logged at warn with the origin, because this is either an attack or a
        misconfigured deployment and both are worth seeing. The origin is the
        attacker's own domain, not anybody's personal data, so it is safe to
        record verbatim.
      */
      this.logger.warn(
        { event: "csrf.origin_rejected", origin, secFetchSite, path: request.url },
        "unsafe request from an origin that is not allowed",
      );
      throw AppError.csrfFailed();
    }

    return true;
  }
}
