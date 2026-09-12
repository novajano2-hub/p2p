import { type AdminIdentity } from "@abay/contracts";
import { type AdminUser } from "@abay/database";
import { Injectable } from "@nestjs/common";
import { type FastifyReply } from "fastify";

import { AppError } from "@/common/errors/app-error";
import { PrismaService } from "@/infra/prisma/prisma.service";
import { AdminMfaService } from "@/modules/admin/admin-mfa.service";
import { AdminSessionService } from "@/modules/admin/admin-session.service";
import { burnTimeLikeAVerify, verifyPassword } from "@/modules/auth/tokens";
import { AuditService } from "@/modules/audit/audit.service";

/*
  Signing in as an administrator.

  A password and, once enrolled, a code from an authenticator app - and
  deliberately nothing else: no OAuth, no emailed code, no self-service
  reset. Every one of those is a remotely reachable path into the most
  privileged accounts on the platform, and an administrator who is locked
  out is fixed by another administrator out of band. Accounts are issued
  with `npm run admin`; there is no route that creates one.

  The two factors are checked in strict order and the response gives away as
  little as each stage allows. A wrong password answers exactly like an
  unknown address; only a CORRECT password reveals that a code is also
  needed, which is inherent to any second factor and is precisely the moment
  the second factor starts mattering. A wrong code says so plainly - the
  caller has already proven the password, so "which half was wrong" is no
  longer a secret worth keeping from them.
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
    private readonly mfa: AdminMfaService,
    private readonly audit: AuditService,
  ) {}

  async login(
    email: string,
    password: string,
    code: string | undefined,
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

    /*
      The second factor, for accounts that have one. An account that does not
      signs in on the password alone - and the guard then confines it to the
      enrollment routes, so the password-only window is exactly as long as it
      takes to scan a QR code, and closes itself.
    */
    if (admin.totpEnrolledAt) {
      if (!code) throw AppError.mfaRequired();
      if (!(await this.mfa.verifyLogin(admin, code))) {
        // The same audit action as a wrong password: what matters to whoever
        // is watching is "failed attempts against this named account".
        await this.audit.record({
          action: "admin.sign_in_failed",
          actor: null,
          subject: { type: "admin_user", id: admin.id },
          correlationId: context.correlationId,
          ip: context.ip ?? null,
        });
        throw AppError.unauthenticated(
          "That code is not valid. Codes change every 30 seconds - enter the one showing now.",
        );
      }
    }

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
    mfaEnrolled: admin.totpEnrolledAt !== null,
  };
}
