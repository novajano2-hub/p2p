import { Module } from "@nestjs/common";

import { PrismaModule } from "@/infra/prisma/prisma.module";
import { CustomerDirectoryService } from "@/modules/customers/customer-directory.service";

/** Read-only, and imported by every realm that has to name a customer. */
@Module({
  imports: [PrismaModule],
  providers: [CustomerDirectoryService],
  exports: [CustomerDirectoryService],
})
export class CustomersModule {}
