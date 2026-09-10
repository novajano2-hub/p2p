import {
  adminLoginRequest,
  kycApproveRequest,
  kycRejectRequest,
  type AdminLoginRequest,
  type AdminSessionResponse,
  type KycApproveRequest,
  type KycQueueResponse,
  type KycRejectRequest,
  type KycReviewItem,
} from "@abay/contracts";
import { Body, Controller, Get, HttpCode, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";

import { AppError } from "@/common/errors/app-error";
import { ZodValidationPipe, zodBody } from "@/common/validation/zod-validation.pipe";
import { AdminAuthService, toIdentity } from "@/modules/admin/admin-auth.service";
import { AdminKycService } from "@/modules/admin/admin-kyc.service";
import { type AdminSessionContext } from "@/modules/admin/admin-session.service";
import { AdminGuard, CurrentAdmin, RequireAdminRole } from "@/modules/admin/admin.guard";

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
  constructor(private readonly auth: AdminAuthService) {}

  /*
    Deliberately not behind the guard: this is how a session begins. It is
    also the loudest thing in the audit log, because a failed attempt against
    a named administrator is the signal worth watching.
  */
  @Post("auth/login")
  @HttpCode(200)
  async login(
    @Body(zodBody(adminLoginRequest)) body: AdminLoginRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AdminSessionResponse> {
    const admin = await this.auth.login(body.email, body.password, reply, requestContext(request));
    return { admin };
  }

  @Post("auth/logout")
  @HttpCode(204)
  @UseGuards(AdminGuard)
  async logout(
    @CurrentAdmin() session: AdminSessionContext,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.auth.logout(session.sessionId, reply);
  }

  @Get("auth/me")
  @UseGuards(AdminGuard)
  me(@CurrentAdmin() session: AdminSessionContext): AdminSessionResponse {
    return { admin: toIdentity(session.admin) };
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
  open(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @CurrentAdmin() session: AdminSessionContext,
    @Req() request: FastifyRequest,
  ): Promise<KycReviewItem> {
    return this.kyc.open(id, session, requestContext(request));
  }

  /** The photograph itself. Streamed through the API; the store's keys never leave it. */
  @Get("submissions/:id/documents/:documentId")
  async document(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @Param("documentId", new ZodValidationPipe(idParam)) documentId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const found = await this.kyc.document(id, documentId);
    if (!found) throw AppError.notFound("That document is not available.");
    await reply.type(found.contentType).send(found.body);
  }

  @Post("submissions/:id/approve")
  @HttpCode(200)
  approve(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @Body(zodBody(kycApproveRequest)) body: KycApproveRequest,
    @CurrentAdmin() session: AdminSessionContext,
    @Req() request: FastifyRequest,
  ): Promise<KycReviewItem> {
    return this.kyc.approve(id, body.note, session, requestContext(request));
  }

  @Post("submissions/:id/reject")
  @HttpCode(200)
  reject(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @Body(zodBody(kycRejectRequest)) body: KycRejectRequest,
    @CurrentAdmin() session: AdminSessionContext,
    @Req() request: FastifyRequest,
  ): Promise<KycReviewItem> {
    return this.kyc.reject(id, body.reason, session, requestContext(request));
  }
}
