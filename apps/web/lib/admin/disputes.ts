import { z } from "zod";

import { adminBlob, adminRequest, type Result } from "@/lib/admin/client";

/*
  The trades that went wrong, as the person who has to decide them reads it.

  Shapes are re-declared here rather than imported from @abay/contracts, like
  everything in lib/admin/client.ts, lib/admin/ledger.ts and
  lib/admin/operations.ts, so the browser bundle stays independent of the
  API's build. USDT is an integer string of millionths and birr an integer
  string of santim; nothing here does arithmetic on either, it only carries
  them to the formatters.

  Two things this module fetches are not JSON: a piece of evidence and an
  image somebody sent in the chat. Both come back as bytes from routes only a
  resolver may call, so they are fetched with the session rather than put in
  an <img src> the browser would request without one.
*/

const micro = z.string().regex(/^-?\d+$/);
const santim = z.string().regex(/^\d+$/);

export const DISPUTE_STATUSES = ["OPEN", "WITHDRAWN", "RESOLVED"] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

export const DISPUTE_REASONS = [
  "PAYMENT_NOT_RECEIVED",
  "PAYMENT_NOT_RELEASED",
  "WRONG_AMOUNT",
  "THIRD_PARTY_PAYMENT",
  "SUSPECTED_FRAUD",
  "OTHER",
] as const;
export type DisputeReason = (typeof DISPUTE_REASONS)[number];

/** The only two ways a dispute ends: the USDT goes on, or it goes back. */
export const DISPUTE_OUTCOMES = ["RELEASE_TO_BUYER", "REFUND_TO_SELLER"] as const;
export type DisputeOutcome = (typeof DISPUTE_OUTCOMES)[number];

export const TRADE_STATUSES = [
  "AWAITING_FIAT_PAYMENT",
  "BUYER_MARKED_PAID",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
  "DISPUTED",
  "REFUNDED",
] as const;
export type TradeStatus = (typeof TRADE_STATUSES)[number];

export const TRADE_EVENT_KINDS = [
  "CREATED",
  "MARKED_PAID",
  "CANCELLED",
  "EXPIRED",
  "RELEASED",
  "DISPUTE_OPENED",
  "DISPUTE_WITHDRAWN",
  "DISPUTE_RESOLVED",
] as const;
export type TradeEventKind = (typeof TRADE_EVENT_KINDS)[number];

export type TradeRole = "BUYER" | "SELLER";
export type PaymentKind =
  "TELEBIRR" | "CBE_BIRR" | "MPESA" | "CBE" | "DASHEN" | "ABYSSINIA" | "AWASH";

const role = z.enum(["BUYER", "SELLER"]);
const paymentKind = z.enum([
  "TELEBIRR",
  "CBE_BIRR",
  "MPESA",
  "CBE",
  "DASHEN",
  "ABYSSINIA",
  "AWASH",
]);

const customerSchema = z.object({
  userId: z.string(),
  platformId: z.string(),
  username: z.string(),
  email: z.string(),
  status: z.enum(["ACTIVE", "SUSPENDED", "CLOSED"]),
  kycStatus: z.enum(["NOT_STARTED", "PENDING", "APPROVED", "REJECTED"]),
});
export type DisputeCustomer = z.infer<typeof customerSchema>;

/** One side of the trade, with the record a resolver weighs them by. */
const partySchema = z.object({
  customer: customerSchema.nullable(),
  tradesTotal: z.number().int().nonnegative(),
  tradesCompleted: z.number().int().nonnegative(),
  tradesFailed: z.number().int().nonnegative(),
});
export type DisputeParty = z.infer<typeof partySchema>;

const tradeSchema = z.object({
  id: z.string(),
  offerSide: z.enum(["BUY", "SELL"]),
  status: z.enum(TRADE_STATUSES),
  amount: micro,
  fee: micro,
  priceSantim: santim,
  fiatSantim: santim,
  paymentKind,
  paymentLabel: z.string(),
  paymentReference: z.string().nullable(),
  createdAt: z.string(),
  paidAt: z.string().nullable(),
  paymentDeadline: z.string(),
  closedAt: z.string().nullable(),
  closeReason: z.string().nullable(),
});
export type DisputedTrade = z.infer<typeof tradeSchema>;

