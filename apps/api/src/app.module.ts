import { Module, type DynamicModule } from "@nestjs/common";

import { AppExceptionFilter } from "@/common/errors/app-exception.filter";
import { IdempotencyModule } from "@/common/idempotency/idempotency.module";
import { loggingModule } from "@/common/logging/logging.module";
import { RateLimitGuard } from "@/common/rate-limit/rate-limit.guard";
import { RateLimitService } from "@/common/rate-limit/rate-limit.service";
import { OriginGuard } from "@/common/security/origin.guard";
import { ConfigModule } from "@/config/config.module";
import { type Env } from "@/config/env";
import { PrismaModule } from "@/infra/prisma/prisma.module";
import { RedisModule } from "@/infra/redis/redis.module";
import { AdminModule } from "@/modules/admin/admin.module";
import { AuthModule } from "@/modules/auth/auth.module";
import { BlockchainModule } from "@/modules/blockchain/blockchain.module";
import { CustodyModule } from "@/modules/custody/custody.module";
import { HealthModule } from "@/modules/health/health.module";
import { KycModule } from "@/modules/kyc/kyc.module";
import { LedgerModule } from "@/modules/ledger/ledger.module";
import { NotificationsModule } from "@/modules/notifications/notifications.module";
import { OutboxModule } from "@/modules/outbox/outbox.module";
import { RiskModule } from "@/modules/risk/risk.module";

/*
  The HTTP application. Feature modules (auth, ledger, offers, trades, ...)
  are added here as the phases land; the worker entrypoint composes its own
  subset of the same modules without the HTTP layer.
*/
@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(env),
        loggingModule(env),
        PrismaModule,
        RedisModule,
        HealthModule,
        AuthModule,
        KycModule,
        LedgerModule,
        NotificationsModule,
        OutboxModule,
        IdempotencyModule,
        BlockchainModule,
        CustodyModule,
        RiskModule,
        AdminModule,
      ],
      /*
        Registered here and applied in createApp, the same way the exception
        filter is: the module tree owns construction, and the one place that
        shapes a request's security posture owns the order they run in.
      */
      providers: [AppExceptionFilter, OriginGuard, RateLimitService, RateLimitGuard],
    };
  }
}
