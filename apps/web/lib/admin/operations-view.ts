import { type StepState, type Tone } from "@/components/admin/admin-bits";
import {
  type AdminDeposit,
  type AdminWithdrawal,
  type DepositStatus,
  type ReconciliationBreak,
  type Sweep,
  type WithdrawalStatus,
} from "@/lib/admin/operations";

/*
  What each state of the two machines is called on screen, what colour it is,
  and where it sits on the rail.

  Tables rather than switch statements, and exhaustive by their type: adding a
  state to a machine breaks the build here until somebody has decided what it
  says to a person. The wording is the same sort the withdrawal machine's own
  MESSAGES table holds - plain, and about the money rather than about the
  software.
*/

type Said = { words: string; tone: Tone; note?: string };

export const DEPOSIT_WORDS: Record<DepositStatus, Said> = {
  DETECTED: {
    words: "Seen on the chain",
    tone: "neutral",
    note: "The transfer has been read off the chain and is being checked.",
  },
  CONFIRMING: {
    words: "Confirming",
    tone: "pending",
    note: "Waiting for enough blocks before the balance is credited.",
  },
  CREDITED: {
    words: "Credited",
    tone: "complete",
    note: "The customer's balance has been increased. Nothing is outstanding.",
  },
  ORPHANED: {
    words: "Dropped by a reorg",
    tone: "attention",
    note: "The block this was in is no longer part of the chain. Nothing was credited.",
  },
  MANUAL_REVIEW: {
    words: "Held for review",
    tone: "pending",
    note: "Risk asked for a person before this is credited.",
  },
  UNATTRIBUTED: {
    words: "Nobody to credit",
    tone: "attention",
    note: "The coins arrived, but we could not work out whose they are.",
  },
  REJECTED: {
    words: "Rejected",
    tone: "attention",
    note: "An administrator decided this should not be credited.",
  },
};

export const WITHDRAWAL_WORDS: Record<WithdrawalStatus, Said> = {
  REQUESTED: { words: "Requested", tone: "neutral" },
  RISK_REVIEW: {
    words: "Waiting for approval",
    tone: "pending",
    note: "The money is held. Nothing leaves until somebody approves it.",
  },
  APPROVED: { words: "Approved", tone: "pending", note: "Queued to be built and sent." },
  REJECTED: {
    words: "Rejected",
    tone: "attention",
    note: "The hold was released and the money returned to the balance.",
  },
  CANCELLED: { words: "Cancelled", tone: "neutral", note: "The customer withdrew the request." },
  BUILDING: { words: "Building", tone: "pending" },
  BUILD_FAILED: { words: "Could not be built", tone: "attention" },
  SIGNING: { words: "Signing", tone: "pending" },
  SIGN_REFUSED: {
    words: "Custody refused to sign",
    tone: "attention",
    note: "Nothing was broadcast. The money is still held.",
  },
  BROADCAST: { words: "Sent", tone: "pending", note: "On the chain, waiting for confirmations." },
  BROADCAST_UNKNOWN: {
    words: "Outcome unknown",
    tone: "attention",
    note: "We do not know whether this reached the chain. It is never retried automatically.",
  },
  MANUAL_INVESTIGATION: {
    words: "Needs investigating",
    tone: "attention",
    note: "Somebody must look this up on the chain and say what actually happened.",
  },
  CONFIRMED: { words: "Confirmed", tone: "complete", note: "Settled on the chain." },
  FAILED_CONFIRMED: {
    words: "Failed on the chain",
    tone: "attention",
    note: "The transaction was mined and reverted. The money went back to the balance.",
  },
};

type Rail = readonly { label: string; state: StepState; detail?: string }[];

/**
 * A deposit's three stops. The middle one is renamed when the deposit went
 * sideways: "Confirming" is a lie on a transfer that never got an owner, and
 * a rail that lies is worse than no rail.
 */
