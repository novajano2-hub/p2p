import {
  disputeEvidenceQuery,
  openDisputeRequest,
  type DisputeEvidenceQuery,
  type DisputeEvidenceView,
  type DisputeView,
  type OpenDisputeRequest,
} from "@abay/contracts";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";

import { AppError } from "@/common/errors/app-error";
import { RateLimit, hours, minutes, perSession } from "@/common/rate-limit/rate-limit.policy";
import { ZodValidationPipe, zodBody, zodQuery } from "@/common/validation/zod-validation.pipe";
import { CurrentSession, SessionGuard } from "@/modules/auth/session.guard";
import { type AuthenticatedSession } from "@/modules/auth/session.service";
import { DisputeService } from "@/modules/disputes/dispute.service";

const idParam = z.uuid();

const requestContext = (request: FastifyRequest) => ({
  correlationId: request.id,
  ip: request.ip,
});

/**
 * A dispute, from inside the trade it is about. Every route is one of the
 * parties' own; a trade they are not party to has no dispute as far as they
 * can tell (AT-6).
 */
@Controller("trades/:tradeId/dispute")
@UseGuards(SessionGuard)
export class DisputesController {
  constructor(private readonly disputes: DisputeService) {}

  @Get()
  one(
    @Param("tradeId", new ZodValidationPipe(idParam)) tradeId: string,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<DisputeView> {
    return this.disputes.viewFor(session.user.id, tradeId);
  }

  /** Asking a person to look. Either party, once the payment has had time to arrive. */
  @Post()
  @HttpCode(201)
  @RateLimit(perSession(10, hours(1)))
  open(
    @Param("tradeId", new ZodValidationPipe(idParam)) tradeId: string,
    @Body(zodBody(openDisputeRequest)) body: OpenDisputeRequest,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: FastifyRequest,
  ): Promise<DisputeView> {
    return this.disputes.open(session.user.id, tradeId, body, requestContext(request));
  }

  /** Taking it back. The party who opened it, only. */
  @Post("withdraw")
  @HttpCode(200)
  @RateLimit(perSession(10, hours(1)))
  withdraw(
    @Param("tradeId", new ZodValidationPipe(idParam)) tradeId: string,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: FastifyRequest,
  ): Promise<DisputeView> {
    return this.disputes.withdraw(session.user.id, tradeId, requestContext(request));
  }

  /*
    A screenshot, as the raw bytes under its own content type (the parsers
    the identity documents and the chat use). The caption travels as a
    query parameter, since there is no JSON body to carry it.
  */
  @Post("evidence")
  @HttpCode(201)
  @RateLimit(perSession(30, hours(1)))
  evidence(
    @Param("tradeId", new ZodValidationPipe(idParam)) tradeId: string,
    @Query(zodQuery(disputeEvidenceQuery)) query: DisputeEvidenceQuery,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: FastifyRequest,
  ): Promise<DisputeEvidenceView> {
    if (!Buffer.isBuffer(body)) {
      throw AppError.validation(
        [{ path: "file", message: "Send the image itself as the request body." }],
        "Send the image as a JPEG, PNG or WebP.",
      );
    }
    return this.disputes.addEvidence(
      session.user.id,
      tradeId,
      body,
      query.note ?? null,
      requestContext(request),
    );
  }

  @Get("evidence/:evidenceId")
  @RateLimit(perSession(240, minutes(5)))
  async evidenceBytes(
    @Param("tradeId", new ZodValidationPipe(idParam)) tradeId: string,
    @Param("evidenceId", new ZodValidationPipe(idParam)) evidenceId: string,
    @CurrentSession() session: AuthenticatedSession,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const found = await this.disputes.evidence(session.user.id, tradeId, evidenceId);
    if (!found) throw AppError.notFound("That file is not available.");
    await reply.type(found.contentType).send(found.body);
  }
}
