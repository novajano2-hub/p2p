import {
  withdrawalApproveRequest,
  withdrawalInvestigationRequest,
  withdrawalRejectRequest,
  type AdminWithdrawalItem,
  type AdminWithdrawalQueueResponse,
  type WithdrawalApproveRequest,
  type WithdrawalInvestigationRequest,
  type WithdrawalRejectRequest,
} from "@abay/contracts";
import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from "@nestjs/common";
import { type FastifyRequest } from "fastify";
import { z } from "zod";

import { RateLimit, minutes, perSession } from "@/common/rate-limit/rate-limit.policy";
import { ZodValidationPipe, zodBody } from "@/common/validation/zod-validation.pipe";
import { type AdminSessionContext } from "@/modules/admin/admin-session.service";
import { AdminGuard, CurrentAdmin, RequireAdminRole } from "@/modules/admin/admin.guard";
import { WithdrawalService } from "@/modules/withdrawals/withdrawal.service";

/*
  The withdrawals that need a person: the ones risk held, and the ones whose
  broadcast outcome nobody can be sure of. WITHDRAWAL_APPROVER is the role,
  and authorising a transfer is deliberately not the same capability as
  reviewing an identity or reading the ledger (ADR-0010, threat model B7.1).

  The ordinary withdrawal never appears here.
*/

const idParam = z.uuid();

const requestContext = (request: FastifyRequest) => ({
  correlationId: request.id,
  ip: request.ip,
});

@Controller("admin/withdrawals")
@UseGuards(AdminGuard)
@RequireAdminRole("WITHDRAWAL_APPROVER")
export class AdminWithdrawalsController {
  constructor(private readonly withdrawals: WithdrawalService) {}

  @Get("queue")
  queue(): Promise<AdminWithdrawalQueueResponse> {
    return this.withdrawals.queue();
  }

  @Get(":id")
  @RateLimit(perSession(300, minutes(5)))
  one(@Param("id", new ZodValidationPipe(idParam)) id: string): Promise<AdminWithdrawalItem> {
    return this.withdrawals.adminItem(id);
  }

  @Post(":id/approve")
  @HttpCode(200)
  @RateLimit(perSession(60, minutes(5)))
  approve(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @Body(zodBody(withdrawalApproveRequest)) body: WithdrawalApproveRequest,
    @CurrentAdmin() session: AdminSessionContext,
    @Req() request: FastifyRequest,
  ): Promise<AdminWithdrawalItem> {
    return this.withdrawals.approve(id, body.reason ?? null, session, requestContext(request));
  }

  @Post(":id/reject")
  @HttpCode(200)
  @RateLimit(perSession(60, minutes(5)))
  reject(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @Body(zodBody(withdrawalRejectRequest)) body: WithdrawalRejectRequest,
    @CurrentAdmin() session: AdminSessionContext,
    @Req() request: FastifyRequest,
  ): Promise<AdminWithdrawalItem> {
    return this.withdrawals.reject(id, body.reason, session, requestContext(request));
  }

  /** Resolving an ambiguous broadcast against the chain (AT-9). */
  @Post(":id/investigation")
  @HttpCode(200)
  @RateLimit(perSession(60, minutes(5)))
  investigation(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @Body(zodBody(withdrawalInvestigationRequest)) body: WithdrawalInvestigationRequest,
    @CurrentAdmin() session: AdminSessionContext,
    @Req() request: FastifyRequest,
  ): Promise<AdminWithdrawalItem> {
    return this.withdrawals.resolveInvestigation(
      id,
      body.outcome,
      body.txHash,
      body.reason,
      session,
      requestContext(request),
    );
  }
}
