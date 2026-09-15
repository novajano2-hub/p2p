import { type OfferStatus } from "@abay/database";

import {
  assertTransition,
  IllegalTransitionError,
  terminalStates,
} from "@/common/state-machine/transition";

import { OFFER_TRANSITIONS } from "./offer.service";

/*
  AT-17 for the fourth table. Three states and nine pairs, and the only one
  that matters is the pair that is not there: a closed offer cannot come back.

  The service asserts through the same helper the other three machines use,
  so this sweep calls assertTransition with the same arguments the service
  passes rather than through a wrapper of its own.
*/

const SUBJECT = "offer";
const STATES = Object.keys(OFFER_TRANSITIONS) as OfferStatus[];

const attempt = (from: OfferStatus, to: OfferStatus) => () => {
  assertTransition(SUBJECT, OFFER_TRANSITIONS, from, to);
};

describe("the offer state machine", () => {
  it("refuses every pair the table does not list (AT-17, this machine)", () => {
    for (const from of STATES) {
      for (const to of STATES) {
        const listed = OFFER_TRANSITIONS[from].includes(to);
        if (listed) expect(attempt(from, to)).not.toThrow();
        else expect(attempt(from, to)).toThrow(IllegalTransitionError);
      }
    }
  });

  it("refuses with a 409 naming the offer and both ends", () => {
    let thrown: unknown;
    try {
      assertTransition(SUBJECT, OFFER_TRANSITIONS, "CLOSED", "ACTIVE");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(IllegalTransitionError);
    const error = thrown as IllegalTransitionError;
    expect(error.status).toBe(409);
    expect(error.machine).toBe("offer");
    expect(error.from).toBe("CLOSED");
    expect(error.to).toBe("ACTIVE");
  });

  /*
    Closing is the only one-way door here, and it has to be. An advertiser
    closes an offer to stop being taken - if it could be reopened, the id a
    taker is holding from a stale marketplace page would become takeable
    again at whatever price the offer now carries.
  */
  it("never reopens a closed offer", () => {
    expect(OFFER_TRANSITIONS.CLOSED).toEqual([]);
    expect(terminalStates(OFFER_TRANSITIONS)).toEqual(["CLOSED"]);
    for (const to of STATES) {
      expect(attempt("CLOSED", to)).toThrow(IllegalTransitionError);
    }
  });

  it("lets an advertiser pause and come back without closing", () => {
    expect(OFFER_TRANSITIONS.ACTIVE).toEqual(["PAUSED", "CLOSED"]);
    expect(OFFER_TRANSITIONS.PAUSED).toEqual(["ACTIVE", "CLOSED"]);
    for (const state of STATES) expect(OFFER_TRANSITIONS[state]).not.toContain(state);
  });
});
