import type { Trade, TradeRole, TradeStatus } from "./client";

/*
  What the orders screens work out for themselves, kept apart from the
  components so it can be tested without a browser: where an order is in its
  three steps, what its row in the list asks of the viewer, the stretch of
  time a date filter means, and what a chat says about when it closes.

  None of this decides anything. What a person may do comes from the server's
  `actions`; this only chooses the words and the emphasis.
*/

/* ------------------------------------------------------------ the steps */

export type StepState = "done" | "on" | "todo" | "warn";

export interface OrderProgress {
  /** 1 to 3 while the order is moving through its steps; null once it ended some other way. */
  step: 1 | 2 | 3 | null;
  /** What the top of the order page says: the thing to do now, or how it ended. */
  title: string;
  labels: readonly [string, string, string];
  /** Null for an order that was cancelled, expired or refunded: there is no progress to draw. */
  states: readonly [StepState, StepState, StepState] | null;
}

const BUYER_STEPS = ["Pay the seller", "Seller releases", "Completed"] as const;
const SELLER_STEPS = ["Buyer pays", "You release", "Completed"] as const;

export function orderProgress(status: TradeStatus, role: TradeRole): OrderProgress {
  const buying = role === "BUYER";
  const labels = buying ? BUYER_STEPS : SELLER_STEPS;
  switch (status) {
    case "AWAITING_FIAT_PAYMENT":
      return {
        step: 1,
        title: buying ? "Pay the seller" : "Waiting for the buyer to pay",
        labels,
        states: ["on", "todo", "todo"],
      };
    case "BUYER_MARKED_PAID":
      return {
        step: 2,
        title: buying ? "Waiting for the seller to release" : "Check your account, then release",
        labels,
        states: ["done", "on", "todo"],
      };
    case "DISPUTED":
      return {
        step: 2,
        title: "In dispute",
        labels: [labels[0], "In dispute", labels[2]],
        states: ["done", "warn", "todo"],
      };
    case "COMPLETED":
      return { step: 3, title: "Completed", labels, states: ["done", "done", "done"] };
    case "CANCELLED":
      return { step: null, title: "Cancelled", labels, states: null };
    case "EXPIRED":
      return { step: null, title: "Expired", labels, states: null };
    case "REFUNDED":
      return { step: null, title: "Refunded to the seller", labels, states: null };
  }
}

/* --------------------------------------------------------- the figures */

const UNDONE: readonly TradeStatus[] = ["CANCELLED", "EXPIRED", "REFUNDED"];

/**
 * What the order's two figures are called. They follow what has happened: a
 * finished order's are in the past, one the buyer has paid for says so, and
 * one that ended some other way moved nothing, so it claims nothing.
 */
export function figureLabels(trade: Pick<Trade, "status" | "role" | "paidAt">): {
  usdt: string;
  fiat: string;
} {
  const buying = trade.role === "BUYER";
  if (trade.status === "COMPLETED") {
    return buying
      ? { usdt: "You received", fiat: "You paid" }
      : { usdt: "You gave", fiat: "You received" };
  }
  if (UNDONE.includes(trade.status)) {
    return buying
      ? { usdt: "You were to receive", fiat: "You were to pay" }
      : { usdt: "You were to give", fiat: "You were to receive" };
  }
  return buying
    ? { usdt: "You receive", fiat: trade.paidAt ? "You paid" : "You pay" }
    : { usdt: "You give", fiat: "You receive" };
}

/* ------------------------------------------------- a row in the orders list */

/** What a row's button says: the thing wanted from the viewer, or just a way in. */
export function rowAction(trade: Pick<Trade, "status" | "actions">): {
  label: "Pay now" | "Release" | "View";
  primary: boolean;
} {
  if (trade.actions.canMarkPaid) return { label: "Pay now", primary: true };
  // A disputed order can be released too, but a dispute is not a nudge to release.
  if (trade.actions.canRelease && trade.status === "BUYER_MARKED_PAID") {
    return { label: "Release", primary: true };
  }
  return { label: "View", primary: false };
}

/* --------------------------------------------------------- the date range */

export type RangePreset = "all" | "7d" | "30d" | "90d" | "custom";

