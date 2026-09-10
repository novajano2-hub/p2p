import { type SessionUser } from "@abay/contracts";
import { type User, type VerificationPurpose } from "@abay/database";
import { Inject, Injectable } from "@nestjs/common";
import { type FastifyReply } from "fastify";
import { PinoLogger } from "nestjs-pino";

import { AppError } from "@/common/errors/app-error";
import { ENV } from "@/config/config.module";
import { type Env } from "@/config/env";
import { MAILER, type Mailer } from "@/infra/mail/mailer";
import { PrismaService } from "@/infra/prisma/prisma.service";
import { RedisService } from "@/infra/redis/redis.service";
import { codeEmail } from "@/modules/auth/emails";
import {
  generatePlatformId,
  placeholderUsername,
  uniqueViolationTargets,
  usernameKey,
} from "@/modules/auth/platform-id";
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

/** Draws of the eight-digit account number before giving up. One is nearly always enough. */
const ID_ATTEMPTS = 5;

/** A six-digit code is a million guesses. Burn the code well before that. */
const MAX_CODE_ATTEMPTS = 5;
const CODE_TTL_MINUTES = 30;

/*
  Tickets: proof that a step was passed, held in Redis rather than the
  database because they are disposable, expire on their own, and losing one
  costs a re-verification rather than an account. Each kind has its own
  namespace so a ticket from one flow can never be spent in another.
*/
type TicketKind = "registration" | "login" | "reset";
const TICKET_TTL_SECONDS: Record<TicketKind, number> = {
  /** Long enough to choose a password, short enough that a leaked ticket is stale fast. */
  registration: 15 * 60,
  /** The code arrives in seconds; ten minutes covers a slow inbox. */
  login: 10 * 60,
  reset: 15 * 60,
};

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
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.logger.setContext(AuthService.name);
  }

  /* ----------------------------------------------------------------- sign-up */

  /*
    Step 1. An address that already has an account is told so and sent to log
    in, the way Binance does it (owner decision, 2026-09-09).

    That is a deliberate trade, and worth naming: this endpoint now answers
    "is this address registered", which is exactly the account-enumeration
    oracle the rest of the flows are shaped to deny. It is confined to here.
    Log-in still answers wrong-password, unknown-address and closed-account
    identically, and password reset still replies the same way whether or not
    the address is known.

    Nothing is sent to the address either way: a returning customer gets the
    answer in the response, not an unrequested code in their inbox.
  */
  async startRegistration(email: string): Promise<void> {
    const existing = await this.prisma.client.user.findUnique({ where: { email } });
    if (existing) {
      this.logger.info(
        { event: "register.start.existing" },
        "registration start for known address",
      );
      throw AppError.conflict("An account already exists for this email address.");
    }
    await this.issueCode(email, "EMAIL_VERIFICATION");
  }

  /*
    Step 2. Proves control of the inbox. On success the code is consumed and
    replaced by a ticket, so the code cannot be replayed and the password step
    cannot be reached without having held the code.
  */
  async verifyRegistration(email: string, code: string): Promise<string> {
    await this.redeemCode(email, "EMAIL_VERIFICATION", code);
    return this.issueTicket("registration", { email });
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
    const claim = await this.takeTicket("registration", ticket);
    if (!claim) {
      throw AppError.unauthenticated("That sign-up has expired. Start again to get a new code.");
    }

    const passwordHash = await hashPassword(plainPassword);

    let user: User | undefined;
    for (let attempt = 1; user === undefined; attempt++) {
      const platformId = generatePlatformId();
      const username = placeholderUsername(platformId);
      try {
        user = await this.prisma.client.$transaction(async (tx) => {
          const created = await tx.user.create({
            data: {
              email: claim.email,
              emailVerifiedAt: new Date(),
              status: "ACTIVE",
              platformId,
              username,
              usernameKey: usernameKey(username),
            },
          });
          await tx.authIdentity.create({
            data: { userId: created.id, provider: "PASSWORD", passwordHash },
          });
          return created;
        });
      } catch (error) {
        // The unique index on email is the authority, not the check in step 1:
        // two sign-ups for the same address can race between them.
        if (uniqueViolationTargets(error, "email")) {
          throw AppError.conflict("An account already exists for that email address.");
        }
        // Someone already holds the number just drawn. Draw again.
        if (uniqueViolationTargets(error, "platform", "username") && attempt < ID_ATTEMPTS) {
          continue;
        }
        throw error;
      }
    }

    await this.sessions.issue(user.id, reply, context);
    return toSessionUser(user);
  }

  /* ------------------------------------------------------------------ log-in */

  /*
    Step 1: the password. Correct means a code goes to the inbox and a ticket
    comes back; no session yet. The password proves the secret is known, the
    code proves the inbox is still held, and a stolen password alone gets
    nobody in.
  */
  async login(email: string, plainPassword: string): Promise<string> {
    // One message for every failure: wrong address, wrong password, closed
    // account, Google-only account. Anything more specific is an oracle.
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

    await this.issueCode(email, "LOGIN");
    return this.issueTicket("login", { email, userId: user.id });
  }

  /** Step 2: the code. Spends the ticket and issues the session. */
  async verifyLogin(
    ticket: string,
    code: string,
    reply: FastifyReply,
    context: RequestContext,
  ): Promise<SessionUser> {
    // Peek, not take: a wrong code must not end the attempt. The code's own
    // attempt counter is what stops guessing.
    const claim = await this.peekTicket("login", ticket);
    if (!claim?.userId) throw AppError.unauthenticated("That sign-in has expired. Start again.");

    await this.redeemCode(claim.email, "LOGIN", code);
    await this.takeTicket("login", ticket);

    const user = await this.prisma.client.user.findUnique({ where: { id: claim.userId } });
    if (!user || user.status === "CLOSED") {
      throw AppError.unauthenticated("That sign-in has expired. Start again.");
    }

    await this.sessions.issue(user.id, reply, context);
    return toSessionUser(user);
  }

  async resendLoginCode(ticket: string): Promise<void> {
    const claim = await this.peekTicket("login", ticket);
    if (!claim) throw AppError.unauthenticated("That sign-in has expired. Start again.");
    await this.issueCode(claim.email, "LOGIN");
  }

  /* -------------------------------------------------------- password reset */

  /*
    Step 1. Same contract as registration start: identical response whether
    or not the address is known.
  */
  async startPasswordReset(email: string): Promise<void> {
    const user = await this.prisma.client.user.findUnique({ where: { email } });
    if (!user) {
      this.logger.info({ event: "reset.start.unknown" }, "password reset for unknown address");
      return;
    }
    await this.issueCode(email, "PASSWORD_RESET");
  }

  /** Step 2. The code proves the inbox; the ticket carries that proof to step 3. */
  async verifyPasswordReset(email: string, code: string): Promise<string> {
    await this.redeemCode(email, "PASSWORD_RESET", code);
    return this.issueTicket("reset", { email });
  }

  /*
    Step 3. Sets the new password and ends every session the account has.
    "Someone changed my password" must mean "and whoever was signed in is
    now signed out", or the reset does not actually recover the account.
  */
  async completePasswordReset(ticket: string, plainPassword: string): Promise<void> {
    const claim = await this.takeTicket("reset", ticket);
    if (!claim) {
      throw AppError.unauthenticated("That reset has expired. Start again to get a new code.");
    }

    const user = await this.prisma.client.user.findUnique({ where: { email: claim.email } });
    if (!user)
      throw AppError.unauthenticated("That reset has expired. Start again to get a new code.");

    const passwordHash = await hashPassword(plainPassword);
    const now = new Date();
    await this.prisma.client.$transaction(async (tx) => {
      // Upsert rather than update: an account that only ever used Google can
      // recover into having a password, and that is the intended way to get one.
      await tx.authIdentity.upsert({
        where: { userId_provider: { userId: user.id, provider: "PASSWORD" } },
        create: { userId: user.id, provider: "PASSWORD", passwordHash, passwordChangedAt: now },
        update: { passwordHash, passwordChangedAt: now },
      });
      await tx.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now, revokedReason: "PASSWORD_CHANGED" },
      });
    });

    this.logger.info({ event: "reset.completed", userId: user.id }, "password reset completed");
  }

  /* ---------------------------------------------------------------- profile */

  /** Changes the username. Unique case-insensitively: "Sam" and "sam" are one name. */
  async updateUsername(userId: string, username: string): Promise<SessionUser> {
    try {
      const user = await this.prisma.client.user.update({
        where: { id: userId },
        data: { username, usernameKey: usernameKey(username) },
      });
      return toSessionUser(user);
    } catch (error) {
      if (uniqueViolationTargets(error, "username")) {
        throw AppError.conflict("That username is taken. Try another.");
      }
      throw error;
    }
  }

  /* ------------------------------------------------------------- internals */

  /*
    Issues a fresh code for the address and sends it. Only the newest code is
    ever live; issuing a new one retires the rest. A delivery failure is
    surfaced as 503 rather than swallowed: a person told "check your inbox"
    when nothing was sent will wait for something that never comes.
  */
  private async issueCode(email: string, purpose: VerificationPurpose): Promise<void> {
    const code = generateVerificationCode();

    await this.prisma.client.$transaction(async (tx) => {
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

    try {
      await this.mailer.send(
        codeEmail({
          to: email,
          purpose,
          code,
          appName: this.env.APP_NAME,
          validForMinutes: CODE_TTL_MINUTES,
        }),
      );
    } catch (error) {
      this.logger.error(
        { err: error, event: "verification.undeliverable", purpose },
        "code not sent",
      );
      throw AppError.notReady(
        "We could not send the email right now. Please try again in a moment.",
      );
    }
  }

  /*
    Checks a code against the newest live token for the address and purpose,
    counting the attempt and burning the token past the limit. Every failure
    is the same error: a wrong code, an expired code, a burnt code and a code
    that was never issued are indistinguishable from outside.
  */
  private async redeemCode(email: string, purpose: VerificationPurpose, code: string) {
    const invalid = AppError.unauthenticated("That code is not valid or has expired.");

    const token = await this.prisma.client.verificationToken.findFirst({
      where: { email, purpose, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });
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
  }

  private async issueTicket(kind: TicketKind, claim: TicketClaim): Promise<string> {
    const ticket = generateToken();
    await this.redis.client.set(
      this.ticketKey(kind, ticket),
      JSON.stringify(claim),
      "EX",
      TICKET_TTL_SECONDS[kind],
    );
    return ticket;
  }

  private async peekTicket(kind: TicketKind, ticket: string): Promise<TicketClaim | null> {
    const raw = await this.redis.client.get(this.ticketKey(kind, ticket));
    return raw ? (JSON.parse(raw) as TicketClaim) : null;
  }

  /** GETDEL: single use even if two requests race. */
  private async takeTicket(kind: TicketKind, ticket: string): Promise<TicketClaim | null> {
    const raw = await this.redis.client.getdel(this.ticketKey(kind, ticket));
    return raw ? (JSON.parse(raw) as TicketClaim) : null;
  }

  private ticketKey(kind: TicketKind, ticket: string): string {
    // Hashed here too: Redis should hold no directly usable value.
    return `auth:ticket:${kind}:${hashToken(ticket)}`;
  }
}

/** What a ticket stands for. The address always; the user only once one exists. */
interface TicketClaim {
  email: string;
  userId?: string;
}

export function toSessionUser(user: User): SessionUser {
  return {
    id: user.id,
    email: user.email,
    platformId: user.platformId,
    username: user.username,
    status: user.status,
    emailVerified: user.emailVerifiedAt !== null,
    kycStatus: user.kycStatus,
  };
}
