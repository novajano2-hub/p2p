import { type AdminIdentity } from "@abay/contracts";
import { type AdminUser } from "@abay/database";
import { Injectable } from "@nestjs/common";
import { type FastifyReply } from "fastify";

import { AppError } from "@/common/errors/app-error";
import { PrismaService } from "@/infra/prisma/prisma.service";
import { AdminSessionService } from "@/modules/admin/admin-session.service";
import { burnTimeLikeAVerify, verifyPassword } from "@/modules/auth/tokens";
import { AuditService } from "@/modules/audit/audit.service";

/*
  Signing in as an administrator.

  Password only, and deliberately nothing else: no OAuth, no emailed code, no
  self-service reset. Every one of those is a remotely reachable path into the
  most privileged accounts on the platform, and an administrator who loses
  their password is reset by another administrator out of band. Accounts are
  issued with `npm run admin:create`; there is no route that creates one.

  What is missing and should not stay missing is a second factor. The threat
  model asks for hardware-backed MFA on this realm (B7.3), and this is a
  password and a short session. That is the next thing to build here, not an
  optional extra.
*/

const REJECTED = AppError.unauthenticated("Those credentials are not valid.");

export interface RequestContext {
  ip?: string | undefined;
  userAgent?: string | undefined;
  correlationId: string;
}

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: AdminSessionService,
    private readonly audit: AuditService,
  ) {}

  async login(
    email: string,
    password: string,
    reply: FastifyReply,
    context: RequestContext,
  ): Promise<AdminIdentity> {
    const admin = await this.prisma.client.adminUser.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!admin) {
      // Spend the same time as a real verify, so the response does not answer
      // "is this an administrator's address".
      await burnTimeLikeAVerify();
      throw REJECTED;
    }
    if (!(await verifyPassword(admin.passwordHash, password))) {
      // Recorded: repeated failures against a named account are the signal
      // that matters here, and there is nowhere else it would be kept.
      await this.audit.record({
        action: "admin.sign_in_failed",
        actor: null,
        subject: { type: "admin_user", id: admin.id },
        correlationId: context.correlationId,
        ip: context.ip ?? null,
      });
      throw REJECTED;
    }
    if (admin.status !== "ACTIVE") throw REJECTED;

    await this.sessions.issue(admin.id, reply, context);
    await this.prisma.client.adminUser.update({
      where: { id: admin.id },
      data: { lastSignedInAt: new Date() },
    });
    await this.audit.record({
      action: "admin.signed_in",
      actor: { id: admin.id, email: admin.email },
      subject: { type: "admin_user", id: admin.id },
      correlationId: context.correlationId,
      ip: context.ip ?? null,
    });

    return toIdentity(admin);
  }

  async logout(sessionId: string, reply: FastifyReply): Promise<void> {
    await this.sessions.revokeById(sessionId, "LOGOUT");
    this.sessions.clearCookie(reply);
  }
}

/** Only what the interface needs. The password hash has no shape that reaches a client. */
export function toIdentity(admin: AdminUser): AdminIdentity {
  return {
    id: admin.id,
    email: admin.email,
    name: admin.name,
    roles: admin.roles,
  };
}
