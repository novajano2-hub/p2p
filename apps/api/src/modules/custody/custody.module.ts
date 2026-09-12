import { Module } from "@nestjs/common";

import { ENV } from "@/config/config.module";
import { type Env } from "@/config/env";
import { PrismaModule } from "@/infra/prisma/prisma.module";
import { BlockchainModule } from "@/modules/blockchain/blockchain.module";
import { CUSTODY_PROVIDER, type CustodyProvider } from "@/modules/custody/custody.provider";
import { MockCustodyProvider } from "@/modules/custody/mock/mock-custody.provider";

/*
  Chooses the custody adapter from configuration (ADR-0006, ADR-0010). The
  mock is exported by its own name as well, because the tests direct it; a
  real adapter has nothing to direct and will not be.
*/
@Module({
  imports: [PrismaModule, BlockchainModule],
  providers: [
    MockCustodyProvider,
    {
      provide: CUSTODY_PROVIDER,
      inject: [ENV, MockCustodyProvider],
      useFactory: (env: Env, mock: MockCustodyProvider): CustodyProvider => {
        switch (env.CUSTODY_PROVIDER) {
          case "mock":
            return mock;
        }
      },
    },
  ],
  exports: [CUSTODY_PROVIDER, MockCustodyProvider],
})
export class CustodyModule {}
