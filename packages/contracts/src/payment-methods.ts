import { z } from "zod";

/*
  Where a seller receives birr.

  The platform never touches the birr leg (ledger-taxonomy.md 7): a buyer
  pays the seller directly, and everything the platform can do is tell the
  buyer where. These shapes are that "where". The details are RESTRICTED
  data (data-classification.md) - encrypted at rest, shown whole to the owner,
  to the counterparty of an open trade, and to a dispute resolver with an
  audit row - so a list of methods carries a label and the last digits, and
  the instructions themselves are a separate, deliberate read.

  A bank is a payment method of its own, the way Binance lists "BCA" and
  "Bank BRI" rather than one "bank transfer": a buyer choosing where to pay
  wants the bank by name, because a transfer within one bank arrives at once
  and one between banks does not. Four banks at launch. A fifth is a value in
  the enum, a row in the table below, and a value in the database's enum.
*/

/** The rails birr actually moves on in Ethiopia: three mobile wallets and four banks. */
export const paymentMethodKind = z.enum([
  "TELEBIRR",
  "CBE_BIRR",
  "MPESA",
  "CBE",
  "DASHEN",
  "ABYSSINIA",
  "AWASH",
]);
export type PaymentMethodKind = z.infer<typeof paymentMethodKind>;

export const WALLET_KINDS = ["TELEBIRR", "CBE_BIRR", "MPESA"] as const;
export type WalletKind = (typeof WALLET_KINDS)[number];

export const BANK_KINDS = ["CBE", "DASHEN", "ABYSSINIA", "AWASH"] as const;
export type BankKind = (typeof BANK_KINDS)[number];

export const isBankKind = (kind: PaymentMethodKind): kind is BankKind =>
  (BANK_KINDS as readonly string[]).includes(kind);

export const paymentMethodStatus = z.enum(["ACTIVE", "ARCHIVED"]);
export type PaymentMethodStatus = z.infer<typeof paymentMethodStatus>;

/**
 * How each rail is named on a screen. `label` is what a list, a chip and a
 * filter say - short, the way a person says it; `fullName` is what the
 * payment instructions say, where "CBE" alone would be too little to type
 * into a banking app; `numberLabel` is what its number is called.
 */
export const PAYMENT_METHOD_KINDS: Record<
  PaymentMethodKind,
  {
    readonly label: string;
    readonly fullName: string;
    readonly numberLabel: string;
    readonly institution: "wallet" | "bank";
  }
> = {
  TELEBIRR: {
    label: "Telebirr",
    fullName: "Telebirr",
    numberLabel: "Telebirr phone number",
    institution: "wallet",
  },
  CBE_BIRR: {
    label: "CBE Birr",
    fullName: "CBE Birr",
    numberLabel: "CBE Birr phone number",
    institution: "wallet",
  },
  MPESA: {
    label: "M-Pesa",
    fullName: "M-Pesa",
    numberLabel: "M-Pesa phone number",
    institution: "wallet",
  },
  CBE: {
    label: "CBE",
    fullName: "Commercial Bank of Ethiopia",
    numberLabel: "Account number",
    institution: "bank",
  },
  DASHEN: {
    label: "Dashen Bank",
    fullName: "Dashen Bank",
    numberLabel: "Account number",
    institution: "bank",
  },
  ABYSSINIA: {
    label: "Bank of Abyssinia",
    fullName: "Bank of Abyssinia",
    numberLabel: "Account number",
    institution: "bank",
  },
  AWASH: {
    label: "Awash Bank",
    fullName: "Awash Bank",
    numberLabel: "Account number",
    institution: "bank",
  },
};

/**
 * The name on the account, as the bank or wallet has it. The buyer sees it
 * and the payer's name is checked against it in a dispute (threat model
 * B8.4), so it is the account's name, not a nickname. Permissive about
 * script for the same reason legalName is: names here are written in Ge'ez
 * and in Latin.
 */
