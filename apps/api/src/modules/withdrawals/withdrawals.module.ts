import { Module } from "@nestjs/common";

import { IdempotencyModule } from "@/common/idempotency/idempotency.module";
import { PrismaModule } from "@/infra/prisma/prisma.module";
import { AuditModule } from "@/modules/audit/audit.module";
import { AuthModule } from "@/modules/auth/auth.module";
import { BlockchainModule } from "@/modules/blockchain/blockchain.module";
import { CustodyModule } from "@/modules/custody/custody.module";
import { LedgerModule } from "@/modules/ledger/ledger.module";
import { NotificationsModule } from "@/modules/notifications/notifications.module";
import { OutboxModule } from "@/modules/outbox/outbox.module";
import { RiskModule } from "@/modules/risk/risk.module";
import { WithdrawalsController } from "@/modules/withdrawals/withdrawals.controller";
import { WithdrawalService } from "@/modules/withdrawals/withdrawal.service";

/*
  Money out. The service is exported for the admin realm's approval queue and
  for the worker's processor, which the worker registers itself: an API
  process has no business building and broadcasting transfers.
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
    BlockchainModule,
    CustodyModule,
    RiskModule,
  ],
  controllers: [WithdrawalsController],
  providers: [WithdrawalService],
  exports: [WithdrawalService],
})
export class WithdrawalsModule {}
