import { type StatusTone } from "@/components/ui/status-pill";
import { type Deposit, type WithdrawalStage } from "@/lib/wallet/client";

/*
  What each state of a transfer is called on the customer's own screen.

  Deliberately not the words the administration screens use. An administrator
  is told what the system did; a customer is told what it means for their
  money and, where something has stopped, who is doing what about it. Nothing
  here mentions a state machine, a ledger account or a risk engine.

  Tables rather than switch statements, exhaustive by their type: a new state
  breaks the build here until somebody has decided what it says to the person
  it happened to.
*/

export interface Said {
  words: string;
  tone: StatusTone;
  detail: string;
}

export const DEPOSIT_WORDS: Record<Deposit["status"], Said> = {
  DETECTED: {
    words: "Seen",
    tone: "pending",
    detail: "We have seen it on the chain and are checking it.",
  },
  CONFIRMING: {
    words: "Confirming",
    tone: "pending",
    detail: "Waiting for the network. It will be credited automatically.",
  },
  CREDITED: {
    words: "Credited",
    tone: "complete",
    detail: "In your available balance.",
  },
  ORPHANED: {
    words: "Did not go through",
    tone: "attention",
    detail:
      "The network dropped the transaction before it settled. Nothing was credited, and nothing was taken from you.",
  },
  MANUAL_REVIEW: {
    words: "Being checked",
    tone: "pending",
    detail: "A person is looking at this one. It is usually a matter of hours.",
  },
  UNATTRIBUTED: {
    words: "Being checked",
    tone: "pending",
    detail:
      "We are working out where this one belongs. Contact support with the transaction hash if it stays here.",
  },
  REJECTED: {
    words: "Not credited",
    tone: "attention",
    detail: "This deposit was not credited. Contact support with the transaction hash.",
  },
};

export const WITHDRAWAL_WORDS: Record<WithdrawalStage, Said> = {
  PENDING: {
    words: "Preparing",
    tone: "pending",
    detail: "Held and on its way. Nothing has left the platform yet.",
  },
  HELD: {
    words: "Being checked",
    tone: "pending",
    detail: "A person is reviewing this one before it is sent. Your money is held, not spent.",
  },
  SENDING: {
    words: "Sending",
    tone: "pending",
    detail: "On the chain, waiting for confirmations.",
  },
  SENT: {
    words: "Sent",
    tone: "complete",
    detail: "Settled on the chain. Check the receiving wallet.",
  },
  RETURNED: {
    words: "Returned",
    tone: "attention",
    detail: "This one did not go out. The full amount is back in your available balance.",
  },
};