const evidenceSchema = z.object({
  id: z.string(),
  uploadedBy: role,
  contentType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type DisputeEvidence = z.infer<typeof evidenceSchema>;

const messageSchema = z.object({
  id: z.string(),
  tradeId: z.string(),
  seq: z.number().int().positive(),
  senderId: z.string(),
  kind: z.enum(["TEXT", "IMAGE"]),
  body: z.string().nullable(),
  image: z
    .object({ contentType: z.string(), sizeBytes: z.number().int().nonnegative() })
    .nullable(),
  clientMessageId: z.string(),
  createdAt: z.string(),
});
export type DisputeMessage = z.infer<typeof messageSchema>;

/** The timeline, with actors named absolutely rather than from one side of the table. */
const eventSchema = z.object({
  id: z.string(),
  kind: z.enum(TRADE_EVENT_KINDS),
  actor: z.enum(["BUYER", "SELLER", "ADMIN", "SYSTEM"]),
  data: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
});
export type DisputeEvent = z.infer<typeof eventSchema>;

const itemSchema = z.object({
  id: z.string(),
  status: z.enum(DISPUTE_STATUSES),
  reason: z.enum(DISPUTE_REASONS),
  description: z.string(),
  openedBy: role,
  outcome: z.enum(DISPUTE_OUTCOMES).nullable(),
  resolutionNote: z.string().nullable(),
  resolvedByEmail: z.string().nullable(),
  evidenceCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  withdrawnAt: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  correlationId: z.string(),
  trade: tradeSchema,
  buyer: partySchema,
  seller: partySchema,
});
export type AdminDispute = z.infer<typeof itemSchema>;

/*
  Everything a resolver may look at, in one response: where the buyer was told
  to pay (RESTRICTED, decrypted for this view alone), what both sides
  attached, everything they said to each other, and what the trade did. The
  API audits the read, so nothing here should be fetched idly.
*/
const detailSchema = itemSchema.extend({
  /** The advertiser's terms as they stood when the order opened, whatever the ad says now. */
  terms: z.string().nullable(),
  payment: z.object({
    kind: paymentKind,
    label: z.string(),
    instructions: z.object({
      kind: paymentKind,
      accountHolder: z.string(),
      accountNumber: z.string(),
    }),
  }),
  evidence: z.array(evidenceSchema),
  messages: z.array(messageSchema),
  events: z.array(eventSchema),
});
export type AdminDisputeDetail = z.infer<typeof detailSchema>;

const queueSchema = z.object({
  open: z.array(itemSchema),
  recent: z.array(itemSchema),
});

const get: RequestInit = { method: "GET" };

export const disputesClient = {
  /** Waiting for a decision, oldest first; then the last few that were decided. */
  async queue(): Promise<Result<{ open: AdminDispute[]; recent: AdminDispute[] }>> {
    const result = await adminRequest("/disputes", queueSchema, get);
    return result.ok ? { ok: true, ...result.data } : result;
  },

  async one(id: string): Promise<Result<{ dispute: AdminDisputeDetail }>> {
    const result = await adminRequest(`/disputes/${id}`, detailSchema, get);
    return result.ok ? { ok: true, dispute: result.data } : result;
  },

  /** Deciding. The note is not optional: both parties are sent it word for word. */
  async resolve(
    id: string,
    input: { outcome: DisputeOutcome; note: string },
  ): Promise<Result<{ dispute: AdminDispute }>> {
    const result = await adminRequest(`/disputes/${id}/resolve`, itemSchema, {
      method: "POST",
      body: JSON.stringify(input),
    });
    return result.ok ? { ok: true, dispute: result.data } : result;
  },

  /** A file one of the parties attached, as bytes the caller turns into an object URL. */
  evidence(disputeId: string, evidenceId: string): Promise<Blob | null> {
    return adminBlob(`/disputes/${disputeId}/evidence/${evidenceId}`);
  },

  /** An image from the trade's chat, named by the message that carried it. */
  chatImage(disputeId: string, messageId: string): Promise<Blob | null> {
    return adminBlob(`/disputes/${disputeId}/messages/${messageId}/image`);
  },
};
