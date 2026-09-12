import { Module, type DynamicModule } from "@nestjs/common";

import { loggingModule } from "@/common/logging/logging.module";
import { ConfigModule } from "@/config/config.module";
import { type Env } from "@/config/env";
import { PrismaModule } from "@/infra/prisma/prisma.module";
import { RedisModule } from "@/infra/redis/redis.module";
import { BlockchainModule } from "@/modules/blockchain/blockchain.module";
import { DepositConfirmer } from "@/modules/deposits/deposit-confirmer";
import { DepositObserver } from "@/modules/deposits/deposit-observer";
import { DepositsModule } from "@/modules/deposits/deposits.module";
import { KycRetentionModule } from "@/modules/kyc/kyc-retention.module";
import { LedgerModule } from "@/modules/ledger/ledger.module";
import { KycSweepScheduler } from "@/modules/kyc/kyc-sweep.scheduler";
import { OutboxModule } from "@/modules/outbox/outbox.module";
import { OutboxPublisher } from "@/modules/outbox/outbox.publisher";
import { ReconciliationModule } from "@/modules/reconciliation/reconciliation.module";
import { SweepsModule } from "@/modules/sweeps/sweeps.module";
import { TreasuryWorker } from "@/modules/sweeps/treasury.worker";
import { WalletsModule } from "@/modules/wallets/wallets.module";
import { WithdrawalProcessor } from "@/modules/withdrawals/withdrawal-processor";
import { WithdrawalsModule } from "@/modules/withdrawals/withdrawals.module";

/*
  The worker process: the same modules as the API, minus HTTP. Its jobs are
  timers over Postgres state - the KYC staging sweep, and the outbox publisher
  (ADR-0007) - each under a short Redis lock so replicas take turns rather
  than collide. The deposit, withdrawal and reconciliation processors of
  Phase 3 join them the same way: the rows are the queue, claimed with
  SKIP LOCKED, so that money-moving work never depends on a second
  datastore's durability.
*/
@Module({})
export class WorkerModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        ConfigModule.forRoot(env),
        loggingModule(env),
        PrismaModule,
        RedisModule,
        KycRetentionModule,
        LedgerModule,
        OutboxModule,
        BlockchainModule,
        WalletsModule,
        DepositsModule,
        WithdrawalsModule,
        SweepsModule,
        ReconciliationModule,
      ],
      providers: [
        KycSweepScheduler,
        OutboxPublisher,
        DepositObserver,
        DepositConfirmer,
        WithdrawalProcessor,
        TreasuryWorker,
      ],
    };
  }
}
