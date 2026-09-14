import { Module } from "@nestjs/common";

import { PrismaModule } from "@/infra/prisma/prisma.module";
import { AuthModule } from "@/modules/auth/auth.module";
import { OfferService } from "@/modules/offers/offer.service";
import { OffersController } from "@/modules/offers/offers.controller";
import { PaymentMethodsModule } from "@/modules/payment-methods/payment-methods.module";

/** The marketplace. The service is exported for the trade engine, which reserves against offers. */
@Module({
  imports: [PrismaModule, AuthModule, PaymentMethodsModule],
  controllers: [OffersController],
  providers: [OfferService],
  exports: [OfferService],
})
export class OffersModule {}
