import { type AdminUser } from "@abay/database";
import { Inject, Injectable } from "@nestjs/common";

import { AppError } from "@/common/errors/app-error";
import { decryptField, encryptField, fieldEncryptionKey } from "@/common/security/field-encryption";
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  otpauthUri,
  verifyTotp,
} from "@/common/security/totp";
import { ENV } from "@/config/config.module";
import { type Env } from "@/config/env";
import { PrismaService } from "@/infra/prisma/prisma.service";
import { type AdminSessionContext } from "@/modules/admin/admin-session.service";
import { AuditService } from "@/modules/audit/audit.service";

/*
  The administrator's second factor (threat model B7.3).

  Mandatory by construction rather than by policy: the guard confines a
  session with no enrolled factor to these routes, so "everyone has MFA" is a
  property of the code, not a rule someone has to keep enforcing. What is
  built here is TOTP - the authenticator-app kind. B7.3's eventual ask is
  hardware-backed keys; this is the first factor, and the honest difference
  is recorded in the threat model rather than papered over.

  The secret is stored AES-256-GCM-encrypted under FIELD_ENCRYPTION_KEY, so a
  copy of the database cannot mint codes. Enrollment is two steps - a secret
  shown once, then a code computed from it - because an account whose "MFA"
  is a secret the phone never actually received is locked, not protected.

  Recovery is deliberately not self-service. A lost phone is fixed by another
  administrator at the machine: `npm run admin -w @abay/database -- mfa-reset`,
  which strips the factor, ends every session, and leaves an audit event. Any
  remotely reachable recovery path would be the realm's softest door.
*/

/** The AAD under which secrets are encrypted; a ciphertext cannot cross fields. */
const PURPOSE = "admin-totp";

@Injectable()
export class AdminMfaService {
  private readonly key: Buffer;
  private readonly issuer: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(ENV) env: Env,
  ) {
    this.key = fieldEncryptionKey(env.FIELD_ENCRYPTION_KEY);
    // Its own issuer name, so the entry on the phone is unmistakably not a
    // customer account - the same distinction the dark header bar draws.
    this.issuer = `${env.APP_NAME} Admin`;
  }

  /*
    A fresh secret, staged but inert. Calling this again simply replaces the
    staged secret - abandoning a half-finished enrollment, or rotating to a
    new phone from a signed-in (and therefore already code-proven) session.
    The active secret is untouched until a code proves the new one.
  */
  async setup(session: AdminSessionContext): Promise<{ secret: string; otpauthUri: string }> {
    const secret = generateTotpSecret();
    await this.prisma.client.adminUser.update({
      where: { id: session.admin.id },
      data: { totpPendingSecret: encryptField(base32Encode(secret), this.key, PURPOSE) },
    });
    return {
      secret: base32Encode(secret),
      otpauthUri: otpauthUri(this.issuer, session.admin.email, secret),
    };
  }

  /*
    The code proves the phone holds the secret; only then does it become the
    account's factor. Every other session the account has is ended in the
    same breath: enrollment is a security posture change, and whoever else is
    signed in - an attacker who beat the real administrator to the password,
    or the administrator's own forgotten tab - should have to come through
    the new door.
  */
  async confirm(
    session: AdminSessionContext,
    code: string,
    context: { correlationId: string; ip?: string | undefined },
  ): Promise<AdminUser> {
    const current = await this.prisma.client.adminUser.findUniqueOrThrow({
      where: { id: session.admin.id },
    });
    if (!current.totpPendingSecret) {
      throw AppError.conflict("There is no set-up in progress. Start again from the QR code.");
    }

    const secret = base32Decode(decryptField(current.totpPendingSecret, this.key, PURPOSE));
    const step = verifyTotp(secret, code);
    if (step === null) {
      throw AppError.unauthenticated(
        "That code is not valid. Codes change every 30 seconds - enter the one showing now.",
      );
    }

    const [admin, others] = await this.prisma.client.$transaction([
      this.prisma.client.adminUser.update({
        where: { id: current.id },
        data: {
          totpSecret: current.totpPendingSecret,
          totpPendingSecret: null,
          totpEnrolledAt: new Date(),
          // The enrollment code itself is spent: it cannot also sign in.
          totpLastUsedStep: BigInt(step),
        },
      }),
      this.prisma.client.adminSession.updateMany({
        where: { adminUserId: current.id, revokedAt: null, id: { not: session.sessionId } },
        data: { revokedAt: new Date(), revokedReason: "REVOKED_BY_ADMIN" },
      }),
    ]);

    await this.audit.record({
      action: "admin.mfa_enrolled",
      actor: { id: admin.id, email: admin.email },
      subject: { type: "admin_user", id: admin.id },
      correlationId: context.correlationId,
      ip: context.ip ?? null,
      after: { mfaEnrolled: true, otherSessionsEnded: others.count },
    });

    return admin;
  }

  /*
    The sign-in check. True only for a six-digit code computed from the
    account's active secret in the current 30-second window (one step of
    clock skew either way) that has NOT been accepted before - the step claim
    below is atomic, so two requests racing the same code cannot both win it
    (RFC 6238 5.2).
  */
  async verifyLogin(admin: AdminUser, code: string): Promise<boolean> {
    if (!admin.totpSecret) return false;
    const secret = base32Decode(decryptField(admin.totpSecret, this.key, PURPOSE));
    const step = verifyTotp(secret, code);
    if (step === null) return false;

    const { count } = await this.prisma.client.adminUser.updateMany({
      where: {
        id: admin.id,
        OR: [{ totpLastUsedStep: null }, { totpLastUsedStep: { lt: BigInt(step) } }],
      },
      data: { totpLastUsedStep: BigInt(step) },
    });
    return count === 1;
  }
}
