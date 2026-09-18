import { z } from "zod";

import type { DisputeReason, OfferDraft, OfferSide, PaymentMethodKind } from "@/lib/market/client";
import { ASSET, DISPUTE_REASONS, FIAT } from "@/lib/market/labels";
import {
  amountForFiat,
  compareSantim,
  fiatForAmount,
  formatSantim,
  isZeroSantim,
  toSantim,
} from "@/lib/market/money";
import { compareMicro, formatMicro, isZeroMicro, toMicro } from "@/lib/money";

/*
  The market's forms, checked before they are sent: taking an ad, posting or
  editing one, opening a dispute, releasing. The server refuses every one of
  these by its own rules; these say the same thing sooner, beside the field
  that is wrong, instead of after a round trip.

  Amounts stay strings the whole way, parsed by the money modules into santim
  and millionths. No float is involved in deciding whether an amount is
  allowed, any more than in showing it.
*/

const birr = (santim: string): string => `${formatSantim(santim)} ${FIAT}`;
const usdt = (micro: string): string => `${formatMicro(micro)} ${ASSET}`;

/* ------------------------------------------------------------ taking an ad */

export type AmountMode = "fiat" | "usdt";

/** The limits a typed amount is held to: the ad's, as the screen has it now. */
export type OrderBounds = {
  mode: AmountMode;
  priceSantim: string;
  minSantim: string;
  maxSantim: string;
  /** Millionths of USDT left on the ad. */
  available: string;
  /**
   * What to say when no payment method is chosen, or null when there is nothing
   * to choose: one way only, chosen for the person.
   */
  railMissing: string | null;
};

/** Both sides of the pair a typed amount makes at a price, or null when it is not an amount. */
export function orderPair(
  typed: string,
  mode: AmountMode,
  priceSantim: string,
): { micro: string; santim: string } | null {
  if (mode === "fiat") {
    const santim = toSantim(typed);
    return santim ? { santim, micro: amountForFiat(santim, priceSantim) } : null;
  }
  const micro = toMicro(typed);
  return micro ? { micro, santim: fiatForAmount(micro, priceSantim) } : null;
}

/** What is wrong with a typed amount against an ad's limits, or null. */
export function amountProblem(typed: string, bounds: OrderBounds): string | null {
  const pair = orderPair(typed, bounds.mode, bounds.priceSantim);
  if (!pair || isZeroMicro(pair.micro) || isZeroSantim(pair.santim)) return "Enter an amount.";
  if (compareSantim(pair.santim, bounds.minSantim) < 0) {
    return `The smallest trade on this offer is ${birr(bounds.minSantim)}.`;
  }
  if (compareSantim(pair.santim, bounds.maxSantim) > 0) {
    return `The largest trade on this offer is ${birr(bounds.maxSantim)}.`;
  }
  if (compareMicro(pair.micro, bounds.available) > 0) {
    return `Only ${usdt(bounds.available)} is available right now.`;
  }
  return null;
}

/** Built for the ad as it is on screen, so a limit that moved is the limit checked. */
export const orderForm = (bounds: OrderBounds) =>
  z.object({
    amount: z.string().superRefine((typed, ctx) => {
      const problem = amountProblem(typed, bounds);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    }),
    rail: z.string().refine((value) => bounds.railMissing === null || value !== "", {
      error: bounds.railMissing ?? "",
    }),
  });
export type OrderForm = { amount: string; rail: string };

/* ---------------------------------------------------------- posting an ad */

export type AdForm = {
  side: OfferSide;
  price: string;
  total: string;
  min: string;
  max: string;
  window: number;
  methodIds: string[];
  kinds: PaymentMethodKind[];
  terms: string;
  autoReply: string;
  requireVerified: boolean;
  minCompletedTrades: string;
};

export const TERMS_MAX = 1_000;
export const AUTO_REPLY_MAX = 500;

