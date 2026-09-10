import { Module } from "@nestjs/common";

import { PrismaModule } from "@/infra/prisma/prisma.module";
import { StorageModule } from "@/infra/storage/storage.module";
import { KycRetentionService } from "@/modules/kyc/kyc-retention.service";

/*
  Retention on its own, with no HTTP anywhere in it, because the process that
  runs the sweep is the worker and it has no HTTP layer to bring along.
*/
@Module({
  imports: [PrismaModule, StorageModule],
  providers: [KycRetentionService],
  exports: [KycRetentionService],
})
export class KycRetentionModule {}
