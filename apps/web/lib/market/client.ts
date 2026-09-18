import { z } from "zod";

import { apiOrigin } from "@/lib/api-origin";
import { send, type Failure } from "@/lib/auth/client";

/*
  The marketplace's calls: payment methods, offers, trades, the chat inside
  a trade, and disputes. Shapes are re-declared here rather than imported
  from @abay/contracts, as everywhere else in this app, so the browser
  bundle stays independent of the API's build; only the fields a screen
  reads are declared. Every amount is an integer string - millionths of a
  USDT, or santim of a birr - and is handed to lib/money.ts or
  lib/market/money.ts to become digits. No screen sees a number.

  It shares lib/auth/client.ts's request helper because the CSRF token the
  API issues lives in that module; a second copy would hold a token it
  never receives and every write would be refused.
*/

const money = z.string().regex(/^-?\d+$/);

export type Result<T> = ({ ok: true } & T) | Failure;

/** A photograph over a mobile connection needs far longer than a form does. */
const UPLOAD_TIMEOUT_MS = 120_000;

/* --------------------------------------------------------- payment methods */

export const paymentMethodKind = z.enum([
  "TELEBIRR",
  "CBE_BIRR",
  "MPESA",
  "CBE",
  "DASHEN",
  "ABYSSINIA",
  "AWASH",
]);
export type PaymentMethodKind = z.infer<typeof paymentMethodKind>;

const paymentMethodSchema = z.object({
  id: z.string(),
  kind: paymentMethodKind,
  /** "Telebirr ····4821", composed by the server. */
  label: z.string(),
  hint: z.string(),
  status: z.enum(["ACTIVE", "ARCHIVED"]),
  createdAt: z.string(),
});
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

const instructionsSchema = z.object({
  kind: paymentMethodKind,
  accountHolder: z.string(),
  accountNumber: z.string(),
});
export type PaymentInstructions = z.infer<typeof instructionsSchema>;

export type NewPaymentMethod =
  | { kind: "TELEBIRR" | "CBE_BIRR" | "MPESA"; accountHolder: string; phone: string }
  | {
      kind: "CBE" | "DASHEN" | "ABYSSINIA" | "AWASH";
      accountHolder: string;
      accountNumber: string;
    };

/* ------------------------------------------------------------------ offers */

export const offerSide = z.enum(["BUY", "SELL"]);
export type OfferSide = z.infer<typeof offerSide>;
export const offerStatus = z.enum(["ACTIVE", "PAUSED", "CLOSED"]);
export type OfferStatus = z.infer<typeof offerStatus>;

const advertiserSchema = z.object({
  userId: z.string(),
  username: z.string(),
  verified: z.boolean(),
  /** Seen in the last five minutes. */
  online: z.boolean(),
  /** When they were last seen, to the minute; null when there is no record of it. */
  lastSeenAt: z.string().nullable(),
  tradesTotal: z.number(),
  tradesCompleted: z.number(),
  completionRate: z.number().nullable(),
  avgReleaseSeconds: z.number().nullable(),
  avgPaySeconds: z.number().nullable(),
});
export type Advertiser = z.infer<typeof advertiserSchema>;

const marketOfferSchema = z.object({
  id: z.string(),
  side: offerSide,
  priceSantim: money,
  /** What could be taken right now, in millionths. */
  available: money,
  minSantim: money,
  maxSantim: money,
  paymentWindowMinutes: z.number(),
  paymentKinds: z.array(paymentMethodKind),
  terms: z.string().nullable(),
  requireVerified: z.boolean(),
  minCompletedTrades: z.number(),
  advertiser: advertiserSchema,
  /** What the ad's terms are a version of: an order quotes it back. */
  revision: z.number(),
  isMine: z.boolean(),
  /** Why the viewer could not take it, which the server would refuse; null when they could. */
  blockedBecause: z.enum(["VERIFICATION", "COMPLETED_TRADES"]).nullable(),
});
export type MarketOffer = z.infer<typeof marketOfferSchema>;

const marketplaceSchema = z.object({
  offers: z.array(marketOfferSchema),
  nextCursor: z.string().nullable(),
});

