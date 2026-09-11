import {
  adminLoginRequest,
  adminMfaConfirmRequest,
  kycRejectRequest,
  type AdminLoginRequest,
  type AdminMfaConfirmRequest,
  type AdminMfaSetupResponse,
  type AdminSessionResponse,
  type KycQueueResponse,
  type KycRejectRequest,
  type KycReviewItem,
} from "@abay/contracts";
import { Body, Controller, Get, HttpCode, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";

import { AppError } from "@/common/errors/app-error";
import {
  RateLimit,
  minutes,
  perEmail,
  perIp,
  perSession,
} from "@/common/rate-limit/rate-limit.policy";
import { ZodValidationPipe, zodBody } from "@/common/validation/zod-validation.pipe";
import { AdminAuthService, toIdentity } from "@/modules/admin/admin-auth.service";
import { AdminKycService } from "@/modules/admin/admin-kyc.service";
import { AdminMfaService } from "@/modules/admin/admin-mfa.service";
import { type AdminSessionContext } from "@/modules/admin/admin-session.service";
import {
  AdminGuard,
  AllowWithoutMfa,
  CurrentAdmin,
  RequireAdminRole,
} from "@/modules/admin/admin.guard";

/*
  Everything an administrator can do, under its own prefix.

  Nothing here is reachable with a customer's session, and nothing under /v1
  is reachable with an administrator's: the two realms share no cookie and no
  table, so there is no privilege to escalate from one to the other.
*/

const idParam = z.uuid();

const requestContext = (request: FastifyRequest) => ({
  correlationId: request.id,
  ip: request.ip,
  userAgent: request.headers["user-agent"],
});

@Controller("admin")
export class AdminAuthController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly mfa: AdminMfaService,
  ) {}

  /*
    Deliberately not behind the guard: this is how a session begins. It is
    also the loudest thing in the audit log, because a failed attempt against
    a named administrator is the signal worth watching.
  */
  @Post("auth/login")
  @HttpCode(200)
  /*
    The tightest limit in the application, and the one that matters most.

    This is the single door into the admin realm, it answers to a password
    alone until MFA lands, and docs/open-questions.md Q2a names a limit here by
    name as part of the defence-in-depth that goes with putting the realm
    behind an edge gate. Administrators are a handful of named people who know
    their own password: five attempts per account in a quarter of an hour is
    generous for them and useless to anybody else.
  */
  @RateLimit(perIp(10, minutes(15)), perEmail(5, minutes(15)))
  async login(
    @Body(zodBody(adminLoginRequest)) body: AdminLoginRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AdminSessionResponse> {
    const admin = await this.auth.login(
      body.email,
      body.password,
      body.code,
      reply,
      requestContext(request),
    );
    return { admin };
  }

  @Post("auth/logout")
  @HttpCode(204)
  @UseGuards(AdminGuard)
  @AllowWithoutMfa()
  @RateLimit(perSession(30, minutes(15)))
  async logout(
    @CurrentAdmin() session: AdminSessionContext,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.auth.logout(session.sessionId, reply);
  }

  @Get("auth/me")
  @UseGuards(AdminGuard)
  @AllowWithoutMfa()
  me(@CurrentAdmin() session: AdminSessionContext): AdminSessionResponse {
    return { admin: toIdentity(session.admin) };
  }

  /* ------------------------------------------------------------------- mfa */

  /*
    Enrollment, reachable before enrollment is done - these two routes and
    the pair above are the whole of what an un-enrolled session can touch.
    Both still sit behind the guard: a session, its CSRF token, and its rate
    limits all apply as everywhere else.
  */

  @Post("auth/mfa/setup")
  @HttpCode(200)
  @UseGuards(AdminGuard)
  @AllowWithoutMfa()
  // A handful of QR codes is a person changing phones; a stream is a script.
  @RateLimit(perSession(10, minutes(15)))
  mfaSetup(@CurrentAdmin() session: AdminSessionContext): Promise<AdminMfaSetupResponse> {
    return this.mfa.setup(session);
  }

  @Post("auth/mfa/confirm")
  @HttpCode(200)
  @UseGuards(AdminGuard)
  @AllowWithoutMfa()
  // Six digits against one staged secret: ten tries dwarfs any honest fumble
  // and starves a guesser, who needs a million.
  @RateLimit(perSession(10, minutes(15)))
  async mfaConfirm(
    @Body(zodBody(adminMfaConfirmRequest)) body: AdminMfaConfirmRequest,
    @CurrentAdmin() session: AdminSessionContext,
    @Req() request: FastifyRequest,
  ): Promise<AdminSessionResponse> {
    const admin = await this.mfa.confirm(session, body.code, requestContext(request));
    return { admin: toIdentity(admin) };
  }
}

@Controller("admin/kyc")
@UseGuards(AdminGuard)
// Every route below reads or decides somebody's identity documents, so every
// route below needs the capability to do that. Being an administrator is not
// enough on its own.
@RequireAdminRole("KYC_REVIEWER")
export class AdminKycController {
  constructor(private readonly kyc: AdminKycService) {}

  @Get("queue")
  queue(): Promise<KycQueueResponse> {
    return this.kyc.queue();
  }

  @Get("submissions/:id")
  /*
    Opening a submission writes an audit event, and both of these move bytes or
    rows on every call. The numbers are set for a person working a queue -
    flicking between three photographs on submission after submission - not for
    a script walking the table.
  */
  @RateLimit(perSession(300, minutes(5)))
  open(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @CurrentAdmin() session: AdminSessionContext,
    @Req() request: FastifyRequest,
  ): Promise<KycReviewItem> {
    return this.kyc.open(id, session, requestContext(request));
  }

  /** The photograph itself. Streamed through the API; the store's keys never leave it. */
  @Get("submissions/:id/documents/:documentId")
  @RateLimit(perSession(300, minutes(5)))
  async document(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @Param("documentId", new ZodValidationPipe(idParam)) documentId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const found = await this.kyc.document(id, documentId);
    if (!found) throw AppError.notFound("That document is not available.");
    await reply.type(found.contentType).send(found.body);
  }

  /** Nothing to validate in the body: approving asks nothing of the administrator. */
  @Post("submissions/:id/approve")
  @HttpCode(200)
  // A decision is a considered act by a person. Sixty in five minutes is far
  // more than anyone reviews properly, and far less than a script would want.
  @RateLimit(perSession(60, minutes(5)))
  approve(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @CurrentAdmin() session: AdminSessionContext,
    @Req() request: FastifyRequest,
  ): Promise<KycReviewItem> {
    return this.kyc.approve(id, session, requestContext(request));
  }

  @Post("submissions/:id/reject")
  @HttpCode(200)
  @RateLimit(perSession(60, minutes(5)))
  reject(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @Body(zodBody(kycRejectRequest)) body: KycRejectRequest,
    @CurrentAdmin() session: AdminSessionContext,
    @Req() request: FastifyRequest,
  ): Promise<KycReviewItem> {
    return this.kyc.reject(id, body.reason, session, requestContext(request));
  }
}
