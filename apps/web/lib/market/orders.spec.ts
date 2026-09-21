import {
  NO_RANGE,
  chatAsked,
  chatClosing,
  chatLink,
  figureLabels,
  orderProgress,
  rangeBounds,
  rangeIsSet,
  rangeLabel,
  rowAction,
} from "./orders";

/* The words and the emphasis the orders screens choose for themselves. */

const NO_ACTIONS = {
  canMarkPaid: false,
  canCancel: false,
  canRelease: false,
  canDispute: false,
  canWithdrawDispute: false,
  canChat: true,
};

describe("orderProgress", () => {
  it("says what to do now, to whoever is looking", () => {
    expect(orderProgress("AWAITING_FIAT_PAYMENT", "BUYER")).toMatchObject({
      step: 1,
      title: "Pay the seller",
      states: ["on", "todo", "todo"],
    });
    expect(orderProgress("AWAITING_FIAT_PAYMENT", "SELLER").title).toBe(
      "Waiting for the buyer to pay",
    );
    expect(orderProgress("BUYER_MARKED_PAID", "SELLER")).toMatchObject({
      step: 2,
      title: "Check your account, then release",
      labels: ["Buyer pays", "You release", "Completed"],
      states: ["done", "on", "todo"],
    });
    expect(orderProgress("BUYER_MARKED_PAID", "BUYER").title).toBe(
      "Waiting for the seller to release",
    );
  });

  it("marks a dispute on the step it interrupts, and finishes all three when complete", () => {
    expect(orderProgress("DISPUTED", "BUYER")).toMatchObject({
      title: "In dispute",
      labels: ["Pay the seller", "In dispute", "Completed"],
      states: ["done", "warn", "todo"],
    });
    expect(orderProgress("COMPLETED", "SELLER").states).toEqual(["done", "done", "done"]);
  });

  it("draws no progress for an order that ended some other way", () => {
    for (const status of ["CANCELLED", "EXPIRED", "REFUNDED"] as const) {
      const progress = orderProgress(status, "BUYER");
      expect(progress.step).toBeNull();
      expect(progress.states).toBeNull();
    }
    expect(orderProgress("REFUNDED", "SELLER").title).toBe("Refunded to the seller");
  });
});

describe("figureLabels", () => {
  const at = "2026-09-19T11:21:00.000Z";

  it("speaks of what is still to happen while the order is open", () => {
    expect(figureLabels({ status: "AWAITING_FIAT_PAYMENT", role: "BUYER", paidAt: null })).toEqual({
      usdt: "You receive",
      fiat: "You pay",
    });
    expect(figureLabels({ status: "BUYER_MARKED_PAID", role: "SELLER", paidAt: at })).toEqual({
      usdt: "You give",
      fiat: "You receive",
    });
  });

  it("says the buyer has paid once they have said so, dispute or not", () => {
    expect(figureLabels({ status: "BUYER_MARKED_PAID", role: "BUYER", paidAt: at }).fiat).toBe(
      "You paid",
    );
    expect(figureLabels({ status: "DISPUTED", role: "BUYER", paidAt: at })).toEqual({
      usdt: "You receive",
      fiat: "You paid",
    });
  });

  it("puts a finished order in the past, on both lines and both sides", () => {
    expect(figureLabels({ status: "COMPLETED", role: "BUYER", paidAt: at })).toEqual({
      usdt: "You received",
      fiat: "You paid",
    });
    expect(figureLabels({ status: "COMPLETED", role: "SELLER", paidAt: at })).toEqual({
      usdt: "You gave",
      fiat: "You received",
    });
  });

  it("claims nothing for an order that ended some other way", () => {
    for (const status of ["CANCELLED", "EXPIRED", "REFUNDED"] as const) {
      expect(figureLabels({ status, role: "BUYER", paidAt: null })).toEqual({
        usdt: "You were to receive",
        fiat: "You were to pay",
      });
      expect(figureLabels({ status, role: "SELLER", paidAt: at })).toEqual({
        usdt: "You were to give",
        fiat: "You were to receive",
      });
    }
  });
});

