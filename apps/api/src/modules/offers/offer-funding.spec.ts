import { fundingOf, type AdNumbers } from "@/modules/offers/offer-funding";

/*
  An ad's balance and why it is hidden, as arithmetic. At 158.50 ETB a
  USDT, a smallest order of 1,000.00 ETB takes 6.309117 USDT: that is worth
  999.995 ETB and a little more, which rounds half up to 1,000.00, while
  6.309116 comes to 999.99.
*/

const USDT = 1_000_000n;
const sell = (remaining: bigint): AdNumbers => ({
  side: "SELL",
  remaining,
  price: 15_850n,
  min: 100_000n,
});

describe("fundingOf", () => {
  it("offers what remains when the balance covers all of it", () => {
    expect(fundingOf(sell(100n * USDT), 500n * USDT)).toEqual({
      adBalance: 100n * USDT,
      hiddenBecause: null,
    });
  });

  it("offers the balance when that is less than what remains", () => {
    expect(fundingOf(sell(100n * USDT), 20n * USDT)).toEqual({
      adBalance: 20n * USDT,
      hiddenBecause: null,
    });
  });

  it("is hidden for the balance when the balance is worth less than the smallest order", () => {
    expect(fundingOf(sell(100n * USDT), 6_309_117n).hiddenBecause).toBeNull();
    expect(fundingOf(sell(100n * USDT), 6_309_116n)).toEqual({
      adBalance: 6_309_116n,
      hiddenBecause: "BALANCE",
    });
    expect(fundingOf(sell(100n * USDT), 0n)).toEqual({ adBalance: 0n, hiddenBecause: "BALANCE" });
  });

  it("is hidden for its remainder when what is left could never make an order, balance or not", () => {
    expect(fundingOf(sell(5n * USDT), 500n * USDT)).toEqual({
      adBalance: 5n * USDT,
      hiddenBecause: "REMAINDER",
    });
    // Both short: the remainder is the reason, because a deposit would not help.
    expect(fundingOf(sell(5n * USDT), 0n).hiddenBecause).toBe("REMAINDER");
    expect(fundingOf(sell(0n), 500n * USDT)).toEqual({ adBalance: 0n, hiddenBecause: "REMAINDER" });
  });

  it("never lets a buy ad depend on its owner's balance", () => {
    const buy: AdNumbers = { ...sell(100n * USDT), side: "BUY" };
    expect(fundingOf(buy, 0n)).toEqual({ adBalance: 100n * USDT, hiddenBecause: null });
    expect(fundingOf({ ...buy, remaining: 5n * USDT }, 0n).hiddenBecause).toBe("REMAINDER");
  });

  it("treats a negative balance as none", () => {
    expect(fundingOf(sell(100n * USDT), -1n)).toEqual({ adBalance: 0n, hiddenBecause: "BALANCE" });
  });
});
