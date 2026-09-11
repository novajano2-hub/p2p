import {
  acceptedResponse,
  completedResponse,
  loginRequest,
  loginResendRequest,
  loginVerifyRequest,
  passwordResetCompleteRequest,
  passwordResetRequest,
  passwordResetVerifyRequest,
  registerCompleteRequest,
  registerStartRequest,
  registerVerifyRequest,
  updateProfileRequest,
  type AcceptedResponse,
  type CompletedResponse,
  type LoginRequest,
  type LoginResendRequest,
  type LoginVerifyRequest,
  type PasswordResetCompleteRequest,
  type PasswordResetRequest,
  type PasswordResetVerifyRequest,
  type RegisterCompleteRequest,
  type RegisterStartRequest,
  type RegisterVerifyRequest,
  type SessionResponse,
  type TicketResponse,
  type UpdateProfileRequest,
} from "@abay/contracts";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { type FastifyReply, type FastifyRequest } from "fastify";
import { PinoLogger } from "nestjs-pino";

import {
  RateLimit,
  minutes,
  perEmail,
  perIp,
  perSession,
} from "@/common/rate-limit/rate-limit.policy";
import { zodBody } from "@/common/validation/zod-validation.pipe";
import { AuthService, toSessionUser } from "@/modules/auth/auth.service";
import { GoogleService, GoogleSignInError } from "@/modules/auth/google.service";
import { CurrentSession, SessionGuard } from "@/modules/auth/session.guard";
import { SessionService, type AuthenticatedSession } from "@/modules/auth/session.service";

/*
  The rate limits on this controller, and why they are the numbers they are.

  Every endpoint here is reachable without a session, which makes them the
  whole attack surface for credential stuffing, account enumeration, and using
  somebody else's inbox as a target (threat model B1.5). Each is limited twice
  where it can be: per email address, because that is the account being
  attacked, and per IP, because otherwise an attacker works down a list of
  addresses and never trips a per-address limit.

  The per-address numbers come from what a real person does when things go
  wrong - mistype a password twice, ask for a second code, come back and try
  again - with room to spare and no more. The per-IP numbers are several times
  that, because a household, an office or a phone network is legitimately many
  people behind one address.

  Counted on arrival rather than on failure. Refusing early is most of the
  value: an Argon2 verification is deliberately expensive, and an emailed code
  costs real money to send.
*/
const CREDENTIAL_WINDOW = minutes(15);