const myOfferSchema = z.object({
  id: z.string(),
  side: offerSide,
  priceSantim: money,
  totalAmount: money,
  remainingAmount: money,
  minSantim: money,
  maxSantim: money,
  paymentWindowMinutes: z.number(),
  paymentMethods: z.array(
    z.object({
      kind: paymentMethodKind,
      paymentMethodId: z.string().nullable(),
      label: z.string().nullable(),
    }),
  ),
  terms: z.string().nullable(),
  autoReply: z.string().nullable(),
  requireVerified: z.boolean(),
  minCompletedTrades: z.number(),
  status: offerStatus,
  revision: z.number(),
  /** Orders from this ad that are still running. Closing the ad leaves them alone. */
  openOrders: z.number(),
  /** What a taker could take right now: a sell ad's remainder, capped by the owner's balance. */
  adBalance: money,
  /** Why the market is not showing it although it is on - or would not, once switched back on. */
  hiddenBecause: z.enum(["BALANCE", "REMAINDER"]).nullable(),
  /** When the balance stopped covering it, as the platform last checked. */
  unfundedSince: z.string().nullable(),
  /** When it goes offline by itself unless the balance covers it again. */
  pausesAt: z.string().nullable(),
  createdAt: z.string(),
});
export type MyOffer = z.infer<typeof myOfferSchema>;

export type OfferDraft = {
  priceSantim: string;
  totalAmount: string;
  minSantim: string;
  maxSantim: string;
  paymentWindowMinutes: number;
  paymentMethodIds?: string[];
  paymentKinds?: PaymentMethodKind[];
  terms?: string;
  autoReply?: string;
  requireVerified?: boolean;
  minCompletedTrades?: number;
};

/* ------------------------------------------------------------------ trades */

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
export const tradeRole = z.enum(["BUYER", "SELLER"]);
export type TradeRole = z.infer<typeof tradeRole>;

export const disputeStatus = z.enum(["OPEN", "WITHDRAWN", "RESOLVED"]);
export const disputeReason = z.enum([
  "PAYMENT_NOT_RECEIVED",
  "PAYMENT_NOT_RELEASED",
  "WRONG_AMOUNT",
  "THIRD_PARTY_PAYMENT",
  "SUSPECTED_FRAUD",
  "OTHER",
]);
export type DisputeReason = z.infer<typeof disputeReason>;
export const disputeOutcome = z.enum(["RELEASE_TO_BUYER", "REFUND_TO_SELLER"]);

