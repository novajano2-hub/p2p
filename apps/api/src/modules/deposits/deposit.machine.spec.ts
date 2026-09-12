import { IllegalTransitionError, terminalStates } from "@/common/state-machine/transition";

import {
  assertDepositTransition,
  confirmationsOf,
  DEPOSIT_TRANSITIONS,
  isOrphaned,
} from "./deposit.machine";

describe("the deposit state machine", () => {
  it("has the three terminal states the document names", () => {
    expect(terminalStates(DEPOSIT_TRANSITIONS).sort()).toEqual([
      "CREDITED",
      "ORPHANED",
      "REJECTED",
    ]);
  });

  it("refuses every pair the table does not list", () => {
    const states = Object.keys(DEPOSIT_TRANSITIONS) as (keyof typeof DEPOSIT_TRANSITIONS)[];
    let refused = 0;
    for (const from of states) {
      for (const to of states) {
        const listed = DEPOSIT_TRANSITIONS[from].includes(to);
        if (listed) {
          expect(() => {
            assertDepositTransition(from, to);
          }).not.toThrow();
        } else {
          expect(() => {
            assertDepositTransition(from, to);
          }).toThrow(IllegalTransitionError);
          refused += 1;
        }
      }
    }
    // 49 pairs, 8 listed.
    expect(refused).toBe(41);
  });

  it("counts confirmations from the block itself, and never below zero", () => {
    expect(confirmationsOf(100n, 100n)).toBe(1);
    expect(confirmationsOf(114n, 100n)).toBe(15);
    expect(confirmationsOf(99n, 100n)).toBe(0);
  });

  it("treats a transfer as gone only once the chain has moved the reorg depth past it", () => {
    expect(isOrphaned(129n, 100n, 30)).toBe(false);
    expect(isOrphaned(130n, 100n, 30)).toBe(true);
  });
});
