import { type WithdrawalStage } from "@abay/contracts";
import { type WithdrawalStatus } from "@abay/database";

import { assertTransition, type TransitionTable } from "@/common/state-machine/transition";

/*
  The withdrawal machine, exactly as docs/architecture/state-machines.md 2
  draws it. It has the most states of the three because it is the only place
  the platform gives up assets irreversibly, and each state exists to record
  one specific thing we do or do not know.

  The three rules worth stating out loud, because breaking any of them costs
  real money:

    nothing leaves BROADCAST_UNKNOWN on its own       a retry sends twice,
                                                      a refund gives it away
    nothing reaches a refund from a broadcast state   the coins may be gone
    every refunding state is one where non-broadcast   which is why
      is certain                                       BUILD_FAILED and
                                                       SIGN_REFUSED may, and
                                                       BROADCAST may not
*/
export const WITHDRAWAL_TRANSITIONS: TransitionTable<WithdrawalStatus> = {
  REQUESTED: ["RISK_REVIEW", "CANCELLED"],
  RISK_REVIEW: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["BUILDING"],
  BUILDING: ["SIGNING", "BUILD_FAILED"],
  SIGNING: ["BROADCAST", "SIGN_REFUSED", "BROADCAST_UNKNOWN"],
  BROADCAST: ["CONFIRMED", "MANUAL_INVESTIGATION", "BROADCAST_UNKNOWN"],
  BROADCAST_UNKNOWN: ["MANUAL_INVESTIGATION"],
  MANUAL_INVESTIGATION: ["BROADCAST", "FAILED_CONFIRMED"],
  REJECTED: [],
  CANCELLED: [],
  BUILD_FAILED: [],
  SIGN_REFUSED: [],
  CONFIRMED: [],
  FAILED_CONFIRMED: [],
};

export const assertWithdrawalTransition = (from: WithdrawalStatus, to: WithdrawalStatus): void => {
  assertTransition("withdrawal", WITHDRAWAL_TRANSITIONS, from, to);
};

/** The states a customer may still call off. Anything being built is past recall. */
export const CANCELLABLE: readonly WithdrawalStatus[] = ["REQUESTED", "RISK_REVIEW"];

/**
 * The states in which the customer's hold has been released back to them
 * (JE-9). Used to assert the money went back exactly once.
 */
export const RELEASED: readonly WithdrawalStatus[] = [
  "REJECTED",
  "CANCELLED",
  "BUILD_FAILED",
  "SIGN_REFUSED",
  "FAILED_CONFIRMED",
];

/*
  Fourteen states, four words. What a customer needs is where their money is,
  not which of our workers has it: PENDING is "we have it and have not sent
  it", HELD is "a person is looking at it", SENDING covers everything from
  building to an ambiguous broadcast - the funds are visibly held, which is
  what AT-9 requires - SENT is done, and RETURNED means it came back.
*/
const STAGES: Record<WithdrawalStatus, WithdrawalStage> = {
  REQUESTED: "PENDING",
  APPROVED: "PENDING",
  RISK_REVIEW: "HELD",
  BUILDING: "SENDING",
  SIGNING: "SENDING",
  BROADCAST: "SENDING",
  BROADCAST_UNKNOWN: "SENDING",
  MANUAL_INVESTIGATION: "SENDING",
  CONFIRMED: "SENT",
  REJECTED: "RETURNED",
  CANCELLED: "RETURNED",
  BUILD_FAILED: "RETURNED",
  SIGN_REFUSED: "RETURNED",
  FAILED_CONFIRMED: "RETURNED",
};

export const stageOf = (status: WithdrawalStatus): WithdrawalStage => STAGES[status];

/*
  What to tell the person it happened to. A table rather than a switch, so
  that a new state cannot be added without deciding what it says; null is a
  deliberate "the status speaks for itself".
*/
const MESSAGES: Record<WithdrawalStatus, string | null> = {
  REQUESTED: null,
  APPROVED: null,
  BUILDING: null,
  SIGNING: null,
  BROADCAST: null,
  CONFIRMED: null,
  RISK_REVIEW: "We are checking this withdrawal. It usually takes a few minutes.",
  BROADCAST_UNKNOWN:
    "This is taking longer than usual. Your funds are held safely while we confirm it.",
  MANUAL_INVESTIGATION:
    "This is taking longer than usual. Your funds are held safely while we confirm it.",
  REJECTED: "We could not approve this withdrawal. The funds are back in your balance.",
  CANCELLED: "You cancelled this withdrawal. The funds are back in your balance.",
  BUILD_FAILED: "This withdrawal did not go ahead. The funds are back in your balance.",
  SIGN_REFUSED: "This withdrawal did not go ahead. The funds are back in your balance.",
  FAILED_CONFIRMED: "This withdrawal did not go ahead. The funds are back in your balance.",
};

/** The reason a person gave, where there is one, otherwise the standing wording. */
export function messageFor(status: WithdrawalStatus, failureReason: string | null): string | null {
  if (status === "REJECTED" && failureReason) return failureReason;
  return MESSAGES[status];
}
