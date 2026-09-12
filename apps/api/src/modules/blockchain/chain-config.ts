import { type ChainNetwork, type LedgerAsset } from "@abay/database";

import { type Env } from "@/config/env";

/*
  What the domain knows about the network, read from configuration once.
  Nothing in a deposit or a withdrawal names a chain, a contract or a
  decimal count: it asks this.
*/
export interface ChainConfig {
  network: ChainNetwork;
  chainId: number;
  token: { symbol: LedgerAsset; contract: string; decimals: number; standard: string };
  finality: { confirmations: number; reorgDepth: number };
  deposit: { dust: bigint; reviewThreshold: bigint };
  sweep: { minimum: bigint };
  reconciliation: { tolerance: bigint };
  withdrawal: {
    min: bigint;
    max: bigint;
    dailyMax: bigint;
    autoApproveBelow: bigint;
    dualApprovalFrom: bigint;
    newAddressCooldownHours: number;
  };
}

const TOKEN_STANDARD: Record<ChainNetwork, string> = { BSC: "BEP20" };

export const chainConfig = (env: Env): ChainConfig => ({
  network: env.CHAIN_NETWORK,
  chainId: env.CHAIN_ID,
  token: {
    symbol: "USDT",
    contract: env.USDT_CONTRACT,
    decimals: env.USDT_DECIMALS,
    // The token standard a person checks against the app they send from.
    standard: TOKEN_STANDARD[env.CHAIN_NETWORK],
  },
  finality: { confirmations: env.DEPOSIT_CONFIRMATIONS, reorgDepth: env.REORG_DEPTH },
  deposit: { dust: env.DEPOSIT_DUST_MICRO, reviewThreshold: env.DEPOSIT_REVIEW_THRESHOLD_MICRO },
  sweep: { minimum: env.SWEEP_MIN_MICRO },
  reconciliation: { tolerance: env.RECONCILIATION_TOLERANCE_MICRO },
  withdrawal: {
    min: env.WITHDRAWAL_MIN_MICRO,
    max: env.WITHDRAWAL_MAX_MICRO,
    dailyMax: env.WITHDRAWAL_DAILY_MAX_MICRO,
    autoApproveBelow: env.WITHDRAWAL_AUTO_APPROVE_MICRO,
    dualApprovalFrom: env.WITHDRAWAL_DUAL_APPROVAL_MICRO,
    newAddressCooldownHours: env.WITHDRAWAL_NEW_ADDRESS_COOLDOWN_HOURS,
  },
});
