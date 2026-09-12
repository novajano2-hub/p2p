import { type AdminRole } from "@abay/contracts";
import {
  createParamDecorator,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { type FastifyReply, type FastifyRequest } from "fastify";

import { AppError } from "@/common/errors/app-error";
import {
  CSRF_HEADER,
  csrfTokenMatches,
  isUnsafeMethod,
  singleHeader,
} from "@/common/security/csrf";
import {
  AdminSessionService,
  type AdminSessionContext,
} from "@/modules/admin/admin-session.service";

/*
  Deny by default, twice over.

  First: an admin session, resolved from the admin cookie alone. A customer
  session is not merely insufficient here, it is invisible - the two realms
  share no table and no cookie, so there is nothing for a customer's session to
  be "escalated" from.

  Second: the role the route asks for. Being an administrator grants nothing on
  its own (B7.1); every route that does something names the capability it
  needs, and an account without it is refused. A route that forgets to name one
  is readable by any administrator, which is why the ones that matter say so
  out loud.

  And third, for anything that changes something: the CSRF token, for the same
  reason and by the same construction as in the customer realm's guard. Unlike
  that one there is no exemption here at all - even signing out is checked,
  because an administrator always has a token by the time they can act, so
  nothing is made unreachable by requiring it.
*/

const ADMIN_ROLES_KEY = "admin:roles";

/** Names the capability a route needs. Without it, any signed-in administrator may call it. */
export const RequireAdminRole = (...roles: AdminRole[]) => SetMetadata(ADMIN_ROLES_KEY, roles);

const ALLOW_WITHOUT_MFA_KEY = "admin:allow-without-mfa";

/**
 * The short list a session may reach before its second factor is enrolled:
 * the enrollment routes themselves, and the two that let a client find out
 * where it stands and leave. Everything else refuses until enrollment is
 * done, which is the whole of what makes MFA mandatory rather than nagged
 * about - and why this is an explicit opt-OUT: a new route is protected by
 * being written, not by being remembered.
 */
export const AllowWithoutMfa = () => SetMetadata(ALLOW_WITHOUT_MFA_KEY, true);

type RequestWithAdmin = FastifyRequest & { adminSession?: AdminSessionContext };

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly sessions: AdminSessionService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithAdmin>();
    const session = await this.sessions.resolve(request);
    if (!session) throw AppError.unauthenticated("Sign in to the admin area to continue.");

    if (isUnsafeMethod(request.method)) {
      const presented = singleHeader(request.headers[CSRF_HEADER]);
      if (!csrfTokenMatches(session.csrfToken, presented)) {
        throw AppError.csrfFailed();
      }
    }

    void http.getResponse<FastifyReply>().header(CSRF_HEADER, session.csrfToken);

    /*
      No second factor yet: the session is real but confined. Checked before
      roles on purpose - an account's roles are irrelevant until the account
      itself is finished being set up.
    */
    if (session.admin.totpEnrolledAt === null) {
      const allowed = this.reflector.getAllAndOverride<boolean | undefined>(ALLOW_WITHOUT_MFA_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!allowed) {
        throw AppError.forbidden("Set up two-factor authentication to continue.");
      }
    }

    const required = this.reflector.getAllAndOverride<AdminRole[] | undefined>(ADMIN_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required && required.length > 0) {
      const held = new Set<string>(session.admin.roles);
      if (!required.some((role) => held.has(role))) {
        // Deliberately does not name the missing role: an administrator who
        // should not be here learns nothing about what would get them in.
        throw AppError.forbidden("You do not have the role this needs.");
      }
    }

    request.adminSession = session;
    return true;
  }
}

/** The admin the guard resolved. Only valid on routes behind AdminGuard. */
export const CurrentAdmin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AdminSessionContext => {
    const request = context.switchToHttp().getRequest<RequestWithAdmin>();
    if (!request.adminSession) {
      // Reaching here means a handler asked for the admin without the guard.
      throw AppError.unauthenticated();
    }
    return request.adminSession;
  },
);
