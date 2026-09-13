import { Module } from "@nestjs/common";

import { PrismaModule } from "@/infra/prisma/prisma.module";
import { AuditModule } from "@/modules/audit/audit.module";
import { AuthModule } from "@/modules/auth/auth.module";
import { BlockchainModule } from "@/modules/blockchain/blockchain.module";
import { CustomersModule } from "@/modules/customers/customers.module";
import { CustodyWebhookController } from "@/modules/deposits/custody-webhook.controller";
import { DepositService } from "@/modules/deposits/deposit.service";
import { DepositsController } from "@/modules/deposits/deposits.controller";
import { LedgerModule } from "@/modules/ledger/ledger.module";
import { NotificationsModule } from "@/modules/notifications/notifications.module";
import { OutboxModule } from "@/modules/outbox/outbox.module";
import { RiskModule } from "@/modules/risk/risk.module";
import { WalletsModule } from "@/modules/wallets/wallets.module";

/*
  Money in. The service is exported for the admin realm's deposit queue and
  for the worker's observer and confirmer, which are registered by the
  worker itself: an API process has no business running timers.
*/
@Module({
  imports: [
    PrismaModule,
    AuthModule,
    LedgerModule,
    AuditModule,
    NotificationsModule,
    OutboxModule,
    BlockchainModule,
    RiskModule,
    WalletsModule,
    CustomersModule,
  ],
  controllers: [DepositsController, CustodyWebhookController],
  providers: [DepositService],
  exports: [DepositService],
})
export class DepositsModule {}
