import { type AdminUser, type SessionEndReason } from "@abay/database";
import { Inject, Injectable } from "@nestjs/common";
import { type FastifyReply, type FastifyRequest } from "fastify";

import { CSRF_HEADER, csrfTokenFor } from "@/common/security/csrf";
import { ENV } from "@/config/config.module";
import { type Env } from "@/config/env";
import { PrismaService } from "@/infra/prisma/prisma.service";
import { generateToken, hashToken } from "@/modules/auth/tokens";

/*
  An administrator's session.

  A deliberate copy of the customer's session service rather than a shared one
  (threat model B7.3). Sharing would mean one code path minting both kinds of
  session, and a mistake in it would cross the boundary the separate realm
  exists to create. The duplication is the control.

  Three things differ on purpose. The cookie has its own name, so the two can
  never be mistaken for one another and holding one says nothing about the
  other. The lifetimes are hours rather than weeks: an administrator is at a
  desk doing a task, not carrying a phone around for a month. And the cookie
  is host-only, always - see below.
*/

export const ADMIN_SESSION_COOKIE = "birq_admin_session";

export interface AdminSessionContext {
  sessionId: string;
  admin: AdminUser;
  /**
   * What a mutation on this session has to present in the x-csrf-token header.
   * A different value from the one the same token would produce in the customer
   * realm, on purpose: the realms share nothing, including this.
   */
  csrfToken: string;
}

@Injectable()
export class AdminSessionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async issue(
    adminUserId: string,
    reply: FastifyReply,
    context: { ip?: string | undefined; userAgent?: string | undefined },
  ): Promise<void> {
    const token = generateToken();
    const maxAgeSeconds = this.env.ADMIN_SESSION_TTL_HOURS * 3_600;

    await this.prisma.client.adminSession.create({
      data: {
        adminUserId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + maxAgeSeconds * 1_000),
        createdIp: context.ip ?? null,
        userAgent: context.userAgent?.slice(0, 400) ?? null,
      },
    });

    void reply.setCookie(ADMIN_SESSION_COOKIE, token, {
      httpOnly: true,
      // Strict, not Lax. The customer cookie is Lax because a session has to
      // survive following a link back into the app; nobody should ever arrive
      // at an admin action by following a link from somewhere else, so the
      // stricter setting costs nothing and removes a class of cross-site entry.
      sameSite: "strict",
      secure: this.env.COOKIE_SECURE,
      path: "/",
      maxAge: maxAgeSeconds,
      /*
        No domain, ever, and deliberately NOT COOKIE_DOMAIN.

        The customer cookie is widened to the registrable domain in production
        so the web server can see it and route on it. Doing the same here would
        send an administrator's session to birq.com on every request for an
        image or a script, which is exactly the reach this realm is separated
        to avoid. Host-only keeps it on admin.birq.com and nowhere else.
      */
    });

    /*
      And the CSRF token for it. The header is the only workable channel for
      this in the admin realm: a cookie set here is host-only by the rule above,
      so script on the web host could not read it, and widening it would undo
      exactly the separation that rule exists to keep.
    */
    void reply.header(CSRF_HEADER, csrfTokenFor("admin", token));
  }

  /** The cookie resolved to a live session, or null. Four ways to be dead. */
  async resolve(request: FastifyRequest): Promise<AdminSessionContext | null> {
    const token = request.cookies?.[ADMIN_SESSION_COOKIE];
    if (!token) return null;

    const session = await this.prisma.client.adminSession.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { adminUser: true },
    });
    if (!session || session.revokedAt) return null;

    const now = Date.now();
    if (session.expiresAt.getTime() <= now) return null;

    const idleMs = this.env.ADMIN_SESSION_IDLE_MINUTES * 60_000;
    if (now - session.lastUsedAt.getTime() > idleMs) {
      await this.revokeById(session.id, "EXPIRED");
      return null;
    }

    const { adminUser } = session;
    if (adminUser.status !== "ACTIVE") return null;
    if (adminUser.passwordChangedAt && session.createdAt < adminUser.passwordChangedAt) {
      await this.revokeById(session.id, "PASSWORD_CHANGED");
      return null;
    }

    // Sliding idle window, written at most once a minute.
    if (now - session.lastUsedAt.getTime() > 60_000) {
      await this.prisma.client.adminSession.update({
        where: { id: session.id },
        data: { lastUsedAt: new Date(now) },
      });
    }

    return { sessionId: session.id, admin: adminUser, csrfToken: csrfTokenFor("admin", token) };
  }

  /** Revocation is a write, never a delete: the row is part of the trail. */
  async revokeById(sessionId: string, reason: SessionEndReason): Promise<void> {
    await this.prisma.client.adminSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  /** Every session an account has. Used when it is suspended or its password changes. */
  async revokeAllFor(adminUserId: string, reason: SessionEndReason): Promise<void> {
    await this.prisma.client.adminSession.updateMany({
      where: { adminUserId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  clearCookie(reply: FastifyReply): void {
    // Host-only on the way out too: a clear that names a domain the cookie was
    // never set on removes nothing, and the session would appear to survive.
    void reply.clearCookie(ADMIN_SESSION_COOKIE, { path: "/" });
  }
}
