import { type StepState, type Tone } from "@/components/admin/admin-bits";
import {
  type AdminDispute,
  type DisputeOutcome,
  type DisputeReason,
  type DisputeStatus,
  type PaymentKind,
  type TradeEventKind,
  type TradeRole,
  type TradeStatus,
} from "@/lib/admin/disputes";

/*
  What a dispute and the trade under it are called on this side of the table.

  The customer's screens speak in the first person - "I have not received the
  payment" is the sentence a seller picked off a list. A resolver is reading
  about two other people, so everything here names them: who said it, about
  whom. The words are otherwise the same words, deliberately, so that what an
  administrator reads and what the parties read cannot drift apart.

  Tables rather than switch statements, and exhaustive by their type: a new
  reason or outcome breaks the build here until somebody has decided what it
  says to the person deciding.
*/

type Said = { words: string; tone: Tone; note?: string };
type Rail = readonly { label: string; state: StepState; detail?: string }[];

export const DISPUTE_WORDS: Record<DisputeStatus, Said> = {
  OPEN: {
    words: "Waiting for a decision",
    tone: "pending",
    note: "The USDT is still in escrow. Nothing moves until this is decided.",
  },
  WITHDRAWN: {
    words: "Withdrawn",
    tone: "neutral",
    note: "The party who opened it took it back. The trade went on without a decision.",
  },
  RESOLVED: {
    words: "Decided",
    tone: "complete",
    note: "The escrow has been settled the way the decision said.",
  },
};

/** The disputed trade's own state, which is not always DISPUTED by the time it is read. */
export const TRADE_WORDS: Record<TradeStatus, Said> = {
  AWAITING_FIAT_PAYMENT: { words: "Waiting for payment", tone: "pending" },
  BUYER_MARKED_PAID: { words: "Buyer says they paid", tone: "pending" },
  COMPLETED: { words: "Completed", tone: "complete" },
  CANCELLED: { words: "Cancelled", tone: "neutral" },
  EXPIRED: { words: "Expired unpaid", tone: "neutral" },
  DISPUTED: { words: "In dispute", tone: "attention" },
  REFUNDED: { words: "Refunded to the seller", tone: "neutral" },
};

/**
 * What each side is claiming, said about them rather than by them. The buyer
 * and the seller can each reach only some of these (the form offers a
 * different list to each), but a resolver may be handed any of them.
 */
const CLAIM: Record<DisputeReason, Record<TradeRole, string>> = {
  PAYMENT_NOT_RECEIVED: {
    SELLER: "The seller says no payment ever arrived.",
    BUYER: "The buyer says the payment did not arrive.",
  },
  PAYMENT_NOT_RELEASED: {
    BUYER: "The buyer says they paid and the seller has not released.",
    SELLER: "The seller says the release did not happen.",
  },
  WRONG_AMOUNT: {
    SELLER: "The seller says the amount that arrived is not the amount agreed.",
    BUYER: "The buyer says the amount is not the amount agreed.",
  },
  THIRD_PARTY_PAYMENT: {
    SELLER: "The seller says the payment came from somebody else's account.",
    BUYER: "The buyer says the payment was made from another account.",
  },
  SUSPECTED_FRAUD: {
    BUYER: "The buyer suspects fraud.",
    SELLER: "The seller suspects fraud.",
  },
  OTHER: {
    BUYER: "The buyer gave another reason.",
    SELLER: "The seller gave another reason.",
  },
};

export function claimSaid(reason: DisputeReason, openedBy: TradeRole): string {
  return CLAIM[reason][openedBy];
}

/** The short form, for a queue row where the description is right beneath it. */
export const REASON_WORDS: Record<DisputeReason, string> = {
  PAYMENT_NOT_RECEIVED: "Payment not received",
  PAYMENT_NOT_RELEASED: "Not released after payment",
  WRONG_AMOUNT: "Wrong amount",
  THIRD_PARTY_PAYMENT: "Paid by a third party",
  SUSPECTED_FRAUD: "Suspected fraud",
  OTHER: "Another reason",
};

/**
 * The two decisions, and what each one does. The consequence is shown before
 * the button, not after it: there is no undo on either, and the two are
 * opposite - one pays the buyer, the other gives the seller their coins back.
 */
