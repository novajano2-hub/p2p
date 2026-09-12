import { Module } from "@nestjs/common";

import { ENV } from "@/config/config.module";
import { type Env } from "@/config/env";
import { PrismaModule } from "@/infra/prisma/prisma.module";
import {
  BLOCKCHAIN_GATEWAY,
  type BlockchainGateway,
} from "@/modules/blockchain/blockchain.gateway";
import {
  MockBlockchainGateway,
  MockChain,
} from "@/modules/blockchain/mock/mock-blockchain.gateway";

/*
  Chooses the chain adapter from configuration, once, at boot (ADR-0006).
  Only the mock exists until Phase 6; the switch has one arm so that adding
  the real one is adding an arm, and the type system says where.
*/
@Module({
  imports: [PrismaModule],
  providers: [
    MockChain,
    MockBlockchainGateway,
    {
      provide: BLOCKCHAIN_GATEWAY,
      inject: [ENV, MockBlockchainGateway],
      useFactory: (env: Env, mock: MockBlockchainGateway): BlockchainGateway => {
        switch (env.BLOCKCHAIN_GATEWAY) {
          case "mock":
            return mock;
        }
      },
    },
  ],
  exports: [BLOCKCHAIN_GATEWAY, MockChain],
})
export class BlockchainModule {}
