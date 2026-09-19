import {
  createPaymentMethodRequest,
  replacePaymentMethodRequest,
  type CreatePaymentMethodRequest,
  type PaymentMethodDetailView,
  type PaymentMethodsResponse,
  type ReplacePaymentMethodRequest,
} from "@abay/contracts";
import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { RateLimit, hours, minutes, perSession } from "@/common/rate-limit/rate-limit.policy";
import { ZodValidationPipe, zodBody } from "@/common/validation/zod-validation.pipe";
import { CurrentSession, SessionGuard } from "@/modules/auth/session.guard";
import { type AuthenticatedSession } from "@/modules/auth/session.service";
import { PaymentMethodService } from "@/modules/payment-methods/payment-method.service";

const idParam = z.uuid();

/**
 * A customer's own payment methods. Every route is scoped by the session:
 * there is no way to name another account's method, and no administrator
 * route here at all - a resolver reads instructions through the dispute
 * they belong to, with the audit row that implies.
 */
@Controller("payment-methods")
@UseGuards(SessionGuard)
export class PaymentMethodsController {
  constructor(private readonly methods: PaymentMethodService) {}

  @Get()
  async list(@CurrentSession() session: AuthenticatedSession): Promise<PaymentMethodsResponse> {
    return { paymentMethods: await this.methods.list(session.user.id) };
  }

  /** The instructions whole. Limited, because this is the one read that decrypts. */
  @Get(":id")
  @RateLimit(perSession(120, minutes(5)))
  get(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<PaymentMethodDetailView> {
    return this.methods.get(session.user.id, id);
  }

  @Post()
  @HttpCode(201)
  @RateLimit(perSession(20, hours(1)))
  create(
    @Body(zodBody(createPaymentMethodRequest)) body: CreatePaymentMethodRequest,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<PaymentMethodDetailView> {
    return this.methods.create(session.user.id, body);
  }

  /** The same kind, new details: the old one archived, its place on live ads taken by the new. */
  @Post(":id/replace")
  @HttpCode(200)
  @RateLimit(perSession(20, hours(1)))
  replace(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @Body(zodBody(replacePaymentMethodRequest)) body: ReplacePaymentMethodRequest,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<PaymentMethodDetailView> {
    return this.methods.replace(session.user.id, id, body);
  }

  /** Archives, never deletes: trades that snapshotted it still point at it. */
  @Delete(":id")
  @HttpCode(204)
  @RateLimit(perSession(60, minutes(5)))
  async archive(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<void> {
    await this.methods.archive(session.user.id, id);
  }
}
