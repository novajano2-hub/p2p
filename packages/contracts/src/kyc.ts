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
  rather than an instant answer, and why the photographs matter as much as
  the typed details - they are what the person actually checks.
*/

export const kycStatus = z.enum(["NOT_STARTED", "PENDING", "APPROVED", "REJECTED"]);
export type KycStatus = z.infer<typeof kycStatus>;

/**
 * Only Ethiopian documents are verified. This is a marketplace for birr, and
 * the person reviewing knows what an Ethiopian ID looks like and cannot vouch
 * for anyone else's. Recorded on every submission all the same, so the day a
 * second country is added the old rows still say which one they were.
 */
export const ISSUING_COUNTRY = "ET";

export const kycDocumentType = z.enum(["NATIONAL_ID", "PASSPORT", "DRIVERS_LICENSE"]);
export type KycDocumentType = z.infer<typeof kycDocumentType>;

/** The photographs a submission is made of. */
export const kycDocumentKind = z.enum(["FRONT", "BACK", "SELFIE"]);
export type KycDocumentKind = z.infer<typeof kycDocumentKind>;

/**
 * Which photographs each document needs. A passport carries everything on
 * one page; a card has a back worth reading. The selfie is what ties the
 * document to the person holding the phone.
 */
export function requiredDocumentKinds(type: KycDocumentType): readonly KycDocumentKind[] {
  return type === "PASSPORT" ? ["FRONT", "SELFIE"] : ["FRONT", "BACK", "SELFIE"];
}

/** The formats a photograph may arrive in. Checked by content, never by file name. */
export const KYC_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type KycImageType = (typeof KYC_IMAGE_TYPES)[number];

/** A phone photograph is a few megabytes. This leaves room without inviting abuse. */
export const KYC_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

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

/** Document numbers vary by document, so only length and charset are checked. */
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

/** The identifier the API minted when a photograph was uploaded. */
const documentId = z.uuid({ error: "Upload the photo again" });

/**
 * The photographs are uploaded first, one request each, and the submission
 * refers to them by the identifiers those uploads returned. Uploading as you
 * go is what makes "retake" cheap and a bad connection survivable: one photo
 * fails, not the whole application.
 */
export const kycSubmissionRequest = z
  .object({
    legalName,
    dateOfBirth,
    documentType: kycDocumentType,
    documentNumber,
    documents: z.object({
      front: documentId,
      back: documentId.optional(),
      selfie: documentId,
    }),
  })
  .superRefine((value, ctx) => {
    if (requiredDocumentKinds(value.documentType).includes("BACK") && !value.documents.back) {
      ctx.addIssue({
        code: "custom",
        path: ["documents", "back"],
        message: "Add a photo of the back of your document",
      });
    }
  });
export type KycSubmissionRequest = z.infer<typeof kycSubmissionRequest>;

/** What an upload answers with: enough to refer to the photograph, nothing more. */
export const kycDocumentResponse = z.object({
  id: z.string(),
  kind: kycDocumentKind,
  contentType: z.enum(KYC_IMAGE_TYPES),
  sizeBytes: z.number().int().nonnegative(),
});
export type KycDocumentResponse = z.infer<typeof kycDocumentResponse>;

/**
 * What the customer is told about where they stand. The dates and the reason
 * describe the newest attempt only; the whole history is an administrator's
 * view, not theirs.
 *
 * `documents` is the staging area: photographs uploaded but not yet part of
 * any submission. It is what lets a form abandoned halfway be picked up where
 * it was left rather than started again, and it is empty the moment a
 * submission claims them.
 */
export const kycStateResponse = z.object({
  status: kycStatus,
  submittedAt: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  documents: z.array(kycDocumentResponse),
});
export type KycStateResponse = z.infer<typeof kycStateResponse>;

/*
  What verification is worth, in US dollars per day. Dollars because the
  asset traded here is USDT, which is worth a dollar, and a ceiling stated in
  the asset's own unit does not move with the exchange rate.

  PLACEHOLDER FIGURES (owner decision outstanding). They are here so the
  interface can state a number instead of being vague, and so there is one
  place to change once the real ceilings are settled. Nothing enforces them
  yet - the ledger and the trade engine do that in Phase 2 - so changing them
  today changes only what the screens promise.
*/
export interface KycTier {
  readonly label: string;
  /** Most a customer may buy or sell in a day, in whole dollars. */
  readonly dailyTradeUsd: number;
  /** Most a customer may withdraw in a day, in whole dollars. */
  readonly dailyWithdrawalUsd: number;
  /** Whether they may publish their own offer rather than only taking others'. */
  readonly canPostOffers: boolean;
}

export const KYC_TIERS: { readonly unverified: KycTier; readonly verified: KycTier } = {
  unverified: {
    label: "Unverified",
    dailyTradeUsd: 100,
    dailyWithdrawalUsd: 100,
    canPostOffers: false,
  },
  verified: {
    label: "Verified",
    dailyTradeUsd: 5_000,
    dailyWithdrawalUsd: 2_000,
    canPostOffers: true,
  },
};

/** The tier an account is on right now. Only APPROVED lifts the ceiling. */
export function tierFor(status: KycStatus): KycTier {
  return status === "APPROVED" ? KYC_TIERS.verified : KYC_TIERS.unverified;
}
