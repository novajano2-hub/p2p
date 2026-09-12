import { z } from "zod";

/**
 * Stable, machine-readable error codes. Clients switch on `code`, never on
 * `message`: messages are for humans and may change; codes are a contract.
 */
export const errorCode = z.enum([
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  /**
   * A cookie-authenticated mutation arrived without proof that the page asking
   * for it is ours: a missing or wrong CSRF token, or an Origin that is not on
   * the allowlist. Separate from FORBIDDEN because the cause and the cure are
   * different - the caller is not lacking a permission, its request is not
   * trusted to have come from the application at all.
   */
  "CSRF_FAILED",
  /**
   * The password was right and it is not enough: this account signs in with a
   * second factor, and the request did not carry a (valid) code. The client's
   * next move is to ask the person for the six digits and try again - which is
   * why it is its own code rather than a flavour of UNAUTHENTICATED.
   */
  "MFA_REQUIRED",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "PAYLOAD_TOO_LARGE",
  "NOT_READY",
  "INTERNAL",
]);
export type ErrorCode = z.infer<typeof errorCode>;

export const errorDetail = z.object({
  /** Dot path into the request body, e.g. "amount" or "items.2.quantity". */
  path: z.string(),
  message: z.string(),
});
export type ErrorDetail = z.infer<typeof errorDetail>;

/**
 * The one error envelope every endpoint returns. `correlationId` matches the
 * `x-request-id` response header and the server's log line for the request,
 * so a support ticket can quote it and the log can be found.
 */
export const apiError = z.object({
  error: z.object({
    code: errorCode,
    message: z.string(),
    correlationId: z.string(),
    details: z.array(errorDetail).optional(),
  }),
});
export type ApiError = z.infer<typeof apiError>;