/** Every problem with an ad, by field, in the order the form asks. */
export function adProblems(draft: AdForm): [keyof AdForm, string][] {
  const problems: [keyof AdForm, string][] = [];
  const price = toSantim(draft.price);
  const total = toMicro(draft.total);
  const min = toSantim(draft.min);
  const max = toSantim(draft.max);
  if (!price || isZeroSantim(price))
    problems.push(["price", `Enter the price in ${FIAT} per ${ASSET}.`]);
  if (!total || isZeroMicro(total))
    problems.push(["total", `Enter how much ${ASSET} the ad is for.`]);
  if (!min || isZeroSantim(min)) problems.push(["min", `Enter the smallest trade, in ${FIAT}.`]);
  if (!max || isZeroSantim(max)) {
    problems.push(["max", `Enter the largest trade, in ${FIAT}.`]);
  } else if (min && compareSantim(min, max) > 0) {
    problems.push(["max", "The largest trade must be at least the smallest."]);
  }
  if (draft.side === "SELL" && draft.methodIds.length === 0) {
    problems.push(["methodIds", "Choose at least one way to be paid."]);
  }
  if (draft.side === "BUY" && draft.kinds.length === 0) {
    problems.push(["kinds", "Choose at least one way you will pay."]);
  }
  if (draft.terms.trim().length > TERMS_MAX) {
    problems.push(["terms", `Keep the terms under ${TERMS_MAX} characters.`]);
  }
  if (draft.autoReply.trim().length > AUTO_REPLY_MAX) {
    problems.push(["autoReply", `Keep the auto-reply under ${AUTO_REPLY_MAX} characters.`]);
  }
  const minTrades = draft.minCompletedTrades.trim() || "0";
  if (!/^\d{1,5}$/.test(minTrades) || Number(minTrades) > 10_000) {
    problems.push(["minCompletedTrades", "Enter a whole number, 10,000 or less."]);
  }
  return problems;
}

/*
  Every field is a plain value to the schema, and every rule is in the one
  refinement: that way all of them are checked on every submit and all the
  problems are shown at once, rather than a field's problem hiding the
  others' until it is fixed.
*/
export const adForm = z
  .object({
    side: z.enum(["SELL", "BUY"]),
    price: z.string(),
    total: z.string(),
    min: z.string(),
    max: z.string(),
    window: z.number(),
    methodIds: z.array(z.string()),
    kinds: z.array(z.custom<PaymentMethodKind>((value) => typeof value === "string")),
    terms: z.string(),
    autoReply: z.string(),
    requireVerified: z.boolean(),
    minCompletedTrades: z.string(),
  })
  .superRefine((draft, ctx) => {
    for (const [path, message] of adProblems(draft)) {
      ctx.addIssue({ code: "custom", path: [path], message });
    }
  });

/** The request a checked ad becomes. Call only once adProblems() has found nothing. */
export function toOfferDraft(draft: AdForm): OfferDraft {
  return {
    priceSantim: toSantim(draft.price) ?? "0",
    totalAmount: toMicro(draft.total) ?? "0",
    minSantim: toSantim(draft.min) ?? "0",
    maxSantim: toSantim(draft.max) ?? "0",
    paymentWindowMinutes: draft.window,
    ...(draft.side === "SELL"
      ? { paymentMethodIds: draft.methodIds }
      : { paymentKinds: draft.kinds }),
    terms: draft.terms.trim(),
    autoReply: draft.autoReply.trim(),
    requireVerified: draft.requireVerified,
    minCompletedTrades: Number(draft.minCompletedTrades.trim() || "0"),
  };
}

/* --------------------------------------------------------------- disputes */

export const DISPUTE_DESCRIPTION_MAX = 1_000;

/** The reasons the API knows, from the one table that words them. */
const REASONS = Object.keys(DISPUTE_REASONS) as [DisputeReason, ...DisputeReason[]];

export const disputeForm = z.object({
  reason: z.enum(REASONS),
  description: z
    .string()
    .trim()
    .min(10, { error: "Say what happened, in at least a few words." })
    .max(DISPUTE_DESCRIPTION_MAX, {
      error: `Keep it under ${DISPUTE_DESCRIPTION_MAX} characters.`,
    }),
});
export type DisputeForm = z.infer<typeof disputeForm>;

/* -------------------------------------------------------------- releasing */

export const releaseForm = z.object({
  password: z.string().min(1, { error: "Enter your password to confirm." }),
});
export type ReleaseForm = z.infer<typeof releaseForm>;
