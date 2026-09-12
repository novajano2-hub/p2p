import { Module } from "@nestjs/common";

import { PrismaModule } from "@/infra/prisma/prisma.module";
import { StorageModule } from "@/infra/storage/storage.module";
import { AdminAuthService } from "@/modules/admin/admin-auth.service";
import { AdminDepositsController } from "@/modules/admin/admin-deposits.controller";
import { AdminKycService } from "@/modules/admin/admin-kyc.service";
import { AdminLedgerController } from "@/modules/admin/admin-ledger.controller";
import { AdminLedgerService } from "@/modules/admin/admin-ledger.service";
import { AdminMfaService } from "@/modules/admin/admin-mfa.service";
import { AdminSessionService } from "@/modules/admin/admin-session.service";
import { AdminAuthController, AdminKycController } from "@/modules/admin/admin.controller";
import { AdminGuard } from "@/modules/admin/admin.guard";
import { AuditModule } from "@/modules/audit/audit.module";
import { DepositsModule } from "@/modules/deposits/deposits.module";
import { NotificationsModule } from "@/modules/notifications/notifications.module";

/*
  The admin realm. Note what it does NOT import: AuthModule. The customer's
  session service has no business here and this module has none there, which
  is the separation the whole design rests on (open-questions Q2).
*/
@Module({
  imports: [PrismaModule, StorageModule, AuditModule, NotificationsModule, DepositsModule],
  controllers: [
    AdminAuthController,
    AdminKycController,
    AdminLedgerController,
    AdminDepositsController,
  ],
  providers: [
    AdminSessionService,
    AdminAuthService,
    AdminMfaService,
    AdminKycService,
    AdminLedgerService,
    AdminGuard,
  ],
})
export class AdminModule {}