export const accountHolder = z
  .string()
  .trim()
  .min(2, { error: "Enter the name on the account" })
  .max(120, { error: "That name is too long" })
  .regex(/\p{L}/u, { error: "Enter the name on the account" });

/**
 * An Ethiopian mobile number: nine digits after the country code, starting
 * with 9 (Ethio telecom) or 7 (Safaricom). Accepted however people write
 * it - +251 9.., 251 9.., 09.., 9.. - and kept in the local form, 09..,
 * which is how the person paying will type it into their own app.
 */
export const ethiopianPhone = z
  .string()
  .trim()
  .regex(/^(\+?251|0)?[79]\d{8}$/, {
    error: "Enter an Ethiopian mobile number, e.g. 09 12 34 56 78",
  })
  .transform((value) => "0" + value.replace(/^(\+?251|0)/, ""));

/** Bank account numbers vary by bank; only length and digits are checked. */
export const accountNumber = z
  .string()
  .trim()
  .regex(/^\d{6,24}$/, { error: "Enter the account number, digits only" });

const wallet = <K extends WalletKind>(kind: K) =>
  z.object({ kind: z.literal(kind), accountHolder, phone: ethiopianPhone });
const bank = <K extends BankKind>(kind: K) =>
  z.object({ kind: z.literal(kind), accountHolder, accountNumber });

/**
 * Adding a method. The shape follows the rail: a wallet is a phone number, a
 * bank is an account number. One live method of each kind: an order names the
 * kind, so the account behind it has to be the only one, and a second is
 * refused. There is no edit: a method whose number changed is a different
 * method, and the old one is archived - which is what replacing does.
 */
export const createPaymentMethodRequest = z.discriminatedUnion("kind", [
  wallet("TELEBIRR"),
  wallet("CBE_BIRR"),
  wallet("MPESA"),
  bank("CBE"),
  bank("DASHEN"),
  bank("ABYSSINIA"),
  bank("AWASH"),
]);
export type CreatePaymentMethodRequest = z.infer<typeof createPaymentMethodRequest>;

/**
 * Replacing a method: the same kind, new details. The old method is archived
 * and the new one takes its place on every live ad that named it - a taker
 * reads the kind, never which account is behind it, so no ad changes version -
 * while a trade already open keeps the details it was opened with.
 */
export const replacePaymentMethodRequest = createPaymentMethodRequest;
export type ReplacePaymentMethodRequest = CreatePaymentMethodRequest;

/**
 * The instructions, in the clear: what a buyer needs to make the payment.
 * Read by the owner, by the counterparty of an open trade, and by a dispute
 * resolver - and by nobody else, ever. The institution is the kind.
 */
export const paymentInstructions = z.object({
  kind: paymentMethodKind,
  accountHolder: z.string(),
  /** The phone number for a wallet, the account number for a bank. */
  accountNumber: z.string(),
});
export type PaymentInstructions = z.infer<typeof paymentInstructions>;

/** A method as a list shows it: the rail and the last digits, nothing to pay to. */
export const paymentMethodView = z.object({
  id: z.string(),
  kind: paymentMethodKind,
  /** "Telebirr ····4821", "Awash Bank ····0193". Composed by the server. */
  label: z.string(),
  /** The last digits of the number. */
  hint: z.string(),
  status: paymentMethodStatus,
  createdAt: z.string(),
});
export type PaymentMethodView = z.infer<typeof paymentMethodView>;

/** The owner's own method, whole. */
export const paymentMethodDetailView = paymentMethodView.extend({
  instructions: paymentInstructions,
});
export type PaymentMethodDetailView = z.infer<typeof paymentMethodDetailView>;

export const paymentMethodsResponse = z.object({
  paymentMethods: z.array(paymentMethodView),
});
export type PaymentMethodsResponse = z.infer<typeof paymentMethodsResponse>;
