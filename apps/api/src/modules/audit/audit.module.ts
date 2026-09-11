import { Module } from "@nestjs/common";

import { PrismaModule } from "@/infra/prisma/prisma.module";
import { AuditService } from "@/modules/audit/audit.service";

/** Available to any module that changes something a person should answer for. */
@Module({
  imports: [PrismaModule],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
