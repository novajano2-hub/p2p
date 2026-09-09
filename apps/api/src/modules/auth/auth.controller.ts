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

import { zodBody } from "@/common/validation/zod-validation.pipe";
import { AuthService, toSessionUser } from "@/modules/auth/auth.service";
import { GoogleService, GoogleSignInError } from "@/modules/auth/google.service";
import { CurrentSession, SessionGuard } from "@/modules/auth/session.guard";
import { SessionService, type AuthenticatedSession } from "@/modules/auth/session.service";

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
  async registerStart(
    @Body(zodBody(registerStartRequest)) body: RegisterStartRequest,
  ): Promise<AcceptedResponse> {
    await this.auth.startRegistration(body.email);
    return ACCEPTED;
  }

  /** Step 2. Exchanges the emailed code for a single-use ticket. */
  @Post("register/verify")
  @HttpCode(200)
  async registerVerify(
    @Body(zodBody(registerVerifyRequest)) body: RegisterVerifyRequest,
  ): Promise<TicketResponse> {
    return { ticket: await this.auth.verifyRegistration(body.email, body.code) };
  }

  /** Step 3. Creates the account and signs it in. */
  @Post("register/complete")
  @HttpCode(201)
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
  async login(@Body(zodBody(loginRequest)) body: LoginRequest): Promise<TicketResponse> {
    return { ticket: await this.auth.login(body.email, body.password) };
  }

  /** Code step. Spends the ticket and issues the session. */
  @Post("login/verify")
  @HttpCode(200)
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
  async passwordReset(
    @Body(zodBody(passwordResetRequest)) body: PasswordResetRequest,
  ): Promise<AcceptedResponse> {
    await this.auth.startPasswordReset(body.email);
    return ACCEPTED;
  }

  @Post("password-reset/verify")
  @HttpCode(200)
  async passwordResetVerify(
    @Body(zodBody(passwordResetVerifyRequest)) body: PasswordResetVerifyRequest,
  ): Promise<TicketResponse> {
    return { ticket: await this.auth.verifyPasswordReset(body.email, body.code) };
  }

  /** Sets the new password and signs the account out everywhere. No session: log in again. */
  @Post("password-reset/complete")
  @HttpCode(200)
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
  async googleStart(@Res() reply: FastifyReply): Promise<void> {
    try {
      await reply.redirect(await this.google.start(), 302);
    } catch (error) {
      await reply.redirect(this.google.failureUrl(this.reasonOf(error)), 302);
    }
  }

  @Get("google/callback")
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