const tradeDisputeSummarySchema = z.object({
  id: z.string(),
  status: disputeStatus,
  reason: disputeReason,
  openedByMe: z.boolean(),
  outcome: disputeOutcome.nullable(),
  resolutionNote: z.string().nullable(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
});

const tradeSchema = z.object({
  id: z.string(),
  offerId: z.string(),
  offerSide,
  role: tradeRole,
  status: tradeStatus,
  /** What to tell this party about where things stand, or null. */
  message: z.string().nullable(),
  amount: money,
  fee: money,
  buyerReceives: money,
  priceSantim: money,
  fiatSantim: money,
  counterparty: advertiserSchema,
  payment: z.object({
    kind: paymentMethodKind,
    label: z.string(),
    instructions: instructionsSchema.nullable(),
    reference: z.string().nullable(),
  }),
  /** The advertiser's terms as they stood when this order opened. */
  terms: z.string().nullable(),
  paymentDeadline: z.string(),
  paidAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  closeReason: z.string().nullable(),
  dispute: tradeDisputeSummarySchema.nullable(),
  chat: z.object({ lastSeq: z.number(), unread: z.number() }),
  actions: z.object({
    canMarkPaid: z.boolean(),
    canCancel: z.boolean(),
    canRelease: z.boolean(),
    canDispute: z.boolean(),
    canWithdrawDispute: z.boolean(),
    canChat: z.boolean(),
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Trade = z.infer<typeof tradeSchema>;

const tradesSchema = z.object({ trades: z.array(tradeSchema), nextCursor: z.string().nullable() });

const tradeEventSchema = z.object({
  id: z.string(),
  kind: z.string(),
  actor: z.enum(["ME", "COUNTERPARTY", "ADMIN", "SYSTEM"]),
  data: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
});
export type TradeEvent = z.infer<typeof tradeEventSchema>;

/* -------------------------------------------------------------------- chat */

const messageSchema = z.object({
  id: z.string(),
  tradeId: z.string(),
  seq: z.number(),
  senderId: z.string(),
  kind: z.enum(["TEXT", "IMAGE"]),
  body: z.string().nullable(),
  image: z.object({ contentType: z.string(), sizeBytes: z.number() }).nullable(),
  clientMessageId: z.string(),
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof messageSchema>;

const messagesSchema = z.object({
  messages: z.array(messageSchema),
  lastSeq: z.number(),
  myLastReadSeq: z.number(),
  theirLastReadSeq: z.number(),
  open: z.boolean(),
});
export type ChatPage = z.infer<typeof messagesSchema>;

/* ---------------------------------------------------------------- disputes */

const evidenceSchema = z.object({
  id: z.string(),
  uploadedBy: tradeRole,
  contentType: z.string(),
  sizeBytes: z.number(),
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type Evidence = z.infer<typeof evidenceSchema>;

const disputeSchema = z.object({
  id: z.string(),
  tradeId: z.string(),
  status: disputeStatus,
  reason: disputeReason,
  description: z.string(),
  openedBy: tradeRole,
  openedByMe: z.boolean(),
  outcome: disputeOutcome.nullable(),
  resolutionNote: z.string().nullable(),
  evidence: z.array(evidenceSchema),
  evidenceLeft: z.number(),
  createdAt: z.string(),
  withdrawnAt: z.string().nullable(),
  resolvedAt: z.string().nullable(),
});
export type Dispute = z.infer<typeof disputeSchema>;

/* ------------------------------------------------------------------ client */

const empty = z.undefined();

const wrap =
  <K extends string>(key: K) =>
  <T>(result: { ok: true; data: T } | Failure): Result<{ [P in K]: T }> =>
    result.ok ? ({ ok: true, [key]: result.data } as { ok: true } & { [P in K]: T }) : result;

const post = <T>(
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
  headers?: Record<string, string>,
) => send(path, schema, { method: "POST", body: JSON.stringify(body), headers: headers ?? {} });

/** An image as the raw request body, under its own type, with the longer timeout a photo needs. */
const upload = <T>(path: string, file: Blob, schema: z.ZodType<T>) =>
  send(
    path,
    schema,
    { method: "POST", body: file, headers: { "content-type": file.type } },
    UPLOAD_TIMEOUT_MS,
  );

const query = (params: Record<string, string | number | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
};

export const marketClient = {
  /* payment methods */
  paymentMethods: () =>
    send(
      "/v1/payment-methods",
      z.object({ paymentMethods: z.array(paymentMethodSchema) }),
      {},
    ).then((result) =>
      result.ok ? { ok: true as const, paymentMethods: result.data.paymentMethods } : result,
    ),
  addPaymentMethod: (input: NewPaymentMethod) =>
    post("/v1/payment-methods", input, paymentMethodSchema).then(wrap("paymentMethod")),
  archivePaymentMethod: (id: string) =>
    send(`/v1/payment-methods/${id}`, empty, { method: "DELETE" }).then(wrap("done")),

  /* offers */
  marketplace: (input: {
    want: OfferSide;
    amountSantim?: string | undefined;
    paymentKind?: PaymentMethodKind | undefined;
    /** Only ads that give the buyer at least this long to pay. */
    minPaymentWindowMinutes?: number | undefined;
    /** Leave out what the viewer could not take. */
    takeable?: boolean | undefined;
    cursor?: string | undefined;
    limit?: number | undefined;
  }) =>
    send(
      `/v1/offers${query({ ...input, takeable: input.takeable ? "true" : undefined })}`,
      marketplaceSchema,
      {},
    ).then((result) => (result.ok ? { ok: true as const, ...result.data } : result)),
  offer: (id: string) => send(`/v1/offers/${id}`, marketOfferSchema, {}).then(wrap("offer")),
  myOffers: () =>
    send("/v1/offers/mine", z.object({ offers: z.array(myOfferSchema) }), {}).then((result) =>
      result.ok ? { ok: true as const, offers: result.data.offers } : result,
    ),
  myOffer: (id: string) => send(`/v1/offers/${id}/mine`, myOfferSchema, {}).then(wrap("offer")),
  createOffer: (input: OfferDraft & { side: OfferSide }) =>
    post("/v1/offers", input, myOfferSchema).then(wrap("offer")),
  updateOffer: (id: string, input: Partial<OfferDraft>) =>
    send(`/v1/offers/${id}`, myOfferSchema, { method: "PATCH", body: JSON.stringify(input) }).then(
      wrap("offer"),
    ),
  setOfferStatus: (id: string, action: "pause" | "resume" | "close") =>
    post(`/v1/offers/${id}/${action}`, {}, myOfferSchema).then(wrap("offer")),

  /* trades */
  trades: (scope: "open" | "closed", cursor?: string) =>
    send(`/v1/trades${query({ scope, cursor })}`, tradesSchema, {}).then((result) =>
      result.ok ? { ok: true as const, ...result.data } : result,
    ),
  trade: (id: string) => send(`/v1/trades/${id}`, tradeSchema, {}).then(wrap("trade")),
  tradeEvents: (id: string) =>
    send(`/v1/trades/${id}/events`, z.object({ events: z.array(tradeEventSchema) }), {}).then(
      (result) => (result.ok ? { ok: true as const, events: result.data.events } : result),
    ),
  createTrade: (
    input: {
      offerId: string;
      /** The ad's version as the screen had it; the server refuses an order on a moved ad. */
      offerRevision: number;
      amount?: string;
      fiatSantim?: string;
      paymentKind?: PaymentMethodKind;
      paymentMethodId?: string;
    },
    idempotencyKey: string,
  ) =>
    post("/v1/trades", input, tradeSchema, { "Idempotency-Key": idempotencyKey }).then(
      wrap("trade"),
    ),
  markPaid: (id: string, reference: string) =>
    post(`/v1/trades/${id}/paid`, reference ? { reference } : {}, tradeSchema).then(wrap("trade")),
  cancelTrade: (id: string, reason: string) =>
    post(`/v1/trades/${id}/cancel`, reason ? { reason } : {}, tradeSchema).then(wrap("trade")),
  releaseTrade: (id: string, password: string) =>
    post(`/v1/trades/${id}/release`, { password }, tradeSchema).then(wrap("trade")),

  /* chat */
  messages: (tradeId: string, after = 0) =>
    send(`/v1/trades/${tradeId}/messages${query({ after, limit: 200 })}`, messagesSchema, {}).then(
      (result) => (result.ok ? { ok: true as const, ...result.data } : result),
    ),
  sendMessage: (tradeId: string, clientMessageId: string, body: string) =>
    post(`/v1/trades/${tradeId}/messages`, { clientMessageId, body }, messageSchema).then(
      wrap("message"),
    ),
  sendImage: (tradeId: string, clientMessageId: string, file: Blob) =>
    upload(`/v1/trades/${tradeId}/messages/images/${clientMessageId}`, file, messageSchema).then(
      wrap("message"),
    ),
  markRead: (tradeId: string, seq: number) =>
    post(`/v1/trades/${tradeId}/messages/read`, { seq }, empty).then(wrap("done")),
  chatImageUrl: (tradeId: string, messageId: string) =>
    `${apiOrigin()}/v1/trades/${tradeId}/messages/${messageId}/image`,

  /* disputes */
  dispute: (tradeId: string) =>
    send(`/v1/trades/${tradeId}/dispute`, disputeSchema, {}).then(wrap("dispute")),
  openDispute: (tradeId: string, input: { reason: DisputeReason; description: string }) =>
    post(`/v1/trades/${tradeId}/dispute`, input, disputeSchema).then(wrap("dispute")),
  withdrawDispute: (tradeId: string) =>
    post(`/v1/trades/${tradeId}/dispute/withdraw`, {}, disputeSchema).then(wrap("dispute")),
  addEvidence: (tradeId: string, file: Blob, note: string) =>
    upload(`/v1/trades/${tradeId}/dispute/evidence${query({ note })}`, file, evidenceSchema).then(
      wrap("evidence"),
    ),
  evidenceUrl: (tradeId: string, evidenceId: string) =>
    `${apiOrigin()}/v1/trades/${tradeId}/dispute/evidence/${evidenceId}`,
};

/** A fresh id for one intent: a message, a trade. Kept across retries, replaced on success. */
export const newClientId = (): string => crypto.randomUUID();
