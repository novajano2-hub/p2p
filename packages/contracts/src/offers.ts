import { z } from "zod";

import { microAmount } from "./ledger";
import { paymentMethodKind } from "./payment-methods";

/*
  Offers: the advertisements the marketplace is made of.

  An offer names a side, a price, an amount and limits; a trade is one
  acceptance of it. Nothing is locked by posting one - the escrow is taken
  from the seller when a trade opens (ADR-0004) - so what a taker sees as
  "available" is what could actually be taken this minute, not what was
  typed.

  USDT is millionths as everywhere (AT-21); birr is santim, hundredths of a
  birr, also as an integer string. A price is santim per one USDT: 158.50
  birr is "15850".
*/

export const offerSide = z.enum(["BUY", "SELL"]);
export type OfferSide = z.infer<typeof offerSide>;

export const offerStatus = z.enum(["ACTIVE", "PAUSED", "CLOSED"]);
export type OfferStatus = z.infer<typeof offerStatus>;

/** The one fiat currency at launch. */
export const FIAT_CURRENCY = "ETB";

/** An integer number of santim (hundredths of a birr), as text. */
export const santimAmount = z.string().regex(/^\d+$/);
export type SantimAmount = z.infer<typeof santimAmount>;

/** How long a buyer may take to pay. The choices Binance offers, in minutes. */
export const PAYMENT_WINDOWS_MINUTES = [15, 30, 45, 60] as const;
export const paymentWindowMinutes = z.literal([...PAYMENT_WINDOWS_MINUTES]);
export type PaymentWindowMinutes = z.infer<typeof paymentWindowMinutes>;

/**
 * Sanity bounds, not policy: a price outside these is a typo, and a limit
 * below a birr is not a trade. All in santim.
 */
export const OFFER_BOUNDS = {
  /** 1 birr per USDT. */
  minPriceSantim: 100,
  /** 100,000 birr per USDT. */
  maxPriceSantim: 10_000_000,
  /** 1 birr. */
  minLimitSantim: 100,
  /** How many rails one offer may name. */
  maxPaymentMethods: 5,
  termsMaxLength: 1_000,
  autoReplyMaxLength: 500,
} as const;

const positiveSantim = (what: string) =>
  santimAmount
    .refine((value) => BigInt(value) > 0n, { error: `Enter ${what}.` })
    .refine((value) => value.length <= 20, { error: "That is too large." });

const positiveMicro = z
  .string()
  .regex(/^\d+$/, { error: "Enter an amount." })
  .refine((value) => BigInt(value) > 0n, { error: "Enter an amount." })
  .refine((value) => value.length <= 20, { error: "That is too large." });

const offerBody = z.object({
  /** Santim per USDT. */
  priceSantim: positiveSantim("a price").refine(
    (value) =>
      BigInt(value) >= BigInt(OFFER_BOUNDS.minPriceSantim) &&
      BigInt(value) <= BigInt(OFFER_BOUNDS.maxPriceSantim),
    { error: "That price does not look right." },
  ),
  /** Millionths of a USDT the offer is for, in total. */
  totalAmount: positiveMicro,
  /** What one trade may be worth, in santim. */
  minSantim: positiveSantim("a minimum"),
  maxSantim: positiveSantim("a maximum"),
  paymentWindowMinutes,
  /** SELL offers: the seller's own methods, by id, where the buyer will pay. */
  paymentMethodIds: z.array(z.uuid()).max(OFFER_BOUNDS.maxPaymentMethods).optional(),
  /** BUY offers: the rails the buyer can pay through. */
  paymentKinds: z.array(paymentMethodKind).max(OFFER_BOUNDS.maxPaymentMethods).optional(),
  terms: z.string().trim().max(OFFER_BOUNDS.termsMaxLength).optional(),
  autoReply: z.string().trim().max(OFFER_BOUNDS.autoReplyMaxLength).optional(),
  requireVerified: z.boolean().optional(),
  minCompletedTrades: z.number().int().min(0).max(10_000).optional(),
});

export const createOfferRequest = offerBody
  .extend({ side: offerSide })
  .superRefine((value, ctx) => {
    if (BigInt(value.minSantim) > BigInt(value.maxSantim)) {
      ctx.addIssue({
        code: "custom",
        path: ["maxSantim"],
        message: "The maximum must be at least the minimum.",
      });
    }
    if (BigInt(value.minSantim) < BigInt(OFFER_BOUNDS.minLimitSantim)) {
      ctx.addIssue({ code: "custom", path: ["minSantim"], message: "At least 1 birr." });
    }
    if (value.side === "SELL" && !(value.paymentMethodIds && value.paymentMethodIds.length > 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["paymentMethodIds"],
        message: "Choose at least one way to be paid.",
      });
    }
    if (value.side === "BUY" && !(value.paymentKinds && value.paymentKinds.length > 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["paymentKinds"],
        message: "Choose at least one way you will pay.",
      });
    }
  });
