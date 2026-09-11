import { Module } from "@nestjs/common";

import { PrismaModule } from "@/infra/prisma/prisma.module";
import { AuthModule } from "@/modules/auth/auth.module";
import { NotificationsController } from "@/modules/notifications/notifications.controller";
import { NotificationsService } from "@/modules/notifications/notifications.service";

/*
  Exported: AdminKycService writes into this service from the admin realm,
  the one deliberate crossing between the two module trees. It reaches in to
  tell a customer something; it never reaches out to read a customer's session
  or anything else customer-side.
*/
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
