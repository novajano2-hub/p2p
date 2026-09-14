import { Module } from "@nestjs/common";

import { IdempotencyModule } from "@/common/idempotency/idempotency.module";
import { PrismaModule } from "@/infra/prisma/prisma.module";
import { AuditModule } from "@/modules/audit/audit.module";
import { AuthModule } from "@/modules/auth/auth.module";
import { LedgerModule } from "@/modules/ledger/ledger.module";
import { NotificationsModule } from "@/modules/notifications/notifications.module";
import { OffersModule } from "@/modules/offers/offers.module";
import { OutboxModule } from "@/modules/outbox/outbox.module";
import { PaymentMethodsModule } from "@/modules/payment-methods/payment-methods.module";
import { TradeService } from "@/modules/trades/trade.service";
import { TradesController } from "@/modules/trades/trades.controller";

/*
  The trade engine. The service is exported for the wallet (the escrowed
  figure), for the chat and the disputes, and for the worker's expirer,
  which the worker registers itself: an API process has no timer.
*/
@Module({
  imports: [
    PrismaModule,
    AuthModule,
    LedgerModule,
    AuditModule,
    NotificationsModule,
    OutboxModule,
    IdempotencyModule,
    OffersModule,
    PaymentMethodsModule,
  ],
  controllers: [TradesController],
  providers: [TradeService],
  exports: [TradeService],
})
export class TradesModule {}
