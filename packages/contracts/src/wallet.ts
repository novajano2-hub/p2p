import { z } from "zod";

import { microAmount } from "./ledger";

/*
  What a customer has, as their own wallet screen reads it.

  Three figures rather than one, because "how much do I have" has three
  different answers and a person acting on the wrong one is a person
  surprised: what they can spend right now, what is committed to a trade, and
  what is on its way out. Every one is an integer string of millionths (AT-21)
  and every one comes from the ledger, never from a column somebody remembered
  to update.
*/
export const walletBalanceResponse = z.object({
  asset: z.string(),
  /** Spendable now: the customer's AVAILABLE liability. */
  available: microAmount,
  /**
   * Locked to trades in progress. Structurally zero until trades exist
   * (Phase 4); it is in the shape now because the screen has to name it, and
   * naming it as zero is true today.
   */
  escrowed: microAmount,
  /** Committed to a withdrawal that has not yet settled. */
  pendingWithdrawal: microAmount,
  /** The three added up: everything the platform owes this account. */
  total: microAmount,
});
export type WalletBalanceResponse = z.infer<typeof walletBalanceResponse>;
