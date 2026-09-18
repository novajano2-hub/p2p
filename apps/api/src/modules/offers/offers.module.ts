import { Module } from "@nestjs/common";

import { PrismaModule } from "@/infra/prisma/prisma.module";
import { AuthModule } from "@/modules/auth/auth.module";
import { LedgerModule } from "@/modules/ledger/ledger.module";
import { NotificationsModule } from "@/modules/notifications/notifications.module";
import { OfferService } from "@/modules/offers/offer.service";
import { OffersController } from "@/modules/offers/offers.controller";
import { PaymentMethodsModule } from "@/modules/payment-methods/payment-methods.module";
import { PresenceModule } from "@/modules/presence/presence.module";

/**
 * The marketplace. The service is exported for the trade engine, which
 * reserves against offers, and for the worker's funding watcher, which the
 * worker registers itself: an API process has no timer.
 */
@Module({
  imports: [
    PrismaModule,
    AuthModule,
    PaymentMethodsModule,
    LedgerModule,
    NotificationsModule,
    PresenceModule,
  ],
  controllers: [OffersController],
  providers: [OfferService],
  exports: [OfferService],
})
export class OffersModule {}
