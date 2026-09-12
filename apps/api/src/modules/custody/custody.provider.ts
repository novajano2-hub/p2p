import { type ChainNetwork, type LedgerAsset } from "@abay/database";

/*
  Where the keys are (ADR-0002, ADR-0006, ADR-0010).

  The provider issues addresses and signs transfers; the application never
  sees a key. Every transfer carries a client reference - the withdrawal's or
  the sweep's own id - and the provider is idempotent on it: the same
  reference twice is one transfer, however many times it is asked. That is
  the property the ambiguous-broadcast rule (AT-9) relies on, and why a real
  adapter that cannot offer it is not an option (open-questions Q6).
*/

export const CUSTODY_PROVIDER = Symbol("CUSTODY_PROVIDER");

export interface DepositAddress {
  /** Lower-cased. */
  address: string;
  walletRef: string;
  accountRef?: string | undefined;
}

export type TreasuryTier = "HOT" | "COLD";

export interface TransferRequest {
  /** Unique per business transfer; the provider's idempotency key. */
  clientRef: string;
  network: ChainNetwork;
  asset: LedgerAsset;
  /** Spend from the hot treasury, or from one attribution address (a sweep). */
  from: { treasury: TreasuryTier } | { address: string };
  /** Lower-cased. */
  to: string;
  /** In the token's own decimals. */
  rawAmount: bigint;
}

/*
  Three answers, and the third is the important one. BROADCAST and REFUSED
  are certain. UNKNOWN means the provider cannot say whether the transfer
  went out - a timeout, a lost reply - and the caller must treat it as
  "possibly sent": never retry, never refund, hand it to a person (AT-9).
*/
export type TransferOutcome =
  | { kind: "BROADCAST"; txHash: string; providerRef: string }
  | { kind: "REFUSED"; reason: string }
  | { kind: "UNKNOWN"; providerRef: string | null };

export interface CustodyProvider {
  /** A fresh address for one customer. Calling it twice for the same customer is the caller's bug. */
  createDepositAddress(input: {
    userId: string;
    network: ChainNetwork;
    asset: LedgerAsset;
  }): Promise<DepositAddress>;

  /** Sign and broadcast, idempotent on clientRef. */
  transfer(request: TransferRequest): Promise<TransferOutcome>;

  /** The platform's own address for a treasury tier. */
  treasuryAddress(network: ChainNetwork, tier: TreasuryTier): Promise<string>;
}
