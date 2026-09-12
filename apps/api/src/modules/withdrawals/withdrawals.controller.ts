import {
  createWithdrawalRequest,
  type CreateWithdrawalRequest,
  type WithdrawalLimitsResponse,
  type WithdrawalsResponse,
  type WithdrawalView,
} from "@abay/contracts";
import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from "@nestjs/common";
import { type FastifyRequest } from "fastify";
import { z } from "zod";

import { IdempotencyKey } from "@/common/idempotency/idempotency-key.decorator";
import { RateLimit, hours, minutes, perSession } from "@/common/rate-limit/rate-limit.policy";
import { ZodValidationPipe, zodBody } from "@/common/validation/zod-validation.pipe";
import { CurrentSession, SessionGuard } from "@/modules/auth/session.guard";
import { type AuthenticatedSession } from "@/modules/auth/session.service";
import { WithdrawalService } from "@/modules/withdrawals/withdrawal.service";

const idParam = z.uuid();

const requestContext = (request: FastifyRequest) => ({
  correlationId: request.id,
  ip: request.ip,
});

/** A customer's own withdrawals: what they may send, what they sent, and calling one off. */
@Controller("wallet/withdrawals")
@UseGuards(SessionGuard)
export class WithdrawalsController {
  constructor(private readonly withdrawals: WithdrawalService) {}

  @Get("limits")
  limits(@CurrentSession() session: AuthenticatedSession): Promise<WithdrawalLimitsResponse> {
    return this.withdrawals.limits(session.user.id);
  }

  @Get()
  async list(@CurrentSession() session: AuthenticatedSession): Promise<WithdrawalsResponse> {
    return { withdrawals: await this.withdrawals.listForUser(session.user.id) };
  }

  @Get(":id")
  get(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<WithdrawalView> {
    return this.withdrawals.getForUser(session.user.id, id);
  }

  /*
    The request carries an Idempotency-Key (ADR-0007), so a retry after a
    dropped reply is the same withdrawal rather than a second one, and the
    password, because a session cookie alone must not be able to send money
    off the platform.

    Tightly limited, and per hour rather than per five minutes: the honest
    rate is a handful a day, and the password in the body means a loose
    limit here would also be a place to guess passwords.
  */
  @Post()
  @HttpCode(201)
  @RateLimit(perSession(20, hours(1)))
  create(
    @Body(zodBody(createWithdrawalRequest)) body: CreateWithdrawalRequest,
    @IdempotencyKey() key: string,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: FastifyRequest,
  ): Promise<WithdrawalView> {
    return this.withdrawals.request(session.user.id, body, key, requestContext(request));
  }

  @Post(":id/cancel")
  @HttpCode(200)
  @RateLimit(perSession(60, minutes(5)))
  cancel(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: FastifyRequest,
  ): Promise<WithdrawalView> {
    return this.withdrawals.cancel(session.user.id, id, requestContext(request));
  }
}
