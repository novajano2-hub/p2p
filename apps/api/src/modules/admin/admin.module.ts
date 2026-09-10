import { Module } from "@nestjs/common";

import { PrismaModule } from "@/infra/prisma/prisma.module";
import { StorageModule } from "@/infra/storage/storage.module";
import { AdminAuthService } from "@/modules/admin/admin-auth.service";
import { AdminKycService } from "@/modules/admin/admin-kyc.service";
import { AdminSessionService } from "@/modules/admin/admin-session.service";
import { AdminAuthController, AdminKycController } from "@/modules/admin/admin.controller";
import { AdminGuard } from "@/modules/admin/admin.guard";
import { AuditModule } from "@/modules/audit/audit.module";
import { NotificationsModule } from "@/modules/notifications/notifications.module";

/*
  The admin realm. Note what it does NOT import: AuthModule. The customer's
  session service has no business here and this module has none there, which
  is the separation the whole design rests on (open-questions Q2).
*/
@Module({
  imports: [PrismaModule, StorageModule, AuditModule, NotificationsModule],
  controllers: [AdminAuthController, AdminKycController],
  providers: [AdminSessionService, AdminAuthService, AdminKycService, AdminGuard],
})
export class AdminModule {}
