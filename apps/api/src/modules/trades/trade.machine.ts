import { type TradeRole } from "@abay/contracts";
import { type TradeStatus } from "@abay/database";

import { assertTransition, type TransitionTable } from "@/common/state-machine/transition";

/*
  The trade machine, as docs/architecture/state-machines.md 3 draws it, with
  three edges that document records as built rather than specified:

    only the buyer cancels          a seller who could cancel after the buyer
                                    had sent birr but before "I have paid"
                                    would be keeping the birr and the USDT
    the seller may release while    most appeals end with the seller finally
    DISPUTED                        seeing the money; an administrator is for
                                    the ones that do not
    the appellant may withdraw      DISPUTED back to BUYER_MARKED_PAID, where
                                    the seller can release

  What the table does NOT contain is the point (AT-4): nothing leads out of
  BUYER_MARKED_PAID on a timer. The expirer only ever touches a trade that is
  still waiting to be paid.
*/
export const TRADE_TRANSITIONS: TransitionTable<TradeStatus> = {
  AWAITING_FIAT_PAYMENT: ["BUYER_MARKED_PAID", "CANCELLED", "EXPIRED"],
  BUYER_MARKED_PAID: ["COMPLETED", "DISPUTED"],
  DISPUTED: ["COMPLETED", "REFUNDED", "BUYER_MARKED_PAID"],
  COMPLETED: [],
  CANCELLED: [],
  EXPIRED: [],
  REFUNDED: [],
};

export const assertTradeTransition = (from: TradeStatus, to: TradeStatus): void => {
  assertTransition("trade", TRADE_TRANSITIONS, from, to);
};

/** The states in which the escrow still holds the trade's amount. */
export const OPEN: readonly TradeStatus[] = [
  "AWAITING_FIAT_PAYMENT",
  "BUYER_MARKED_PAID",
  "DISPUTED",
];

/** The states in which the escrow is exactly zero (ledger-taxonomy.md 3.2). */
export const SETTLED: readonly TradeStatus[] = ["COMPLETED", "CANCELLED", "EXPIRED", "REFUNDED"];

export const isOpen = (status: TradeStatus): boolean => OPEN.includes(status);

/*
  What to tell each party. A table rather than a switch, so that a new state
  cannot be added without deciding what it says to both sides; null means
  the status speaks for itself.
*/
const MESSAGES: Record<TradeStatus, Record<TradeRole, string | null>> = {
  AWAITING_FIAT_PAYMENT: {
    BUYER: "Pay the seller with the details shown, then press I have paid.",
    SELLER: "Waiting for the buyer to pay. Do not release until the money is in your account.",
  },
  BUYER_MARKED_PAID: {
    BUYER: "The seller has been told. They release the USDT once your payment shows up.",
    SELLER: "The buyer says they have paid. Check your account, then release.",
  },
  DISPUTED: {
    BUYER: "This trade is under review. Keep the conversation in the chat.",
    SELLER: "This trade is under review. Keep the conversation in the chat.",
  },
  COMPLETED: { BUYER: "The USDT is in your available balance.", SELLER: null },
  CANCELLED: {
    BUYER: "You cancelled this trade. The seller's USDT went back to them.",
    SELLER: "The buyer cancelled. Your USDT is back in your available balance.",
  },
  EXPIRED: {
    BUYER: "The time to pay ran out. Do not send anything for this trade now.",
    SELLER: "The buyer did not pay in time. Your USDT is back in your available balance.",
  },
  REFUNDED: {
    BUYER: "This trade was decided in the seller's favour.",
    SELLER: "This trade was decided in your favour. Your USDT is back in your available balance.",
  },
};

export const messageFor = (status: TradeStatus, role: TradeRole): string | null =>
  MESSAGES[status][role];