export interface RangeChoice {
  preset: RangePreset;
  /** For a custom range: the days as a date input gives them, "2026-09-01". Either may be empty. */
  from: string;
  to: string;
}

export const NO_RANGE: RangeChoice = { preset: "all", from: "", to: "" };

export const RANGE_PRESETS: readonly { id: RangePreset; label: string }[] = [
  { id: "all", label: "All time" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
  { id: "custom", label: "Custom" },
];

const DAYS: Record<Exclude<RangePreset, "all" | "custom">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

/** Midnight at the start of a "2026-09-01" day, in the viewer's own time zone; null if it is not a day. */
function startOfDay(day: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The moments a choice means, as the API wants them: from the first, up to
 * but not including the second. Days are the viewer's days - "19 Sept" ends
 * at their midnight, not at UTC's.
 */
export function rangeBounds(
  choice: RangeChoice,
  now: Date = new Date(),
): { from?: string; to?: string } {
  if (choice.preset === "all") return {};
  if (choice.preset !== "custom") {
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - DAYS[choice.preset]);
    return { from: from.toISOString() };
  }
  const from = startOfDay(choice.from);
  const last = startOfDay(choice.to);
  const to = last ? new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1) : null;
  // Back to front: nothing can be in it, and the API would refuse it. Treat it as not chosen yet.
  if (from && to && from.getTime() >= to.getTime()) return {};
  return {
    ...(from ? { from: from.toISOString() } : {}),
    ...(to ? { to: to.toISOString() } : {}),
  };
}

const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** "All time", "Last 30 days", "1 Sept 2026 – 19 Sept 2026". */
export function rangeLabel(choice: RangeChoice): string {
  if (choice.preset !== "custom") {
    return RANGE_PRESETS.find((preset) => preset.id === choice.preset)?.label ?? "All time";
  }
  const from = startOfDay(choice.from);
  const to = startOfDay(choice.to);
  if (from && to) return `${day.format(from)} – ${day.format(to)}`;
  if (from) return `From ${day.format(from)}`;
  if (to) return `Until ${day.format(to)}`;
  return "Custom range";
}

/** Whether a choice narrows the list at all. A custom range with no days in it does not. */
export const rangeIsSet = (choice: RangeChoice): boolean =>
  Object.keys(rangeBounds(choice)).length > 0;

/* ---------------------------------------------------- where the chat is */

/** From here up the chat sits beside the order. Tailwind's lg breakpoint. */
export const CHAT_BESIDE = "(min-width: 1024px)";

/**
 * An order with its chat open. Below the breakpoint the chat is a screen of
 * its own and this is what opens it; above it the chat is beside the order
 * whatever the address says.
 */
export const chatLink = (tradeId: string): string => `/orders/${tradeId}?chat=open`;

/** Whether an address's query asks for the chat. */
export const chatAsked = (params: { get(name: string): string | null }): boolean =>
  params.get("chat") === "open";

/* ------------------------------------------------- when the chat closes */

const closing = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

const ENDED: Partial<Record<TradeStatus, string>> = {
  COMPLETED: "was completed",
  CANCELLED: "was cancelled",
  EXPIRED: "expired",
  REFUNDED: "was refunded",
};

/**
 * What the chat says about its own end. While the order is open: nothing.
 * After it: until when the chat stays open, and why then - or, once closed,
 * when it closed and why, since a message box that simply is not there
 * explains nothing.
 */
export function chatClosing(
  trade: Pick<Trade, "status" | "closedAt"> & {
    chat: Pick<Trade["chat"], "closesAt">;
    actions: Pick<Trade["actions"], "canChat">;
  },
): { open: boolean; line: string | null } {
  const open = trade.actions.canChat;
  const { closesAt } = trade.chat;
  if (!closesAt || !trade.closedAt) return { open, line: null };

  const at = new Date(closesAt);
  const when = `${closing.format(at)} at ${clock.format(at)}`;
  const hours = Math.round((at.getTime() - new Date(trade.closedAt).getTime()) / 3_600_000);
  const after = `${hours} ${hours === 1 ? "hour" : "hours"} after the order ${ENDED[trade.status] ?? "closed"}`;
  return {
    open,
    line: open
      ? `This chat closes on ${when}, ${after}.`
      : `It closed on ${when}, ${after}. You can still read it.`,
  };
}
