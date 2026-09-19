import { amountForFiat, fiatForAmount, formatEtb } from "@/common/money/fiat";

describe("fiatForAmount", () => {
  it("multiplies millionths by a santim price and scales back down", () => {
    // 100 USDT at 158.50 ETB = 15,850.00 ETB
    expect(fiatForAmount(100_000_000n, 15_850n)).toBe(1_585_000n);
  });

  it("rounds half up when the product leaves a fraction of a santim", () => {
    // 0.333333 USDT at 1.50 ETB = 0.4999995 ETB -> 50 santim
    expect(fiatForAmount(333_333n, 150n)).toBe(50n);
    // 0.000001 USDT at 1.00 ETB = 0.0001 santim -> 0
    expect(fiatForAmount(1n, 100n)).toBe(0n);
    // exactly half a santim rounds up
    expect(fiatForAmount(500_000n, 1n)).toBe(1n);
  });

  it("refuses a negative amount or a non-positive price", () => {
    expect(() => fiatForAmount(-1n, 100n)).toThrow(RangeError);
    expect(() => fiatForAmount(1n, 0n)).toThrow(RangeError);
  });
});

describe("amountForFiat", () => {
  it("divides santim by the price and rounds down", () => {
    // 1,000.00 ETB at 158.50 = 6.309148... USDT
    expect(amountForFiat(100_000n, 15_850n)).toBe(6_309_148n);
  });

  it("never asks for more fiat than was typed when converted back", () => {
    for (const [fiat, price] of [
      [100_000n, 15_850n],
      [1n, 15_850n],
      [999_999n, 12_345n],
      [123_456n, 100n],
    ] as const) {
      const amount = amountForFiat(fiat, price);
      expect(fiatForAmount(amount, price)).toBeLessThanOrEqual(fiat);
    }
  });
});

describe("formatEtb", () => {
  it("prints santim as ETB with two decimals and grouping", () => {
    expect(formatEtb(1_585_000n)).toBe("15,850.00");
    expect(formatEtb(5n)).toBe("0.05");
    expect(formatEtb(123_456_789n)).toBe("1,234,567.89");
    expect(formatEtb(-150n)).toBe("-1.50");
  });
});
