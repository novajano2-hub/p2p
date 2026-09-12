import { z } from "zod";

import { chainNetwork } from "./deposits";
import { microAmount } from "./ledger";

/*
  Where the chain and the ledger disagree, and what a person does about it.

  The reconciler is read-only by design (ADR-0009): it compares what the chain
  holds against what the ledger says it holds, and raises a break. It never
  posts a correcting entry, because "the books disagree with reality" is not
  something software should resolve on its own - one direction is money we may
  owe somebody, and the other is a loss.
*/

export const breakKind = z.enum(["SURPLUS", "SHORTFALL"]);
export type BreakKind = z.infer<typeof breakKind>;

export const breakStatus = z.enum(["OPEN", "RESOLVED", "DISMISSED"]);
export type BreakStatus = z.infer<typeof breakStatus>;

export const reconciliationBreakView = z.object({
  id: z.string(),
  network: chainNetwork,
  asset: z.string(),
  accountCode: z.string(),
  kind: breakKind,
  status: breakStatus,
  /** All in millionths. `difference` is positive; `kind` carries the direction. */
  ledgerBalance: microAmount,
  chainBalance: microAmount,
  difference: microAmount,
  detectedAt: z.string(),
  lastSeenAt: z.string(),
  resolvedBy: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  resolutionReason: z.string().nullable(),
  adjustmentTransactionId: z.string().nullable(),
  correlationId: z.string(),
});
export type ReconciliationBreakView = z.infer<typeof reconciliationBreakView>;

export const reconciliationBreaksResponse = z.object({
  breaks: z.array(reconciliationBreakView),
  open: z.number().int().nonnegative(),
});
export type ReconciliationBreaksResponse = z.infer<typeof reconciliationBreaksResponse>;

/** One position, as the last pass saw it. Read-only; nothing here was posted. */
export const reconciliationPosition = z.object({
  accountCode: z.string(),
  ledgerBalance: microAmount,
  chainBalance: microAmount,
  difference: microAmount,
  /** What was compared, in words, so the arithmetic can be checked by hand. */
  describes: z.string(),
  agrees: z.boolean(),
});
export type ReconciliationPosition = z.infer<typeof reconciliationPosition>;

export const reconciliationReport = z.object({
  checkedAt: z.string(),
  network: chainNetwork,
  agrees: z.boolean(),
  positions: z.array(reconciliationPosition),
  /** Raised or refreshed by this pass. */
  breaksOpen: z.number().int().nonnegative(),
  /** Assets the ledger says we control, including what is mid-transaction. */
  ledgerAssets: microAmount,
  /** What the chain shows at every address we control. */
  chainAssets: microAmount,
  /** Ledger assets that are mid-transaction and so invisible on any address. */
  inTransit: microAmount,
});
export type ReconciliationReport = z.infer<typeof reconciliationReport>;

/**
 * What a person does about a break. RECORD_SURPLUS posts JE-11, booking coins
 * we did not expect as something we may owe rather than as revenue.
 * WRITE_OFF_SHORTFALL posts JE-12, which the platform's own equity absorbs -
 * customer balances are never quietly reduced to cover a platform loss.
 * DISMISS posts nothing and is for a break that turned out to be explained.
 */
export const resolveBreakRequest = z.object({
  action: z.enum(["RECORD_SURPLUS", "WRITE_OFF_SHORTFALL", "DISMISS"]),
  reason: z.string().trim().min(10).max(1000),
});
export type ResolveBreakRequest = z.infer<typeof resolveBreakRequest>;

/* ----------------------------------------------------------------- sweeps */

export const sweepStatus = z.enum(["PENDING", "BROADCAST", "CONFIRMED", "FAILED"]);
export type SweepStatus = z.infer<typeof sweepStatus>;

export const sweepView = z.object({
  id: z.string(),
  network: chainNetwork,
  asset: z.string(),
  amount: microAmount,
  status: sweepStatus,
  address: z.string(),
  txHash: z.string().nullable(),
  attempts: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SweepView = z.infer<typeof sweepView>;

export const sweepsResponse = z.object({
  sweeps: z.array(sweepView),
  /** Waiting at attribution addresses, not yet swept. Millionths. */
  unswept: microAmount,
});
export type SweepsResponse = z.infer<typeof sweepsResponse>;
