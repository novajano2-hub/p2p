import { z } from "zod";

/*
  What the wallet screens know before there is an API behind them.

  Everything here is presentation: the networks a deposit can arrive on, the
  words each screen uses, and the shape of the two forms. No balance, no
  address and no fee in this file is real, and nothing on these screens can
  move anything - the ledger is Phase 2 and custody is Phase 6.

  PLACEHOLDER FIGURES, like KYC_TIERS in @abay/contracts: the minimums, the
  confirmation counts and the withdrawal fees are here so the interface can
  state a number rather than be vague, and so there is one place to correct
  once the custody provider is chosen and the network is settled.
*/

/** The one asset at launch. A second one is a Phase 2 conversation, not a config change. */
export const ASSET = { symbol: "USDT", name: "Tether USD" } as const;

export type NetworkId = "plasma" | "tron" | "bsc" | "ethereum";

export type Network = {
  id: NetworkId;
  /** What every other exchange calls it, so a withdrawal screen elsewhere matches this one. */
  name: string;
  /** The token standard. The part people actually check before they send. */
  standard: string;
  /** Roughly how long a deposit takes to arrive. */
  arrival: string;
  /** Blocks before a deposit is credited. */
  confirmations: number;
  /** Smallest deposit that will be credited, in USDT. */
  minDeposit: number;
  /** What the network charges to send out, in USDT. Zero where gas is sponsored. */
  withdrawalFee: number;
  /**
   * Whether BIRQ accepts this network. One at launch (docs/architecture:
   * "no second asset or second network"); the rest are listed so the choice
   * is visible and so turning one on is a flag, not a new screen.
   */
  supported: boolean;
};

/*
  Plasma first because it is the target chain (ADR-0006, still UNVALIDATED -
  see Q7 in docs/open-questions.md). The other three are where Ethiopian
  customers most often already hold USDT, which is exactly the question Q7
  asks; they are listed as unsupported rather than hidden so the gap is
  visible on screen instead of only in a document.
*/
export const NETWORKS: readonly Network[] = [
  {
    id: "plasma",
    name: "Plasma",
    standard: "USDT0",
    arrival: "Under a minute",
    confirmations: 1,
    minDeposit: 1,
    withdrawalFee: 0,
    supported: true,
  },
  {
    id: "tron",
    name: "Tron",
    standard: "TRC20",
    arrival: "About a minute",
    confirmations: 20,
    minDeposit: 1,
    withdrawalFee: 1,
    supported: false,
  },
  {
    id: "bsc",
    name: "BNB Smart Chain",
    standard: "BEP20",
    arrival: "About a minute",
    confirmations: 15,
    minDeposit: 1,
    withdrawalFee: 0.29,
    supported: false,
  },
  {
    id: "ethereum",
    name: "Ethereum",
    standard: "ERC20",
    arrival: "A few minutes",
    confirmations: 12,
    minDeposit: 10,
    withdrawalFee: 3.5,
    supported: false,
  },
];

export const DEFAULT_NETWORK: NetworkId = "plasma";

export const networkById = (id: NetworkId): Network =>
  NETWORKS.find((network) => network.id === id) ?? NETWORKS[0]!;

/** "Plasma (USDT0)". The pair a person checks against the app they are sending from. */
export const networkLabel = (network: Network): string => `${network.name} (${network.standard})`;

/* ------------------------------------------------------------------ money */

const amount = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const birr = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** "1,250.00". Two places, grouped, always both places so a column lines up. */
export const formatAmount = (value: number): string => amount.format(value);

/** "≈ 71,000 ETB". A rough conversion, never a price to trade on. */
export const formatEtb = (value: number): string => `${birr.format(value)} ETB`;

/* ------------------------------------------------------------------ forms */

/** Mirrors the server's platform id: "BQ-" and eight digits. */
export const platformIdSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^BQ-\d{8}$/, { error: "Enter a BIRQ ID, like BQ-12345678" });

/** A positive amount with at most two decimal places. */
const amountSchema = z
  .string()
  .trim()
  .min(1, { error: "Enter an amount" })
  .regex(/^\d+(\.\d{1,2})?$/, { error: "Enter an amount, to at most two decimal places" })
  .refine((value) => Number(value) > 0, { error: "Enter an amount greater than zero" });

/*
  Deliberately loose. Address shapes differ per chain and a regex that is
  almost right rejects real addresses; the API validates against the chain
  itself, which is the only check that means anything.
*/
export const withdrawForm = z.object({
  address: z
    .string()
    .trim()
    .min(20, { error: "Enter the address you are withdrawing to" })
    .max(120, { error: "That address is too long" }),
  amount: amountSchema,
});
export type WithdrawForm = z.infer<typeof withdrawForm>;

export const transferForm = z.object({
  recipient: platformIdSchema,
  amount: amountSchema,
  note: z.string().trim().max(140, { error: "Keep the note under 140 characters" }).optional(),
});
export type TransferForm = z.infer<typeof transferForm>;
