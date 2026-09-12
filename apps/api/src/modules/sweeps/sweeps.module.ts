import { Module } from "@nestjs/common";

import { PrismaModule } from "@/infra/prisma/prisma.module";
import { AuditModule } from "@/modules/audit/audit.module";
import { BlockchainModule } from "@/modules/blockchain/blockchain.module";
import { CustodyModule } from "@/modules/custody/custody.module";
import { LedgerModule } from "@/modules/ledger/ledger.module";
import { SweepService } from "@/modules/sweeps/sweep.service";

@Module({
  imports: [PrismaModule, LedgerModule, AuditModule, BlockchainModule, CustodyModule],
  providers: [SweepService],
  exports: [SweepService],
})
export class SweepsModule {}
