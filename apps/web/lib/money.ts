/*
  Millionths, as text, into something a person reads - and back again.

  The API carries every amount as an integer string of the asset's smallest
  unit (one millionth of a USDT) and never as a JSON number, because a double
  cannot hold every 64-bit integer (AT-21). This is the one place in the
  browser where that becomes digits or stops being them, and it is all BigInt
  for the same reason: nothing here is ever a float, on either screen, in
  either realm.
*/

const SCALE = 6;

/** "1234567890" -> "1,234.567890". Always six decimals: the ledger's precision is the point. */
export function formatMicro(amount: string): string {
  let value: bigint;
  try {
    value = BigInt(amount);
  } catch {
    return amount;
  }
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const whole = magnitude / 10n ** BigInt(SCALE);
  const fraction = (magnitude % 10n ** BigInt(SCALE)).toString().padStart(SCALE, "0");
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "−" : ""}${grouped}.${fraction}`;
}

/** Whether an amount string is exactly zero, without parsing it as a number. */
export const isZeroMicro = (amount: string): boolean => /^-?0+$/.test(amount);

/** "1234567890" -> "1234.567890". The same digits without grouping, for an input's value. */
export function plainMicro(amount: string): string {
  return formatMicro(amount).replace(/,/g, "");
}

/**
 * What a person typed, into millionths - or null if it is not an amount.
 *
 * The whole reason this exists rather than `Number(text) * 1e6`: at six
 * decimal places that multiplication is already wrong for ordinary values
 * (2.3 * 1e6 is 2299999.9999999995), and rounding it would be a policy
 * decision about somebody's money made by accident in a display layer.
 */
export function toMicro(input: string): string | null {
  const text = input.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  try {
    return (BigInt(whole ?? "0") * 1_000_000n + BigInt(fraction.padEnd(6, "0") || "0")).toString();
  } catch {
    return null;
  }
}

/** -1, 0 or 1, comparing two integer strings of millionths. Never parses them as numbers. */
export function compareMicro(a: string, b: string): -1 | 0 | 1 {
  try {
    const left = BigInt(a);
    const right = BigInt(b);
    return left < right ? -1 : left > right ? 1 : 0;
  } catch {
    return 0;
  }
}

/** a + b, both integer strings of millionths. */
export function addMicro(a: string, b: string): string {
  try {
    return (BigInt(a) + BigInt(b)).toString();
  } catch {
    return "0";
  }
}

/** a − b, floored at zero: a "they receive" figure is never negative. */
export function subMicro(a: string, b: string): string {
  try {
    const difference = BigInt(a) - BigInt(b);
    return (difference < 0n ? 0n : difference).toString();
  } catch {
    return "0";
  }
}
