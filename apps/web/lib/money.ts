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
/** The places a person is shown. The ledger keeps six; a screen shows two, as a price does. */
const SHOWN = 2;

/**
 * "1234567890" -> "1,234.57": grouped, two places, half up. A whisker of USDT
 * reads "<0.01" rather than a "0.00" that says there is nothing. Ask for all
 * six places where the ledger's precision is the point.
 */
export function formatMicro(amount: string, places: number = SHOWN): string {
  let value: bigint;
  try {
    value = BigInt(amount);
  } catch {
    return amount;
  }
  const negative = value < 0n;
  const sign = negative ? "−" : "";
  const magnitude = negative ? -value : value;
  const dropped = 10n ** BigInt(SCALE - places);
  const rounded = (magnitude + dropped / 2n) / dropped;
  if (magnitude > 0n && rounded === 0n) return `${sign}<0.${"0".repeat(places - 1)}1`;
  const unit = 10n ** BigInt(places);
  const grouped = (rounded / unit).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (rounded % unit).toString().padStart(places, "0");
  return `${sign}${grouped}${places > 0 ? `.${fraction}` : ""}`;
}

/** Whether an amount string is exactly zero, without parsing it as a number. */
export const isZeroMicro = (amount: string): boolean => /^-?0+$/.test(amount);

/** "1234567890" -> "1234.56789": every digit, no grouping, no trailing zeros, for an input's value. */
export function plainMicro(amount: string): string {
  const exact = formatMicro(amount, SCALE).replace(/,/g, "");
  return exact.includes(".") ? exact.replace(/\.?0+$/, "") : exact;
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
