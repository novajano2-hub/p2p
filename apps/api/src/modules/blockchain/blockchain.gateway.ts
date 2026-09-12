import { type ChainNetwork } from "@abay/database";

/*
  The chain, as far as the application is allowed to know it (ADR-0006).

  Read-only: the gateway observes. Anything that changes the chain - a
  signature, a broadcast - goes through the custody provider, which is a
  different interface for a reason (ADR-0010). Amounts are the chain's own
  integers; the caller converts them at the edge, once (common/money/units).
*/

export const BLOCKCHAIN_GATEWAY = Symbol("BLOCKCHAIN_GATEWAY");

export interface ChainTransfer {
  network: ChainNetwork;
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  /** Lower-cased. */
  from: string;
  /** Lower-cased. */
  to: string;
  /** Lower-cased. */
  tokenContract: string;
  /** In the token's own decimals. */
  rawAmount: bigint;
}

export interface BlockchainGateway {
  /** The latest block on the canonical chain. */
  headBlock(network: ChainNetwork): Promise<bigint>;

  /**
   * The transfer as the canonical chain has it right now, or null if the
   * chain no longer (or never) contains it. A webhook's word is never enough:
   * a deposit is credited only from what this returns (state-machines.md 1).
   */
  findTransfer(
    network: ChainNetwork,
    txHash: string,
    logIndex: number,
  ): Promise<ChainTransfer | null>;

  /** Token transfers into any of the addresses, at or after fromBlock, in chain order. */
  transfersTo(
    network: ChainNetwork,
    addresses: readonly string[],
    fromBlock: bigint,
  ): Promise<ChainTransfer[]>;

  /** The token balance an address holds, in the token's own decimals. For reconciliation. */
  tokenBalance(network: ChainNetwork, address: string): Promise<bigint>;
}
