import type { StatusTone } from "@/components/ui/status-pill";
import type {
  DisputeReason,
  OfferStatus,
  PaymentMethodKind,
  TradeRole,
  TradeStatus,
} from "@/lib/market/client";

/*
  The words. Every enumeration the API speaks in, as a person reads it,
  mirrored from @abay/contracts rather than imported so the browser bundle
  stays independent of the API's build (the same rule as everywhere else in
  lib/). The mirror test on the server side pins the enumerations to the
  schema; this file pins the words to the enumerations.
*/

export const FIAT = "birr";
export const ASSET = "USDT";

export const PAYMENT_KINDS: Record<
  PaymentMethodKind,
  {
    /** What a list, a chip and a filter say. */
    label: string;
    /** What the payment instructions say: "CBE" alone is too little to type into a banking app. */
    fullName: string;
    numberLabel: string;
    institution: "wallet" | "bank";
    /** The bar beside the name, Binance-style. */
    bar: string;
  }
> = {
  TELEBIRR: {
    label: "Telebirr",
    fullName: "Telebirr",
    numberLabel: "Telebirr phone number",
    institution: "wallet",
    bar: "bg-status-complete-fg",
  },
  CBE_BIRR: {
    label: "CBE Birr",
    fullName: "CBE Birr",
    numberLabel: "CBE Birr phone number",
    institution: "wallet",
    bar: "bg-primary",
  },
  MPESA: {
    label: "M-Pesa",
    fullName: "M-Pesa",
    numberLabel: "M-Pesa phone number",
    institution: "wallet",
    bar: "bg-status-pending-fg",
  },
  CBE: {
    label: "CBE",
    fullName: "Commercial Bank of Ethiopia",
    numberLabel: "Account number",
    institution: "bank",
    bar: "bg-sage",
  },
  DASHEN: {
    label: "Dashen Bank",
    fullName: "Dashen Bank",
    numberLabel: "Account number",
    institution: "bank",
    bar: "bg-status-attention-fg",
  },
  ABYSSINIA: {
    label: "Bank of Abyssinia",
    fullName: "Bank of Abyssinia",
    numberLabel: "Account number",
    institution: "bank",
    bar: "bg-foreground",
  },
  AWASH: {
    label: "Awash Bank",
    fullName: "Awash Bank",
    numberLabel: "Account number",
    institution: "bank",
    bar: "bg-muted-foreground",
  },
};

export const PAYMENT_KIND_LIST = Object.keys(PAYMENT_KINDS) as PaymentMethodKind[];
/** The three mobile wallets, in the order a form offers them. */
export const WALLET_KINDS = ["TELEBIRR", "CBE_BIRR", "MPESA"] as const;
/** The four launch banks, each a method of its own. */
export const BANK_KINDS = ["CBE", "DASHEN", "ABYSSINIA", "AWASH"] as const;

/** How long a buyer has to pay. The four the API accepts. */
export const PAYMENT_WINDOWS = [15, 30, 45, 60] as const;

/** The three states an ad is in, in the words Binance uses for them. */
export const OFFER_STATUS: Record<OfferStatus, { label: string; tone: StatusTone }> = {
  ACTIVE: { label: "Online", tone: "complete" },
  PAUSED: { label: "Offline", tone: "pending" },
  CLOSED: { label: "Closed", tone: "neutral" },
};

/**
 * A trade's status as a pill: the same seven states from either side of the
 * table, worded for the person reading, with the tone that says whether
 * anything is wanted from them.
 */
export function tradeStatusPill(
  status: TradeStatus,
  role: TradeRole,
): { label: string; tone: StatusTone } {
  switch (status) {
    case "AWAITING_FIAT_PAYMENT":
      return role === "BUYER"
        ? { label: "Pay now", tone: "pending" }
        : { label: "Awaiting payment", tone: "pending" };
    case "BUYER_MARKED_PAID":
      return role === "SELLER"
        ? { label: "Release", tone: "attention" }
        : { label: "Awaiting release", tone: "pending" };
    case "DISPUTED":
      return { label: "In dispute", tone: "attention" };
    case "COMPLETED":
      return { label: "Completed", tone: "complete" };
    case "CANCELLED":
      return { label: "Cancelled", tone: "neutral" };
    case "EXPIRED":
      return { label: "Expired", tone: "neutral" };
    case "REFUNDED":
      return { label: "Refunded", tone: "neutral" };
  }
}

/** Where a trade stands, as the end of "It is ... now." */
export const TRADE_STATUS_NOW: Record<TradeStatus, string> = {
  AWAITING_FIAT_PAYMENT: "waiting for the buyer to pay",
  BUYER_MARKED_PAID: "marked as paid",
  DISPUTED: "in dispute",
  COMPLETED: "complete",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
  REFUNDED: "refunded to the seller",
};

export const DISPUTE_REASONS: Record<DisputeReason, string> = {
  PAYMENT_NOT_RECEIVED: "I have not received the payment",
  PAYMENT_NOT_RELEASED: "I paid and the seller has not released",
  WRONG_AMOUNT: "The amount received is not the agreed amount",
  THIRD_PARTY_PAYMENT: "The payment came from somebody else's account",
  SUSPECTED_FRAUD: "I suspect fraud",
  OTHER: "Something else",
};

/** The reasons in the order a form offers them: a buyer's first, then a seller's. */
export const DISPUTE_REASONS_FOR: Record<TradeRole, readonly DisputeReason[]> = {
  BUYER: ["PAYMENT_NOT_RELEASED", "SUSPECTED_FRAUD", "OTHER"],
  SELLER: [
    "PAYMENT_NOT_RECEIVED",
    "WRONG_AMOUNT",
    "THIRD_PARTY_PAYMENT",
    "SUSPECTED_FRAUD",
    "OTHER",
  ],
};

/** What the timeline calls each event. */
export const EVENT_LABELS: Record<string, string> = {
  CREATED: "Trade opened, USDT locked in escrow",
  MARKED_PAID: "Marked as paid",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired unpaid, escrow returned to the seller",
  RELEASED: "USDT released to the buyer",
  DISPUTE_OPENED: "Dispute opened",
  DISPUTE_WITHDRAWN: "Dispute withdrawn",
  DISPUTE_RESOLVED: "Dispute decided",
};

/** "12 orders · 98% completion", the line under an advertiser's name. */
export function traderRecord(stats: {
  tradesTotal: number;
  completionRate: number | null;
}): string {
  const parts = [`${stats.tradesTotal} ${stats.tradesTotal === 1 ? "order" : "orders"}`];
  if (stats.completionRate !== null) parts.push(`${stats.completionRate}% completion`);
  return parts.join(" · ");
}

/** "releases in ~4 min", or null before there is anything to average. */
export function releaseHint(stats: { avgReleaseSeconds: number | null }): string | null {
  return stats.avgReleaseSeconds === null
    ? null
    : `releases in ~${minutes(stats.avgReleaseSeconds)}`;
}

/** "~6 min", or a dash before there is anything to average. */
export function averageMinutes(seconds: number | null): string {
  return seconds === null ? "—" : `~${minutes(seconds)}`;
}

/** "23 h 41 min", "41 min": how long until a moment, rounded up to the minute. */
export function untilLabel(ms: number): string {
  const total = Math.ceil(ms / 60_000);
  if (total <= 0) return "less than a minute";
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

function minutes(seconds: number): string {
  const value = Math.max(1, Math.round(seconds / 60));
  return `${value} min`;
}