export function depositRail(deposit: AdminDeposit): Rail {
  const seen = { label: "Seen", state: "done" as StepState };
  const counted = `${deposit.confirmations} / ${deposit.confirmationsRequired}`;

  switch (deposit.status) {
    case "DETECTED":
      return [
        { label: "Seen", state: "active" },
        { label: "Confirming", state: "todo" },
        { label: "Credited", state: "todo" },
      ];
    case "CONFIRMING":
      return [
        seen,
        { label: "Confirming", state: "active", detail: counted },
        { label: "Credited", state: "todo" },
      ];
    case "CREDITED":
      return [
        seen,
        { label: "Confirmed", state: "done", detail: counted },
        { label: "Credited", state: "done" },
      ];
    case "ORPHANED":
      return [
        seen,
        { label: "Reorged out", state: "failed" },
        { label: "Credited", state: "todo" },
      ];
    case "MANUAL_REVIEW":
      return [
        seen,
        { label: "Confirmed", state: "done", detail: counted },
        { label: "Held", state: "active" },
      ];
    case "UNATTRIBUTED":
      return [
        seen,
        { label: "Needs an owner", state: "active" },
        { label: "Credited", state: "todo" },
      ];
    case "REJECTED":
      return [
        seen,
        { label: "Confirmed", state: "done", detail: counted },
        { label: "Rejected", state: "failed" },
      ];
  }
}

/** A withdrawal's four stops: asked for, allowed, sent, settled. */
export function withdrawalRail(withdrawal: AdminWithdrawal): Rail {
  const asked = { label: "Requested", state: "done" as StepState };
  const allowed = { label: "Approved", state: "done" as StepState };
  const counted = `${withdrawal.confirmations} / ${withdrawal.confirmationsRequired}`;
  const rest = (sent: StepState, settled: StepState, detail?: string) =>
    [
      asked,
      allowed,
      { label: "Sent", state: sent },
      { label: "Confirmed", state: settled, ...(detail ? { detail } : {}) },
    ] as const;

  switch (withdrawal.status) {
    case "REQUESTED":
      return [
        { label: "Requested", state: "active" },
        { label: "Approved", state: "todo" },
        { label: "Sent", state: "todo" },
        { label: "Confirmed", state: "todo" },
      ];
    case "RISK_REVIEW":
      return [
        asked,
        { label: "Approval", state: "active" },
        { label: "Sent", state: "todo" },
        { label: "Confirmed", state: "todo" },
      ];
    case "REJECTED":
    case "CANCELLED":
      return [
        asked,
        { label: withdrawal.status === "REJECTED" ? "Rejected" : "Cancelled", state: "failed" },
        { label: "Sent", state: "todo" },
        { label: "Confirmed", state: "todo" },
      ];
    case "APPROVED":
    case "BUILDING":
    case "SIGNING":
      return rest("active", "todo");
    case "BUILD_FAILED":
    case "SIGN_REFUSED":
      return rest("failed", "todo");
    case "BROADCAST":
      return rest("done", "active", counted);
    case "BROADCAST_UNKNOWN":
    case "MANUAL_INVESTIGATION":
      return rest("active", "todo");
    case "CONFIRMED":
      return rest("done", "done", counted);
    case "FAILED_CONFIRMED":
      return rest("done", "failed", counted);
  }
}

export const SWEEP_TONE: Record<Sweep["status"], Tone> = {
  PENDING: "neutral",
  BROADCAST: "pending",
  CONFIRMED: "complete",
  FAILED: "attention",
};

export const BREAK_TONE: Record<ReconciliationBreak["status"], Tone> = {
  OPEN: "attention",
  RESOLVED: "complete",
  DISMISSED: "neutral",
};

/** Both directions said plainly, because "break" alone tells nobody anything. */
export const BREAK_WORDS: Record<ReconciliationBreak["kind"], string> = {
  SURPLUS: "More on the chain than the ledger says",
  SHORTFALL: "Less on the chain than the ledger says",
};
