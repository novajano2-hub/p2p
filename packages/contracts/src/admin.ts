import { z } from "zod";

import { kycDocumentKind, kycDocumentType, kycRejectionReason, kycStatus } from "./kyc";

/*
  The administrator's side of the platform.

  A separate realm from the customer's, decided in Phase 0 (open-questions Q2)
  and shaped by the threat model's B7: an administrator has their own account,
  their own session, their own cookie and their own routes, and shares no
  infrastructure with a customer. Nothing under /v1/admin is reachable with a
  customer session, and nothing under /v1 is reachable with an admin one.

  Capability is granted per role, never implied by being an administrator.
*/

export const adminRole = z.enum([
  "KYC_REVIEWER",
  "DISPUTE_RESOLVER",
  "WITHDRAWAL_APPROVER",
  "FINANCIAL_ADJUSTER",
  "LEDGER_VIEWER",
  "DEPOSIT_REVIEWER",
]);
export type AdminRole = z.infer<typeof adminRole>;

/** Six digits from an authenticator app. Trimmed: people paste these. */
export const totpCode = z
  .string()
  .trim()
  .regex(/^\d{6}$/, { error: "Enter the 6-digit code from your authenticator app." });

export const adminLoginRequest = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1),
  /*
    Absent on the first attempt. If the account has a second factor enrolled,
    the answer is MFA_REQUIRED and the client repeats the request with the
    code filled in; an account not yet enrolled signs in without one and can
    then reach nothing but the enrollment routes.
  */
  code: totpCode.optional(),
});
export type AdminLoginRequest = z.infer<typeof adminLoginRequest>;

/** Everything the admin interface is allowed to know about whoever is signed in. */
export const adminIdentity = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  roles: z.array(adminRole),
  /** False until a code has been confirmed. The interface gates on this. */
  mfaEnrolled: z.boolean(),
});
export type AdminIdentity = z.infer<typeof adminIdentity>;

export const adminSessionResponse = z.object({ admin: adminIdentity });
export type AdminSessionResponse = z.infer<typeof adminSessionResponse>;

/* --------------------------------------------------------------------- mfa */

/**
 * A fresh, not-yet-active secret for enrollment. The URI is what the QR code
 * encodes; the secret is the same value spelled out for typing into an app by
 * hand. Neither grants anything until a code computed from it is confirmed -
 * and this is the ONLY time the secret ever leaves the server, because it is
 * the one moment the authenticator app needs it.
 */
export const adminMfaSetupResponse = z.object({
  secret: z.string(),
  otpauthUri: z.string(),
});
export type AdminMfaSetupResponse = z.infer<typeof adminMfaSetupResponse>;

/** Proves the app was really enrolled: a code computed from the pending secret. */
export const adminMfaConfirmRequest = z.object({ code: totpCode });
export type AdminMfaConfirmRequest = z.infer<typeof adminMfaConfirmRequest>;

/* -------------------------------------------------------------- kyc review */

/**
 * One submission as the queue lists it. This is RESTRICTED personal data
 * (docs/architecture/data-classification.md) and the only place in the system
 * it is ever returned: a customer cannot read it back, and no other admin
 * route exposes it.
 */
export const kycReviewItem = z.object({
  id: z.string(),
  status: kycStatus,
  submittedAt: z.string(),
  reviewedAt: z.string().nullable(),

  /** Who it belongs to, as the queue needs to show them. */
  account: z.object({
    userId: z.string(),
    platformId: z.string(),
    username: z.string(),
    email: z.string(),
  }),

  /** What they claim, to be checked against the photographs. */
  legalName: z.string(),
  dateOfBirth: z.string(),
  country: z.string(),
  documentType: kycDocumentType,
  documentNumber: z.string(),

  documents: z.array(z.object({ id: z.string(), kind: kycDocumentKind })),
});
export type KycReviewItem = z.infer<typeof kycReviewItem>;

export const kycQueueResponse = z.object({
  submissions: z.array(kycReviewItem),
  /** How many are still waiting, so the queue can say so without a second call. */
  pending: z.number().int().nonnegative(),
});
export type KycQueueResponse = z.infer<typeof kycQueueResponse>;

/**
 * Approving asks nothing of the administrator: there is no reason to record
 * because there is nothing to explain, and no wording to compose because
 * nobody reads one. The request body is empty on purpose - not optional
 * fields nobody fills in, an actually empty shape.
 */
export const kycApproveRequest = z.object({});
export type KycApproveRequest = z.infer<typeof kycApproveRequest>;

/**
 * Rejecting asks for exactly one thing: which of the fixed reasons applies.
 * Not a sentence the administrator composes - see kycRejectionReason in
 * ./kyc for why a closed set is the right shape for this, not a shortcut past
 * a better one.
 */
export const kycRejectRequest = z.object({
  reason: kycRejectionReason,
});
export type KycRejectRequest = z.infer<typeof kycRejectRequest>;

/* --------------------------------------------------------------- customers */

/*
  A customer, as an administrator deciding something about their money needs
  to see them. Deliberately four fields: enough to be sure this is the right
  person, and nothing about their identity documents, their balance or their
  trading. Anyone who needs those has a role that opens the screen that shows
  them.
*/
export const adminCustomerSummary = z.object({
  userId: z.string(),
  /** "BQ-" and eight digits: what a person quotes to support. */
  platformId: z.string(),
  username: z.string(),
  email: z.string(),
  status: z.enum(["ACTIVE", "SUSPENDED", "CLOSED"]),
  kycStatus: kycStatus,
});
export type AdminCustomerSummary = z.infer<typeof adminCustomerSummary>;

/**
 * Finding a customer by something a human actually has: their account
 * number, their username, or their email. Never by internal id - if you
 * already have the id you are not searching.
 */
export const adminCustomerSearchQuery = z.object({
  q: z.string().trim().min(2).max(120),
});
export type AdminCustomerSearchQuery = z.infer<typeof adminCustomerSearchQuery>;

export const adminCustomerSearchResponse = z.object({
  customers: z.array(adminCustomerSummary),
  /** True when more matched than were returned: narrow the search. */
  truncated: z.boolean(),
});
export type AdminCustomerSearchResponse = z.infer<typeof adminCustomerSearchResponse>;
