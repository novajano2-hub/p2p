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
  { label: string; numberLabel: string; /** The bar beside the name, Binance-style. */ bar: string }
> = {
  TELEBIRR: {
    label: "Telebirr",
    numberLabel: "Telebirr phone number",
    bar: "bg-status-complete-fg",
  },
  CBE_BIRR: { label: "CBE Birr", numberLabel: "CBE Birr phone number", bar: "bg-primary" },
  MPESA: { label: "M-Pesa", numberLabel: "M-Pesa phone number", bar: "bg-status-pending-fg" },
  BANK_TRANSFER: { label: "Bank transfer", numberLabel: "Account number", bar: "bg-sage" },
};

export const PAYMENT_KIND_LIST = Object.keys(PAYMENT_KINDS) as PaymentMethodKind[];

/** Every bank a transfer may name, code and name, in the order the API lists them. */
export const BANKS: readonly { code: string; name: string }[] = [
  { code: "CBE", name: "Commercial Bank of Ethiopia" },
  { code: "AWASH", name: "Awash Bank" },
  { code: "DASHEN", name: "Dashen Bank" },
  { code: "ABYSSINIA", name: "Bank of Abyssinia" },
  { code: "WEGAGEN", name: "Wegagen Bank" },
  { code: "NIB", name: "Nib International Bank" },
  { code: "HIBRET", name: "Hibret Bank" },
  { code: "ZEMEN", name: "Zemen Bank" },
  { code: "BERHAN", name: "Berhan Bank" },
  { code: "ABAY", name: "Abay Bank" },
  { code: "BUNNA", name: "Bunna Bank" },
  { code: "ENAT", name: "Enat Bank" },
  { code: "COOP_OROMIA", name: "Cooperative Bank of Oromia" },
  { code: "OROMIA", name: "Oromia Bank" },
  { code: "LION", name: "Lion International Bank" },
  { code: "AMHARA", name: "Amhara Bank" },
  { code: "SIINQEE", name: "Siinqee Bank" },
  { code: "TSEHAY", name: "Tsehay Bank" },
  { code: "ZAMZAM", name: "ZamZam Bank" },
  { code: "HIJRA", name: "Hijra Bank" },
  { code: "GADAA", name: "Gadaa Bank" },
  { code: "AHADU", name: "Ahadu Bank" },
  { code: "GOH_BETOCH", name: "Goh Betoch Bank" },
  { code: "TSEDEY", name: "Tsedey Bank" },
  { code: "GLOBAL", name: "Global Bank Ethiopia" },
];

/** How long a buyer has to pay. The four the API accepts. */
export const PAYMENT_WINDOWS = [15, 30, 45, 60] as const;

export const OFFER_STATUS: Record<OfferStatus, { label: string; tone: StatusTone }> = {
  ACTIVE: { label: "Live", tone: "complete" },
  PAUSED: { label: "Paused", tone: "pending" },
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
  avgReleaseSeconds: number | null;
}): string {
  const parts = [`${stats.tradesTotal} ${stats.tradesTotal === 1 ? "order" : "orders"}`];
  if (stats.completionRate !== null) parts.push(`${stats.completionRate}% completion`);
  if (stats.avgReleaseSeconds !== null)
    parts.push(`releases in ~${minutes(stats.avgReleaseSeconds)}`);
  return parts.join(" · ");
}

function minutes(seconds: number): string {
  const value = Math.max(1, Math.round(seconds / 60));
  return `${value} min`;
}
