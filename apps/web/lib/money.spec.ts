import {
  addMicro,
  compareMicro,
  formatMicro,
  isZeroMicro,
  plainMicro,
  subMicro,
  toMicro,
} from "@/lib/money";

/*
  AT-21, the browser's half: money is never a float on this side either.

  The interesting failures are not the obvious ones. `Number("2.3") * 1e6` is
  2299999.9999999995, and `Number("9007199254740993")` is 9007199254740992 -
  both are how a display layer quietly decides something about somebody's
  balance. Every case below would pass with a float implementation except the
  ones that matter, so those are the ones stated explicitly.
*/

describe("formatting millionths", () => {
  it("shows two places, half up, grouped", () => {
    expect(formatMicro("0")).toBe("0.00");
    expect(formatMicro("1000000")).toBe("1.00");
    expect(formatMicro("1234567890")).toBe("1,234.57");
    expect(formatMicro("1234564999")).toBe("1,234.56");
    expect(formatMicro("1000000000000")).toBe("1,000,000.00");
  });

  it("says a whisker is there rather than rounding it to nothing", () => {
    expect(formatMicro("1")).toBe("<0.01");
    expect(formatMicro("4999")).toBe("<0.01");
    expect(formatMicro("5000")).toBe("0.01");
  });

  it("keeps all six places when asked, for the ledger", () => {
    expect(formatMicro("1", 6)).toBe("0.000001");
    expect(formatMicro("1234567890", 6)).toBe("1,234.567890");
  });

  it("marks a negative with a real minus sign, not a hyphen", () => {
    expect(formatMicro("-1500000")).toBe("\u22121.50");
  });

  it("hands back anything that is not an integer string, rather than guessing", () => {
    expect(formatMicro("not a number")).toBe("not a number");
  });

  it("survives values a double cannot hold", () => {
    // 2^63 - 1 millionths: the top of what the database column can carry.
    expect(formatMicro("9223372036854775807", 6)).toBe("9,223,372,036,854.775807");
    // One above the largest exact integer a double has. A float would round it.
    expect(formatMicro("9007199254740993", 6)).toBe("9,007,199,254.740993");
    expect(formatMicro("9007199254740993")).toBe("9,007,199,254.74");
  });

  it("plainMicro is every digit without the grouping or trailing zeros, for an input", () => {
    expect(plainMicro("1234567890")).toBe("1234.56789");
    expect(plainMicro("2000000")).toBe("2");
    expect(plainMicro("2500000")).toBe("2.5");
    expect(plainMicro("0")).toBe("0");
  });

  it("knows zero without parsing it", () => {
    expect(isZeroMicro("0")).toBe(true);
    expect(isZeroMicro("000")).toBe(true);
    expect(isZeroMicro("-0")).toBe(true);
    expect(isZeroMicro("1")).toBe(false);
  });
});

describe("parsing what a person typed", () => {
  it("reads whole numbers and every place up to six", () => {
    expect(toMicro("0")).toBe("0");
    expect(toMicro("1")).toBe("1000000");
    expect(toMicro("1.5")).toBe("1500000");
    expect(toMicro("0.000001")).toBe("1");
    expect(toMicro("1234.567890")).toBe("1234567890");
  });

  it("is exact where a float is not", () => {
    // Number("2.3") * 1e6 === 2299999.9999999995. This is the whole reason
    // the function exists.
    expect(toMicro("2.3")).toBe("2300000");
    expect(toMicro("0.07")).toBe("70000");
    expect(toMicro("1.005")).toBe("1005000");
    expect(toMicro("8.11")).toBe("8110000");
  });

  it("refuses anything that is not an amount", () => {
    expect(toMicro("")).toBeNull();
    expect(toMicro("abc")).toBeNull();
    expect(toMicro("-1")).toBeNull();
    expect(toMicro("1.2345678")).toBeNull(); // seven places
    expect(toMicro("1e6")).toBeNull();
    expect(toMicro("1,000")).toBeNull();
    expect(toMicro("Infinity")).toBeNull();
  });

  it("ignores surrounding space, because people paste", () => {
    expect(toMicro("  12.50  ")).toBe("12500000");
  });

  it("round-trips through formatting, including past the float ceiling", () => {
    for (const micro of [
      "0",
      "1",
      "999999",
      "1000000",
      "1234567890",
      "9007199254740993",
      "9223372036854775807",
    ]) {
      expect(toMicro(plainMicro(micro))).toBe(micro);
    }
  });
});

describe("comparing and adding without leaving the integers", () => {
  it("orders values a double would call equal", () => {
    expect(compareMicro("9007199254740992", "9007199254740993")).toBe(-1);
    expect(compareMicro("9007199254740993", "9007199254740992")).toBe(1);
    expect(compareMicro("5", "5")).toBe(0);
  });

  it("adds exactly", () => {
    expect(addMicro("9007199254740992", "1")).toBe("9007199254740993");
    expect(addMicro("2300000", "700000")).toBe("3000000");
  });

  it("subtracts, and floors at zero rather than going negative", () => {
    expect(subMicro("3000000", "1000000")).toBe("2000000");
    expect(subMicro("1000000", "3000000")).toBe("0");
    expect(subMicro("9007199254740993", "1")).toBe("9007199254740992");
  });
});
