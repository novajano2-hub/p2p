import { z } from "zod";

/*
  Authentication contracts. Written by hand: nothing here is derived from a
  Prisma model, so a password hash cannot reach a browser because someone
  reused a type.

  Registration is three steps because the address is proved before an account
  exists. Nothing is written to `users` until the password step succeeds, so an
  abandoned sign-up leaves no row and no way to ask "is this address taken".
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

export const registerStartRequest = z.object({ email: emailAddress });
export type RegisterStartRequest = z.infer<typeof registerStartRequest>;

export const registerVerifyRequest = z.object({
  email: emailAddress,
  code: verificationCode,
});
export type RegisterVerifyRequest = z.infer<typeof registerVerifyRequest>;

/** Proof that the address was verified. Single use, short lived, server-issued. */
export const registrationTicket = z.string().min(20).max(200);

export const registerVerifyResponse = z.object({ ticket: registrationTicket });
export type RegisterVerifyResponse = z.infer<typeof registerVerifyResponse>;

export const registerCompleteRequest = z.object({
  ticket: registrationTicket,
  password,
});
export type RegisterCompleteRequest = z.infer<typeof registerCompleteRequest>;

export const loginRequest = z.object({
  email: emailAddress,
  /** Not the `password` policy: an old password that no longer meets it must still sign in. */
  password: z.string().min(1, { error: "Enter your password" }).max(200),
});
export type LoginRequest = z.infer<typeof loginRequest>;

export const passwordResetRequest = z.object({ email: emailAddress });
export type PasswordResetRequest = z.infer<typeof passwordResetRequest>;

export const userStatus = z.enum(["ACTIVE", "SUSPENDED", "CLOSED"]);
export type UserStatus = z.infer<typeof userStatus>;

/** Everything the client is allowed to know about the signed-in account. */
export const sessionUser = z.object({
  id: z.string(),
  email: z.string(),
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
