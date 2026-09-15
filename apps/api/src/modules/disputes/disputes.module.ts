import { Module } from "@nestjs/common";

import { PrismaModule } from "@/infra/prisma/prisma.module";
import { StorageModule } from "@/infra/storage/storage.module";
import { AuditModule } from "@/modules/audit/audit.module";
import { AuthModule } from "@/modules/auth/auth.module";
import { ChatModule } from "@/modules/chat/chat.module";
import { CustomersModule } from "@/modules/customers/customers.module";
import { DisputeService } from "@/modules/disputes/dispute.service";
import { DisputesController } from "@/modules/disputes/disputes.controller";
import { PaymentMethodsModule } from "@/modules/payment-methods/payment-methods.module";
import { TradesModule } from "@/modules/trades/trades.module";

/**
 * Disputes. The parties' side is here; the resolver's routes live in the
 * admin realm and reach in through the exported service, the same way the
 * admin realm reaches into withdrawals and deposits.
 */
@Module({
  imports: [
    PrismaModule,
    StorageModule,
    AuthModule,
    AuditModule,
    TradesModule,
    ChatModule,
    PaymentMethodsModule,
    CustomersModule,
  ],
  controllers: [DisputesController],
  providers: [DisputeService],
  exports: [DisputeService],
})
export class DisputesModule {}
