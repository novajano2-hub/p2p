import { type DepositStatus } from "@abay/database";

import { assertTransition, type TransitionTable } from "@/common/state-machine/transition";

/*
  The deposit machine, exactly as docs/architecture/state-machines.md 1 draws
  it. CREDITED, ORPHANED and REJECTED are terminal: a credit that later proves
  wrong is corrected by a new ledger transaction, never by moving the deposit
  backwards.
*/
export const DEPOSIT_TRANSITIONS: TransitionTable<DepositStatus> = {
  DETECTED: ["CONFIRMING", "UNATTRIBUTED"],
  CONFIRMING: ["CREDITED", "ORPHANED", "MANUAL_REVIEW"],
  MANUAL_REVIEW: ["CREDITED", "REJECTED"],
  UNATTRIBUTED: ["CREDITED"],
  CREDITED: [],
  ORPHANED: [],
  REJECTED: [],
};

export const assertDepositTransition = (from: DepositStatus, to: DepositStatus): void => {
  assertTransition("deposit", DEPOSIT_TRANSITIONS, from, to);
};

/**
 * How many confirmations a transfer in `blockNumber` has when the head is
 * `head`: the block itself counts as the first, as BSC explorers count it.
 * Zero when the head is somehow behind the block.
 */
export function confirmationsOf(head: bigint, blockNumber: bigint): number {
  const depth = head - blockNumber + 1n;
  if (depth <= 0n) return 0;
  return depth > 1_000_000n ? 1_000_000 : Number(depth);
}

/**
 * Whether a transfer missing from the canonical chain has been missing for
 * long enough to be treated as gone: the chain has advanced the reorg depth
 * past the block it was in, and it is still not there.
 */
export const isOrphaned = (head: bigint, blockNumber: bigint, reorgDepth: number): boolean =>
  head >= blockNumber + BigInt(reorgDepth);