export type CreateOfferRequest = z.infer<typeof createOfferRequest>;

/**
 * Editing. Everything but the side, and only what is sent changes; the
 * server re-checks the whole offer against the merged result. Changing the
 * total keeps what open trades have already taken.
 */
export const updateOfferRequest = offerBody.partial().superRefine((value, ctx) => {
  if (
    value.minSantim !== undefined &&
    value.maxSantim !== undefined &&
    BigInt(value.minSantim) > BigInt(value.maxSantim)
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["maxSantim"],
      message: "The maximum must be at least the minimum.",
    });
  }
});
export type UpdateOfferRequest = z.infer<typeof updateOfferRequest>;

export const offerPaymentMethodView = z.object({
  kind: paymentMethodKind,
  /** Set on a SELL offer: which of the seller's methods. Null on a BUY offer. */
  paymentMethodId: z.string().nullable(),
  label: z.string().nullable(),
});
export type OfferPaymentMethodView = z.infer<typeof offerPaymentMethodView>;

/** An offer as its owner sees it. */
export const offerView = z.object({
  id: z.string(),
  side: offerSide,
  asset: z.string(),
  fiat: z.string(),
  priceSantim: santimAmount,
  totalAmount: microAmount,
  remainingAmount: microAmount,
  minSantim: santimAmount,
  maxSantim: santimAmount,
  paymentWindowMinutes,
  paymentMethods: z.array(offerPaymentMethodView),
  terms: z.string().nullable(),
  autoReply: z.string().nullable(),
  requireVerified: z.boolean(),
  minCompletedTrades: z.number().int().nonnegative(),
  status: offerStatus,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type OfferView = z.infer<typeof offerView>;

export const myOffersResponse = z.object({ offers: z.array(offerView) });
export type MyOffersResponse = z.infer<typeof myOffersResponse>;

/**
 * The advertiser as a taker sees them: a username and a track record. Never
 * an email, never an account number, never a balance.
 */
export const advertiserView = z.object({
  userId: z.string(),
  username: z.string(),
  verified: z.boolean(),
  tradesTotal: z.number().int().nonnegative(),
  tradesCompleted: z.number().int().nonnegative(),
  /** Whole percent, or null until there is something to count. */
  completionRate: z.number().int().min(0).max(100).nullable(),
  avgReleaseSeconds: z.number().int().nonnegative().nullable(),
  avgPaySeconds: z.number().int().nonnegative().nullable(),
});
export type AdvertiserView = z.infer<typeof advertiserView>;

/**
 * An offer as the marketplace shows it. `available` is what could be taken
 * right now - for a SELL offer the lesser of what remains and what the
 * seller can currently fund - and `maxSantim` is capped by it, so the
 * limits on screen are limits a trade could actually meet.
 */
export const marketplaceOffer = z.object({
  id: z.string(),
  side: offerSide,
  asset: z.string(),
  fiat: z.string(),
  priceSantim: santimAmount,
  available: microAmount,
  minSantim: santimAmount,
  maxSantim: santimAmount,
  paymentWindowMinutes,
  paymentKinds: z.array(paymentMethodKind),
  terms: z.string().nullable(),
  requireVerified: z.boolean(),
  minCompletedTrades: z.number().int().nonnegative(),
  advertiser: advertiserView,
  /** The viewer's own, shown so they can see their place in the list, and not takeable. */
  isMine: z.boolean(),
});
export type MarketplaceOffer = z.infer<typeof marketplaceOffer>;

export const marketplaceQuery = z.object({
  /** What the viewer wants to do. BUY lists SELL offers, and the other way round. */
  want: offerSide,
  /** A birr amount the viewer means to trade: offers whose limits exclude it are left out. */
  amountSantim: santimAmount.optional(),
  paymentKind: paymentMethodKind.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type MarketplaceQuery = z.infer<typeof marketplaceQuery>;

export const marketplaceResponse = z.object({
  offers: z.array(marketplaceOffer),
  /** Pass back as `cursor` for the next page; null at the end. */
  nextCursor: z.string().nullable(),
});
export type MarketplaceResponse = z.infer<typeof marketplaceResponse>;
