/*
  The one conversion between the chain's integer and the ledger's.

  The ledger counts millionths of a USDT (ADR-0005). BEP-20 USDT on BSC counts
  in 10^-18. Every deposit crosses this line exactly once, on the way in, and
  every withdrawal crosses it once on the way out; nothing else in the
  application ever holds a chain-scaled number. Both directions are integer
  arithmetic on bigint - there is no float anywhere near money.

  Scaling down floors. The part below one millionth (at most 10^12 - 1 of the
  chain's units, a billionth of a cent) is not credited: it is too small to
  represent, and rounding it up would credit money that did not arrive. The
  raw integer is kept on the deposit row, so nothing is lost, only not counted.
*/

/** The ledger's decimals: 1 USDT = 1,000,000. */
export const LEDGER_DECIMALS = 6;

export class InvalidAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAmountError";
  }
}

/** A non-negative integer in text, as chains and providers report amounts. */
export function parseRawAmount(text: string): bigint {
  if (!/^\d+$/.test(text)) throw new InvalidAmountError("amount must be a non-negative integer");
  return BigInt(text);
}

/** Chain units -> millionths, flooring anything below one millionth. */
export function toLedgerUnits(raw: bigint, decimals: number): bigint {
  assertDecimals(decimals);
  if (raw < 0n) throw new InvalidAmountError("amount must not be negative");
  if (decimals === LEDGER_DECIMALS) return raw;
  if (decimals > LEDGER_DECIMALS) return raw / 10n ** BigInt(decimals - LEDGER_DECIMALS);
  return raw * 10n ** BigInt(LEDGER_DECIMALS - decimals);
}

/** Millionths -> chain units. Exact: a millionth is always representable on-chain. */
export function toChainUnits(micro: bigint, decimals: number): bigint {
  assertDecimals(decimals);
  if (micro < 0n) throw new InvalidAmountError("amount must not be negative");
  if (decimals === LEDGER_DECIMALS) return micro;
  if (decimals > LEDGER_DECIMALS) return micro * 10n ** BigInt(decimals - LEDGER_DECIMALS);
  const divisor = 10n ** BigInt(LEDGER_DECIMALS - decimals);
  if (micro % divisor !== 0n) {
    throw new InvalidAmountError("amount is finer than the chain can represent");
  }
  return micro / divisor;
}

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new InvalidAmountError("decimals must be an integer between 0 and 36");
  }
}
