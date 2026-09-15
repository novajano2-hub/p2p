/*
  Birr, in the browser. The API keeps birr in santim (hundredths) as integer
  strings, the way it keeps USDT in millionths, and this module is the only
  place those strings become digits on screen or digits become strings on
  the way back. No float touches a price or a total anywhere in this app.

  The two conversions mirror apps/api/src/common/money/fiat.ts exactly: a
  USDT amount becomes birr rounded half up, and a birr amount becomes USDT
  rounded down, so the pair a screen previews is the pair the server will
  answer with, and the birr a person types is never turned into more birr.
*/

const MICRO = 1_000_000n;

const group = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** "634000" -> "6,340.00". Always two decimals: prices and totals are quoted to the santim. */
export function formatSantim(santim: string): string {
  const negative = santim.startsWith("-");
  const value = BigInt(negative ? santim.slice(1) : santim);
  const whole = group((value / 100n).toString());
  const cents = (value % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${cents}`;
}

/** "634000" -> "6340.00", for putting a value back into an input. */
export function plainSantim(santim: string): string {
  const value = BigInt(santim);
  return `${(value / 100n).toString()}.${(value % 100n).toString().padStart(2, "0")}`;
}

/**
 * What a person typed as birr, as santim - or null when it is not an amount.
 * Commas and spaces are ignored; more than two decimals is refused rather
 * than rounded, because a rounded input is a number the person did not type.
 */
export function toSantim(input: string): string | null {
  const cleaned = input.replace(/[,\s]/g, "");
  const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(cleaned);
  if (!match) return null;
  const [, whole, fraction = ""] = match;
  if (whole === undefined) return null;
  const value = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return value.toString();
}

/** Birr for a USDT amount at a price, rounded half up to the santim. */
export function fiatForAmount(amountMicro: string, priceSantim: string): string {
  return ((BigInt(amountMicro) * BigInt(priceSantim) + MICRO / 2n) / MICRO).toString();
}

/** USDT for a birr amount at a price, rounded down to the millionth. */
export function amountForFiat(fiatSantim: string, priceSantim: string): string {
  const price = BigInt(priceSantim);
  if (price <= 0n) return "0";
  return ((BigInt(fiatSantim) * MICRO) / price).toString();
}

export const isZeroSantim = (santim: string): boolean => /^-?0+$/.test(santim);

/** -1, 0 or 1, comparing two santim strings as the integers they are. */
export function compareSantim(a: string, b: string): -1 | 0 | 1 {
  const left = BigInt(a);
  const right = BigInt(b);
  return left < right ? -1 : left > right ? 1 : 0;
}
