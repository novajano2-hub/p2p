import { Module, type DynamicModule } from "@nestjs/common";

import { loggingModule } from "@/common/logging/logging.module";
import { ConfigModule } from "@/config/config.module";
import { type Env } from "@/config/env";
import { PrismaModule } from "@/infra/prisma/prisma.module";
import { RedisModule } from "@/infra/redis/redis.module";
import { KycRetentionModule } from "@/modules/kyc/kyc-retention.module";
import { KycSweepScheduler } from "@/modules/kyc/kyc-sweep.scheduler";

/*
  The worker process: the same modules as the API, minus HTTP. Its one job
  today is the KYC staging sweep, which deletes photographs no submission
  ever claimed. BullMQ queues and their processors register here from Phase 3
  (deposit confirmation, withdrawal broadcast, reconciliation), and the sweep
  becomes a repeatable job among them.
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
      ],
      providers: [KycSweepScheduler],
    };
  }
}
