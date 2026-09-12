import { IllegalTransitionError, terminalStates } from "@/common/state-machine/transition";

import {
  assertWithdrawalTransition,
  messageFor,
  RELEASED,
  stageOf,
  WITHDRAWAL_TRANSITIONS,
} from "./withdrawal.machine";

type Status = keyof typeof WITHDRAWAL_TRANSITIONS;
const STATES = Object.keys(WITHDRAWAL_TRANSITIONS) as Status[];

describe("the withdrawal state machine", () => {
  it("refuses every pair the table does not list (AT-17, this machine)", () => {
    for (const from of STATES) {
      for (const to of STATES) {
        const listed = WITHDRAWAL_TRANSITIONS[from].includes(to);
        const attempt = () => {
          assertWithdrawalTransition(from, to);
        };
        if (listed) expect(attempt).not.toThrow();
        else expect(attempt).toThrow(IllegalTransitionError);
      }
    }
  });

  it("has exactly the six terminal states, and they are the ones that end things", () => {
    expect(terminalStates(WITHDRAWAL_TRANSITIONS).sort()).toEqual([
      "BUILD_FAILED",
      "CANCELLED",
      "CONFIRMED",
      "FAILED_CONFIRMED",
      "REJECTED",
      "SIGN_REFUSED",
    ]);
  });

  /* The three rules that cost money if broken. */
  it("never lets an ambiguous broadcast retry or refund itself", () => {
    expect(WITHDRAWAL_TRANSITIONS.BROADCAST_UNKNOWN).toEqual(["MANUAL_INVESTIGATION"]);
    for (const to of STATES) {
      if (to === "MANUAL_INVESTIGATION") continue;
      expect(() => {
        assertWithdrawalTransition("BROADCAST_UNKNOWN", to);
      }).toThrow(IllegalTransitionError);
    }
  });

  it("never reaches a refund from a state where the coins may already be gone", () => {
    for (const from of ["BROADCAST", "BROADCAST_UNKNOWN"] as Status[]) {
      for (const to of RELEASED) {
        expect(() => {
          assertWithdrawalTransition(from, to);
        }).toThrow(IllegalTransitionError);
      }
    }
    // The one exception, and it takes a human who checked the chain.
    expect(WITHDRAWAL_TRANSITIONS.MANUAL_INVESTIGATION).toContain("FAILED_CONFIRMED");
  });

  it("shows a customer four words, and keeps their money visible while it is ambiguous", () => {
    expect(stageOf("REQUESTED")).toBe("PENDING");
    expect(stageOf("RISK_REVIEW")).toBe("HELD");
    expect(stageOf("BROADCAST_UNKNOWN")).toBe("SENDING");
    expect(stageOf("MANUAL_INVESTIGATION")).toBe("SENDING");
    expect(stageOf("CONFIRMED")).toBe("SENT");
    for (const status of RELEASED) expect(stageOf(status)).toBe("RETURNED");
    expect(messageFor("BROADCAST_UNKNOWN", null)).toMatch(/held safely/);
    expect(messageFor("CONFIRMED", null)).toBeNull();
  });
});
