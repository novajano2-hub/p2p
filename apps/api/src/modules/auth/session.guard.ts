import {
  createParamDecorator,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { type FastifyReply, type FastifyRequest } from "fastify";

import { AppError } from "@/common/errors/app-error";
import {
  CSRF_HEADER,
  csrfTokenMatches,
  isUnsafeMethod,
  singleHeader,
} from "@/common/security/csrf";
import { SessionService, type AuthenticatedSession } from "@/modules/auth/session.service";

/*
  Deny by default. A route is only reachable without a session if it says so by
  omitting this guard; there is no "public unless marked private" flag to
  forget to set.

  It is also where CSRF is enforced, and that placement is the point rather
  than a convenience. "Every cookie-authenticated mutation" (threat model B1.2)
  is not a list somebody maintains - it is exactly the set of unsafe requests
  that pass through here, so putting the check inside the guard makes the two
  the same thing by construction. A route added tomorrow is covered because it
  needs a session, not because somebody remembered to decorate it.

  What this leaves uncovered is worth naming. POST /v1/auth/logout resolves its
  session by hand instead of using this guard, so it is not token-checked: it is
  idempotent, it can only end the caller's own session, and it has to stay
  reachable by a client that cannot tell whether it is signed in - which is
  precisely the case where no token has been handed out yet. A forged logout is
  a nuisance, not a breach, and OriginGuard still refuses it from any origin we
  do not serve.
*/

type RequestWithSession = FastifyRequest & { session?: AuthenticatedSession };

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithSession>();
    const session = await this.sessions.resolve(request);
    if (!session) throw AppError.unauthenticated();

    if (isUnsafeMethod(request.method)) {
      const presented = singleHeader(request.headers[CSRF_HEADER]);
      if (!csrfTokenMatches(session.csrfToken, presented)) {
        throw AppError.csrfFailed();
      }
    }

    /*
      Handed back on every authenticated response, safe ones included. A client
      therefore holds a current token after any request at all, which removes
      the one way this could have become a papercut: a page open long enough to
      be looking at a session other than the one it was loaded with.
    */
    void http.getResponse<FastifyReply>().header(CSRF_HEADER, session.csrfToken);

    request.session = session;
    return true;
  }
}

/** The session the guard resolved. Only valid on routes behind SessionGuard. */
export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedSession => {
    const request = context.switchToHttp().getRequest<RequestWithSession>();
    if (!request.session) {
      // Reaching here means a handler asked for the session without the guard.
      throw AppError.unauthenticated();
    }
    return request.session;
  },
);
