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
*/

/** The rails birr actually moves on in Ethiopia. */
export const paymentMethodKind = z.enum(["TELEBIRR", "CBE_BIRR", "MPESA", "BANK_TRANSFER"]);
export type PaymentMethodKind = z.infer<typeof paymentMethodKind>;

export const paymentMethodStatus = z.enum(["ACTIVE", "ARCHIVED"]);
export type PaymentMethodStatus = z.infer<typeof paymentMethodStatus>;

/** How each rail is named on a screen, and what its number is called. */
export const PAYMENT_METHOD_KINDS: Record<
  PaymentMethodKind,
  { readonly label: string; readonly numberLabel: string }
> = {
  TELEBIRR: { label: "Telebirr", numberLabel: "Telebirr phone number" },
  CBE_BIRR: { label: "CBE Birr", numberLabel: "CBE Birr phone number" },
  MPESA: { label: "M-Pesa", numberLabel: "M-Pesa phone number" },
  BANK_TRANSFER: { label: "Bank transfer", numberLabel: "Account number" },
};

/**
 * The banks a transfer can name. A closed list rather than free text so a
 * buyer reads "Awash Bank" spelled one way, a filter can match it, and a
 * typo cannot send money to a bank that does not exist.
 */
export const BANK_CODES = [
  "CBE",
  "AWASH",
  "DASHEN",
  "ABYSSINIA",
  "WEGAGEN",
  "NIB",
  "HIBRET",
  "ZEMEN",
  "BERHAN",
  "ABAY",
  "BUNNA",
  "ENAT",
  "COOP_OROMIA",
  "OROMIA",
  "LION",
  "AMHARA",
  "SIINQEE",
  "TSEHAY",
  "ZAMZAM",
  "HIJRA",
  "GADAA",
  "AHADU",
  "GOH_BETOCH",
  "TSEDEY",
  "GLOBAL",
] as const;
export type BankCode = (typeof BANK_CODES)[number];

export const bankCode = z.enum(BANK_CODES);

export const ETHIOPIAN_BANKS: Record<BankCode, string> = {
  CBE: "Commercial Bank of Ethiopia",
  AWASH: "Awash Bank",
  DASHEN: "Dashen Bank",
  ABYSSINIA: "Bank of Abyssinia",
  WEGAGEN: "Wegagen Bank",
  NIB: "Nib International Bank",
  HIBRET: "Hibret Bank",
  ZEMEN: "Zemen Bank",
  BERHAN: "Berhan Bank",
  ABAY: "Abay Bank",
  BUNNA: "Bunna Bank",
  ENAT: "Enat Bank",
  COOP_OROMIA: "Cooperative Bank of Oromia",
  OROMIA: "Oromia Bank",
  LION: "Lion International Bank",
  AMHARA: "Amhara Bank",
  SIINQEE: "Siinqee Bank",
  TSEHAY: "Tsehay Bank",
  ZAMZAM: "ZamZam Bank",
  HIJRA: "Hijra Bank",
  GADAA: "Gadaa Bank",
  AHADU: "Ahadu Bank",
  GOH_BETOCH: "Goh Betoch Bank",
  TSEDEY: "Tsedey Bank",
  GLOBAL: "Global Bank Ethiopia",
};

/** How many a customer may keep. Binance allows a handful; nobody needs more. */
export const PAYMENT_METHODS_MAX = 10;

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

const branch = z.string().trim().max(80, { error: "That branch name is too long" });

/**
 * Adding a method. The shape follows the rail: a wallet is a phone number, a
 * bank transfer is a bank and an account number. There is no edit: a method
 * whose number changed is a different method, and the old one is archived.
 */
export const createPaymentMethodRequest = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("TELEBIRR"), accountHolder, phone: ethiopianPhone }),
  z.object({ kind: z.literal("CBE_BIRR"), accountHolder, phone: ethiopianPhone }),
  z.object({ kind: z.literal("MPESA"), accountHolder, phone: ethiopianPhone }),
  z.object({
    kind: z.literal("BANK_TRANSFER"),
    accountHolder,
    bankCode,
    accountNumber,
    branch: branch.optional(),
  }),
]);
export type CreatePaymentMethodRequest = z.infer<typeof createPaymentMethodRequest>;

/**
 * The instructions, in the clear: what a buyer needs to make the payment.
 * Read by the owner, by the counterparty of an open trade, and by a dispute
 * resolver - and by nobody else, ever.
 */
export const paymentInstructions = z.object({
  kind: paymentMethodKind,
  bankCode: bankCode.nullable(),
  bankName: z.string().nullable(),
  accountHolder: z.string(),
  /** The phone number for a wallet, the account number for a bank. */
  accountNumber: z.string(),
  branch: z.string().nullable(),
});
export type PaymentInstructions = z.infer<typeof paymentInstructions>;

/** A method as a list shows it: the rail and the last digits, nothing to pay to. */
export const paymentMethodView = z.object({
  id: z.string(),
  kind: paymentMethodKind,
  bankCode: bankCode.nullable(),
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
