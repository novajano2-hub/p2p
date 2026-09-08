import {
  createParamDecorator,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { type FastifyRequest } from "fastify";

import { AppError } from "@/common/errors/app-error";
import { SessionService, type AuthenticatedSession } from "@/modules/auth/session.service";

/*
  Deny by default. A route is only reachable without a session if it says so by
  omitting this guard; there is no "public unless marked private" flag to
  forget to set.
*/

type RequestWithSession = FastifyRequest & { session?: AuthenticatedSession };

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithSession>();
    const session = await this.sessions.resolve(request);
    if (!session) throw AppError.unauthenticated();
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
