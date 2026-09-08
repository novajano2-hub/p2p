import { Module, type DynamicModule } from "@nestjs/common";

import { loggingModule } from "@/common/logging/logging.module";
import { ConfigModule } from "@/config/config.module";
import { type Env } from "@/config/env";
import { PrismaModule } from "@/infra/prisma/prisma.module";
import { RedisModule } from "@/infra/redis/redis.module";

/*
  The worker process: the same modules as the API, minus HTTP. BullMQ queues
  and their processors register here from Phase 3 (deposit confirmation,
  withdrawal broadcast, reconciliation). Until then it boots, reports, and
  waits, so the deployment shape exists before the work does.
*/
@Module({})
export class WorkerModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: WorkerModule,
      imports: [ConfigModule.forRoot(env), loggingModule(env), PrismaModule, RedisModule],
    };
  }
}