const ACCEPTED: AcceptedResponse = acceptedResponse.parse({ status: "accepted" });
const COMPLETED: CompletedResponse = completedResponse.parse({ status: "completed" });

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly google: GoogleService,
    private readonly sessions: SessionService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AuthController.name);
  }

  /* ----------------------------------------------------------------- sign-up */

  /** Step 1 of sign-up. Always 202, so it cannot be used to probe for accounts. */
  @Post("register/start")
  @HttpCode(202)
  // Sends an email, and doubles as the resend: room for a first code plus a
  // few retries, nothing like a mail bomb.
  @RateLimit(perIp(20, CREDENTIAL_WINDOW), perEmail(5, CREDENTIAL_WINDOW))
  async registerStart(
    @Body(zodBody(registerStartRequest)) body: RegisterStartRequest,
  ): Promise<AcceptedResponse> {
    await this.auth.startRegistration(body.email);
    return ACCEPTED;
  }

  /** Step 2. Exchanges the emailed code for a single-use ticket. */
  @Post("register/verify")
  @HttpCode(200)
  // Guessing a six-digit code. The token's own counter already burns it after
  // five wrong tries; this is what stops a run at fresh tokens being free.
  @RateLimit(perIp(30, CREDENTIAL_WINDOW), perEmail(10, CREDENTIAL_WINDOW))
  async registerVerify(
    @Body(zodBody(registerVerifyRequest)) body: RegisterVerifyRequest,
  ): Promise<TicketResponse> {
    return { ticket: await this.auth.verifyRegistration(body.email, body.code) };
  }

  /** Step 3. Creates the account and signs it in. */
  @Post("register/complete")
  @HttpCode(201)
  // Hashes a password with Argon2, so the cost is ours before it is anyone's.
  @RateLimit(perIp(20, CREDENTIAL_WINDOW))
  async registerComplete(
    @Body(zodBody(registerCompleteRequest)) body: RegisterCompleteRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionResponse> {
    const user = await this.auth.completeRegistration(
      body.ticket,
      body.password,
      reply,
      contextOf(request),
    );
    return { user };
  }

  /* ------------------------------------------------------------------ log-in */

  /** Password step. A correct password gets a code in the inbox and a ticket back, not a session. */
  @Post("login")
  @HttpCode(200)
  // The credential-stuffing endpoint. Eight tries per address in a quarter of
  // an hour is more than someone who has forgotten which password they used.
  @RateLimit(perIp(30, CREDENTIAL_WINDOW), perEmail(8, CREDENTIAL_WINDOW))
  async login(@Body(zodBody(loginRequest)) body: LoginRequest): Promise<TicketResponse> {
    return { ticket: await this.auth.login(body.email, body.password) };
  }

  /** Code step. Spends the ticket and issues the session. */
  @Post("login/verify")
  @HttpCode(200)
  // By IP alone: the body carries a ticket, not an address, and keying on the
  // ticket would hand every attempt a counter of its own.
  @RateLimit(perIp(30, CREDENTIAL_WINDOW))
  async loginVerify(
    @Body(zodBody(loginVerifyRequest)) body: LoginVerifyRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionResponse> {
    const user = await this.auth.verifyLogin(body.ticket, body.code, reply, contextOf(request));
    return { user };
  }

  @Post("login/resend")
  @HttpCode(202)
  @RateLimit(perIp(15, CREDENTIAL_WINDOW))
  async loginResend(
    @Body(zodBody(loginResendRequest)) body: LoginResendRequest,
  ): Promise<AcceptedResponse> {
    await this.auth.resendLoginCode(body.ticket);
    return ACCEPTED;
  }

  /*
    Idempotent by design: signing out twice, or without a session, is 204 and
    clears the cookie either way. A client that cannot tell whether it was
    signed in should still be able to get to a signed-out state.
  */
  @Post("logout")
  @HttpCode(204)
  // Loose, but not absent: signing out is a database write either way.
  @RateLimit(perIp(60, CREDENTIAL_WINDOW))
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const session = await this.sessions.resolve(request);
    if (session) await this.sessions.revokeById(session.sessionId, "LOGOUT");
    this.sessions.clearCookie(reply);
  }

  /** Who the cookie belongs to. The client uses this to restore a session on load. */
  @Get("me")
  @UseGuards(SessionGuard)
  me(@CurrentSession() session: AuthenticatedSession): SessionResponse {
    return { user: toSessionUser(session.user) };
  }

  /** The one editable part of the profile today: the username. */
  @Patch("me")
  @UseGuards(SessionGuard)
  @RateLimit(perSession(20, minutes(60)))
  async updateMe(
    @Body(zodBody(updateProfileRequest)) body: UpdateProfileRequest,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<SessionResponse> {
    return { user: await this.auth.updateUsername(session.user.id, body.username) };
  }

  /* -------------------------------------------------------- password reset */

  /** Start a password reset. Always 202, for the same reason as register/start. */
  @Post("password-reset")
  @HttpCode(202)
  // The tightest per-address limit here, because somebody else's inbox is the
  // target: four reset emails in a quarter of an hour is already generous.
  @RateLimit(perIp(15, CREDENTIAL_WINDOW), perEmail(4, CREDENTIAL_WINDOW))
  async passwordReset(
    @Body(zodBody(passwordResetRequest)) body: PasswordResetRequest,
  ): Promise<AcceptedResponse> {
    await this.auth.startPasswordReset(body.email);
    return ACCEPTED;
  }

  @Post("password-reset/verify")
  @HttpCode(200)
  @RateLimit(perIp(30, CREDENTIAL_WINDOW), perEmail(10, CREDENTIAL_WINDOW))
  async passwordResetVerify(
    @Body(zodBody(passwordResetVerifyRequest)) body: PasswordResetVerifyRequest,
  ): Promise<TicketResponse> {
    return { ticket: await this.auth.verifyPasswordReset(body.email, body.code) };
  }

  /** Sets the new password and signs the account out everywhere. No session: log in again. */
  @Post("password-reset/complete")
  @HttpCode(200)
  @RateLimit(perIp(20, CREDENTIAL_WINDOW))
  async passwordResetComplete(
    @Body(zodBody(passwordResetCompleteRequest)) body: PasswordResetCompleteRequest,
  ): Promise<CompletedResponse> {
    await this.auth.completePasswordReset(body.ticket, body.password);
    return COMPLETED;
  }

  /* ------------------------------------------------------------------ google */

  /*
    Both Google routes answer with a redirect, never with JSON: the browser is
    on a top-level navigation, and a person looking at a JSON error page has
    nowhere to go. Failures become ?error=google_<reason> on the log-in page.
  */
  @Get("google/start")
  /*
    Both Google routes answer a top-level navigation, so a refusal here reaches
    a person as a JSON page rather than the redirect the rest of this pair is
    careful to give them. The limits are set high enough that only abuse gets
    there, and they are not left off: the callback exchanges a code with Google
    over the network and writes to the database, which is far too expensive to
    leave uncounted.
  */
  @RateLimit(perIp(60, CREDENTIAL_WINDOW))
  async googleStart(@Res() reply: FastifyReply): Promise<void> {
    try {
      await reply.redirect(await this.google.start(), 302);
    } catch (error) {
      await reply.redirect(this.google.failureUrl(this.reasonOf(error)), 302);
    }
  }

  @Get("google/callback")
  @RateLimit(perIp(60, CREDENTIAL_WINDOW))
  async googleCallback(
    @Query() query: Record<string, unknown>,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    try {
      await this.google.complete(query, reply, contextOf(request));
      await reply.redirect(this.google.successUrl(), 302);
    } catch (error) {
      await reply.redirect(this.google.failureUrl(this.reasonOf(error)), 302);
    }
  }

  private reasonOf(error: unknown) {
    if (error instanceof GoogleSignInError) return error.reason;
    // Anything else is ours, not Google's, and needs a stack trace in the log.
    this.logger.error({ err: error, event: "google.unexpected" }, "google sign-in failed");
    return "failed" as const;
  }
}

function contextOf(request: FastifyRequest) {
  return { ip: request.ip, userAgent: request.headers["user-agent"] };
}
