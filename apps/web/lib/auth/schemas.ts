import { z } from "zod";

/*
  Validation for the sign-in and sign-up forms. Rules live here, once, so the
  live password checklist and the submit-time validation cannot disagree.

  Identifier: email only at launch (owner decision, 2026-09-08). Phone sign-in
  waits for an SMS provider.

  Password policy matches Binance exactly (8+ characters, a number, an upper
  case letter): the audience already knows those rules, and Argon2id on the
  server carries the real security weight. Server-side enforcement is
  authoritative; this is the client mirror.
*/

export const passwordRules = [
  {
    id: "length",
    label: "At least 8 characters",
    test: (value: string) => value.length >= 8,
  },
  {
    id: "number",
    label: "At least 1 number",
    test: (value: string) => /\d/.test(value),
  },
  {
    id: "upper",
    label: "At least 1 upper case letter",
    test: (value: string) => /[A-Z]/.test(value),
  },
] as const;

export type PasswordRuleId = (typeof passwordRules)[number]["id"];

export const emailSchema = z
  .string()
  .trim()
  .min(1, { error: "Enter your email address" })
  .pipe(z.email({ error: "Enter a valid email address" }));

export const codeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, { error: "Enter the 6-digit code" });

export const newPasswordSchema = z
  .string()
  .refine((value) => passwordRules.every((rule) => rule.test(value)), {
    error: "Your password does not meet the requirements yet",
  });

export const registerEmailForm = z.object({
  email: emailSchema,
  consent: z.boolean().refine((agreed) => agreed, {
    error: "Agree to the Terms and the Privacy Policy to continue",
  }),
});
export type RegisterEmailForm = z.infer<typeof registerEmailForm>;

export const codeForm = z.object({ code: codeSchema });
export type CodeForm = z.infer<typeof codeForm>;

export const newPasswordForm = z.object({ password: newPasswordSchema });
export type NewPasswordForm = z.infer<typeof newPasswordForm>;

export const loginEmailForm = z.object({ email: emailSchema });
export type LoginEmailForm = z.infer<typeof loginEmailForm>;

export const loginPasswordForm = z.object({
  password: z.string().min(1, { error: "Enter your password" }),
});
export type LoginPasswordForm = z.infer<typeof loginPasswordForm>;

export const recoverForm = z.object({ email: emailSchema });
export type RecoverForm = z.infer<typeof recoverForm>;

/** Mirrors the server's rule for a username (packages/contracts/src/auth.ts). */
export const usernameForm = z.object({
  username: z
    .string()
    .trim()
    .min(3, { error: "Use at least 3 characters" })
    .max(20, { error: "Use at most 20 characters" })
    .regex(/^[A-Za-z0-9_]+$/, { error: "Use letters, numbers and underscores only" }),
});
export type UsernameForm = z.infer<typeof usernameForm>;

/*
  Identity verification, split the way the steps are: which document, then
  what it says. The photographs are not form fields - the flow holds the ids
  the uploads returned. Mirrors the server's rules in @abay/contracts; the
  server is the authority and checks all of it again.
*/
export const kycDocumentForm = z.object({
  documentType: z.enum(["NATIONAL_ID", "PASSPORT", "DRIVERS_LICENSE"], {
    error: "Choose the document you will photograph",
  }),
});
export type KycDocumentForm = z.infer<typeof kycDocumentForm>;

/** 18 is the age of majority in Ethiopia, and the floor for holding money here. */
export const MINIMUM_AGE_YEARS = 18;

/** Nobody alive is older than this; a date beyond it is a typo, not a person. */
export const MAXIMUM_AGE_YEARS = 120;

function yearsSince(iso: string): number {
  const from = new Date(iso + "T00:00:00Z");
  const now = new Date();
  let years = now.getUTCFullYear() - from.getUTCFullYear();
  const months = now.getUTCMonth() - from.getUTCMonth();
  if (months < 0 || (months === 0 && now.getUTCDate() < from.getUTCDate())) years -= 1;
  return years;
}

export const kycDetailsForm = z.object({
  legalName: z
    .string()
    .trim()
    .min(2, { error: "Enter your full name as printed on your document" })
    .max(120, { error: "That name is too long" }),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Choose your date of birth" })
    .refine((value) => yearsSince(value) >= MINIMUM_AGE_YEARS, {
      error: "You must be at least " + MINIMUM_AGE_YEARS + " to use BIRQ",
    })
    .refine((value) => yearsSince(value) <= MAXIMUM_AGE_YEARS, {
      error: "Enter a real date of birth",
    }),
  documentNumber: z
    .string()
    .trim()
    .toUpperCase()
    .min(4, { error: "Enter the number printed on your document" })
    .max(40, { error: "That document number is too long" })
    .regex(/^[A-Z0-9][A-Z0-9 /-]*$/, { error: "Use letters, numbers, spaces, dashes and slashes" }),
});
export type KycDetailsForm = z.infer<typeof kycDetailsForm>;
