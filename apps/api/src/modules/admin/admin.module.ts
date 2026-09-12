import { Module } from "@nestjs/common";

import { PrismaModule } from "@/infra/prisma/prisma.module";
import { StorageModule } from "@/infra/storage/storage.module";
import { AdminAuthService } from "@/modules/admin/admin-auth.service";
import { AdminDepositsController } from "@/modules/admin/admin-deposits.controller";
import { AdminKycService } from "@/modules/admin/admin-kyc.service";
import { AdminReconciliationController } from "@/modules/admin/admin-reconciliation.controller";
import { AdminLedgerController } from "@/modules/admin/admin-ledger.controller";
import { AdminLedgerService } from "@/modules/admin/admin-ledger.service";
import { AdminMfaService } from "@/modules/admin/admin-mfa.service";
import { AdminSessionService } from "@/modules/admin/admin-session.service";
import { AdminWithdrawalsController } from "@/modules/admin/admin-withdrawals.controller";
import { AdminAuthController, AdminKycController } from "@/modules/admin/admin.controller";
import { AdminGuard } from "@/modules/admin/admin.guard";
import { AuditModule } from "@/modules/audit/audit.module";
import { DepositsModule } from "@/modules/deposits/deposits.module";
import { NotificationsModule } from "@/modules/notifications/notifications.module";
import { ReconciliationModule } from "@/modules/reconciliation/reconciliation.module";
import { SweepsModule } from "@/modules/sweeps/sweeps.module";
import { WithdrawalsModule } from "@/modules/withdrawals/withdrawals.module";

/*
  The admin realm. Note what it does NOT import: AuthModule. The customer's
  session service has no business here and this module has none there, which
  is the separation the whole design rests on (open-questions Q2).
*/
@Module({
  imports: [
    PrismaModule,
    StorageModule,
    AuditModule,
    NotificationsModule,
    DepositsModule,
    WithdrawalsModule,
    SweepsModule,
    ReconciliationModule,
  ],
  controllers: [
    AdminAuthController,
    AdminKycController,
    AdminLedgerController,
    AdminDepositsController,
    AdminWithdrawalsController,
    AdminReconciliationController,
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
