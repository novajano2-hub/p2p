import { type SessionUser } from "@abay/contracts";
import { type User } from "@abay/database";
import { Inject, Injectable } from "@nestjs/common";
import { type FastifyReply } from "fastify";
import { PinoLogger } from "nestjs-pino";

import { AppError } from "@/common/errors/app-error";
import { ENV } from "@/config/config.module";
import { type Env } from "@/config/env";
import { PrismaService } from "@/infra/prisma/prisma.service";
import { RedisService } from "@/infra/redis/redis.service";
import { SessionService } from "@/modules/auth/session.service";
import {
  burnTimeLikeAVerify,
  generateToken,
  generateVerificationCode,
  hashPassword,
  hashToken,
  tokenMatches,
  verifyPassword,
} from "@/modules/auth/tokens";

/** A six-digit code is a million guesses. Burn the code well before that. */
const MAX_CODE_ATTEMPTS = 5;
const CODE_TTL_MINUTES = 30;
/** Long enough to choose a password, short enough that a leaked ticket is stale fast. */
const TICKET_TTL_SECONDS = 15 * 60;

interface RequestContext {
  ip?: string | undefined;
  userAgent?: string | undefined;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly sessions: SessionService,
    private readonly logger: PinoLogger,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.logger.setContext(AuthService.name);
  }

  /*
    Step 1. Always succeeds, whether or not the address is already registered.
    The response cannot be used to discover who has an account, so the caller
    is told nothing except that something was accepted.
  */
  async startRegistration(email: string): Promise<void> {
    const existing = await this.prisma.client.user.findUnique({ where: { email } });
    if (existing) {
      // Nothing is sent and nothing is created: an attacker learns nothing, and
      // the owner of a registered address is not mailed a code they did not ask
      // for. A "you already have an account" email belongs here later.
      this.logger.info(
        { event: "register.start.existing" },
        "registration start for known address",
      );
      return;
    }

    await this.issueCode(email, "EMAIL_VERIFICATION");
  }

  /*
    Step 2. Proves control of the inbox. On success the code is consumed and
    replaced by a short-lived single-use ticket, so the code cannot be replayed
    and the password step cannot be reached without having held the code.
  */
  async verifyRegistration(email: string, code: string): Promise<string> {
    const token = await this.prisma.client.verificationToken.findFirst({
      where: { email, purpose: "EMAIL_VERIFICATION", consumedAt: null },
      orderBy: { createdAt: "desc" },
    });

    const invalid = AppError.unauthenticated("That code is not valid or has expired.");
    if (!token) throw invalid;

    if (token.expiresAt.getTime() <= Date.now()) throw invalid;

    if (token.attempts + 1 >= MAX_CODE_ATTEMPTS) {
      // Burn on the last allowed attempt rather than leaving a nearly-exhausted
      // code alive for the next attacker.
      await this.prisma.client.verificationToken.update({
        where: { id: token.id },
        data: { attempts: { increment: 1 }, consumedAt: new Date() },
      });
      throw invalid;
    }

    await this.prisma.client.verificationToken.update({
      where: { id: token.id },
      data: { attempts: { increment: 1 } },
    });

    if (!tokenMatches(token.tokenHash, hashToken(code))) throw invalid;

    await this.prisma.client.verificationToken.update({
      where: { id: token.id },
      data: { consumedAt: new Date() },
    });

    // The ticket lives in Redis, not the database: it is disposable, expires on
    // its own, and losing it costs a re-verification rather than an account.
    const ticket = generateToken();
    await this.redis.client.set(this.ticketKey(ticket), email, "EX", TICKET_TTL_SECONDS);
    return ticket;
  }

  /*
    Step 3. The first point at which a row appears in `users`. User and identity
    are written in one transaction: an account can never exist with no way to
    sign in to it.
  */
  async completeRegistration(
    ticket: string,
    plainPassword: string,
    reply: FastifyReply,
    context: RequestContext,
  ): Promise<SessionUser> {
    // GETDEL: the ticket is single use even if two requests race.
    const email = await this.redis.client.getdel(this.ticketKey(ticket));
    if (!email) {
      throw AppError.unauthenticated("That link has expired. Start again to get a new code.");
    }

    const passwordHash = await hashPassword(plainPassword);

    let user: User;
    try {
      user = await this.prisma.client.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: { email, emailVerifiedAt: new Date(), status: "ACTIVE" },
        });
        await tx.authIdentity.create({
          data: { userId: created.id, provider: "PASSWORD", passwordHash },
        });
        return created;
      });
    } catch (error) {
      // The unique index on email is the authority, not the check in step 1:
      // two sign-ups for the same address can race between them.
      if (isUniqueViolation(error)) {
        throw AppError.conflict("An account already exists for that email address.");
      }
      throw error;
    }

    await this.sessions.issue(user.id, reply, context);
    return toSessionUser(user);
  }

  async login(
    email: string,
    plainPassword: string,
    reply: FastifyReply,
    context: RequestContext,
  ): Promise<SessionUser> {
    // One message for every failure: wrong address, wrong password, closed
    // account. Anything more specific is an account-existence oracle.
    const rejected = AppError.unauthenticated("That email or password is not correct.");

    const user = await this.prisma.client.user.findUnique({
      where: { email },
      include: { identities: { where: { provider: "PASSWORD" } } },
    });
    const identity = user?.identities[0];

    if (!user || !identity?.passwordHash) {
      // Spend the same time as a real verify, so response time does not answer
      // "does this address have an account".
      await burnTimeLikeAVerify();
      throw rejected;
    }

    if (!(await verifyPassword(identity.passwordHash, plainPassword))) throw rejected;
    if (user.status === "CLOSED") throw rejected;

    await this.sessions.issue(user.id, reply, context);
    return toSessionUser(user);
  }

  /*
    Password reset start. Same contract as registration start: identical
    response whether or not the address is known.
  */
  async startPasswordReset(email: string): Promise<void> {
    const user = await this.prisma.client.user.findUnique({ where: { email } });
    if (!user) {
      this.logger.info({ event: "reset.start.unknown" }, "password reset for unknown address");
      return;
    }
    await this.issueCode(email, "PASSWORD_RESET");
  }

  private async issueCode(
    email: string,
    purpose: "EMAIL_VERIFICATION" | "PASSWORD_RESET",
  ): Promise<void> {
    const code = generateVerificationCode();

    await this.prisma.client.$transaction(async (tx) => {
      // Only the newest code is ever live. Issuing a new one retires the rest.
      await tx.verificationToken.updateMany({
        where: { email, purpose, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await tx.verificationToken.create({
        data: {
          email,
          purpose,
          tokenHash: hashToken(code),
          expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000),
        },
      });
    });

    // No mailer yet. Outside production the code is logged so the flow can be
    // walked end to end; in production this logs nothing and the code is
    // unreachable until the email provider is wired up (Phase 1 follow-up).
    if (this.env.NODE_ENV === "production") {
      this.logger.warn(
        { event: "verification.undeliverable", purpose },
        "verification code generated but no email provider is configured",
      );
    } else {
      this.logger.info({ event: "verification.code", purpose, email, code }, "verification code");
    }
  }

  private ticketKey(ticket: string): string {
    // The ticket is hashed here too: Redis should hold no directly usable value.
    return `auth:registration-ticket:${hashToken(ticket)}`;
  }
}

export function toSessionUser(user: User): SessionUser {
  return {
    id: user.id,
    email: user.email,
    status: user.status,
    emailVerified: user.emailVerifiedAt !== null,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
