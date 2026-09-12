import { type KycStatus } from "@abay/database";

/*
  The one place a "should a human look at this" decision is made.

  Behind an interface (ADR-0006) so that the policy can grow - velocity,
  device history, a vendor's score - without the deposit or withdrawal code
  changing. Two rules the callers hold, not the engine: an engine that throws
  is treated as REVIEW, never as approval (state-machines.md, "fails closed");
  and REVIEW is the exception, the ordinary case never meets a person.
*/

export const RISK_ENGINE = Symbol("RISK_ENGINE");

export interface WithdrawalRiskInput {
  userId: string;
  kycStatus: KycStatus;
  /** Millionths. */
  amount: bigint;
  /** Lower-cased. */
  destination: string;
  /** When this customer first withdrew to this destination; null if never. */
  destinationFirstUsedAt: Date | null;
  /** Millionths already requested in the trailing 24 hours, this request excluded. */
  dailyTotal: bigint;
}

export interface WithdrawalRiskVerdict {
  decision: "AUTO_APPROVE" | "REVIEW";
  /** 0..100; informational, kept on the withdrawal. */
  score: number;
  reasons: string[];
  /** Distinct administrators needed before it may proceed; 0 for an auto-approval. */
  approvalsRequired: number;
}

export interface DepositRiskInput {
  userId: string | null;
  /** Millionths. */
  amount: bigint;
  /** Lower-cased. */
  from: string;
}

export interface DepositRiskVerdict {
  decision: "CREDIT" | "REVIEW";
  reasons: string[];
}

export interface RiskEngine {
  evaluateWithdrawal(input: WithdrawalRiskInput): Promise<WithdrawalRiskVerdict>;
  evaluateDeposit(input: DepositRiskInput): Promise<DepositRiskVerdict>;
}
