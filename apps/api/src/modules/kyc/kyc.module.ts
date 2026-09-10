import { Module } from "@nestjs/common";

import { PrismaModule } from "@/infra/prisma/prisma.module";
import { AuthModule } from "@/modules/auth/auth.module";
import { KycController } from "@/modules/kyc/kyc.controller";
import { KycService } from "@/modules/kyc/kyc.service";

/** AuthModule for the session guard; nothing here is reachable without one. */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [KycController],
  providers: [KycService],
})
export class KycModule {}
