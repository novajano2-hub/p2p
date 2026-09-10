import { type AdminRole } from "@abay/contracts";
import {
  createParamDecorator,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { type FastifyRequest } from "fastify";

import { AppError } from "@/common/errors/app-error";
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
*/

const ADMIN_ROLES_KEY = "admin:roles";

/** Names the capability a route needs. Without it, any signed-in administrator may call it. */
export const RequireAdminRole = (...roles: AdminRole[]) => SetMetadata(ADMIN_ROLES_KEY, roles);

type RequestWithAdmin = FastifyRequest & { adminSession?: AdminSessionContext };

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly sessions: AdminSessionService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithAdmin>();
    const session = await this.sessions.resolve(request);
    if (!session) throw AppError.unauthenticated("Sign in to the admin area to continue.");

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
