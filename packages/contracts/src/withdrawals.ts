import { z } from "zod";

import { adminCustomerSummary } from "./admin";
import { chainNetwork } from "./deposits";
import { microAmount } from "./ledger";

/*
  Money going out (docs/architecture/state-machines.md 2, ADR-0010).

  The customer's side of this is deliberately small: an amount, a network, an
  address, and their password again. Everything else - risk, approval,
  building, signing, broadcasting, confirming - happens behind the scenes and
  reaches them as a status. Amounts are integer strings of millionths (AT-21).
*/

export const withdrawalStatus = z.enum([
  "REQUESTED",
  "RISK_REVIEW",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
  "BUILDING",
  "BUILD_FAILED",
  "SIGNING",
  "SIGN_REFUSED",
  "BROADCAST",
  "BROADCAST_UNKNOWN",
  "MANUAL_INVESTIGATION",
  "CONFIRMED",
  "FAILED_CONFIRMED",
]);
export type WithdrawalStatus = z.infer<typeof withdrawalStatus>;

/**
 * What a customer sees, in four words rather than fourteen states. The
 * internal state machine is plumbing; this is the only thing an interface
 * should render or a person should have to understand.
 */
export const withdrawalStage = z.enum(["PENDING", "SENDING", "SENT", "RETURNED", "HELD"]);
export type WithdrawalStage = z.infer<typeof withdrawalStage>;

export const createWithdrawalRequest = z.object({
  network: chainNetwork,
  /** Millionths, as an integer string. Never a number. */
  amount: z.string().regex(/^\d+$/, { error: "Enter an amount." }),
  destination: z
    .string()
    .trim()
    .regex(/^0x[0-9a-fA-F]{40}$/, { error: "That is not a valid address for this network." }),
  /*
    The account password, again, for this one act (state-machines.md: "step-up
    auth passed"). An irreversible transfer should not be one click away from
    a session someone walked away from, and it is the control that costs a
    thief the most when they have only a stolen cookie.
  */
  password: z.string().min(1, { error: "Enter your password to confirm." }),
});
export type CreateWithdrawalRequest = z.infer<typeof createWithdrawalRequest>;

export const withdrawalView = z.object({
  id: z.string(),
  network: chainNetwork,
  asset: z.string(),
  amount: microAmount,
  fee: microAmount,
  destination: z.string(),
  stage: withdrawalStage,
  status: withdrawalStatus,
  /** Null until it reaches the chain. */
  txHash: z.string().nullable(),
  confirmations: z.number().int().nonnegative(),
  confirmationsRequired: z.number().int().positive(),
  /** Why it stopped, in words for the person it happened to. Null while it is fine. */
  message: z.string().nullable(),
  /*
    Whether the customer may still call this one off. The server says so
    rather than the browser working it out: the rule is about the internal
    status and `stage` deliberately cannot express it - one stage covers both
    a withdrawal waiting for a person, which can be cancelled, and one already
    approved, which cannot.
  */
  cancellable: z.boolean(),
  requestedAt: z.string(),
  settledAt: z.string().nullable(),
});
export type WithdrawalView = z.infer<typeof withdrawalView>;

export const withdrawalsResponse = z.object({ withdrawals: z.array(withdrawalView) });
export type WithdrawalsResponse = z.infer<typeof withdrawalsResponse>;

/** What the customer may send, and what they have already used today. */
export const withdrawalLimitsResponse = z.object({
  network: chainNetwork,
  asset: z.string(),
  minimum: microAmount,
  maximum: microAmount,
  dailyMaximum: microAmount,
  dailyRemaining: microAmount,
  available: microAmount,
  /** Zero at launch, posted as its own ledger leg regardless. */
  fee: microAmount,
});
export type WithdrawalLimitsResponse = z.infer<typeof withdrawalLimitsResponse>;

/* ------------------------------------------------------------------ admin */

export const withdrawalApprovalView = z.object({
  adminId: z.string(),
  adminEmail: z.string(),
  reason: z.string().nullable(),
  createdAt: z.string(),
});
export type WithdrawalApprovalView = z.infer<typeof withdrawalApprovalView>;

export const adminWithdrawalItem = withdrawalView.extend({
  userId: z.string(),
  /** Who is sending it, so the approver is not deciding about a uuid. */
  customer: adminCustomerSummary.nullable(),
  riskScore: z.number().int().nullable(),
  riskReasons: z.array(z.string()),
  approvalsRequired: z.number().int().nonnegative(),
  approvals: z.array(withdrawalApprovalView),
  providerRef: z.string().nullable(),
  buildAttempts: z.number().int().nonnegative(),
  failureReason: z.string().nullable(),
  holdTransactionId: z.string().nullable(),
  broadcastTransactionId: z.string().nullable(),
  settledTransactionId: z.string().nullable(),
  correlationId: z.string(),
  broadcastAt: z.string().nullable(),
});
export type AdminWithdrawalItem = z.infer<typeof adminWithdrawalItem>;

export const adminWithdrawalQueueResponse = z.object({
  /** Waiting for a decision: RISK_REVIEW. */
  review: z.array(adminWithdrawalItem),
  /** Waiting for a person to resolve against the chain: MANUAL_INVESTIGATION. */
  investigation: z.array(adminWithdrawalItem),
});
export type AdminWithdrawalQueueResponse = z.infer<typeof adminWithdrawalQueueResponse>;

const decisionReason = z.string().trim().min(3).max(500);

export const withdrawalApproveRequest = z.object({ reason: decisionReason.optional() });
export type WithdrawalApproveRequest = z.infer<typeof withdrawalApproveRequest>;

export const withdrawalRejectRequest = z.object({ reason: decisionReason });
export type WithdrawalRejectRequest = z.infer<typeof withdrawalRejectRequest>;

/**
 * Resolving an ambiguous broadcast, against the chain and never against a
 * provider's word (AT-9, ADR-0010). "BROADCAST" says the transaction is
 * there and names it; "FAILED" says nothing was ever sent, and takes two
 * administrators because it is the one that gives the money back.
 */
export const withdrawalInvestigationRequest = z.object({
  outcome: z.enum(["BROADCAST", "FAILED"]),
  /** Required when the outcome is BROADCAST: the transaction found on the chain. */
  txHash: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional(),
  reason: decisionReason,
});
export type WithdrawalInvestigationRequest = z.infer<typeof withdrawalInvestigationRequest>;
