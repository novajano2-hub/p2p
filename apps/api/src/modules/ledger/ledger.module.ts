import { Module } from "@nestjs/common";

import { LedgerService } from "@/modules/ledger/ledger.service";

/*
  The ledger, as a module other modules import to move money. It exports the
  service and nothing else: no controller yet (the admin's read-only viewer is
  stage 4), and no way for another module to reach a ledger table except
  through LedgerService.post.
*/
@Module({
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
