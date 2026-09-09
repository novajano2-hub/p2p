import { type SessionEndReason, type User } from "@abay/database";
import { Inject, Injectable } from "@nestjs/common";
import { type FastifyReply, type FastifyRequest } from "fastify";

import { ENV } from "@/config/config.module";
import { type Env } from "@/config/env";
import { PrismaService } from "@/infra/prisma/prisma.service";
import { generateToken, hashToken } from "@/modules/auth/tokens";

/*
  Sessions are opaque and server-side. A custodial platform has to be able to
  end a session now - on password change, on a support call, on suspicion - and
  a self-contained token cannot be recalled before it expires. The cost is a
  database read per authenticated request, which is the right trade here.
*/

export const SESSION_COOKIE = "birq_session";

export interface AuthenticatedSession {
  sessionId: string;
  user: User;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Issues a session and puts the only copy of the token in an httpOnly cookie. */
  async issue(
    userId: string,
    reply: FastifyReply,
    context: { ip?: string | undefined; userAgent?: string | undefined },
  ): Promise<void> {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + this.env.SESSION_TTL_HOURS * 3_600_000);

    await this.prisma.client.session.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        expiresAt,
        createdIp: context.ip ?? null,
        userAgent: context.userAgent?.slice(0, 400) ?? null,
      },
    });

    void reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      // Lax, not Strict: the session must survive following a link back into
      // the app. Cross-site POSTs are handled by CSRF tokens, not by the cookie.
      sameSite: "lax",
      secure: this.env.COOKIE_SECURE,
      path: "/",
      maxAge: this.env.SESSION_TTL_HOURS * 3_600,
      ...(this.env.COOKIE_DOMAIN ? { domain: this.env.COOKIE_DOMAIN } : {}),
    });
  }

  /**
   * Resolves the cookie to a live session, or null. Enforces three separate
   * expiries: revocation, absolute lifetime, and idleness.
   */
  async resolve(request: FastifyRequest): Promise<AuthenticatedSession | null> {
    const token = request.cookies?.[SESSION_COOKIE];
    if (!token) return null;

    const session = await this.prisma.client.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { include: { identities: true } } },
    });
    if (!session || session.revokedAt) return null;

    const now = Date.now();
    if (session.expiresAt.getTime() <= now) return null;

    const idleMs = this.env.SESSION_IDLE_TTL_HOURS * 3_600_000;
    if (now - session.lastUsedAt.getTime() > idleMs) {
      await this.revokeById(session.id, "EXPIRED");
      return null;
    }

    // A session issued before the password last changed is stale. This is what
    // makes "changing your password signs out your other devices" true.
    const changedAt = session.user.identities.find(
      (identity) => identity.provider === "PASSWORD",
    )?.passwordChangedAt;
    if (changedAt && session.createdAt < changedAt) {
      await this.revokeById(session.id, "PASSWORD_CHANGED");
      return null;
    }

    if (session.user.status === "CLOSED") return null;

    // Sliding idle window. Written at most once a minute: every authenticated
    // request does not need to be a write.
    if (now - session.lastUsedAt.getTime() > 60_000) {
      await this.prisma.client.session.update({
        where: { id: session.id },
        data: { lastUsedAt: new Date(now) },
      });
    }

    return { sessionId: session.id, user: session.user };
  }

  /** Revocation is a write, never a delete: the row is the audit trail. */
  async revokeById(sessionId: string, reason: SessionEndReason): Promise<void> {
    await this.prisma.client.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  clearCookie(reply: FastifyReply): void {
    void reply.clearCookie(SESSION_COOKIE, {
      path: "/",
      ...(this.env.COOKIE_DOMAIN ? { domain: this.env.COOKIE_DOMAIN } : {}),
    });
  }
}
