import { z } from "zod";

/*
  The words the wallet screens use. Not the numbers.

  Every figure that used to live here - minimum deposit, confirmations,
  withdrawal fee - now comes from the API, because the API is what enforces
  them and a second copy in the browser is a promise that can quietly stop
  being true. What is left is presentation: what each network is called, what
  its token standard is, roughly how long it takes, and which ones we do not
  accept yet.

  The unsupported ones are listed rather than hidden so the choice is visible
  on screen and turning one on is a flag rather than a new screen. Their ids
  are the API's spelling of a network, so nothing has to be translated between
  the two.
*/

/** The one asset at launch. A second one is a design conversation, not a config change. */
export const ASSET = { symbol: "USDT", name: "Tether USD" } as const;

export type NetworkId = "BSC" | "PLASMA" | "TRON" | "ETHEREUM";

export interface Network {
  id: NetworkId;
  /** What every other exchange calls it, so a withdrawal screen elsewhere matches this one. */
  name: string;
  /** The token standard. The part people actually check before they send. */
  standard: string;
  /** Roughly how long a transfer takes to arrive. Prose, not a promise. */
  arrival: string;
  /** Whether BIRQ accepts this network. Exactly one is true (ADR-0006, amended 2026-09-12). */
  supported: boolean;
}

export const NETWORKS: readonly Network[] = [
  {
    id: "BSC",
    name: "BNB Smart Chain",
    standard: "BEP20",
    arrival: "About a minute",
    supported: true,
  },
  { id: "PLASMA", name: "Plasma", standard: "USDT0", arrival: "Under a minute", supported: false },
  { id: "TRON", name: "Tron", standard: "TRC20", arrival: "About a minute", supported: false },
  {
    id: "ETHEREUM",
    name: "Ethereum",
    standard: "ERC20",
    arrival: "A few minutes",
    supported: false,
  },
];

/** The one we accept. Never a network the picker would then refuse. */
export const DEFAULT_NETWORK: NetworkId = "BSC";

export const networkById = (id: string): Network =>
  NETWORKS.find((network) => network.id === id) ?? NETWORKS[0]!;

/** "BNB Smart Chain (BEP20)". The pair a person checks against the app they are sending from. */
export const networkLabel = (network: Network): string => `${network.name} (${network.standard})`;

/* ------------------------------------------------------------------ forms */

/** Mirrors the server's platform id: "BQ-" and eight digits. */
export const platformIdSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^BQ-\d{8}$/, { error: "Enter a BIRQ ID, like BQ-12345678" });

/*
  Six decimal places, not two: the ledger keeps millionths and a form that
  silently drops the rest is a form that loses somebody's money. The value is
  never parsed as a number here - lib/money.ts turns it into millionths.
*/
export const amountSchema = z
  .string()
  .trim()
  .min(1, { error: "Enter an amount" })
  .regex(/^\d+(\.\d{1,6})?$/, { error: "Enter an amount, to at most six decimal places" })
  .refine((value) => /[1-9]/.test(value), { error: "Enter an amount greater than zero" });

export const transferForm = z.object({
  recipient: platformIdSchema,
  amount: amountSchema,
  note: z.string().trim().max(140, { error: "Keep the note under 140 characters" }).optional(),
});
export type TransferForm = z.infer<typeof transferForm>;

/*
  The address shape is the chain's, and this one chain has exactly one: 0x and
  forty hex digits. Checked here because a mistyped address is the single
  most expensive mistake available on these screens, and because the server
  refuses the same shape - so a form that accepted more would only be
  postponing the refusal until after the password had been typed.
*/
export const withdrawForm = z.object({
  address: z
    .string()
    .trim()
    .regex(/^0x[0-9a-fA-F]{40}$/, { error: "That is not a valid address for this network" }),
  amount: amountSchema,
  password: z.string().min(1, { error: "Enter your password to confirm" }),
});
export type WithdrawForm = z.infer<typeof withdrawForm>;
