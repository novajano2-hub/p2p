import {
  depositApproveRequest,
  depositAttributeRequest,
  depositRejectRequest,
  type AdminDepositItem,
  type AdminDepositQueueResponse,
  type DepositApproveRequest,
  type DepositAttributeRequest,
  type DepositRejectRequest,
} from "@abay/contracts";
import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from "@nestjs/common";
import { type FastifyRequest } from "fastify";
import { z } from "zod";

import { RateLimit, minutes, perSession } from "@/common/rate-limit/rate-limit.policy";
import { ZodValidationPipe, zodBody } from "@/common/validation/zod-validation.pipe";
import { type AdminSessionContext } from "@/modules/admin/admin-session.service";
import { AdminGuard, CurrentAdmin, RequireAdminRole } from "@/modules/admin/admin.guard";
import { DepositService } from "@/modules/deposits/deposit.service";

/*
  The rare deposits that need a person: held for review, or arrived at an
  address we could not match to a customer. DEPOSIT_REVIEWER is the role,
  and it is its own role because deciding whose money this is should not
  come bundled with any other power. The ordinary deposit never appears
  here; it credits itself.
*/

const idParam = z.uuid();

const requestContext = (request: FastifyRequest) => ({
  correlationId: request.id,
  ip: request.ip,
});

@Controller("admin/deposits")
@UseGuards(AdminGuard)
@RequireAdminRole("DEPOSIT_REVIEWER")
export class AdminDepositsController {
  constructor(private readonly deposits: DepositService) {}

  @Get("queue")
  queue(): Promise<AdminDepositQueueResponse> {
    return this.deposits.queue();
  }

  @Get(":id")
  @RateLimit(perSession(300, minutes(5)))
  one(@Param("id", new ZodValidationPipe(idParam)) id: string): Promise<AdminDepositItem> {
    return this.deposits.adminItem(id);
  }

  // A decision is a considered act by a person; the limits below are the
  // KYC queue's, for the same reason.
  @Post(":id/approve")
  @HttpCode(200)
  @RateLimit(perSession(60, minutes(5)))
  approve(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @Body(zodBody(depositApproveRequest)) body: DepositApproveRequest,
    @CurrentAdmin() session: AdminSessionContext,
    @Req() request: FastifyRequest,
  ): Promise<AdminDepositItem> {
    return this.deposits.review(
      id,
      "APPROVE",
      body.reason ?? null,
      session,
      requestContext(request),
    );
  }

  @Post(":id/reject")
  @HttpCode(200)
  @RateLimit(perSession(60, minutes(5)))
  reject(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @Body(zodBody(depositRejectRequest)) body: DepositRejectRequest,
    @CurrentAdmin() session: AdminSessionContext,
    @Req() request: FastifyRequest,
  ): Promise<AdminDepositItem> {
    return this.deposits.review(id, "REJECT", body.reason, session, requestContext(request));
  }

  @Post(":id/attribute")
  @HttpCode(200)
  @RateLimit(perSession(60, minutes(5)))
  attribute(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @Body(zodBody(depositAttributeRequest)) body: DepositAttributeRequest,
    @CurrentAdmin() session: AdminSessionContext,
    @Req() request: FastifyRequest,
  ): Promise<AdminDepositItem> {
    return this.deposits.attribute(id, body.userId, body.reason, session, requestContext(request));
  }
}
