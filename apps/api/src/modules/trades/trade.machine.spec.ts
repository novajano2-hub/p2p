import { type TradeRole } from "@abay/contracts";
import { type TradeStatus } from "@abay/database";

import { IllegalTransitionError, terminalStates } from "@/common/state-machine/transition";

import {
  assertTradeTransition,
  isOpen,
  messageFor,
  OPEN,
  SETTLED,
  TRADE_TRANSITIONS,
} from "./trade.machine";

/*
  AT-17 for the machine that decides whether escrow may leave a trade.

  The withdrawal and deposit machines have had this sweep since Phase 3; this
  one is the table with the most money behind it and had two of its
  forty-nine pairs asserted, incidentally, inside an AT-4 test. Everything
  here is the table talking to itself: no database, no Nest, no HTTP. What a
  refused transition does to the world - that it writes nothing - is a
  different question, asked in test/api/transitions.spec.ts.
*/

const STATES = Object.keys(TRADE_TRANSITIONS) as TradeStatus[];
const ROLES: TradeRole[] = ["BUYER", "SELLER"];

describe("the trade state machine", () => {
  it("refuses every pair the table does not list (AT-17, this machine)", () => {
    for (const from of STATES) {
      for (const to of STATES) {
        const listed = TRADE_TRANSITIONS[from].includes(to);
        const attempt = () => {
          assertTradeTransition(from, to);
        };
        if (listed) expect(attempt).not.toThrow();
        else expect(attempt).toThrow(IllegalTransitionError);
      }
    }
  });

  it("refuses with a 409 that names both ends, not a bare throw", () => {
    let thrown: unknown;
    try {
      assertTradeTransition("COMPLETED", "AWAITING_FIAT_PAYMENT");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(IllegalTransitionError);
    const error = thrown as IllegalTransitionError;
    expect(error.status).toBe(409);
    expect(error.code).toBe("CONFLICT");
    expect(error.machine).toBe("trade");
    expect(error.from).toBe("COMPLETED");
    expect(error.to).toBe("AWAITING_FIAT_PAYMENT");
  });

  /*
    A trade that could go from a state to itself would let the same move be
    made twice - two releases, two refunds - and the second one would post a
    second set of entries. The table's job is to make that unrepresentable.
  */
  it("lets no state lead back to itself", () => {
    for (const state of STATES) {
      expect(TRADE_TRANSITIONS[state]).not.toContain(state);
    }
  });

  it("keeps OPEN, SETTLED and the table from drifting apart", () => {
    expect(terminalStates(TRADE_TRANSITIONS).sort()).toEqual([...SETTLED].sort());
    expect([...OPEN, ...SETTLED].sort()).toEqual([...STATES].sort());
    for (const state of STATES) {
      expect(isOpen(state)).toBe(OPEN.includes(state));
      // Every open state has somewhere to go; a settled one is the end.
      expect(TRADE_TRANSITIONS[state].length > 0).toBe(isOpen(state));
    }
  });

  /* ------------------------------------------ the rules that cost money */

  /*
    If this pair were ever listed, escrow could be paid to the buyer before
    they had even claimed to have sent birr - the seller would lose the coins
    for nothing. Release is only reachable through BUYER_MARKED_PAID or
    through a decision on a dispute.
  */
  it("never releases a trade the buyer has not even claimed to have paid", () => {
    expect(TRADE_TRANSITIONS.AWAITING_FIAT_PAYMENT).toEqual([
      "BUYER_MARKED_PAID",
      "CANCELLED",
      "EXPIRED",
    ]);
    expect(TRADE_TRANSITIONS.AWAITING_FIAT_PAYMENT).not.toContain("COMPLETED");
    expect(TRADE_TRANSITIONS.AWAITING_FIAT_PAYMENT).not.toContain("REFUNDED");
  });

  /*
    AT-4, expressed on the table: once the buyer says they have paid, the only
    ways out are a release or a person. An EXPIRED or CANCELLED edge here
    would hand the seller their coins back after the birr had been sent.
  */
  it("gives a paid trade no exit but a release or a dispute", () => {
    expect(TRADE_TRANSITIONS.BUYER_MARKED_PAID).toEqual(["COMPLETED", "DISPUTED"]);
    expect(TRADE_TRANSITIONS.BUYER_MARKED_PAID).not.toContain("EXPIRED");
    expect(TRADE_TRANSITIONS.BUYER_MARKED_PAID).not.toContain("CANCELLED");
  });

  /*
    The three ends of a dispute: decided for the buyer, decided for the
    seller, or withdrawn back to where the seller can still release. Anything
    else - expiring a disputed trade, cancelling it - would settle escrow
    without a decision.
  */
  it("ends a dispute only by deciding it or withdrawing it", () => {
    expect(TRADE_TRANSITIONS.DISPUTED).toEqual(["COMPLETED", "REFUNDED", "BUYER_MARKED_PAID"]);
  });

  it("lets nothing out of a settled trade", () => {
    for (const state of SETTLED) {
      expect(TRADE_TRANSITIONS[state]).toEqual([]);
      for (const to of STATES) {
        expect(() => {
          assertTradeTransition(state, to);
        }).toThrow(IllegalTransitionError);
      }
    }
  });

  /*
    A state without words is a screen that says nothing to somebody whose
    money is in it, so the table is exhaustive by its type and this proves
    the values are really there rather than undefined at runtime.
  */
  it("has something to say to both parties in every state", () => {
    for (const state of STATES) {
      for (const role of ROLES) {
        const message = messageFor(state, role);
        expect(message === null || message.length > 0).toBe(true);
      }
    }
    // The one deliberate silence: a completed trade needs no line for the
    // seller, who has already been paid and told.
    expect(messageFor("COMPLETED", "SELLER")).toBeNull();
    expect(messageFor("COMPLETED", "BUYER")).not.toBeNull();
  });
});
