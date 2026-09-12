/*
  Millionths, as text, into something a person reads.

  The API carries every amount as an integer string of the asset's smallest
  unit (one millionth of a USDT) and never as a JSON number, because a double
  cannot hold every 64-bit integer. This is the one place the browser turns
  that into digits, and it does so with BigInt for the same reason: nothing
  here is ever a float.
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
