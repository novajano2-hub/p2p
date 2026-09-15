import {
  resolveDisputeRequest,
  type AdminDisputeDetail,
  type AdminDisputeItem,
  type AdminDisputeQueueResponse,
  type ResolveDisputeRequest,
} from "@abay/contracts";
import { Body, Controller, Get, HttpCode, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";

import { AppError } from "@/common/errors/app-error";
import { RateLimit, minutes, perSession } from "@/common/rate-limit/rate-limit.policy";
import { ZodValidationPipe, zodBody } from "@/common/validation/zod-validation.pipe";
import { type AdminSessionContext } from "@/modules/admin/admin-session.service";
import { AdminGuard, CurrentAdmin, RequireAdminRole } from "@/modules/admin/admin.guard";
import { DisputeService } from "@/modules/disputes/dispute.service";

/*
  The disputes that need a person. DISPUTE_RESOLVER is the role, and
  deciding who gets the escrow is deliberately not the same capability as
  approving a withdrawal or posting a correction (threat model B7.1). A
  resolver cannot be a party to the trade: administrators are a separate
  realm with no customer account at all.

  Reading a dispute is audited, because it shows where the buyer was told
  to pay (B7.5). Deciding one needs a note, which both parties receive.
*/

const idParam = z.uuid();

const requestContext = (request: FastifyRequest) => ({
  correlationId: request.id,
  ip: request.ip,
});

@Controller("admin/disputes")
@UseGuards(AdminGuard)
@RequireAdminRole("DISPUTE_RESOLVER")
export class AdminDisputesController {
  constructor(private readonly disputes: DisputeService) {}

  @Get()
  queue(): Promise<AdminDisputeQueueResponse> {
    return this.disputes.queue();
  }

  @Get(":id")
  @RateLimit(perSession(300, minutes(5)))
  one(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @CurrentAdmin() session: AdminSessionContext,
    @Req() request: FastifyRequest,
  ): Promise<AdminDisputeDetail> {
    return this.disputes.detail(id, session, requestContext(request));
  }

  @Get(":id/evidence/:evidenceId")
  @RateLimit(perSession(600, minutes(5)))
  async evidence(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @Param("evidenceId", new ZodValidationPipe(idParam)) evidenceId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const found = await this.disputes.adminEvidence(id, evidenceId);
    if (!found) throw AppError.notFound("That file is not available.");
    await reply.type(found.contentType).send(found.body);
  }

  /** An image from the trade's chat, which the transcript in the detail names by message id. */
  @Get(":id/messages/:messageId/image")
  @RateLimit(perSession(600, minutes(5)))
  async chatImage(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @Param("messageId", new ZodValidationPipe(idParam)) messageId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const found = await this.disputes.adminChatImage(id, messageId);
    if (!found) throw AppError.notFound("That image is not available.");
    await reply.type(found.contentType).send(found.body);
  }

  @Post(":id/resolve")
  @HttpCode(200)
  @RateLimit(perSession(60, minutes(5)))
  resolve(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @Body(zodBody(resolveDisputeRequest)) body: ResolveDisputeRequest,
    @CurrentAdmin() session: AdminSessionContext,
    @Req() request: FastifyRequest,
  ): Promise<AdminDisputeItem> {
    return this.disputes.resolve(id, body, session, requestContext(request));
  }
}
