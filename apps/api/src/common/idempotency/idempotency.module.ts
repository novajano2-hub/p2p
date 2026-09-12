import { Module } from "@nestjs/common";

import { IdempotencyService } from "@/common/idempotency/idempotency.service";
import { PrismaModule } from "@/infra/prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  providers: [IdempotencyService],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
