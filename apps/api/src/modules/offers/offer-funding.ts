import { type OfferHiddenReason, type OfferSide } from "@abay/contracts";

import { fiatForAmount } from "@/common/money/fiat";

/*
  An ad's balance: what a taker could take from it right now, and - when
  that is worth less than its own smallest order - why.

  Posting an ad locks nothing (ADR-0004); a seller may advertise more than
  they hold, as on Binance. So a sell ad offers the lesser of what remains of
  it and the seller's available balance, and the market shows it only while
  that covers its smallest order. The marketplace query does the same
  arithmetic in SQL (OfferService.search); this is the one the owner's view
  and the worker's pass share, so the two can never disagree about an ad.
*/

export interface AdNumbers {
  side: OfferSide;
  /** Millionths of a USDT not yet taken. */
  remaining: bigint;
  /** Santim per USDT. */
  price: bigint;
  /** Santim: the smallest order. */
  min: bigint;
}

export interface AdFunding {
  /** Millionths of a USDT a taker could take right now. */
  adBalance: bigint;
  hiddenBecause: OfferHiddenReason | null;
}

/**
 * `available` is the seller's available balance; a buy ad ignores it, since
 * whoever takes a buy ad is the one who gives up USDT.
 *
 * What is left of the ad is judged first: when the remainder alone is worth
 * less than the smallest order, no deposit can bring the ad back, and saying
 * "add USDT" would send its owner the wrong way.
 */
export function fundingOf(ad: AdNumbers, available: bigint): AdFunding {
  const held = available > 0n ? available : 0n;
  const adBalance = ad.side === "SELL" && held < ad.remaining ? held : ad.remaining;
  if (fiatForAmount(ad.remaining, ad.price) < ad.min) {
    return { adBalance, hiddenBecause: "REMAINDER" };
  }
  if (fiatForAmount(adBalance, ad.price) < ad.min) {
    return { adBalance, hiddenBecause: "BALANCE" };
  }
  return { adBalance, hiddenBecause: null };
}
