import { z } from "zod";

import { microAmount } from "./ledger";
import { advertiserView, offerSide, santimAmount } from "./offers";
import { paymentInstructions, paymentMethodKind } from "./payment-methods";

/*
  Trades: one acceptance of an offer, from escrow lock to settlement
  (docs/architecture/state-machines.md 3).

  The USDT side is the platform's: locked in a per-trade escrow account the
  moment the trade opens, and moved exactly once when it closes. The birr
  side is the parties' own, outside the platform, which is why a trade
  carries the seller's payment instructions, a deadline, and a chat - and
  why the two words that matter most are "I have paid", which moves nothing,
  and "release", which the seller alone can say.
*/

export const tradeStatus = z.enum([
  "AWAITING_FIAT_PAYMENT",
  "BUYER_MARKED_PAID",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
  "DISPUTED",
  "REFUNDED",
]);
export type TradeStatus = z.infer<typeof tradeStatus>;

/** The viewer's side of a trade. */
export const tradeRole = z.enum(["BUYER", "SELLER"]);
export type TradeRole = z.infer<typeof tradeRole>;

export const tradeEventKind = z.enum([
  "CREATED",
  "MARKED_PAID",
  "CANCELLED",
  "EXPIRED",
  "RELEASED",
  "DISPUTE_OPENED",
  "DISPUTE_WITHDRAWN",
  "DISPUTE_RESOLVED",
]);
export type TradeEventKind = z.infer<typeof tradeEventKind>;

const positiveInteger = (what: string) =>
  z
    .string()
    .regex(/^\d+$/, { error: `Enter ${what}.` })
    .refine((value) => BigInt(value) > 0n, { error: `Enter ${what}.` })
    .refine((value) => value.length <= 20, { error: "That is too large." });

/**
 * Taking an offer. The taker names either the USDT or the birr, and the
 * server works out the other at the offer's price - the pair it answers with
 * is what the trade is for, exactly, and never more birr than was typed.
 *
 * Which rail: on a SELL offer the buyer picks one of the seller's kinds; on
 * a BUY offer the taker is the seller and names one of their own methods.
 */
export const createTradeRequest = z
  .object({
    offerId: z.uuid(),
    amount: positiveInteger("an amount").optional(),
    fiatSantim: positiveInteger("an amount").optional(),
    paymentKind: paymentMethodKind.optional(),
    paymentMethodId: z.uuid().optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.amount === undefined) === (value.fiatSantim === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["amount"],
        message: "Enter how much USDT or how much birr, one of the two.",
      });
    }
  });
export type CreateTradeRequest = z.infer<typeof createTradeRequest>;

/** "I have paid". A reference the buyer's bank or wallet gave them, if they have one. */
export const markPaidRequest = z.object({
  reference: z.string().trim().max(80).optional(),
});
export type MarkPaidRequest = z.infer<typeof markPaidRequest>;

/**
 * Releasing the USDT. The seller's password again, for this one act
 * (state-machines.md: "step-up auth passed"): it is the moment money changes
 * hands, and a session someone walked away from must not be enough.
 */
export const releaseTradeRequest = z.object({
  password: z.string().min(1, { error: "Enter your password to confirm." }),
});
export type ReleaseTradeRequest = z.infer<typeof releaseTradeRequest>;

export const cancelTradeRequest = z.object({
  reason: z.string().trim().max(200).optional(),
});
export type CancelTradeRequest = z.infer<typeof cancelTradeRequest>;

/** What the viewer may do to this trade right now. The server says; the browser never infers. */
export const tradeActions = z.object({
  canMarkPaid: z.boolean(),
  canCancel: z.boolean(),
  canRelease: z.boolean(),
  canDispute: z.boolean(),
  canWithdrawDispute: z.boolean(),
  /** Whether the chat still accepts messages. */
  canChat: z.boolean(),
});
export type TradeActions = z.infer<typeof tradeActions>;

export const tradeDisputeSummary = z.object({
  id: z.string(),
  status: z.enum(["OPEN", "WITHDRAWN", "RESOLVED"]),
  reason: z.enum([
    "PAYMENT_NOT_RECEIVED",
    "PAYMENT_NOT_RELEASED",
    "WRONG_AMOUNT",
    "THIRD_PARTY_PAYMENT",
    "SUSPECTED_FRAUD",
    "OTHER",
  ]),
  openedByMe: z.boolean(),
  outcome: z.enum(["RELEASE_TO_BUYER", "REFUND_TO_SELLER"]).nullable(),
  /** The resolver's words to the parties, once decided. */
  resolutionNote: z.string().nullable(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
});
export type TradeDisputeSummary = z.infer<typeof tradeDisputeSummary>;

/** One trade as one of its parties sees it. */
export const tradeView = z.object({
  id: z.string(),
  offerId: z.string(),
  offerSide,
  role: tradeRole,
  status: tradeStatus,
  /** What to tell this party about where things stand. Null when the status speaks for itself. */
  message: z.string().nullable(),

  asset: z.string(),
  amount: microAmount,
  fee: microAmount,
  /** What the buyer's balance rises by at release: amount less the fee. */
  buyerReceives: microAmount,
  fiat: z.string(),
  priceSantim: santimAmount,
  fiatSantim: santimAmount,

  counterparty: advertiserView,

  payment: z.object({
    kind: paymentMethodKind,
    label: z.string(),
    /**
     * Where to pay. The seller's own, always; the buyer's to see while the
     * trade is open, and gone once it closes - a closed trade has no reason
     * to keep showing somebody's account number.
     */
    instructions: paymentInstructions.nullable(),
    /** What the buyer said their bank called the transfer, if anything. */
    reference: z.string().nullable(),
  }),

  paymentDeadline: z.string(),
  paidAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  closeReason: z.string().nullable(),

  dispute: tradeDisputeSummary.nullable(),
  actions: tradeActions,

  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TradeView = z.infer<typeof tradeView>;

export const tradeEventView = z.object({
  id: z.string(),
  kind: tradeEventKind,
  /** Who did it, from the viewer's side of the table. */
  actor: z.enum(["ME", "COUNTERPARTY", "ADMIN", "SYSTEM"]),
  data: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
});
export type TradeEventView = z.infer<typeof tradeEventView>;

export const tradesQuery = z.object({
  /** Open: anything not settled. Closed: everything that is. */
  scope: z.enum(["open", "closed"]).default("open"),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type TradesQuery = z.infer<typeof tradesQuery>;

export const tradesResponse = z.object({
  trades: z.array(tradeView),
  nextCursor: z.string().nullable(),
});
export type TradesResponse = z.infer<typeof tradesResponse>;

export const tradeEventsResponse = z.object({ events: z.array(tradeEventView) });
export type TradeEventsResponse = z.infer<typeof tradeEventsResponse>;
