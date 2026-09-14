import {
  cancelTradeRequest,
  createTradeRequest,
  markPaidRequest,
  releaseTradeRequest,
  tradesQuery,
  type CancelTradeRequest,
  type CreateTradeRequest,
  type MarkPaidRequest,
  type ReleaseTradeRequest,
  type TradeEventsResponse,
  type TradesQuery,
  type TradesResponse,
  type TradeView,
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
  UseGuards,
} from "@nestjs/common";
import { type FastifyRequest } from "fastify";
import { z } from "zod";

import { IdempotencyKey } from "@/common/idempotency/idempotency-key.decorator";
import { RateLimit, hours, minutes, perSession } from "@/common/rate-limit/rate-limit.policy";
import { ZodValidationPipe, zodBody, zodQuery } from "@/common/validation/zod-validation.pipe";
import { CurrentSession, SessionGuard } from "@/modules/auth/session.guard";
import { type AuthenticatedSession } from "@/modules/auth/session.service";
import { TradeService } from "@/modules/trades/trade.service";

const idParam = z.uuid();

const requestContext = (request: FastifyRequest) => ({
  correlationId: request.id,
  ip: request.ip,
});

/**
 * A customer's trades. Every route is one of the parties' own: the session
 * decides which side of the table the caller is on, and a trade they are
 * not party to does not exist as far as they can tell (AT-6).
 */
@Controller("trades")
@UseGuards(SessionGuard)
export class TradesController {
  constructor(private readonly trades: TradeService) {}

  @Get()
  list(
    @Query(zodQuery(tradesQuery)) query: TradesQuery,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<TradesResponse> {
    return this.trades.listForUser(session.user.id, query);
  }

  /*
    Taking an offer. An Idempotency-Key (ADR-0007), so a retry after a
    dropped reply is the same trade and not a second escrow.
  */
  @Post()
  @HttpCode(201)
  @RateLimit(perSession(60, hours(1)))
  create(
    @Body(zodBody(createTradeRequest)) body: CreateTradeRequest,
    @IdempotencyKey() key: string,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: FastifyRequest,
  ): Promise<TradeView> {
    return this.trades.create(session.user.id, body, key, requestContext(request));
  }

  @Get(":id")
  one(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<TradeView> {
    return this.trades.getForUser(session.user.id, id);
  }

  @Get(":id/events")
  events(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<TradeEventsResponse> {
    return this.trades.eventsForUser(session.user.id, id);
  }

  /** "I have paid". Moves nothing; tells the seller. */
  @Post(":id/paid")
  @HttpCode(200)
  @RateLimit(perSession(60, minutes(5)))
  markPaid(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @Body(zodBody(markPaidRequest)) body: MarkPaidRequest,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: FastifyRequest,
  ): Promise<TradeView> {
    return this.trades.markPaid(session.user.id, id, body, requestContext(request));
  }

  @Post(":id/cancel")
  @HttpCode(200)
  @RateLimit(perSession(60, minutes(5)))
  cancel(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @Body(zodBody(cancelTradeRequest)) body: CancelTradeRequest,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: FastifyRequest,
  ): Promise<TradeView> {
    return this.trades.cancel(session.user.id, id, body, requestContext(request));
  }

  /*
    Release: the seller lets the USDT go. The password in the body is the
    step-up, and the reason this is limited per hour rather than per five
    minutes - a loose limit here would also be a place to guess passwords.
  */
  @Post(":id/release")
  @HttpCode(200)
  @RateLimit(perSession(30, hours(1)))
  release(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @Body(zodBody(releaseTradeRequest)) body: ReleaseTradeRequest,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: FastifyRequest,
  ): Promise<TradeView> {
    return this.trades.release(session.user.id, id, body.password, requestContext(request));
  }
}
