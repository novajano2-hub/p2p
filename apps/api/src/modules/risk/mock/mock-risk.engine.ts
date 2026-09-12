import { Inject, Injectable } from "@nestjs/common";

import { ENV } from "@/config/config.module";
import { type Env } from "@/config/env";
import { chainConfig, type ChainConfig } from "@/modules/blockchain/chain-config";
import {
  type DepositRiskInput,
  type DepositRiskVerdict,
  type RiskEngine,
  type WithdrawalRiskInput,
  type WithdrawalRiskVerdict,
} from "@/modules/risk/risk.engine";

/*
  The launch policy, written down as rules rather than as a score: a person
  can read exactly why a withdrawal stopped. Deterministic, so a test can
  stage each rule. The thresholds come from configuration; the shape of the
  rules is the policy in state-machines.md 2:

    at or above the dual-approval amount   two administrators
    at or above the auto-approve amount    one administrator
    a destination never used before, or    one administrator
    used more recently than the cooldown

  The last is the one that matters most: it is what stops "phish a password,
  sign in, send everything to a fresh address" - the ordinary withdrawal to
  an address the customer has used before is untouched by it.
*/

const HOUR_MS = 60 * 60 * 1000;

@Injectable()
export class MockRiskEngine implements RiskEngine {
  private readonly chain: ChainConfig;

  constructor(@Inject(ENV) env: Env) {
    this.chain = chainConfig(env);
  }

  evaluateWithdrawal(input: WithdrawalRiskInput): Promise<WithdrawalRiskVerdict> {
    const policy = this.chain.withdrawal;
    const reasons: string[] = [];
    let approvalsRequired = 0;

    if (input.amount >= policy.dualApprovalFrom) {
      reasons.push("amount at or above the dual-approval threshold");
      approvalsRequired = 2;
    } else if (input.amount >= policy.autoApproveBelow) {
      reasons.push("amount at or above the auto-approval threshold");
      approvalsRequired = 1;
    }

    const cooldownMs = policy.newAddressCooldownHours * HOUR_MS;
    const firstUsed = input.destinationFirstUsedAt;
    if (cooldownMs > 0 && (!firstUsed || Date.now() - firstUsed.getTime() < cooldownMs)) {
      reasons.push(
        firstUsed
          ? "destination first used within the new-address cooldown"
          : "destination never used before",
      );
      approvalsRequired = Math.max(approvalsRequired, 1);
    }

    return Promise.resolve({
      decision: reasons.length === 0 ? "AUTO_APPROVE" : "REVIEW",
      score: Math.min(100, reasons.length * 40),
      reasons,
      approvalsRequired,
    });
  }

  evaluateDeposit(input: DepositRiskInput): Promise<DepositRiskVerdict> {
    const reasons: string[] = [];
    if (input.amount >= this.chain.deposit.reviewThreshold) {
      reasons.push("amount at or above the review threshold");
    }
    return Promise.resolve({ decision: reasons.length === 0 ? "CREDIT" : "REVIEW", reasons });
  }
}
