import {
  adForm,
  adProblems,
  amountProblem,
  disputeForm,
  orderForm,
  orderPair,
  toOfferDraft,
  type AdForm,
  type OrderBounds,
} from "@/lib/market/forms";

/*
  The market's forms say no before the server does, in the same terms. The
  amount rules are arithmetic on somebody's money, so they are pinned here to
  the santim and the millionth rather than left to a browser test.
*/

/** 158.50 birr a USDT, 10 to 20,000 birr a trade, 200 USDT left. */
const BOUNDS: OrderBounds = {
  mode: "fiat",
  priceSantim: "15850",
  minSantim: "1000",
  maxSantim: "2000000",
  available: "200000000",
  railMissing: null,
};

describe("taking an ad", () => {
  it("previews the pair the server will open, rounding the way it does", () => {
    // 1,000 birr buys 6.309148 USDT, rounded down to the millionth.
    expect(orderPair("1000", "fiat", "15850")).toEqual({ santim: "100000", micro: "6309148" });
    // 10 USDT costs 1,585.00 birr.
    expect(orderPair("10", "usdt", "15850")).toEqual({ micro: "10000000", santim: "158500" });
    expect(orderPair("1,000.5", "fiat", "15850")?.santim).toBe("100050");
    expect(orderPair("12.345", "fiat", "15850")).toBeNull();
    expect(orderPair("abc", "usdt", "15850")).toBeNull();
  });

  it("holds an amount to the ad's limits and to what is left", () => {
    expect(amountProblem("", BOUNDS)).toBe("Enter an amount.");
    expect(amountProblem("0", BOUNDS)).toBe("Enter an amount.");
    expect(amountProblem("9.99", BOUNDS)).toBe("The smallest trade on this offer is 10.00 birr.");
    expect(amountProblem("10", BOUNDS)).toBeNull();
    expect(amountProblem("20000", BOUNDS)).toBeNull();
    expect(amountProblem("20000.01", BOUNDS)).toBe(
      "The largest trade on this offer is 20,000.00 birr.",
    );
    const nearlyGone = { ...BOUNDS, available: "5000000" };
    // 1,000 birr is 6.309148 USDT, more than the 5 left.
    expect(amountProblem("1000", nearlyGone)).toBe("Only 5.000000 USDT is available right now.");
  });

  it("reads the amount in whichever unit the person chose", () => {
    const inUsdt = { ...BOUNDS, mode: "usdt" as const };
    expect(amountProblem("10", inUsdt)).toBeNull();
    // 0.05 USDT is 7.93 birr, under the smallest trade.
    expect(amountProblem("0.05", inUsdt)).toBe("The smallest trade on this offer is 10.00 birr.");
    // 101 USDT is 16,008.50 birr: inside the limits, but more than is left on this one.
    expect(amountProblem("101", { ...inUsdt, available: "100000000" })).toBe(
      "Only 100.000000 USDT is available right now.",
    );
    // 127 USDT is 20,129.50 birr.
    expect(amountProblem("127", inUsdt)).toBe("The largest trade on this offer is 20,000.00 birr.");
  });

  it("asks for a payment method only when there is a choice to make", () => {
    const loose = orderForm(BOUNDS).safeParse({ amount: "1000", rail: "" });
    expect(loose.success).toBe(true);
    const strict = orderForm({ ...BOUNDS, railMissing: "Choose how you will pay." }).safeParse({
      amount: "1000",
      rail: "",
    });
    expect(strict.success).toBe(false);
    expect(strict.error?.issues.map((issue) => [issue.path.join("."), issue.message])).toEqual([
      ["rail", "Choose how you will pay."],
    ]);
  });
});

const AD: AdForm = {
  side: "SELL",
  price: "158.50",
  total: "100",
  min: "500",
  max: "20000",
  window: 30,
  methodIds: ["pm1"],
  kinds: [],
  terms: "  Pay from an account in your own name.  ",
  autoReply: "",
  requireVerified: false,
  minCompletedTrades: "",
};

describe("posting an ad", () => {
  it("finds nothing wrong with a complete ad, and sends what the API reads", () => {
    expect(adProblems(AD)).toEqual([]);
    expect(toOfferDraft(AD)).toEqual({
      priceSantim: "15850",
      totalAmount: "100000000",
      minSantim: "50000",
      maxSantim: "2000000",
      paymentWindowMinutes: 30,
      paymentMethodIds: ["pm1"],
      terms: "Pay from an account in your own name.",
      autoReply: "",
      requireVerified: false,
      minCompletedTrades: 0,
    });
  });

  it("reports every problem at once, in the order the form asks", () => {
    const empty = { ...AD, price: "", total: "0", min: "", max: "", methodIds: [] };
    expect(adProblems(empty).map(([field]) => field)).toEqual([
      "price",
      "total",
      "min",
      "max",
      "methodIds",
    ]);
    // ...and the schema turns each into an issue on its own field.
    const parsed = adForm.safeParse(empty);
    expect(parsed.error?.issues.map((issue) => issue.path[0])).toEqual([
      "price",
      "total",
      "min",
      "max",
      "methodIds",
    ]);
  });

  it("keeps the smallest trade at or below the largest", () => {
    expect(adProblems({ ...AD, min: "20000.01" })).toEqual([
      ["max", "The largest trade must be at least the smallest."],
    ]);
  });

  it("asks a buy ad how its advertiser will pay, and a sell ad how they will be paid", () => {
    expect(adProblems({ ...AD, side: "BUY", methodIds: [], kinds: [] })).toEqual([
      ["kinds", "Choose at least one way you will pay."],
    ]);
    expect(toOfferDraft({ ...AD, side: "BUY", methodIds: [], kinds: ["CBE", "AWASH"] })).toEqual(
      expect.objectContaining({ paymentKinds: ["CBE", "AWASH"] }),
    );
  });

  it("wants a whole number of completed trades", () => {
    expect(adProblems({ ...AD, minCompletedTrades: "2.5" })).toEqual([
      ["minCompletedTrades", "Enter a whole number, 10,000 or less."],
    ]);
    expect(adProblems({ ...AD, minCompletedTrades: "10001" })).toHaveLength(1);
    expect(toOfferDraft({ ...AD, minCompletedTrades: " 12 " }).minCompletedTrades).toBe(12);
  });
});

describe("opening a dispute", () => {
  it("wants a few words about what happened", () => {
    expect(disputeForm.safeParse({ reason: "OTHER", description: " too short " }).success).toBe(
      false,
    );
    expect(
      disputeForm.safeParse({ reason: "OTHER", description: "I paid and nothing came back." })
        .success,
    ).toBe(true);
  });
});