describe("rowAction", () => {
  it("names what is wanted from the viewer, and is otherwise just a way in", () => {
    expect(
      rowAction({
        status: "AWAITING_FIAT_PAYMENT",
        actions: { ...NO_ACTIONS, canMarkPaid: true },
      }),
    ).toEqual({ label: "Pay now", primary: true });
    expect(
      rowAction({ status: "BUYER_MARKED_PAID", actions: { ...NO_ACTIONS, canRelease: true } }),
    ).toEqual({ label: "Release", primary: true });
    // A seller may release a disputed order, but a dispute is not a nudge to.
    expect(rowAction({ status: "DISPUTED", actions: { ...NO_ACTIONS, canRelease: true } })).toEqual(
      { label: "View", primary: false },
    );
    expect(rowAction({ status: "COMPLETED", actions: NO_ACTIONS })).toEqual({
      label: "View",
      primary: false,
    });
  });
});

describe("the date range", () => {
  // Noon, so a day's arithmetic cannot slip across midnight in any time zone the tests run in.
  const now = new Date(2026, 8, 19, 12, 0, 0);

  it("means nothing for all time, and the last N of the viewer's own days for a preset", () => {
    expect(rangeBounds(NO_RANGE, now)).toEqual({});
    expect(rangeBounds({ preset: "7d", from: "", to: "" }, now)).toEqual({
      from: new Date(2026, 8, 12).toISOString(),
    });
    expect(rangeBounds({ preset: "90d", from: "", to: "" }, now)).toEqual({
      from: new Date(2026, 5, 21).toISOString(),
    });
  });

  it("runs a custom range from the first day's midnight to the end of the last day", () => {
    expect(rangeBounds({ preset: "custom", from: "2026-09-01", to: "2026-09-19" }, now)).toEqual({
      from: new Date(2026, 8, 1).toISOString(),
      to: new Date(2026, 8, 20).toISOString(),
    });
    // One end is enough.
    expect(rangeBounds({ preset: "custom", from: "2026-09-01", to: "" }, now)).toEqual({
      from: new Date(2026, 8, 1).toISOString(),
    });
    // Back to front, or not days at all: not a range yet.
    expect(rangeBounds({ preset: "custom", from: "2026-09-19", to: "2026-09-01" }, now)).toEqual(
      {},
    );
    expect(rangeBounds({ preset: "custom", from: "soon", to: "" }, now)).toEqual({});
  });

  it("says what it is", () => {
    expect(rangeLabel(NO_RANGE)).toBe("All time");
    expect(rangeLabel({ preset: "30d", from: "", to: "" })).toBe("Last 30 days");
    expect(rangeLabel({ preset: "custom", from: "2026-09-01", to: "2026-09-19" })).toBe(
      "1 Sept 2026 – 19 Sept 2026",
    );
    expect(rangeLabel({ preset: "custom", from: "2026-09-01", to: "" })).toBe("From 1 Sept 2026");
    expect(rangeLabel({ preset: "custom", from: "", to: "" })).toBe("Custom range");
  });

  it("counts as a filter only when it narrows something", () => {
    expect(rangeIsSet(NO_RANGE)).toBe(false);
    expect(rangeIsSet({ preset: "custom", from: "", to: "" })).toBe(false);
    expect(rangeIsSet({ preset: "7d", from: "", to: "" })).toBe(true);
  });
});

describe("the chat's address", () => {
  it("asks for the chat it links to", () => {
    const url = new URL(chatLink("t1"), "https://birq.example");
    expect(url.pathname).toBe("/orders/t1");
    expect(chatAsked(url.searchParams)).toBe(true);
    expect(chatAsked(new URLSearchParams("chat=shut"))).toBe(false);
    expect(chatAsked(new URLSearchParams(""))).toBe(false);
  });
});

describe("chatClosing", () => {
  const closedAt = new Date(2026, 8, 19, 14, 21).toISOString();
  const closesAt = new Date(2026, 8, 20, 14, 21).toISOString();

  it("says nothing while the order is open", () => {
    expect(
      chatClosing({
        status: "AWAITING_FIAT_PAYMENT",
        closedAt: null,
        chat: { closesAt: null },
        actions: { canChat: true },
      }),
    ).toEqual({ open: true, line: null });
  });

  it("says until when it stays open, and why then", () => {
    expect(
      chatClosing({
        status: "COMPLETED",
        closedAt,
        chat: { closesAt },
        actions: { canChat: true },
      }),
    ).toEqual({
      open: true,
      line: "This chat closes on 20 Sept at 14:21, 24 hours after the order was completed.",
    });
  });

  it("says when it closed and why, once it has", () => {
    expect(
      chatClosing({
        status: "EXPIRED",
        closedAt,
        chat: { closesAt },
        actions: { canChat: false },
      }),
    ).toEqual({
      open: false,
      line: "It closed on 20 Sept at 14:21, 24 hours after the order expired. You can still read it.",
    });
  });
});
