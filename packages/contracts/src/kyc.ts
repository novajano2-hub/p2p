import { z } from "zod";

/*
  Identity verification.

  A custodial marketplace has to know who it is holding money for. Everyone
  can trade small amounts straight after sign-up, because a wall at the door
  loses the customer; verification is what lifts the ceiling and unlocks
  posting an offer, which is the point at which someone asks strangers to
  trust them.

  A submission is read by an administrator, not by a provider: at this size a
  person reads the documents. That is why the flow ends in "under review"
  rather than an instant answer.
*/

export const kycStatus = z.enum(["NOT_STARTED", "PENDING", "APPROVED", "REJECTED"]);
export type KycStatus = z.infer<typeof kycStatus>;

export const kycDocumentType = z.enum(["NATIONAL_ID", "PASSPORT", "DRIVERS_LICENSE"]);
export type KycDocumentType = z.infer<typeof kycDocumentType>;

/** ISO 3166-1 alpha-2, upper case. Ethiopia is "ET". */
export const countryCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, { error: "Choose the country that issued your document" });

/**
 * The name exactly as printed on the document. Deliberately permissive about
 * script and punctuation: Ethiopian names are written in Ge'ez and in Latin,
 * and a rule that allows only one of those rejects real people.
 */
export const legalName = z
  .string()
  .trim()
  .min(2, { error: "Enter your full name as printed on your document" })
  .max(120, { error: "That name is too long" })
  .regex(/\p{L}/u, { error: "Enter your full name as printed on your document" });

/** Document numbers vary by country, so only length and charset are checked. */
export const documentNumber = z
  .string()
  .trim()
  .toUpperCase()
  .min(4, { error: "Enter the number printed on your document" })
  .max(40, { error: "That document number is too long" })
  .regex(/^[A-Z0-9][A-Z0-9 /-]*$/, { error: "Use letters, numbers, spaces, dashes and slashes" });

/** The age of majority in Ethiopia, and the floor for holding money here. */
export const MINIMUM_AGE_YEARS = 18;

/** Nobody alive is older than this; a date beyond it is a typo, not a person. */
const MAXIMUM_AGE_YEARS = 120;

export function yearsBetween(from: Date, to: Date): number {
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  const monthDelta = to.getUTCMonth() - from.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && to.getUTCDate() < from.getUTCDate())) years -= 1;
  return years;
}

const asUtcDate = (value: string) => new Date(value + "T00:00:00Z");

/**
 * A calendar date, "YYYY-MM-DD". A plain date rather than a timestamp: a
 * birthday is the same day everywhere, and storing it as an instant shifts it
 * by a day for anyone far enough east or west of the server.
 */
export const dateOfBirth = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Enter your date of birth" })
  .refine((value) => !Number.isNaN(asUtcDate(value).getTime()), { error: "Enter a real date" })
  .refine((value) => yearsBetween(asUtcDate(value), new Date()) >= MINIMUM_AGE_YEARS, {
    error: "You must be at least " + MINIMUM_AGE_YEARS + " to use BIRQ",
  })
  .refine((value) => yearsBetween(asUtcDate(value), new Date()) <= MAXIMUM_AGE_YEARS, {
    error: "Enter a real date of birth",
  });

export const kycSubmissionRequest = z.object({
  legalName,
  dateOfBirth,
  country: countryCode,
  documentType: kycDocumentType,
  documentNumber,
});
export type KycSubmissionRequest = z.infer<typeof kycSubmissionRequest>;

/**
 * What the customer is told about where they stand. The dates and the reason
 * describe the newest attempt only; the whole history is an administrator's
 * view, not theirs.
 */
export const kycStateResponse = z.object({
  status: kycStatus,
  submittedAt: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  rejectionReason: z.string().nullable(),
});
export type KycStateResponse = z.infer<typeof kycStateResponse>;

/*
  What verification is worth, in birr per day.

  PLACEHOLDER FIGURES (owner decision outstanding). They are here so the
  interface can state a number instead of being vague, and so there is one
  place to change once the real ceilings are settled. Nothing enforces them
  yet - the ledger and the trade engine do that in Phase 2 - so changing them
  today changes only what the screens promise.
*/
export interface KycTier {
  readonly label: string;
  /** Most a customer may buy or sell in a day, in whole birr. */
  readonly dailyTradeEtb: number;
  /** Most a customer may withdraw in a day, in whole birr. */
  readonly dailyWithdrawalEtb: number;
  /** Whether they may publish their own offer rather than only taking others'. */
  readonly canPostOffers: boolean;
}

export const KYC_TIERS: { readonly unverified: KycTier; readonly verified: KycTier } = {
  unverified: {
    label: "Unverified",
    dailyTradeEtb: 10_000,
    dailyWithdrawalEtb: 10_000,
    canPostOffers: false,
  },
  verified: {
    label: "Verified",
    dailyTradeEtb: 500_000,
    dailyWithdrawalEtb: 200_000,
    canPostOffers: true,
  },
};

/** The tier an account is on right now. Only APPROVED lifts the ceiling. */
export function tierFor(status: KycStatus): KycTier {
  return status === "APPROVED" ? KYC_TIERS.verified : KYC_TIERS.unverified;
}
