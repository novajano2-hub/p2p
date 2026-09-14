/*
  Birr arithmetic. The birr never enters the ledger (ledger-taxonomy.md 7);
  it appears on an offer as a price and on a trade as the amount the buyer
  is told to pay. Both are integers of santim - hundredths of a birr - kept
  with the same discipline as the ledger's millionths: no floats, ever, and
  one rounding rule written down once.

  A price is santim per one USDT, so the birr value of an amount is
  amount × price scaled back down by the USDT's millionths. That division
  can leave a fraction of a santim; it is rounded half up, the way a bank
  statement would. Going the other way - "how much USDT does this many birr
  buy" - rounds DOWN, so the fiat a buyer is then asked to pay for that
  amount is never more than what they typed.
*/

const MICRO = 1_000_000n;
const SANTIM_PER_BIRR = 100n;

/** The birr a given amount of USDT is worth at a price, in santim, rounded half up. */
export function fiatForAmount(amountMicro: bigint, priceSantim: bigint): bigint {
  if (amountMicro < 0n || priceSantim <= 0n) throw new RangeError("fiatForAmount: bad input");
  return (amountMicro * priceSantim + MICRO / 2n) / MICRO;
}

/** The USDT a given number of santim buys at a price, in millionths, rounded down. */
export function amountForFiat(fiatSantim: bigint, priceSantim: bigint): bigint {
  if (fiatSantim < 0n || priceSantim <= 0n) throw new RangeError("amountForFiat: bad input");
  return (fiatSantim * MICRO) / priceSantim;
}

/** Santim as "1,234.50", for an email, a notification or a log line. Never for arithmetic. */
export function formatEtb(santim: bigint): string {
  const negative = santim < 0n;
  const magnitude = negative ? -santim : santim;
  const whole = magnitude / SANTIM_PER_BIRR;
  const fraction = (magnitude % SANTIM_PER_BIRR).toString().padStart(2, "0");
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}.${fraction}`;
}