export const OUTCOME_WORDS: Record<
  DisputeOutcome,
  { words: string; short: string; consequence: string }
> = {
  RELEASE_TO_BUYER: {
    words: "Release the USDT to the buyer",
    short: "Released to the buyer",
    consequence:
      "The escrow is paid out to the buyer exactly as a normal release would, fee included, and the trade completes. Decide this when you are satisfied the ETB reached the seller.",
  },
  REFUND_TO_SELLER: {
    words: "Return the USDT to the seller",
    short: "Refunded to the seller",
    consequence:
      "The escrow goes back to the seller's available balance and the trade ends refunded. The buyer gets nothing. Decide this when you are satisfied no payment reached the seller.",
  },
};

/** What the timeline calls each event, with nobody addressed as "you". */
export const EVENT_WORDS: Record<TradeEventKind, string> = {
  CREATED: "Trade opened, USDT locked in escrow",
  MARKED_PAID: "Buyer marked the ETB as sent",
  CANCELLED: "Cancelled, escrow returned to the seller",
  EXPIRED: "Expired unpaid, escrow returned to the seller",
  RELEASED: "USDT released to the buyer",
  DISPUTE_OPENED: "Dispute opened",
  DISPUTE_WITHDRAWN: "Dispute withdrawn",
  DISPUTE_RESOLVED: "Dispute decided",
};

export const ACTOR_WORDS: Record<"BUYER" | "SELLER" | "ADMIN" | "SYSTEM", string> = {
  BUYER: "buyer",
  SELLER: "seller",
  ADMIN: "administrator",
  SYSTEM: "system",
};

/** The same rails the customer sees named, and what their number is called. */
export const PAYMENT_WORDS: Record<PaymentKind, { label: string; numberLabel: string }> = {
  TELEBIRR: { label: "Telebirr", numberLabel: "Telebirr phone number" },
  CBE_BIRR: { label: "CBE Birr", numberLabel: "CBE Birr phone number" },
  MPESA: { label: "M-Pesa", numberLabel: "M-Pesa phone number" },
  CBE: { label: "Commercial Bank of Ethiopia", numberLabel: "Account number" },
  DASHEN: { label: "Dashen Bank", numberLabel: "Account number" },
  ABYSSINIA: { label: "Bank of Abyssinia", numberLabel: "Account number" },
  AWASH: { label: "Awash Bank", numberLabel: "Account number" },
};

/**
 * Where the trade got to, in four stops. The trade's own journey rather than
 * the dispute's, because what a resolver needs at a glance is where the money
 * is and how it got there - a dispute of its own has only two states worth
 * drawing, and they are both in the heading already.
 */
export function disputeRail(dispute: AdminDispute): Rail {
  const opened = { label: "Trade opened", state: "done" as StepState };
  const paid = {
    label: "Buyer marked paid",
    state: (dispute.trade.paidAt ? "done" : "todo") as StepState,
  };
  const disputed = {
    label: "Disputed",
    state: (dispute.status === "OPEN" ? "active" : "done") as StepState,
  };

  if (dispute.status === "OPEN") {
    return [opened, paid, disputed, { label: "Decided", state: "todo" }];
  }
  if (dispute.status === "WITHDRAWN") {
    return [opened, paid, disputed, { label: "Withdrawn", state: "done" }];
  }
  return [
    opened,
    paid,
    disputed,
    {
      label: dispute.outcome ? OUTCOME_WORDS[dispute.outcome].short : "Decided",
      state: "done",
    },
  ];
}

/** "14 trades · 12 completed · 2 failed", the line under a party's name. */
export function partyRecord(party: {
  tradesTotal: number;
  tradesCompleted: number;
  tradesFailed: number;
}): string {
  const finished = party.tradesCompleted + party.tradesFailed;
  const rate = finished === 0 ? null : Math.round((party.tradesCompleted / finished) * 100);
  const trades = `${party.tradesTotal} ${party.tradesTotal === 1 ? "trade" : "trades"}`;
  if (rate === null) return `${trades} · none finished yet`;
  return `${trades} · ${rate}% completed · ${party.tradesFailed} failed`;
}
