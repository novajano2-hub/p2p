import {
  createOfferRequest,
  marketplaceQuery,
  updateOfferRequest,
  type CreateOfferRequest,
  type MarketplaceOffer,
  type MarketplaceQuery,
  type MarketplaceResponse,
  type MyOffersResponse,
  type OfferView,
  type UpdateOfferRequest,
} from "@abay/contracts";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import { RateLimit, hours, minutes, perSession } from "@/common/rate-limit/rate-limit.policy";
import { ZodValidationPipe, zodBody, zodQuery } from "@/common/validation/zod-validation.pipe";
import { CurrentSession, SessionGuard } from "@/modules/auth/session.guard";
import { type AuthenticatedSession } from "@/modules/auth/session.service";
import { OfferService } from "@/modules/offers/offer.service";

const idParam = z.uuid();

/**
 * The marketplace and a customer's own advertisements. Reading the list
 * needs a session but no more; posting needs verification, which the
 * service checks, since it is a rule about the account and not the route.
 */
@Controller("offers")
@UseGuards(SessionGuard)
export class OffersController {
  constructor(private readonly offers: OfferService) {}

  @Get()
  marketplace(
    @Query(zodQuery(marketplaceQuery)) query: MarketplaceQuery,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<MarketplaceResponse> {
    return this.offers.marketplace(session.user.id, query);
  }

  @Get("mine")
  async mine(@CurrentSession() session: AuthenticatedSession): Promise<MyOffersResponse> {
    return { offers: await this.offers.listMine(session.user.id) };
  }

  @Post()
  @HttpCode(201)
  @RateLimit(perSession(30, hours(1)))
  create(
    @Body(zodBody(createOfferRequest)) body: CreateOfferRequest,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<OfferView> {
    return this.offers.create(session.user.id, body);
  }

  /** An offer as somebody about to take it sees it. */
  @Get(":id")
  one(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<MarketplaceOffer> {
    return this.offers.getForTaking(session.user.id, id);
  }

  /** The owner's own view of it, with everything editable. */
  @Get(":id/mine")
  mineOne(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<OfferView> {
    return this.offers.getMine(session.user.id, id);
  }

  @Patch(":id")
  @RateLimit(perSession(60, minutes(5)))
  update(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @Body(zodBody(updateOfferRequest)) body: UpdateOfferRequest,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<OfferView> {
    return this.offers.update(session.user.id, id, body);
  }

  @Post(":id/pause")
  @HttpCode(200)
  @RateLimit(perSession(60, minutes(5)))
  pause(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<OfferView> {
    return this.offers.setStatus(session.user.id, id, "PAUSED");
  }

  @Post(":id/resume")
  @HttpCode(200)
  @RateLimit(perSession(60, minutes(5)))
  resume(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<OfferView> {
    return this.offers.setStatus(session.user.id, id, "ACTIVE");
  }

  @Post(":id/close")
  @HttpCode(200)
  @RateLimit(perSession(60, minutes(5)))
  close(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<OfferView> {
    return this.offers.setStatus(session.user.id, id, "CLOSED");
  }
}
