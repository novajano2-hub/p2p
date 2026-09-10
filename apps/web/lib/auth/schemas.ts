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
