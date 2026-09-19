import {
  amountForFiat,
  compareSantim,
  fiatForAmount,
  formatSantim,
  plainSantim,
  toSantim,
} from "@/lib/market/money";

/*
  AT-21, the ETB half: the browser previews the pair the server will
  answer with, and never a different one. The two conversions here have to
  agree with apps/api/src/common/money/fiat.ts to the santim and to the
  millionth, so the cases below are the server's own.
*/

describe("formatSantim", () => {
  it("prints santim as ETB with two decimals and thousands separators", () => {
    expect(formatSantim("634000")).toBe("6,340.00");
    expect(formatSantim("15850")).toBe("158.50");
    expect(formatSantim("5")).toBe("0.05");
    expect(formatSantim("0")).toBe("0.00");
    expect(formatSantim("123456789")).toBe("1,234,567.89");
  });

  it("keeps a sign", () => {
    expect(formatSantim("-1050")).toBe("-10.50");
  });
});

describe("toSantim", () => {
  it("reads what a person types, with or without separators", () => {
    expect(toSantim("6340")).toBe("634000");
    expect(toSantim("6,340.50")).toBe("634050");
    expect(toSantim("6 340.5")).toBe("634050");
    expect(toSantim("0.05")).toBe("5");
    expect(toSantim("158.")).toBe("15800");
  });

  it("refuses what is not an amount, including a third decimal", () => {
    expect(toSantim("")).toBeNull();
    expect(toSantim("abc")).toBeNull();
    expect(toSantim("1.005")).toBeNull();
    expect(toSantim("-5")).toBeNull();
    expect(toSantim("1e3")).toBeNull();
  });

  it("round-trips through plainSantim", () => {
    expect(plainSantim("634050")).toBe("6340.50");
    expect(toSantim(plainSantim("634050"))).toBe("634050");
  });
});

describe("the two conversions agree with the server", () => {
  it("40 USDT at 158.50 is 6,340.00 ETB", () => {
    expect(fiatForAmount("40000000", "15850")).toBe("634000");
  });

  it("rounds ETB half up: 6.309148 USDT at 158.50 is 999.99958, so 1,000.00", () => {
    expect(fiatForAmount("6309148", "15850")).toBe("100000");
  });

  it("rounds USDT down: 1,000 ETB at 158.50 buys 6.309148, never more", () => {
    expect(amountForFiat("100000", "15850")).toBe("6309148");
    expect(fiatForAmount(amountForFiat("100000", "15850"), "15850")).toBe("100000");
  });

  it("does not divide by a zero price", () => {
    expect(amountForFiat("100000", "0")).toBe("0");
  });
});

describe("compareSantim", () => {
  it("compares as integers, not as strings", () => {
    expect(compareSantim("900", "1000")).toBe(-1);
    expect(compareSantim("1000", "1000")).toBe(0);
    expect(compareSantim("10000000000000000000", "9")).toBe(1);
  });
});
