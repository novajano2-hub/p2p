import { z } from "zod";

import { microAmount } from "./ledger";

/*
  Money coming in, as the customer and the administrator see it.

  A deposit is an on-chain transfer to the customer's own address, tracked
  from first sighting to credited balance (docs/architecture/state-machines.md
  1). The customer sees where it is and how many confirmations it has; the
  administrator additionally sees the rare ones that need a decision. Amounts
  are integer strings of millionths, as everywhere (AT-21).
*/

export const chainNetwork = z.enum(["BSC"]);
export type ChainNetwork = z.infer<typeof chainNetwork>;

export const depositStatus = z.enum([
  "DETECTED",
  "CONFIRMING",
  "CREDITED",
  "ORPHANED",
  "MANUAL_REVIEW",
  "UNATTRIBUTED",
  "REJECTED",
]);
export type DepositStatus = z.infer<typeof depositStatus>;

/** Where to send USDT so that it becomes this customer's balance. */
export const depositAddressResponse = z.object({
  network: chainNetwork,
  /** The token standard a person checks against the app they are sending from. */
  standard: z.string(),
  asset: z.string(),
  /** Lower-cased; render as given. */
  address: z.string(),
  confirmationsRequired: z.number().int().positive(),
  /** Below this the deposit is held as unattributed rather than credited. Millionths. */
  minimumDeposit: microAmount,
});
export type DepositAddressResponse = z.infer<typeof depositAddressResponse>;

/** One deposit as its owner sees it. */
export const depositView = z.object({
  id: z.string(),
  network: chainNetwork,
  txHash: z.string(),
  amount: microAmount,
  status: depositStatus,
  confirmations: z.number().int().nonnegative(),
  confirmationsRequired: z.number().int().positive(),
  detectedAt: z.string(),
  creditedAt: z.string().nullable(),
});
export type DepositView = z.infer<typeof depositView>;

export const depositsResponse = z.object({ deposits: z.array(depositView) });
export type DepositsResponse = z.infer<typeof depositsResponse>;

/* ------------------------------------------------------------------ admin */

/** One deposit with everything the chain and the pipeline recorded about it. */
export const adminDepositItem = depositView.extend({
  logIndex: z.number().int().nonnegative(),
  blockNumber: z.string(),
  fromAddress: z.string(),
  toAddress: z.string(),
  tokenContract: z.string(),
  /** The chain's own integer, in the token's decimals. */
  rawAmount: z.string(),
  userId: z.string().nullable(),
  detectedVia: z.string(),
  /** Why it is held, or why it could not be attributed. */
  reviewReason: z.string().nullable(),
  ledgerTransactionId: z.string().nullable(),
  decidedBy: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decisionReason: z.string().nullable(),
  correlationId: z.string(),
});
export type AdminDepositItem = z.infer<typeof adminDepositItem>;

export const adminDepositQueueResponse = z.object({
  deposits: z.array(adminDepositItem),
  waiting: z.number().int().nonnegative(),
});
export type AdminDepositQueueResponse = z.infer<typeof adminDepositQueueResponse>;

const decisionReason = z.string().trim().min(3).max(500);

/** Approving a held deposit: a reason is welcome, not demanded. */
export const depositApproveRequest = z.object({ reason: decisionReason.optional() });
export type DepositApproveRequest = z.infer<typeof depositApproveRequest>;

/** Rejecting one: the reason is mandatory, and it is what the audit trail keeps. */
export const depositRejectRequest = z.object({ reason: decisionReason });
export type DepositRejectRequest = z.infer<typeof depositRejectRequest>;

/** Attributing an unmatched deposit to a customer, with the evidence for it. */
export const depositAttributeRequest = z.object({
  userId: z.uuid(),
  reason: decisionReason,
});
export type DepositAttributeRequest = z.infer<typeof depositAttributeRequest>;

/* ---------------------------------------------------------------- webhook */

/**
 * What the custody provider posts when a transfer reaches one of our
 * addresses. The body is a claim, not a fact: it is signed over the raw
 * bytes, and the transfer is then re-read from the chain before anything
 * is recorded (state-machines.md 1).
 */
export const custodyTransferWebhook = z.object({
  event: z.literal("transfer.incoming"),
  network: chainNetwork,
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  logIndex: z.number().int().nonnegative(),
  /** The provider's own delivery id, for its logs; not used for idempotency. */
  deliveryId: z.string().max(200).optional(),
});
export type CustodyTransferWebhook = z.infer<typeof custodyTransferWebhook>;

export const webhookAck = z.object({
  received: z.literal(true),
  /** What was done with it. "duplicate" and "not_on_chain" are acknowledgements, not errors. */
  outcome: z.enum(["recorded", "duplicate", "not_on_chain"]),
});
export type WebhookAck = z.infer<typeof webhookAck>;
