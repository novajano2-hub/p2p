import {
  acceptedResponse,
  loginRequest,
  passwordResetRequest,
  registerCompleteRequest,
  registerStartRequest,
  registerVerifyRequest,
  type AcceptedResponse,
  type LoginRequest,
  type PasswordResetRequest,
  type RegisterCompleteRequest,
  type RegisterStartRequest,
  type RegisterVerifyRequest,
  type RegisterVerifyResponse,
  type SessionResponse,
} from "@abay/contracts";
import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from "@nestjs/common";
import { type FastifyReply, type FastifyRequest } from "fastify";

import { zodBody } from "@/common/validation/zod-validation.pipe";
import { AuthService, toSessionUser } from "@/modules/auth/auth.service";
import { CurrentSession, SessionGuard } from "@/modules/auth/session.guard";
import { SessionService, type AuthenticatedSession } from "@/modules/auth/session.service";

const ACCEPTED: AcceptedResponse = acceptedResponse.parse({ status: "accepted" });

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

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
  ): Promise<RegisterVerifyResponse> {
    const ticket = await this.auth.verifyRegistration(body.email, body.code);
    return { ticket };
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

  @Post("login")
  @HttpCode(200)
  async login(
    @Body(zodBody(loginRequest)) body: LoginRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionResponse> {
    const user = await this.auth.login(body.email, body.password, reply, contextOf(request));
    return { user };
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

  /** Start a password reset. Always 202, for the same reason as register/start. */
  @Post("password-reset")
  @HttpCode(202)
  async passwordReset(
    @Body(zodBody(passwordResetRequest)) body: PasswordResetRequest,
  ): Promise<AcceptedResponse> {
    await this.auth.startPasswordReset(body.email);
    return ACCEPTED;
  }
}

function contextOf(request: FastifyRequest) {
  return { ip: request.ip, userAgent: request.headers["user-agent"] };
}
