import { z } from "zod";

/*
  Authentication contracts. Written by hand: nothing here is derived from a
  Prisma model, so a password hash cannot reach a browser because someone
  reused a type.

  Every flow has the same shape. Something is proved (an inbox, a password),
  the server hands back a short-lived single-use ticket, and the next step
  spends the ticket. Nothing is written to `users` until a sign-up's password
  step succeeds, so an abandoned sign-up leaves no row and no way to ask "is
  this address taken".

    sign-up:   start(email) -> code -> verify -> ticket -> complete(password)
    log-in:    login(email, password) -> code -> ticket -> verify(code)
    reset:     start(email) -> code -> verify -> ticket -> complete(password)
*/

/** Addresses are compared lower-cased and trimmed, here and in the database. */
export const emailAddress = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Enter a valid email address" }))
  .pipe(z.string().max(254, { error: "That email address is too long" }));

/**
 * The password policy, in one place. Matches what the sign-up form shows as it
 * is typed; the server is the authority and re-checks it.
 */
export const password = z
  .string()
  .min(8, { error: "Use at least 8 characters" })
  .max(200, { error: "That password is too long" })
  .regex(/\d/, { error: "Include at least 1 number" })
  .regex(/[A-Z]/, { error: "Include at least 1 upper case letter" });

export const verificationCode = z
  .string()
  .trim()
  .regex(/^\d{6}$/, { error: "Enter the 6-digit code" });

/** Proof that a step was passed. Single use, short lived, server-issued, opaque. */
export const ticket = z.string().min(20).max(200);

export const ticketResponse = z.object({ ticket });
export type TicketResponse = z.infer<typeof ticketResponse>;

/* Sign-up */

export const registerStartRequest = z.object({ email: emailAddress });
export type RegisterStartRequest = z.infer<typeof registerStartRequest>;

export const registerVerifyRequest = z.object({ email: emailAddress, code: verificationCode });
export type RegisterVerifyRequest = z.infer<typeof registerVerifyRequest>;

export const registerCompleteRequest = z.object({ ticket, password });
export type RegisterCompleteRequest = z.infer<typeof registerCompleteRequest>;

/* Log-in */

export const loginRequest = z.object({
  email: emailAddress,
  /** Not the `password` policy: an old password that no longer meets it must still sign in. */
  password: z.string().min(1, { error: "Enter your password" }).max(200),
});
export type LoginRequest = z.infer<typeof loginRequest>;

export const loginVerifyRequest = z.object({ ticket, code: verificationCode });
export type LoginVerifyRequest = z.infer<typeof loginVerifyRequest>;

/** Re-send the code for an in-progress log-in. The ticket is the only handle. */
export const loginResendRequest = z.object({ ticket });
export type LoginResendRequest = z.infer<typeof loginResendRequest>;

/* Password reset */

export const passwordResetRequest = z.object({ email: emailAddress });
export type PasswordResetRequest = z.infer<typeof passwordResetRequest>;

export const passwordResetVerifyRequest = z.object({
  email: emailAddress,
  code: verificationCode,
});
export type PasswordResetVerifyRequest = z.infer<typeof passwordResetVerifyRequest>;

export const passwordResetCompleteRequest = z.object({ ticket, password });
export type PasswordResetCompleteRequest = z.infer<typeof passwordResetCompleteRequest>;

/* Profile */

/**
 * Chosen by the customer and shown to counterparties. Letters, digits and
 * underscores only, so it can never look like an email, a number or markup.
 */
export const username = z
  .string()
  .trim()
  .min(3, { error: "Use at least 3 characters" })
  .max(20, { error: "Use at most 20 characters" })
  .regex(/^[A-Za-z0-9_]+$/, { error: "Use letters, numbers and underscores only" });

export const updateProfileRequest = z.object({ username });
export type UpdateProfileRequest = z.infer<typeof updateProfileRequest>;

/* Session */

export const userStatus = z.enum(["ACTIVE", "SUSPENDED", "CLOSED"]);
export type UserStatus = z.infer<typeof userStatus>;

/** Everything the client is allowed to know about the signed-in account. */
export const sessionUser = z.object({
  id: z.string(),
  email: z.string(),
  /** The customer-facing account number, "BQ-" and eight digits. Never changes. */
  platformId: z.string(),
  username: z.string(),
  status: userStatus,
  emailVerified: z.boolean(),
});
export type SessionUser = z.infer<typeof sessionUser>;

export const sessionResponse = z.object({ user: sessionUser });
export type SessionResponse = z.infer<typeof sessionResponse>;

/**
 * Deliberately empty of detail. Every registration and reset start returns
 * this, whether or not the address is known, so the endpoint cannot be used to
 * discover who has an account.
 */
export const acceptedResponse = z.object({ status: z.literal("accepted") });
export type AcceptedResponse = z.infer<typeof acceptedResponse>;

/** A step that finished and left nothing for the client to hold on to. */
export const completedResponse = z.object({ status: z.literal("completed") });
export type CompletedResponse = z.infer<typeof completedResponse>;

/**
 * Why a Google sign-in bounced back to the log-in page. Carried in the URL,
 * so short, fixed, and never anything about the account.
 */
export const googleFailure = z.enum([
  "unavailable",
  "denied",
  "expired",
  "failed",
  "unverified_email",
  "closed",
]);
export type GoogleFailure = z.infer<typeof googleFailure>;
