import { z } from "zod";

import { adminCustomerSummary } from "./admin";
import { tradeMessageView } from "./chat";
import { microAmount } from "./ledger";
import { offerSide, santimAmount } from "./offers";
import { paymentInstructions, paymentMethodKind } from "./payment-methods";
import {
  disputeOutcome,
  disputeReason,
  disputeStatus,
  tradeEventKind,
  tradeRole,
  tradeStatus,
  type DisputeReason,
} from "./trades";

/*
  Disputes (state-machines.md 3, DISPUTED). Once the buyer has said "I have
  paid", either party may ask a person to look: the buyer because the
  seller will not release, the seller because nothing arrived, the wrong
  amount arrived, or it came from somebody else's account. The escrow stays
  locked while they do. A dispute ends one of three ways: the party who
  opened it withdraws, the seller releases after all, or an administrator
  with the DISPUTE_RESOLVER role decides - and that decision is
  ledger-identical to a release or a refund, with the difference kept in
  who acted, why, and what they looked at (AT-8).
*/

/** The reasons, in the words a person picks from. */
export const DISPUTE_REASONS: Record<DisputeReason, string> = {
  PAYMENT_NOT_RECEIVED: "I have not received the payment",
  PAYMENT_NOT_RELEASED: "I paid and the seller has not released",
  WRONG_AMOUNT: "The amount received is not the agreed amount",
  THIRD_PARTY_PAYMENT: "The payment came from somebody else's account",
  SUSPECTED_FRAUD: "I suspect fraud",
  OTHER: "Something else",
};

export const DISPUTE_DESCRIPTION_MAX_LENGTH = 1_000;
/** Files each party may attach to one dispute (threat model B5.4). */
export const DISPUTE_EVIDENCE_MAX_PER_PARTY = 5;
/** A screenshot of a transfer, the same cap as a chat image. */
export const DISPUTE_EVIDENCE_MAX_BYTES = 5 * 1024 * 1024;
export const DISPUTE_EVIDENCE_NOTE_MAX_LENGTH = 200;

const words = (what: string) =>
  z
    .string()
    .trim()
    .min(10, { error: `${what}, in at least a few words.` })
    .max(DISPUTE_DESCRIPTION_MAX_LENGTH, {
      error: `Keep it under ${DISPUTE_DESCRIPTION_MAX_LENGTH} characters.`,
    });

export const openDisputeRequest = z.object({
  reason: disputeReason,
  description: words("Say what happened"),
});
export type OpenDisputeRequest = z.infer<typeof openDisputeRequest>;

/** A caption for a file, since the file itself is the request body. */
export const disputeEvidenceQuery = z.object({
  note: z.string().trim().max(DISPUTE_EVIDENCE_NOTE_MAX_LENGTH).optional(),
});
export type DisputeEvidenceQuery = z.infer<typeof disputeEvidenceQuery>;

export const disputeEvidenceView = z.object({
  id: z.string(),
  /** Which side attached it. */
  uploadedBy: tradeRole,
  contentType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type DisputeEvidenceView = z.infer<typeof disputeEvidenceView>;

/** A dispute as one of the trade's parties sees it. */
export const disputeView = z.object({
  id: z.string(),
  tradeId: z.string(),
  status: disputeStatus,
  reason: disputeReason,
  description: z.string(),
  openedBy: tradeRole,
  openedByMe: z.boolean(),
  outcome: disputeOutcome.nullable(),
  /** The reviewer's words to both parties, once decided. */
  resolutionNote: z.string().nullable(),
  evidence: z.array(disputeEvidenceView),
  /** How many more files this party may attach; zero once the dispute is not open. */
  evidenceLeft: z.number().int().nonnegative(),
  createdAt: z.string(),
  withdrawnAt: z.string().nullable(),
  resolvedAt: z.string().nullable(),
});
export type DisputeView = z.infer<typeof disputeView>;

/* ---------------------------------------------------------------- admin */

/**
 * Deciding. The note is mandatory and goes to both parties word for word
 * (threat model B7.1: a decision without a stated reason is not one).
 */
export const resolveDisputeRequest = z.object({
  outcome: disputeOutcome,
  note: words("Say why"),
});
export type ResolveDisputeRequest = z.infer<typeof resolveDisputeRequest>;

/** One side of the trade, as the resolver needs to weigh them. */
export const adminDisputeParty = z.object({
  customer: adminCustomerSummary.nullable(),
  tradesTotal: z.number().int().nonnegative(),
  tradesCompleted: z.number().int().nonnegative(),
  tradesFailed: z.number().int().nonnegative(),
});
export type AdminDisputeParty = z.infer<typeof adminDisputeParty>;

export const adminDisputeTrade = z.object({
  id: z.string(),
  offerSide,
  status: tradeStatus,
  amount: microAmount,
  fee: microAmount,
  priceSantim: santimAmount,
  fiatSantim: santimAmount,
  paymentKind: paymentMethodKind,
  paymentLabel: z.string(),
  /** What the buyer said their bank called the transfer, if anything. */
  paymentReference: z.string().nullable(),
  createdAt: z.string(),
  paidAt: z.string().nullable(),
  paymentDeadline: z.string(),
  closedAt: z.string().nullable(),
  closeReason: z.string().nullable(),
});
export type AdminDisputeTrade = z.infer<typeof adminDisputeTrade>;

export const adminDisputeItem = z.object({
  id: z.string(),
  status: disputeStatus,
  reason: disputeReason,
  description: z.string(),
  openedBy: tradeRole,
  outcome: disputeOutcome.nullable(),
  resolutionNote: z.string().nullable(),
  resolvedByEmail: z.string().nullable(),
  evidenceCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  withdrawnAt: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  correlationId: z.string(),
  trade: adminDisputeTrade,
  buyer: adminDisputeParty,
  seller: adminDisputeParty,
});
export type AdminDisputeItem = z.infer<typeof adminDisputeItem>;

/** The trade's timeline, with the actors named absolutely rather than from one side of the table. */
export const adminTradeEvent = z.object({
  id: z.string(),
  kind: tradeEventKind,
  actor: z.enum(["BUYER", "SELLER", "ADMIN", "SYSTEM"]),
  data: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
});
export type AdminTradeEvent = z.infer<typeof adminTradeEvent>;

/** Everything a resolver may look at, in one place. Reading it is audited. */
export const adminDisputeDetail = adminDisputeItem.extend({
  /** Where the buyer was told to pay: RESTRICTED, decrypted for this view only. */
  payment: z.object({
    kind: paymentMethodKind,
    label: z.string(),
    instructions: paymentInstructions,
  }),
  evidence: z.array(disputeEvidenceView),
  messages: z.array(tradeMessageView),
  events: z.array(adminTradeEvent),
});
export type AdminDisputeDetail = z.infer<typeof adminDisputeDetail>;

export const adminDisputeQueueResponse = z.object({
  /** Waiting for a decision, oldest first. */
  open: z.array(adminDisputeItem),
  /** The last few decided or withdrawn, newest first, for context. */
  recent: z.array(adminDisputeItem),
});
export type AdminDisputeQueueResponse = z.infer<typeof adminDisputeQueueResponse>;
