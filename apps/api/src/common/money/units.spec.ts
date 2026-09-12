import { InvalidAmountError, parseRawAmount, toChainUnits, toLedgerUnits } from "./units";

describe("chain units <-> ledger units", () => {
  it("scales 18 decimals down to millionths exactly when the amount is whole", () => {
    expect(toLedgerUnits(100n * 10n ** 18n, 18)).toBe(100_000_000n);
    expect(toLedgerUnits(1_500_000n * 10n ** 12n, 18)).toBe(1_500_000n);
  });

  it("floors anything below one millionth rather than rounding it up", () => {
    // 1.000000999999999999 USDT credits as 1.000000
    expect(toLedgerUnits(10n ** 18n + 999_999_999_999n, 18)).toBe(1_000_000n);
    expect(toLedgerUnits(999_999_999_999n, 18)).toBe(0n);
  });

  it("is the identity at six decimals and scales up below six", () => {
    expect(toLedgerUnits(123n, 6)).toBe(123n);
    expect(toLedgerUnits(5n, 2)).toBe(50_000n);
  });

  it("goes back to the chain exactly, and refuses what the chain cannot hold", () => {
    expect(toChainUnits(1_500_000n, 18)).toBe(1_500_000n * 10n ** 12n);
    expect(toChainUnits(50_000n, 2)).toBe(5n);
    expect(() => toChainUnits(50_001n, 2)).toThrow(InvalidAmountError);
  });

  it("round-trips a full uint256 without losing precision", () => {
    const max = 2n ** 256n - 1n;
    const micro = toLedgerUnits(max, 18);
    expect(micro).toBe(max / 10n ** 12n);
    expect(toChainUnits(micro, 18)).toBe(micro * 10n ** 12n);
  });

  it("refuses negatives, non-integers and absurd decimals", () => {
    expect(() => toLedgerUnits(-1n, 18)).toThrow(InvalidAmountError);
    expect(() => toLedgerUnits(1n, 1.5)).toThrow(InvalidAmountError);
    expect(() => parseRawAmount("1.5")).toThrow(InvalidAmountError);
    expect(() => parseRawAmount("-1")).toThrow(InvalidAmountError);
    expect(parseRawAmount("000123")).toBe(123n);
  });
});
