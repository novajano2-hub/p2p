import { Module } from "@nestjs/common";

import { ENV } from "@/config/config.module";
import { type Env } from "@/config/env";
import { MockRiskEngine } from "@/modules/risk/mock/mock-risk.engine";
import { RISK_ENGINE, type RiskEngine } from "@/modules/risk/risk.engine";

/** Chooses the risk engine from configuration (ADR-0006). The launch policy is the mock. */
@Module({
  providers: [
    MockRiskEngine,
    {
      provide: RISK_ENGINE,
      inject: [ENV, MockRiskEngine],
      useFactory: (env: Env, mock: MockRiskEngine): RiskEngine => {
        switch (env.RISK_ENGINE) {
          case "mock":
            return mock;
        }
      },
    },
  ],
  exports: [RISK_ENGINE],
})
export class RiskModule {}
